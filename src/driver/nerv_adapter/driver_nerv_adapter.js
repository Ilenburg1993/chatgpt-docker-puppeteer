// @ts-check - Type checking rigoroso habilitado (arquivo core)
import EventEmitter from 'node:events';
import * as driverFactory from '../factory.js';
import { STATUS_VALUES } from '#core/constants/tasks';
import { log } from '#core/logger';
import { ActionCode, MessageType, ActorRole } from '#shared/nerv/constants';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';
import {
    getActionCode,
    getCorrelationId,
    getMessageType,
    getPayload,
    getTaskIdFromPayload,
} from '#shared/nerv/envelope_reader';
import { putBuffer, putJson, putText } from '#infra/storage/artifact_store';

// ============================================================================
// ADAPTER_CONFIG - Zero Magic Numbers
// ============================================================================

/**
 * Configuração do DriverNERVAdapter.
 * Todas as constantes configuráveis via environment variables.
 *
 * @const {object} ADAPTER_CONFIG
 */
const ADAPTER_CONFIG = {
    /** Timeout máximo para execução de task (ms) - Default: 5 minutos */
    EXECUTE_TASK_TIMEOUT_MS: parseInt(process.env.ADAPTER_EXECUTE_TIMEOUT || '300000', 10),

    /** Timeout para shutdown gracioso (ms) - Default: 30 segundos */
    SHUTDOWN_TIMEOUT_MS: parseInt(process.env.ADAPTER_SHUTDOWN_TIMEOUT || '30000', 10),

    /** Intervalo para health check periódico (ms) - Default: 1 minuto */
    HEALTH_CHECK_INTERVAL_MS: parseInt(process.env.ADAPTER_HEALTH_INTERVAL || '60000', 10),

    /** Máximo de drivers ativos simultaneamente - Default: 10 */
    MAX_ACTIVE_DRIVERS: parseInt(process.env.ADAPTER_MAX_DRIVERS || '10', 10),

    /** Tamanho do buffer de telemetria para batch emit - Default: 1000 */
    TELEMETRY_BUFFER_SIZE: parseInt(process.env.ADAPTER_TELEMETRY_BUFFER || '1000', 10),

    /** Intervalo de flush de telemetria (ms) - Default: 1000 (env: ADAPTER_TELEMETRY_FLUSH_INTERVAL) */
    TELEMETRY_FLUSH_INTERVAL_MS: parseInt(process.env.ADAPTER_TELEMETRY_FLUSH_INTERVAL || '1000', 10),

    /** Intervalo para warning de modo degradado (ms) - Default: 1 minuto */
    DEGRADED_MODE_WARNING_INTERVAL_MS: parseInt(process.env.ADAPTER_DEGRADED_WARNING || '60000', 10),

    /** Máximo de tentativas para retry de eventos NERV - Default: 3 */
    EVENT_RETRY_MAX_ATTEMPTS: parseInt(process.env.ADAPTER_EVENT_RETRY || '3', 10),

    /** Backoff entre retries de eventos (ms) - Default: 100ms */
    EVENT_RETRY_BACKOFF_MS: parseInt(process.env.ADAPTER_EVENT_BACKOFF || '100', 10),

    /** Circuit breaker: threshold de falhas - Default: 5 */
    CIRCUIT_BREAKER_THRESHOLD: parseInt(process.env.ADAPTER_CIRCUIT_THRESHOLD || '5', 10),

    /** Circuit breaker: timeout para HALF_OPEN (ms) - Default: 1 minuto */
    CIRCUIT_BREAKER_TIMEOUT_MS: parseInt(process.env.ADAPTER_CIRCUIT_TIMEOUT || '60000', 10),

    // ✅ U5: Smart Retry Configuration
    /** Máximo de retries para tasks - Default: 3 */
    MAX_RETRY_ATTEMPTS: parseInt(process.env.ADAPTER_MAX_RETRIES || '3', 10),

    /** Backoff inicial para retry (ms) - Default: 1000ms (1s → 2s → 4s) */
    RETRY_BACKOFF_MS: parseInt(process.env.ADAPTER_RETRY_BACKOFF || '1000', 10),

    /** Heartbeat interval (ms) - Default: 10s */
    TASK_HEARTBEAT_INTERVAL_MS: parseInt(process.env.ADAPTER_TASK_HEARTBEAT_INTERVAL_MS || '10000', 10),

    /** Max HTML bytes to store in diagnostic artifact (default: 1MB) */
    DIAGNOSTIC_HTML_MAX_BYTES: parseInt(process.env.ADAPTER_DIAGNOSTIC_HTML_MAX_BYTES || '1000000', 10),
};

// ============================================================================
// ADAPTER_EVENTS - Eventos Locais (EventEmitter)
// ============================================================================

/**
 * Eventos emitidos pelo DriverNERVAdapter (EventEmitter).
 * Estes são eventos LOCAIS (subscribers no mesmo processo).
 * Para eventos NERV (IPC), usar ActionCode.DRIVER_*.
 *
 * @const {object} ADAPTER_EVENTS
 */
const ADAPTER_EVENTS = {
    TASK_STARTED: 'adapter:task_started',
    TASK_COMPLETED: 'adapter:task_completed',
    TASK_FAILED: 'adapter:task_failed',
    TASK_ABORTED: 'adapter:task_aborted',
    TASK_QUEUED: 'adapter:task_queued',
    TASK_RETRYING: 'adapter:task_retrying',
    TASK_STATE_OBSERVED: 'adapter:task_state_observed',

    DRIVER_ATTACHED: 'adapter:driver_attached',
    DRIVER_DETACHED: 'adapter:driver_detached',

    HEALTH_CHECK: 'adapter:health_check',
    ERROR: 'adapter:error',

    DEGRADED_MODE: 'adapter:degraded_mode',

    CIRCUIT_BREAKER_OPEN: 'adapter:circuit_breaker_open',
    CIRCUIT_BREAKER_CLOSED: 'adapter:circuit_breaker_closed',

    SHUTDOWN: 'adapter:shutdown',
};

// ============================================================================
// DriverNERVAdapter Class (EventEmitter v2.0)
// ============================================================================

/** Classe exportada: DriverNERVAdapter. */
class DriverNERVAdapter extends EventEmitter {
    /**
     * @param {any} nerv
     * @param {any} browserPool
     * @param {any} [config]
     */
    constructor(nerv, browserPool, config) {
        super();

        if (!nerv) {
            throw new Error('[DriverNERVAdapter] NERV instance required');
        }

        if (!browserPool) {
            log('WARN', '[DriverNERVAdapter] Inicializando em MODO DEGRADADO (browserPool = null)');
            log('WARN', '[DriverNERVAdapter] Comandos de execução serão rejeitados até Browser Pool ser configurado');
        }

        this.nerv = nerv;
        this.browserPool = browserPool || null;
        this.config = config || {};
        this.degradedMode = !this.browserPool;

        // Key: taskId
        // Value: { driver, page, listeners, abortController, externalAbortForwarder }
        this.activeDrivers = new Map();
        /** @type {any[]} */
        this.telemetryBuffer = [];
        // Reentrancy guard for telemetry flush
        this._isFlushing = false;

        this.circuitBreakers = new Map();

        // ✅ MUST exist (era bug crítico)
        this.abortedTasks = new Map();
        this._nervUnsubscribe = null;
        this._shutdownPromise = null;
        this._shutdownResult = null;

        /** @type {any} */
        this.performanceMetrics = {
            poolAcquireTimes: [],
            contextAttachTimes: [],
            executeTimes: [],
            detachTimes: [],
            releaseTimes: [],
            totalTimes: [],
            avgPoolAcquire: 0,
            avgContextAttach: 0,
            avgExecute: 0,
            avgDetach: 0,
            avgRelease: 0,
            avgTotal: 0,
        };

        this.stats = {
            tasksExecuted: 0,
            tasksAborted: 0,
            driversCrashed: 0,
            vitalsEmitted: 0,

            tasksRejected: 0,
            tasksTimedOut: 0,
            eventsEmitted: 0,
            eventsFailed: 0,
            driversAttached: 0,
            driversDetached: 0,
            healthChecksPerformed: 0,
            degradedModeWarnings: 0,
            circuitBreakerTrips: 0,

            tasksRetried: 0,
            retriesSucceeded: 0,
            retriesFailed: 0,

            totalTaskDuration: 0,
            maxTaskDuration: 0,
            minTaskDuration: Infinity,

            startTime: Date.now(),
        };

        this._setupListeners();
        this._startPeriodicHealthCheck();
        this._startTelemetryFlush();

        if (this.degradedMode) {
            this._startDegradedModeWarning();
        }

        log('INFO', '[DriverNERVAdapter] v2.0 inicializado e conectado ao NERV');
        log(
            'INFO',
            `[DriverNERVAdapter] Config: MAX_ACTIVE_DRIVERS=${ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS}, EXECUTE_TIMEOUT=${ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS}ms`
        );
    }

    _setupListeners() {
        const unsubscribe = this.nerv.onReceive((/** @type {any} */ envelope) => {
            const messageType = getMessageType(envelope);
            const actionCode = getActionCode(envelope);
            const correlationId = getCorrelationId(envelope);

            if (messageType !== MessageType.COMMAND) return;
            if (!actionCode || !actionCode.startsWith('DRIVER_')) return;

            this._handleDriverCommand(envelope).catch((/** @type {any} */ err) => {
                log(
                    'ERROR',
                    `[DriverNERVAdapter] Erro ao processar comando: ${err?.message || String(err)}`,
                    correlationId
                );

                let taskId;
                try {
                    taskId = getTaskIdFromPayload(getPayload(envelope));
                } catch (/** @type {any} */ taskIdError) {
                    log(
                        'WARN',
                        `[DriverNERVAdapter] Falha ao extrair taskId do comando: ${taskIdError?.message || String(taskIdError)}`,
                        correlationId
                    );
                    taskId = undefined;
                }

                // ✅ P1-4: Removed 'void' to allow .catch() to work properly
                this._emitBoth(
                    ADAPTER_EVENTS.ERROR,
                    ActionCode.DRIVER_ERROR,
                    {
                        error: err?.message || String(err),
                        taskId,
                        originalCommand: actionCode,
                        reason: 'INFRASTRUCTURE_ERROR',
                    },
                    correlationId
                ).catch((/** @type {any} */ emitErr) => {
                    log(
                        'ERROR',
                        `[DriverNERVAdapter] Falha ao emitir DRIVER_ERROR: ${emitErr?.message || String(emitErr)}`,
                        correlationId
                    );
                });
            });
        });

        this._nervUnsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;
        log('DEBUG', '[DriverNERVAdapter] Listeners configurados para DRIVER_* commands');
    }

    /**
     * @param {any} envelope
     */
    async _handleDriverCommand(envelope) {
        const actionCode = getActionCode(envelope);
        const payload = /** @type {any} */ (getPayload(envelope));
        const correlationId = getCorrelationId(envelope);

        let taskId;
        try {
            taskId = getTaskIdFromPayload(payload);
        } catch (/** @type {any} */ taskIdError) {
            log(
                'DEBUG',
                `[DriverNERVAdapter] getTaskIdFromPayload falhou, aplicando fallback: ${taskIdError?.message || String(taskIdError)}`,
                correlationId
            );
            taskId = payload?.taskId || payload?.task?.meta?.id || payload?.task?.id || null;
        }

        log('DEBUG', `[DriverNERVAdapter] Recebido comando: ${actionCode}`, correlationId);

        if (this.degradedMode && actionCode === ActionCode.DRIVER_EXECUTE_TASK) {
            log(
                'WARN',
                `[DriverNERVAdapter] REJEITADO: Sistema em modo degradado (Browser Pool não disponível)`,
                correlationId
            );

            await this._emitBoth(
                ADAPTER_EVENTS.TASK_FAILED,
                ActionCode.DRIVER_TASK_FAILED,
                {
                    taskId,
                    reason: 'DEGRADED_MODE',
                    reason_class: 'ENV_UNAVAILABLE',
                    reason_code: 'DEGRADED_MODE',
                    cause_layer: 'BROWSER_POOL',
                    error: 'Sistema em modo degradado - Browser Pool não disponível',
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    count_attempt: false,
                    suggestion:
                        'Configure o browserEndpoint/proxy com remote debugging exposto ao container (ver CONFIG.DEBUG_PORT ou CHROME_WS_ENDPOINT) e reinicie o sistema',
                    suggestedDelayMs: 1000,
                },
                correlationId
            );
            return;
        }

        switch (actionCode) {
            case ActionCode.DRIVER_EXECUTE_TASK: {
                const { validateBrowserPool } = await import('#core/validators/prerequisite_validator');
                const poolValidation = validateBrowserPool(this.browserPool);

                if (!poolValidation.valid) {
                    log('WARN', `[DriverNERVAdapter] Task rejeitada: ${poolValidation.reason}`, correlationId);

                    const retryable = Boolean(poolValidation.details?.retryable ?? false);
                    const suggestedDelayMs = Number(poolValidation.details?.suggestedDelayMs ?? 0) || 0;

                    await this._emitBoth(
                        ADAPTER_EVENTS.TASK_FAILED,
                        ActionCode.DRIVER_TASK_FAILED,
                        {
                            taskId,
                            reason: poolValidation.reason,
                            reason_class: retryable ? 'ENV_UNAVAILABLE' : 'TASK_ERROR',
                            reason_code: poolValidation.reason,
                            cause_layer: 'BROWSER_POOL',
                            error: poolValidation.details?.message || 'Pré-requisito não atendido',
                            suggestion: poolValidation.details?.suggestion,
                            retryable,
                            next_action: retryable ? 'RETRY_LATER' : 'ABORT',
                            ...(retryable ? { suggestedDelayMs: Math.max(250, suggestedDelayMs || 1000) } : {}),
                            count_attempt: false,
                        },
                        correlationId
                    );
                    return;
                }

                await this._executeTask(payload, correlationId);
                break;
            }

            case ActionCode.DRIVER_ABORT:
                await this._abortTask(payload, correlationId);
                break;

            case ActionCode.DRIVER_HEALTH_CHECK:
                await this._performHealthCheck(payload, correlationId);
                break;

            default:
                log('WARN', `[DriverNERVAdapter] Comando desconhecido: ${actionCode}`, correlationId);
        }
    }

    /**
     * @param {any} payload
     * @param {any} [correlationId]
     * @param {number} [retryCount]
     */
    async _executeTask(payload, correlationId, retryCount = 0) {
        const { task, signal: externalSignal } = payload;

        if (!task?.meta?.id) {
            throw new Error('Task inválida recebida via NERV');
        }

        if (!this.browserPool) {
            throw new Error('browserPool not available (degraded mode)');
        }

        const taskId = task.meta.id;
        const startTime = Date.now();

        /** @type {{ total: number, poolAcquire: number|null, contextAttach: number|null, execute: number|null, detach: number|null, release: number|null }} */
        const timings = {
            total: startTime,
            poolAcquire: null,
            contextAttach: null,
            execute: null,
            detach: null,
            release: null,
        };

        // Abort controller interno (permite abort por comando mesmo se payload só tiver signal)
        const abortController = new AbortController();
        const signal = abortController.signal;

        let externalAbortForwarder = null;
        if (externalSignal) {
            externalAbortForwarder = () => {
                try {
                    abortController.abort(externalSignal.reason);
                } catch (/** @type {any} */ abortReasonError) {
                    log(
                        'DEBUG',
                        `[DriverNERVAdapter] Abort reason inválido para ${taskId}, usando abort sem reason: ${abortReasonError?.message || String(abortReasonError)}`,
                        correlationId
                    );
                    abortController.abort();
                }
            };

            if (externalSignal.aborted) {
                externalAbortForwarder();
            } else {
                externalSignal.addEventListener('abort', externalAbortForwarder, { once: true });
            }
        }

        log('INFO', `[DriverNERVAdapter] Iniciando execução: ${taskId}`, correlationId);

        // ✅ P1 BUG #4 FIX: fail-fast se já abortado
        if (signal.aborted) {
            log('WARN', `[DriverNERVAdapter] Task ${taskId} already aborted before execution`, correlationId);

            await this._emitBoth(
                ADAPTER_EVENTS.TASK_ABORTED,
                ActionCode.DRIVER_TASK_ABORTED,
                {
                    taskId,
                    reason: 'PRE_EXECUTION_ABORT',
                    message: 'AbortSignal was already aborted before task execution started',
                },
                correlationId
            );

            this.stats.tasksAborted++;
            return;
        }

        if (this.activeDrivers.has(taskId)) {
            log(
                'WARN',
                `[DriverNERVAdapter] Task ${taskId} já possui driver ativo (duplicate dispatch)`,
                correlationId
            );

            const active = this.activeDrivers.get(taskId);
            const activeCorrelationId = active?.correlationId || null;

            await this._emitBoth(
                ADAPTER_EVENTS.TASK_FAILED,
                ActionCode.DRIVER_TASK_FAILED,
                {
                    taskId,
                    error: 'Task already running (duplicate dispatch)',
                    reason: 'TASK_ALREADY_RUNNING',
                    reason_class: 'ENV_UNAVAILABLE',
                    reason_code: 'TASK_ALREADY_RUNNING',
                    cause_layer: 'DRIVER_POOL',
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    suggestedDelayMs: 1000,
                    count_attempt: false,
                    do_not_unlock: true,
                    do_not_change_status: true,
                    activeCorrelationId,
                },
                correlationId
            );

            this.stats.tasksRejected++;
            return;
        }

        const target = task?.spec?.target || payload?.target || 'chatgpt';

        if (!this._canExecute(target)) {
            const breaker = this.circuitBreakers.get(target);
            const timeoutMs = breaker?.timeout ?? 1000;
            const failures = breaker?.failures ?? 0;
            const threshold = breaker?.threshold ?? 0;

            const error = `Circuit breaker OPEN for target ${target} - too many recent failures (${failures}/${threshold})`;

            log('WARN', `[DriverNERVAdapter] U2: ${error}`, correlationId);

            await this._emitBoth(
                ADAPTER_EVENTS.TASK_FAILED,
                ActionCode.DRIVER_TASK_FAILED,
                {
                    taskId,
                    target,
                    error,
                    reason: 'CIRCUIT_BREAKER_OPEN',
                    reason_class: 'ENV_UNAVAILABLE',
                    reason_code: 'CIRCUIT_BREAKER_OPEN',
                    cause_layer: 'BROWSER_POOL',
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    suggestion: `Aguarde ${Math.floor(timeoutMs / 1000)}s para circuit breaker recovery`,
                    suggestedDelayMs: timeoutMs,
                    count_attempt: false,
                },
                correlationId
            );

            this.stats.tasksRejected++;
            return;
        }

        // ✅ 3. Limite de drivers ativos → reject with retryable (SSOT reschedules; no in-memory driver queue)
        if (this.activeDrivers.size >= ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS) {
            const jitter = Math.floor(Math.random() * 250);
            const delay = 500 + jitter;
            const error = `Driver saturated (${this.activeDrivers.size}/${ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS})`;

            log('INFO', `[DriverNERVAdapter] Rejecting task ${taskId}: ${error}`, correlationId);

            await this._emitBoth(
                ADAPTER_EVENTS.TASK_FAILED,
                ActionCode.DRIVER_TASK_FAILED,
                {
                    taskId,
                    error,
                    reason: 'DRIVER_SATURATED',
                    reason_class: 'ENV_UNAVAILABLE',
                    reason_code: 'DRIVER_SATURATED',
                    cause_layer: 'DRIVER_POOL',
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    suggestedDelayMs: delay,
                    count_attempt: false,
                },
                correlationId
            );

            this.stats.tasksRejected++;
            return;
        }

        /** @type {any} */
        let page = null;
        /** @type {any} */
        let driver = null;
        /** @type {any[]} */
        let listeners = [];
        let abortHandler = null;

        // Registra entry consistente (corrige mismatch com abort/shutdown)
        /** @type {any} */
        const activeEntry = {
            driver: null,
            page: null,
            listeners: [],
            abortController,
            externalAbortForwarder,
            correlationId,
            heartbeatTimer: null,
        };
        this.activeDrivers.set(taskId, activeEntry);

        try {
            // Early ACK: admitted for processing (extends SSOT lock before slow steps like allocate/acquire).
            // ✅ P1-4: Removed 'void' and upgraded log level (heartbeat failure is critical for observability)
            activeEntry.heartbeatTimer = setInterval(() => {
                this._emitBoth(
                    ADAPTER_EVENTS.TASK_STATE_OBSERVED,
                    ActionCode.DRIVER_TASK_HEARTBEAT,
                    {
                        taskId,
                        target,
                    },
                    correlationId
                ).catch((/** @type {any} */ err) => {
                    log(
                        'WARN', // ✅ P1-4: Upgraded from DEBUG - heartbeat failures are important
                        `[DriverNERVAdapter] Heartbeat emit failed for ${taskId}: ${err?.message || String(err)}`,
                        correlationId
                    );
                });
            }, ADAPTER_CONFIG.TASK_HEARTBEAT_INTERVAL_MS);

            // Marca abortedTasks quando houver abort (interno ou externo)
            abortHandler = () => {
                log('WARN', `[DriverNERVAdapter] Abort signal received for task ${taskId}`, correlationId);

                const existing = this.abortedTasks.get(taskId) || {};
                this.abortedTasks.set(taskId, {
                    ...existing,
                    aborting: true,
                    abortReason: existing.abortReason || 'USER_ABORT',
                    timestamp: Date.now(),
                });
            };
            signal.addEventListener('abort', abortHandler, { once: true });

            // ✅ v3.1: Hot Pool - Acquire driver (may include page)
            const poolAcquireStart = Date.now();
            driver = await this._withTimeout(
                driverFactory.acquireFromPool(target),
                ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS,
                'driverFactory.acquireFromPool'
            );
            activeEntry.driver = driver;

            // Hot vs Cold Pool Logic
            if (driver.page && !driver.page.isClosed()) {
                // Hot Driver: Page already attached
                page = driver.page;
                log('DEBUG', `[DriverNERVAdapter] Hot Driver acquired (page attached).`, correlationId);
            } else {
                // Cold Driver: Allocate new page (legacy/fallback)
                log(
                    'WARN',
                    `[DriverNERVAdapter] Cold Driver detected (no page). Allocating page manually.`,
                    correlationId
                );
                page = await this._withTimeout(
                    this.browserPool.allocate(target),
                    ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS,
                    'browserPool.allocate'
                );
            }
            activeEntry.page = page;

            timings.poolAcquire = Date.now() - poolAcquireStart;

            if (this.browserPool.updatePageTaskId) {
                this.browserPool.updatePageTaskId(page, taskId);
            }

            log(
                'DEBUG',
                `[DriverNERVAdapter] Resources acquired for task ${taskId} (driver=${driver.target})`,
                correlationId
            );

            // Attach context
            const attachStart = Date.now();
            driver.attachContext(page, signal, correlationId);
            timings.contextAttach = Date.now() - attachStart;

            log('DEBUG', `[DriverNERVAdapter] Context attached to driver (state=${driver.state})`, correlationId);

            listeners = this._attachDriverTelemetry(driver, taskId, correlationId);
            activeEntry.listeners = listeners;

            // Driver ready check
            if (!driver) {
                throw new Error('[DriverNERVAdapter] Driver is null after acquire');
            }
            if (driver.destroyed) {
                throw new Error('[DriverNERVAdapter] Driver is destroyed after acquire');
            }
            if (driver.state !== 'IDLE') {
                log(
                    'WARN',
                    `[DriverNERVAdapter] Driver state is '${driver.state}' (expected 'IDLE'). Forçando reset para IDLE antes de executar.`,
                    correlationId
                );
                if (typeof driver.setState === 'function') {
                    driver.setState('IDLE');
                }
            }
            if (!driver.page || driver.page.isClosed()) {
                throw new Error('[DriverNERVAdapter] Driver page is null or closed after acquire');
            }

            let pageUrl = null;
            try {
                pageUrl = driver.page.url();
            } catch (/** @type {any} */ pageUrlError) {
                log(
                    'DEBUG',
                    `[DriverNERVAdapter] Não foi possível obter URL da página para ${taskId}: ${pageUrlError?.message || String(pageUrlError)}`,
                    correlationId
                );
                pageUrl = null;
            }

            // Preflight diagnostic (before STARTED): classify environment/user/UI problems deterministically.
            if (retryCount === 0) {
                const preflight = await this._runPreflight({ driver, page: driver.page, task, taskId, target, signal });
                if (!preflight.ok) {
                    const diag = await this._captureDiagnostics({
                        taskId,
                        correlationId,
                        target,
                        driver,
                        page: driver.page,
                        phase: 'preflight',
                        diagnosis: preflight.diagnosis || null,
                    });

                    await this._emitBoth(
                        ADAPTER_EVENTS.TASK_FAILED,
                        ActionCode.DRIVER_TASK_FAILED,
                        {
                            taskId,
                            error: preflight.failure?.error || 'Preflight failed',
                            reason: preflight.failure?.reason_code || preflight.failure?.reason || 'PREFLIGHT_FAILED',
                            reason_class: preflight.failure?.reason_class || 'ENV_UNAVAILABLE',
                            reason_code: preflight.failure?.reason_code || 'PREFLIGHT_FAILED',
                            cause_layer: preflight.failure?.cause_layer || 'PAGE',
                            retryable: Boolean(preflight.failure?.retryable),
                            next_action: preflight.failure?.next_action || 'RETRY_LATER',
                            suggestedDelayMs: preflight.failure?.suggestedDelayMs ?? null,
                            count_attempt: Boolean(preflight.failure?.count_attempt),
                            details: {
                                ...(preflight.failure?.details || {}),
                                ...(diag ? { diagnostic_storage: diag.storage, diagnosis_summary: diag.summary } : {}),
                            },
                        },
                        correlationId
                    );

                    this.stats.tasksRejected++;
                    return;
                }
            }

            // Tactical retries (browser-level) are still the same SSOT attempt (same correlationId).
            // Emit DRIVER_TASK_STARTED only once per attempt to avoid inflating strategic attempts.
            if (retryCount === 0) {
                await this._emitBoth(
                    ADAPTER_EVENTS.TASK_STARTED,
                    ActionCode.DRIVER_TASK_STARTED,
                    {
                        taskId,
                        target,
                        driverType: driver.constructor.name,
                        driverState: driver.state,
                        pageUrl,
                        activeDrivers: this.activeDrivers.size,
                    },
                    correlationId
                );
            }

            // Execute (timeout)
            const executeStart = Date.now();
            const systemMessage =
                typeof task?.spec?.payload?.system_message === 'string' ? task.spec.payload.system_message.trim() : '';
            const userMessage =
                typeof task?.spec?.payload?.user_message === 'string' ? task.spec.payload.user_message.trim() : '';
            const legacyPrompt =
                typeof task?.spec?.prompt === 'string'
                    ? task.spec.prompt
                    : typeof task?.prompt === 'string'
                      ? task.prompt
                      : '';
            const prompt = userMessage
                ? systemMessage
                    ? `SYSTEM:\n${systemMessage}\n\nUSER:\n${userMessage}`
                    : userMessage
                : legacyPrompt;
            if (!prompt) {
                throw new Error('[DriverNERVAdapter] Task prompt missing (expected spec.payload.user_message)');
            }
            const result = await this._withTimeout(
                driver.execute(prompt),
                ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS,
                'driver.execute'
            );
            timings.execute = Date.now() - executeStart;

            const duration = Date.now() - startTime;
            this.stats.totalTaskDuration += duration;
            this.stats.maxTaskDuration = Math.max(this.stats.maxTaskDuration, duration);
            this.stats.minTaskDuration = Math.min(this.stats.minTaskDuration, duration);

            timings.total = duration;
            this._recordPerformanceMetrics(timings);

            // Persist response (sem ReferenceError)
            let persisted = null;
            try {
                persisted = await this._persistResponse(taskId, result, task, correlationId);
                if (persisted) {
                    log('INFO', `[DriverNERVAdapter] Response saved for task ${taskId}`, correlationId);
                }
            } catch (/** @type {any} */ saveError) {
                log(
                    'ERROR',
                    `[DriverNERVAdapter] Failed to save response for ${taskId}: ${saveError?.message || String(saveError)}`,
                    correlationId
                );
            }

            await this._emitBoth(
                ADAPTER_EVENTS.TASK_COMPLETED,
                ActionCode.DRIVER_TASK_COMPLETED,
                {
                    taskId,
                    result,
                    storage: persisted?.storage || null,
                    storage_format: persisted?.format || null,
                    timings: {
                        poolAcquire: timings.poolAcquire,
                        contextAttach: timings.contextAttach,
                        execute: timings.execute,
                        total: duration,
                    },
                },
                correlationId
            );

            this.stats.tasksExecuted++;
            this._recordSuccess(target);
        } catch (/** @type {any} */ error) {
            const abortEntry = this.abortedTasks.get(taskId);
            const wasAborted = abortEntry?.aborting;

            if (wasAborted) {
                if (!abortEntry.reported) {
                    log('WARN', `[DriverNERVAdapter] Task ${taskId} aborted during execution`, correlationId);

                    await this._emitBoth(
                        ADAPTER_EVENTS.TASK_ABORTED,
                        ActionCode.DRIVER_TASK_ABORTED,
                        {
                            taskId,
                            reason: abortEntry.abortReason || 'USER_ABORT',
                            message: 'Task execution was aborted by AbortSignal',
                        },
                        correlationId
                    );

                    abortEntry.reported = true;
                    this.abortedTasks.set(taskId, abortEntry);
                    this.stats.tasksAborted++;
                }
            } else {
                const failure = this._classifyFailure(error);
                if (failure.isTimeout) {
                    this.stats.tasksTimedOut++;
                }

                let diag = null;
                try {
                    if (driver?.page && !(driver.page.isClosed && driver.page.isClosed())) {
                        diag = await this._captureDiagnostics({
                            taskId,
                            correlationId,
                            target,
                            driver,
                            page: driver.page,
                            phase: 'execute',
                            diagnosis: failure.details || null,
                        });
                    }
                } catch (/** @type {any} */ _) {
                    diag = null;
                }

                log(
                    'ERROR',
                    `[DriverNERVAdapter] Task failed (${failure.reason_class}/${failure.reason}): ${failure.error}`,
                    correlationId
                );

                await this._emitBoth(
                    ADAPTER_EVENTS.TASK_FAILED,
                    ActionCode.DRIVER_TASK_FAILED,
                    {
                        taskId,
                        error: failure.error,
                        reason: failure.reason,
                        reason_class: failure.reason_class,
                        reason_code: failure.reason_code || failure.reason,
                        cause_layer: failure.cause_layer || null,
                        retryable: failure.retryable,
                        next_action: failure.next_action,
                        suggestedDelayMs: failure.suggestedDelayMs,
                        count_attempt: failure.count_attempt,
                        details: {
                            ...(failure.details || {}),
                            ...(diag ? { diagnostic_storage: diag.storage, diagnosis_summary: diag.summary } : {}),
                        },
                    },
                    correlationId
                );

                this.stats.driversCrashed++;
                const targetForFailure = task?.spec?.target || payload?.target || 'chatgpt';
                this._recordFailure(targetForFailure);
            }
        } finally {
            try {
                if (activeEntry?.heartbeatTimer) {
                    clearInterval(activeEntry.heartbeatTimer);
                    activeEntry.heartbeatTimer = null;
                }
            } catch (/** @type {any} */ _) {
                /* ignore */
            }

            // Cleanup listeners
            try {
                if (signal && abortHandler) {
                    signal.removeEventListener('abort', abortHandler);
                }
            } catch (/** @type {any} */ removeAbortListenerError) {
                log(
                    'WARN',
                    `[DriverNERVAdapter] Falha ao remover listener de abort interno para ${taskId}: ${removeAbortListenerError?.message || String(removeAbortListenerError)}`,
                    correlationId
                );
            }

            // Remove forwarder do signal externo (evita leak)
            try {
                if (externalSignal && externalAbortForwarder) {
                    externalSignal.removeEventListener('abort', externalAbortForwarder);
                }
            } catch (/** @type {any} */ removeExternalAbortError) {
                log(
                    'WARN',
                    `[DriverNERVAdapter] Falha ao remover listener de abort externo para ${taskId}: ${removeExternalAbortError?.message || String(removeExternalAbortError)}`,
                    correlationId
                );
            }

            this.abortedTasks.delete(taskId);

            await this._finallyCleanup(taskId, page, driver, listeners);
        }
    }

    /**
     * @param {any} payload
     * @param {any} [correlationId]
     */
    async _abortTask(payload, correlationId) {
        const taskId = payload?.taskId;

        if (!taskId) {
            log('WARN', '[DriverNERVAdapter] Abort recebido sem taskId', correlationId);
            return;
        }

        const active = this.activeDrivers.get(taskId);

        if (!active) {
            log('WARN', `[DriverNERVAdapter] Task ${taskId} não encontrada para abortar`, correlationId);
            return;
        }

        log('INFO', `[DriverNERVAdapter] Abortando task: ${taskId}`, correlationId);

        const reason = payload?.reason || 'USER_REQUESTED';

        const existing = this.abortedTasks.get(taskId) || {};
        this.abortedTasks.set(taskId, {
            ...existing,
            aborting: true,
            abortReason: reason,
            timestamp: Date.now(),
            reported: true,
        });

        try {
            active.abortController?.abort(reason);
        } catch (/** @type {any} */ abortError) {
            log(
                'WARN',
                `[DriverNERVAdapter] Abort com reason falhou para ${taskId}: ${abortError?.message || String(abortError)}`,
                correlationId
            );
            try {
                active.abortController?.abort();
            } catch (/** @type {any} */ fallbackAbortError) {
                log(
                    'WARN',
                    `[DriverNERVAdapter] Abort fallback também falhou para ${taskId}: ${fallbackAbortError?.message || String(fallbackAbortError)}`,
                    correlationId
                );
            }
        }

        await this._emitBoth(
            ADAPTER_EVENTS.TASK_ABORTED,
            ActionCode.DRIVER_TASK_ABORTED,
            {
                taskId,
                reason,
            },
            correlationId
        );

        this.stats.tasksAborted++;
    }

    /**
     * @param {any} payload
     * @param {any} [correlationId]
     */
    async _performHealthCheck(payload, correlationId) {
        let browserPoolHealth;
        let healthStatus = STATUS_VALUES.HEALTHY;

        try {
            if (this.browserPool) {
                browserPoolHealth = await this._withTimeout(
                    this.browserPool.getHealth(),
                    5000,
                    'browserPool.getHealth'
                );
            } else {
                browserPoolHealth = { status: 'DEGRADED', reason: 'Pool not available' };
                healthStatus = STATUS_VALUES.DEGRADED;
            }
        } catch (/** @type {any} */ poolError) {
            log('ERROR', `[DriverNERVAdapter] Health check failed: ${poolError.message}`, correlationId);

            await this._emitError('health_check', poolError, null, correlationId, 'health_check');

            browserPoolHealth = {
                status: 'ERROR',
                error: poolError.message,
                isTimeout: poolError.name === 'TimeoutError',
            };
            healthStatus = STATUS_VALUES.UNHEALTHY;
        }

        const health = {
            adapter: healthStatus,
            activeDrivers: this.activeDrivers.size,
            degradedMode: this.degradedMode,
            circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([target, breaker]) => ({
                target,
                state: breaker.state,
                failures: breaker.failures,
                threshold: breaker.threshold,
            })),
            performance: {
                avgPoolAcquire: this.performanceMetrics.avgPoolAcquire,
                avgContextAttach: this.performanceMetrics.avgContextAttach,
                avgExecute: this.performanceMetrics.avgExecute,
                avgTotal: this.performanceMetrics.avgTotal,
            },
            stats: { ...this.stats },
            browserPoolHealth,
            config: {
                maxActiveDrivers: ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS,
                executeTimeout: ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS,
                shutdownTimeout: ADAPTER_CONFIG.SHUTDOWN_TIMEOUT_MS,
                circuitBreakerThreshold: ADAPTER_CONFIG.CIRCUIT_BREAKER_THRESHOLD,
            },
            uptime: Date.now() - this.stats.startTime,
        };

        await this._emitBoth(ADAPTER_EVENTS.HEALTH_CHECK, ActionCode.DRIVER_HEALTH_REPORT, health, correlationId);

        this.stats.healthChecksPerformed++;

        log(
            'DEBUG',
            `[DriverNERVAdapter] Health check: ${healthStatus}, ${this.activeDrivers.size} drivers ativos`,
            correlationId
        );

        return health;
    }

    /**
     * @param {any} timings
     */
    _recordPerformanceMetrics(timings) {
        const { poolAcquire, contextAttach, execute, total } = timings;

        if (poolAcquire !== null) {
            this.performanceMetrics.poolAcquireTimes.push(poolAcquire);
            if (this.performanceMetrics.poolAcquireTimes.length > 100) this.performanceMetrics.poolAcquireTimes.shift();
        }

        if (contextAttach !== null) {
            this.performanceMetrics.contextAttachTimes.push(contextAttach);
            if (this.performanceMetrics.contextAttachTimes.length > 100)
                this.performanceMetrics.contextAttachTimes.shift();
        }

        if (execute !== null) {
            this.performanceMetrics.executeTimes.push(execute);
            if (this.performanceMetrics.executeTimes.length > 100) this.performanceMetrics.executeTimes.shift();
        }

        if (total !== null) {
            this.performanceMetrics.totalTimes.push(total);
            if (this.performanceMetrics.totalTimes.length > 100) this.performanceMetrics.totalTimes.shift();
        }

        const avg = (/** @type {number[]} */ arr) => (arr.length > 0 ? arr.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0) / arr.length : 0);

        this.performanceMetrics.avgPoolAcquire = Math.round(avg(this.performanceMetrics.poolAcquireTimes));
        this.performanceMetrics.avgContextAttach = Math.round(avg(this.performanceMetrics.contextAttachTimes));
        this.performanceMetrics.avgExecute = Math.round(avg(this.performanceMetrics.executeTimes));
        this.performanceMetrics.avgTotal = Math.round(avg(this.performanceMetrics.totalTimes));
    }

    /**
     * @param {any} driver
     * @param {any} taskId
     * @param {any} [correlationId]
     */
    _attachDriverTelemetry(driver, taskId, correlationId) {
        /** @type {any[]} */
        const listeners = [];

        // ✅ P1-4: Removed 'void' and added error handler - state changes are critical for observability
        const stateChangeListener = (/** @type {any} */ data) => {
            this._emitBoth(
                ADAPTER_EVENTS.TASK_STATE_OBSERVED,
                ActionCode.DRIVER_STATE_OBSERVED,
                {
                    taskId,
                    stateTransition: data,
                    timestamp: new Date().toISOString(),
                },
                correlationId
            ).catch((/** @type {any} */ err) => {
                log(
                    'WARN',
                    `[DriverNERVAdapter] Failed to emit state change for ${taskId}: ${err?.message}`,
                    correlationId
                );
            });
        };
        driver.on('state_change', stateChangeListener);
        listeners.push({ event: 'state_change', listener: stateChangeListener });

        const progressListener = (/** @type {any} */ data) => {
            try {
                this._bufferTelemetry(
                    ActionCode.DRIVER_VITAL,
                    {
                        taskId,
                        vitalType: 'PROGRESS',
                        data,
                        timestamp: new Date().toISOString(),
                    },
                    correlationId
                );

                this.stats.vitalsEmitted++;
            } catch (/** @type {any} */ err) {
                log('WARN', `[DriverNERVAdapter] Progress telemetry buffer failed: ${err?.message || String(err)}`);
            }
        };
        driver.on('progress', progressListener);
        listeners.push({ event: 'progress', listener: progressListener });

        // ✅ P1-4: Removed 'void' and added error handler - anomalies are critical alerts
        const anomalyListener = (/** @type {any} */ data) => {
            this._emitBoth(
                ADAPTER_EVENTS.ERROR,
                ActionCode.DRIVER_ANOMALY,
                {
                    taskId,
                    anomalyType: data.type,
                    severity: data.severity,
                    details: data.message,
                },
                correlationId
            ).catch((/** @type {any} */ err) => {
                log(
                    'ERROR',
                    `[DriverNERVAdapter] Failed to emit anomaly for ${taskId}: ${err?.message}`,
                    correlationId
                );
            });
        };
        driver.on('anomaly', anomalyListener);
        listeners.push({ event: 'anomaly', listener: anomalyListener });

        const destroyedListener = () => {
            this._detachDriverTelemetry(driver, listeners);
            this.emit(ADAPTER_EVENTS.DRIVER_DETACHED, { taskId });
            this.stats.driversDetached++;
        };
        driver.once('destroyed', destroyedListener);

        this.emit(ADAPTER_EVENTS.DRIVER_ATTACHED, { taskId });
        this.stats.driversAttached++;

        return listeners;
    }

    /**
     * @param {any} driver
     * @param {any[]} listeners
     */
    _detachDriverTelemetry(driver, listeners) {
        if (!listeners || listeners.length === 0) return;

        for (const { event, listener } of listeners) {
            try {
                driver.off(event, listener);
            } catch (/** @type {any} */ err) {
                log('WARN', `[DriverNERVAdapter] Error removing listener ${event}: ${err.message}`);
            }
        }

        log('DEBUG', `[DriverNERVAdapter] Detached ${listeners.length} telemetry listeners`);
    }

    /**
     * @param {any} actionCode
     * @param {any} payload
     * @param {any} [correlationId]
     */
    async _emitEvent(actionCode, payload, correlationId) {
        const maxRetries = ADAPTER_CONFIG.EVENT_RETRY_MAX_ATTEMPTS;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const envelope = HighLevelNERV.makeEnvelope({
                    actor: ActorRole.DRIVER,
                    messageType: MessageType.EVENT,
                    actionCode,
                    payload,
                    correlationId,
                });

                if (!this.nerv || typeof this.nerv.emitEvent !== 'function') {
                    throw new Error('NERV instance with emitEvent required');
                }

                await this.nerv.emitEvent(envelope);

                log('DEBUG', `[DriverNERVAdapter] Evento NERV emitido: ${actionCode}`, correlationId);
                this.stats.eventsEmitted++;
                return;
            } catch (/** @type {any} */ err) {
                const lastError = err;

                if (attempt < maxRetries - 1) {
                    const backoff = ADAPTER_CONFIG.EVENT_RETRY_BACKOFF_MS * (attempt + 1);
                    log(
                        'WARN',
                        `[DriverNERVAdapter] Falha ao emitir evento (tentativa ${attempt + 1}/${maxRetries}): ${lastError.message}`,
                        correlationId
                    );
                    await new Promise(resolve => setTimeout(resolve, backoff));
                } else {
                    log(
                        'ERROR',
                        `[DriverNERVAdapter] Falha permanente ao emitir evento após ${maxRetries} tentativas: ${lastError.message}`,
                        correlationId
                    );

                    this.stats.eventsFailed++;

                    this.emit(ADAPTER_EVENTS.ERROR, {
                        operation: '_emitEvent',
                        actionCode,
                        error: err.message,
                        retries: maxRetries,
                    });
                }
            }
        }
    }

    /**
     * @param {any} localEvent
     * @param {any} nervActionCode
     * @param {any} payload
     * @param {any} [correlationId]
     */
    async _emitBoth(localEvent, nervActionCode, payload, correlationId) {
        this.emit(localEvent, { ...payload, correlationId });
        await this._emitEvent(nervActionCode, payload, correlationId);
    }

    /**
     * @param {any} actionCode
     * @param {any} payload
     * @param {any} [correlationId]
     */
    _bufferTelemetry(actionCode, payload, correlationId) {
        this.telemetryBuffer.push({
            actionCode,
            payload,
            correlationId,
            timestamp: Date.now(),
        });

        if (this.telemetryBuffer.length >= ADAPTER_CONFIG.TELEMETRY_BUFFER_SIZE) {
            this._flushTelemetry();
        }
    }

    /**
     * ✅ P1-4: Now async to await all emissions before clearing buffer.
     * Prevents data loss if emissions fail.
     */
    async _flushTelemetry() {
        // Reentrancy guard
        if (this._isFlushing) {
            return { success: false, reason: 'already_flushing' };
        }

        if (this.telemetryBuffer.length === 0) return { success: true, flushed: 0 };

        this._isFlushing = true;
        try {
            const batch = [...this.telemetryBuffer];

            // Emit all events and wait for completion
            const results = await Promise.allSettled(
                batch.map(({ actionCode, payload, correlationId }) =>
                    this._emitEvent(actionCode, payload, correlationId)
                )
            );

            /** @type {any[]} */
            const failedItems = [];
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    failedItems.push(batch[index]);
                    log(
                        'WARN',
                        `[DriverNERVAdapter] Telemetry emission failed: ${result.reason?.message || String(result.reason)}`
                    );
                }
            });

            // Rebuild buffer: failed items + unknown new items added after batch was captured
            this.telemetryBuffer = [...failedItems, ...this.telemetryBuffer.slice(batch.length)];

            const successCount = batch.length - failedItems.length;
            const failCount = failedItems.length;

            if (successCount > 0) {
                log('DEBUG', `[DriverNERVAdapter] Flushed ${successCount}/${batch.length} telemetry events`);
            }
            if (failCount > 0) {
                log('WARN', `[DriverNERVAdapter] ${failCount}/${batch.length} telemetry events failed, will retry`);
            }

            return { success: true, flushed: successCount, failed: failCount };
        } finally {
            this._isFlushing = false;
        }
    }

    /**
     * @param {any} operation
     * @param {any} error
     * @param {any} [taskId]
     * @param {any} [correlationId]
     * @param {any} [phase]
     */
    async _emitError(operation, error, taskId, correlationId, phase) {
        log(
            'ERROR',
            `[DriverNERVAdapter] ${operation} failed: ${error.message} (phase=${phase}, taskId=${taskId || 'n/a'})`,
            correlationId
        );

        const isTaskScoped = Boolean(taskId);

        await this._emitBoth(
            isTaskScoped ? ADAPTER_EVENTS.TASK_FAILED : ADAPTER_EVENTS.ERROR,
            isTaskScoped ? ActionCode.DRIVER_TASK_FAILED : ActionCode.DRIVER_ERROR,
            {
                ...(isTaskScoped ? { taskId } : {}),
                operation,
                error: error.message,
                reason: isTaskScoped ? 'INFRASTRUCTURE_ERROR' : 'DRIVER_INFRASTRUCTURE_ERROR',
                retryable: isTaskScoped,
                next_action: isTaskScoped ? 'RETRY_LATER' : 'CHECK_INFRA',
                errorType: error.constructor.name,
                stack: error.stack,
                phase,
                timestamp: Date.now(),
            },
            correlationId
        );

        this.stats.tasksRejected++;
    }

    /**
     * Captura artefatos de diagnóstico para falhas de execução.
     *
     * @param {{
     *   taskId?: string,
     *   correlationId?: string,
     *   target?: string,
     *   driver?: any,
     *   page?: any,
     *   phase?: string,
     *   diagnosis?: any
     * }} [context={}]
     */
    async _captureDiagnostics({
        taskId,
        correlationId,
        target,
        driver,
        page,
        phase = 'unknown',
        diagnosis = null,
    } = {}) {
        if (!page || (page.isClosed && page.isClosed())) {
            return null;
        }

        const base = `diagnostics/${String(taskId)}/${String(correlationId)}`;
        const now = Date.now();

        let url = null;
        let title = null;
        let ua = null;
        let viewport = null;
        try {
            url = page.url();
        } catch (/** @type {any} */ _) {
            // Keep null;
        }
        try {
            title = await page.title();
        } catch (/** @type {any} */ _) {
            // Keep null;
        }
        try {
            ua = await page.browser().userAgent();
        } catch (/** @type {any} */ _) {
            // Keep null;
        }
        try {
            viewport = page.viewport ? page.viewport() : null;
        } catch (/** @type {any} */ _) {
            // Keep null;
        }

        /** @type {Record<string, string|null>} */
        const storage = {
            screenshot_file: null,
            html_file: null,
            meta_json_file: null,
        };

        // Screenshot (best-effort)
        try {
            const buf = await page.screenshot({ type: 'png', fullPage: true });
            const stored = await putBuffer({
                kind: 'diagnostic_screenshot',
                buffer: buf,
                relPath: `${base}/page.png`,
                ext: 'png',
                mime: 'image/png',
            });
            storage.screenshot_file = stored.storageUri;
        } catch (/** @type {any} */ _) {
            storage.screenshot_file = null;
        }

        // HTML (best-effort, truncated)
        try {
            const html = await page.content();
            const max = Math.max(10000, Number(ADAPTER_CONFIG.DIAGNOSTIC_HTML_MAX_BYTES) || 1000000);
            const truncated = Buffer.byteLength(html, 'utf8') > max ? html.slice(0, max) : html;
            const stored = await putText({
                kind: 'diagnostic_html',
                text: truncated,
                relPath: `${base}/page.html`,
                ext: 'html',
                mime: 'text/html',
            });
            storage.html_file = stored.storageUri;
        } catch (/** @type {any} */ _) {
            storage.html_file = null;
        }

        const meta = {
            ts_ms: now,
            phase,
            taskId,
            attemptId: correlationId,
            target,
            page: {
                url,
                title,
                userAgent: ua,
                viewport,
            },
            driver: {
                type: driver?.constructor?.name || null,
                state: driver?.state || null,
                destroyed: Boolean(driver?.destroyed),
            },
            diagnosis,
        };

        try {
            const stored = await putJson({
                kind: 'diagnostic_meta',
                json: meta,
                relPath: `${base}/meta.json`,
                mime: 'application/json',
            });
            storage.meta_json_file = stored.storageUri;
        } catch (/** @type {any} */ _) {
            storage.meta_json_file = null;
        }

        const summary = {
            phase,
            page_url: url,
            triage_type: diagnosis?.triage?.type || diagnosis?.triage?.result?.type || null,
            stability_success: diagnosis?.stability?.success ?? null,
            interface_reason: diagnosis?.interface?.reason ?? null,
        };

        return { storage, summary };
    }

    /**
     * Executa preflight mínimo antes do driver entrar no loop principal.
     *
     * @param {{
     *   driver?: any,
     *   page?: any,
     *   task?: any,
     *   taskId?: string,
     *   target?: string,
     *   signal?: AbortSignal | null
     * }} [context={}]
     */
    async _runPreflight({ driver, page, task, taskId, target, signal } = {}) {
        /** @type {any} */
        const diagnosis = {
            stability: null,
            triage: null,
            page: null,
            interface: null,
        };

        const langCode = driver?.config?.langCode || driver?.config?.lang || 'en';

        // 1) Basic page validation (structured reason codes)
        try {
            const { validateLLMPage } = await import('#core/validators/prerequisite_validator');
            const v = await validateLLMPage(page);
            diagnosis.page = v;
            if (!v.valid) {
                const userAction = new Set(['INVALID_URL', 'UNSUPPORTED_LLM']).has(v.reason);
                return {
                    ok: false,
                    diagnosis,
                    failure: {
                        reason_class: userAction ? 'USER_ACTION_REQUIRED' : 'ENV_UNAVAILABLE',
                        reason_code: v.reason,
                        cause_layer: userAction ? 'USER' : 'PAGE',
                        reason: v.reason,
                        retryable: true,
                        next_action: userAction ? 'BLOCK' : 'RETRY_LATER',
                        suggestedDelayMs: userAction ? 0 : 2000,
                        count_attempt: false,
                        error: v.details?.message || `PREREQUISITE_FAILED: ${v.reason}`,
                        details: v.details || null,
                    },
                };
            }
        } catch (/** @type {any} */ err) {
            return {
                ok: false,
                diagnosis,
                failure: {
                    reason_class: 'ENV_UNAVAILABLE',
                    reason_code: 'PREFLIGHT_PAGE_VALIDATION_ERROR',
                    cause_layer: 'PAGE',
                    reason: 'PREFLIGHT_PAGE_VALIDATION_ERROR',
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    suggestedDelayMs: 2000,
                    count_attempt: false,
                    error: err?.message || String(err),
                    details: null,
                },
            };
        }

        // 2) Stabilizer (fast signal: if the page is still “busy”, prefer reschedule)
        try {
            const stability = /** @type {any} */ (await (
                await import('#shared/page_stability/stabilizer')
            ).waitForStability(driver, 10000, signal || null));
            diagnosis.stability = {
                success: Boolean(stability?.success),
                timeout: Boolean(stability?.timeout),
                phasesFailed: Array.isArray(stability?.phasesFailed) ? stability.phasesFailed.slice(0, 5) : [],
                finalLag: stability?.finalLag ?? null,
            };
        } catch (/** @type {any} */ err) {
            diagnosis.stability = { success: false, error: err?.message || String(err) };
        }

        if (diagnosis.stability && diagnosis.stability.success === false) {
            return {
                ok: false,
                diagnosis,
                failure: {
                    reason_class: 'ENV_UNAVAILABLE',
                    reason_code: 'PAGE_NOT_STABLE',
                    cause_layer: 'PAGE',
                    reason: 'PAGE_NOT_STABLE',
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    suggestedDelayMs: 5000,
                    count_attempt: false,
                    error: 'Page not stable for execution',
                    details: diagnosis.stability,
                },
            };
        }

        // 3) Triage (detects CAPTCHA/login/infra barriers/limits)
        try {
            const { Triage } = await import('#driver/modules/triage');
            const triage = new Triage(page, String(langCode || 'en'));
            const triageResult = /** @type {any} */ (await triage.diagnose(signal ?? undefined));
            diagnosis.triage = { result: triageResult };

            const t = triageResult?.type || null;
            if (t === 'CAPTCHA_CHALLENGE' || t === 'LOGIN_REQUIRED' || t === 'INFRA_BARRIER_DETECTED') {
                return {
                    ok: false,
                    diagnosis,
                    failure: {
                        reason_class: 'USER_ACTION_REQUIRED',
                        reason_code: t,
                        cause_layer: 'USER',
                        reason: t,
                        retryable: true,
                        next_action: 'BLOCK',
                        suggestedDelayMs: 0,
                        count_attempt: false,
                        error: `Preflight triage: ${t}`,
                        details: triageResult,
                    },
                };
            }
            if (t === 'LIMIT_REACHED') {
                return {
                    ok: false,
                    diagnosis,
                    failure: {
                        reason_class: 'USER_ACTION_REQUIRED',
                        reason_code: 'LIMIT_REACHED',
                        cause_layer: 'USER',
                        reason: 'LIMIT_REACHED',
                        retryable: true,
                        next_action: 'BLOCK',
                        suggestedDelayMs: 0,
                        count_attempt: false,
                        error: 'Limit/quota reached',
                        details: triageResult,
                    },
                };
            }
            if (t === 'BROWSER_FROZEN') {
                return {
                    ok: false,
                    diagnosis,
                    failure: {
                        reason_class: 'ENV_UNAVAILABLE',
                        reason_code: 'BROWSER_FROZEN',
                        cause_layer: 'PAGE',
                        reason: 'BROWSER_FROZEN',
                        retryable: true,
                        next_action: 'RETRY_LATER',
                        suggestedDelayMs: 5000,
                        count_attempt: false,
                        error: 'Browser event loop lag indicates freeze',
                        details: triageResult,
                    },
                };
            }
        } catch (/** @type {any} */ err) {
            diagnosis.triage = { error: err?.message || String(err) };
            // Triage failure is not blocking by itself; continue.
        }

        // 4) Interface validation (SADI/analyzer)
        try {
            const { validateLLMInterface } = await import('#core/validators/prerequisite_validator');
            const v = await validateLLMInterface(page);
            diagnosis.interface = v;
            if (!v.valid) {
                // If it is "interactive" problems, prefer BLOCK (user modal/overlay) over punishing attempts.
                if (v.reason === 'TEXTAREA_NOT_INTERACTIVE') {
                    return {
                        ok: false,
                        diagnosis,
                        failure: {
                            reason_class: 'USER_ACTION_REQUIRED',
                            reason_code: 'INACTIVITY_OVERLAY',
                            cause_layer: 'USER',
                            reason: 'TEXTAREA_NOT_INTERACTIVE',
                            retryable: true,
                            next_action: 'BLOCK',
                            suggestedDelayMs: 0,
                            count_attempt: false,
                            error: v.details?.message || 'Input not interactive (likely user action required)',
                            details: v.details || null,
                        },
                    };
                }

                return {
                    ok: false,
                    diagnosis,
                    failure: {
                        reason_class: 'TASK_ERROR',
                        reason_code: 'UI_NOT_FOUND',
                        cause_layer: 'UI',
                        reason: v.reason,
                        retryable: true,
                        next_action: 'RETRY_LATER',
                        suggestedDelayMs: 2000,
                        count_attempt: true,
                        error: v.details?.message || `Interface invalid: ${v.reason}`,
                        details: v.details || null,
                    },
                };
            }
        } catch (/** @type {any} */ err) {
            diagnosis.interface = {
                valid: false,
                reason: 'INTERFACE_CHECK_ERROR',
                details: { error: err?.message || String(err) },
            };
            return {
                ok: false,
                diagnosis,
                failure: {
                    reason_class: 'ENV_UNAVAILABLE',
                    reason_code: 'INTERFACE_CHECK_ERROR',
                    cause_layer: 'UI',
                    reason: 'INTERFACE_CHECK_ERROR',
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    suggestedDelayMs: 2000,
                    count_attempt: false,
                    error: err?.message || String(err),
                    details: null,
                },
            };
        }

        // OK
        return { ok: true, diagnosis, taskId, target, task: task || null };
    }

    /**
     * @param {any} promise
     * @param {number} ms
     * @param {string} [operation]
     */
    _withTimeout(promise, ms, operation) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                const error = /** @type {any} */ (new Error(`Timeout after ${ms}ms`));
                error.name = 'TimeoutError';
                error.operation = operation;
                reject(error);
            }, ms);

            Promise.resolve(promise).then(
                value => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(value);
                },
                err => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(err);
                }
            );
        });
    }

    /**
     * @param {any} taskId
     * @param {any} page
     * @param {any} driver
     * @param {any[]} listeners
     */
    async _finallyCleanup(taskId, page, driver, listeners) {
        const hotPoolEnabled = String(process.env.DRIVER_HOT_POOL_ENABLED ?? 'true').toLowerCase() !== 'false';
        const isHotPath = Boolean(hotPoolEnabled && this.browserPool && driver && driver._isHot);
        const withTimeout =
            typeof this._withTimeout === 'function'
                ? this._withTimeout.bind(this)
                : (/** @type {any} */ promise, /** @type {number} */ ms, /** @type {string} */ operation) =>
                      new Promise((resolve, reject) => {
                          let settled = false;
                          const timer = setTimeout(() => {
                              if (settled) return;
                              settled = true;
                              const error = /** @type {any} */ (new Error(`Timeout after ${ms}ms`));
                              error.name = 'TimeoutError';
                              error.operation = operation;
                              reject(error);
                          }, ms);

                          Promise.resolve(promise).then(
                              value => {
                                  if (settled) return;
                                  settled = true;
                                  clearTimeout(timer);
                                  resolve(value);
                              },
                              err => {
                                  if (settled) return;
                                  settled = true;
                                  clearTimeout(timer);
                                  reject(err);
                              }
                          );
                      });

        if (driver && listeners && listeners.length > 0) {
            try {
                this._detachDriverTelemetry(driver, listeners);
            } catch (/** @type {any} */ err) {
                log('WARN', `[DriverNERVAdapter] Error detaching listeners: ${err.message}`);
            }
        }

        if (driver) {
            try {
                if (!isHotPath && typeof driver.detachContext === 'function') {
                    driver.detachContext({ force: true });
                }

                await withTimeout(driverFactory.releaseToPool(driver), 5000, 'driverFactory.releaseToPool (finally)');
            } catch (/** @type {any} */ err) {
                log('WARN', `[DriverNERVAdapter] Error releasing driver: ${err.message}`);
            }
        }

        if (taskId) {
            this._cleanupDriver(taskId);
        }

        if (!isHotPath && page && this.browserPool) {
            try {
                await withTimeout(this.browserPool.release(page), 5000, 'browserPool.release');
            } catch (/** @type {any} */ err) {
                log('WARN', `[DriverNERVAdapter] Error releasing page: ${err.message}`);
            }
        }
    }

    /**
     * @param {any} taskId
     */
    _cleanupDriver(taskId) {
        const entry = this.activeDrivers.get(taskId);
        if (!entry) return;

        this.activeDrivers.delete(taskId);

        const driverTarget = entry?.driver?.target || 'unknown';
        log('DEBUG', `[DriverNERVAdapter] Task ${taskId} cleaned from activeDrivers Map (driver=${driverTarget})`);
    }

    /**
     * @param {any} target
     */
    _canExecute(target) {
        if (!this.circuitBreakers.has(target)) {
            this.circuitBreakers.set(target, {
                state: 'CLOSED',
                failures: 0,
                threshold: ADAPTER_CONFIG.CIRCUIT_BREAKER_THRESHOLD,
                timeout: ADAPTER_CONFIG.CIRCUIT_BREAKER_TIMEOUT_MS,
                lastFailureTime: null,
            });
        }

        const breaker = this.circuitBreakers.get(target);
        const { state, timeout, lastFailureTime } = breaker;

        if (state === 'CLOSED') return true;

        if (state === 'OPEN') {
            if (Date.now() - lastFailureTime > timeout) {
                breaker.state = 'HALF_OPEN';
                log('INFO', `[DriverNERVAdapter] U2: Circuit breaker HALF_OPEN for ${target} (recovery attempt)`);

                this.emit(ADAPTER_EVENTS.CIRCUIT_BREAKER_CLOSED, {
                    target,
                    state: 'HALF_OPEN',
                    failures: breaker.failures,
                    threshold: breaker.threshold,
                });

                return true;
            }
            return false;
        }

        if (state === 'HALF_OPEN') return true;

        return true;
    }

    /**
     * @param {any} target
     */
    _recordSuccess(target) {
        if (!this.circuitBreakers.has(target)) return;

        const breaker = this.circuitBreakers.get(target);

        if (breaker.state === 'HALF_OPEN') {
            breaker.state = 'CLOSED';
            log('INFO', `[DriverNERVAdapter] U2: Circuit breaker CLOSED for ${target} (recovered)`);

            this.emit(ADAPTER_EVENTS.CIRCUIT_BREAKER_CLOSED, {
                target,
                state: 'CLOSED',
                previousFailures: breaker.failures,
            });
        }

        breaker.failures = 0;
    }

    /**
     * @param {any} error
     */
    _classifyFailure(error) {
        const message = String(error?.message || '');
        const name = String(error?.name || '');
        const code = error?.code ? String(error.code) : null;
        const details = error?.details || null;

        if (code === 'CHROME_PROXY_UNAVAILABLE') {
            return {
                reason: 'CHROME_PROXY_UNAVAILABLE',
                reason_code: 'CHROME_PROXY_UNAVAILABLE',
                cause_layer: 'BROWSER_POOL',
                reason_class: 'ENV_UNAVAILABLE',
                retryable: true,
                next_action: 'RETRY_LATER',
                suggestedDelayMs: 10000,
                count_attempt: false,
                error: message || String(error),
                isTimeout: false,
                details,
            };
        }

        if (code === 'DRIVER_POOL_EXHAUSTED') {
            return {
                reason: 'DRIVER_POOL_EXHAUSTED',
                reason_code: 'DRIVER_POOL_EXHAUSTED',
                cause_layer: 'DRIVER_POOL',
                reason_class: 'ENV_UNAVAILABLE',
                retryable: true,
                next_action: 'RETRY_LATER',
                suggestedDelayMs: 2000,
                count_attempt: false,
                error: message || String(error),
                isTimeout: false,
                details,
            };
        }

        if (code === 'INVALID_TARGET') {
            return {
                reason: 'INVALID_TARGET',
                reason_code: 'INVALID_TARGET',
                cause_layer: 'POLICY',
                reason_class: 'TASK_ERROR',
                retryable: false,
                next_action: 'ABORT',
                suggestedDelayMs: 0,
                count_attempt: true,
                error: message || String(error),
                isTimeout: false,
                details,
            };
        }

        if (
            message.includes('Page closed') ||
            message.includes('page.isClosed()') ||
            message.includes('target closed') ||
            message.includes('Target closed') ||
            message.includes('Page is null or closed') ||
            message.includes('Browser disconnected') ||
            message.includes('Session closed') ||
            message.includes('Protocol error') ||
            message.includes('Target.sendMessageToTarget')
        ) {
            return {
                reason: 'BROWSER_DISCONNECTED',
                reason_code: 'BROWSER_DISCONNECTED',
                cause_layer: 'PAGE',
                reason_class: 'ENV_UNAVAILABLE',
                retryable: true,
                next_action: 'RETRY_LATER',
                suggestedDelayMs: 2000,
                count_attempt: false,
                error: message || String(error),
                isTimeout: false,
                details: { code: 'BROWSER_OR_PAGE_CLOSED' },
            };
        }

        if (message.startsWith('PREREQUISITE_FAILED:')) {
            const reason = message.split(':').slice(1).join(':').trim() || 'PREREQUISITE_FAILED';
            const userActionReasons = new Set([
                'INVALID_URL',
                'UNSUPPORTED_LLM',
                'LOGIN_REQUIRED',
                'CAPTCHA_CHALLENGE',
            ]);
            const isUserAction = userActionReasons.has(reason);
            const causeLayer = isUserAction
                ? 'USER'
                : reason.startsWith('TEXTAREA_') || reason.includes('SEND_BUTTON')
                  ? 'UI'
                  : 'PAGE';
            return {
                reason,
                reason_code: reason,
                cause_layer: causeLayer,
                reason_class: isUserAction ? 'USER_ACTION_REQUIRED' : 'ENV_UNAVAILABLE',
                retryable: true,
                next_action: isUserAction ? 'BLOCK' : 'RETRY_LATER',
                suggestedDelayMs: isUserAction ? 0 : 2000,
                count_attempt: false,
                error: message || String(error),
                isTimeout: false,
                details,
            };
        }

        if (message.toLowerCase().includes('abort') || name === 'AbortError') {
            return {
                reason: 'OPERATION_ABORTED',
                reason_code: 'OPERATION_ABORTED',
                cause_layer: 'USER',
                reason_class: 'ENV_UNAVAILABLE',
                retryable: false,
                next_action: 'ABORT',
                suggestedDelayMs: 0,
                count_attempt: false,
                error: message || String(error),
                isTimeout: false,
                details: { code: 'ABORTED' },
            };
        }

        if (
            message.includes('LOGIN_REQUIRED') ||
            message.includes('CAPTCHA_CHALLENGE') ||
            message.includes('LIMIT_REACHED')
        ) {
            const rc = message.includes('LOGIN_REQUIRED')
                ? 'LOGIN_REQUIRED'
                : message.includes('CAPTCHA_CHALLENGE')
                  ? 'CAPTCHA_CHALLENGE'
                  : 'LIMIT_REACHED';
            return {
                reason: rc,
                reason_code: rc,
                cause_layer: 'USER',
                reason_class: 'USER_ACTION_REQUIRED',
                retryable: true,
                next_action: 'BLOCK',
                suggestedDelayMs: 0,
                count_attempt: false,
                error: message || String(error),
                isTimeout: false,
                details,
            };
        }

        if (
            message.includes('ECONNREFUSED') ||
            message.includes('ENOTFOUND') ||
            message.includes('ETIMEDOUT') ||
            message.includes('ECONNRESET') ||
            message.includes('socket hang up') ||
            message.toLowerCase().includes('browserpool') ||
            message.toLowerCase().includes('destroyed') ||
            message.includes('Driver is null')
        ) {
            return {
                reason: 'ENV_UNAVAILABLE',
                reason_code: 'ENV_UNAVAILABLE',
                cause_layer: 'NETWORK',
                reason_class: 'ENV_UNAVAILABLE',
                retryable: true,
                next_action: 'RETRY_LATER',
                suggestedDelayMs: 2000,
                count_attempt: false,
                error: message || String(error),
                isTimeout: false,
                details,
            };
        }

        const isTimeout =
            name === 'TimeoutError' || message.toLowerCase().includes('timeout') || message.includes('WAIT_TIMEOUT');
        if (isTimeout) {
            const op = String(error?.operation || '');
            if (op.includes('driver.execute') || message.includes('WAIT_TIMEOUT')) {
                // LLM/driver operational timeout: do not consume strategic attempts.
                return {
                    reason: 'LLM_TIMEOUT',
                    reason_code: 'LLM_TIMEOUT',
                    cause_layer: 'LLM',
                    reason_class: 'TASK_ERROR',
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    suggestedDelayMs: 30000,
                    count_attempt: false,
                    error: message || String(error),
                    isTimeout: true,
                    details: { ...(details || {}), operation: op || null },
                };
            }

            // Infrastructure/allocate timeouts: treat as ENV.
            if (op.includes('browserPool.allocate') || op.includes('driverFactory.acquireFromPool')) {
                return {
                    reason: 'ENV_TIMEOUT',
                    reason_code: 'ENV_TIMEOUT',
                    cause_layer: 'BROWSER_POOL',
                    reason_class: 'ENV_UNAVAILABLE',
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    suggestedDelayMs: 5000,
                    count_attempt: false,
                    error: message || String(error),
                    isTimeout: true,
                    details: { ...(details || {}), operation: op || null },
                };
            }

            return {
                reason: 'EXECUTION_TIMEOUT',
                reason_code: 'EXECUTION_TIMEOUT',
                cause_layer: 'LLM',
                reason_class: 'TASK_ERROR',
                retryable: true,
                next_action: 'RETRY_LATER',
                suggestedDelayMs: 2000,
                count_attempt: false,
                error: message || String(error),
                isTimeout: true,
                details: { ...(details || {}), operation: error?.operation || null },
            };
        }

        const selectorSignals = [
            'Textarea not found',
            'Send button not found',
            'TEXTAREA_NOT_FOUND',
            'SEND_BUTTON_NOT_FOUND',
        ];
        if (selectorSignals.some(s => message.includes(s))) {
            return {
                reason: 'UI_NOT_FOUND',
                reason_code: 'UI_NOT_FOUND',
                cause_layer: 'UI',
                reason_class: 'TASK_ERROR',
                retryable: true,
                next_action: 'RETRY_LATER',
                suggestedDelayMs: 2000,
                count_attempt: true,
                error: message || String(error),
                isTimeout: false,
                details,
            };
        }

        return {
            reason: 'TASK_EXECUTION_ERROR',
            reason_code: 'TASK_EXECUTION_ERROR',
            cause_layer: 'DRIVER',
            reason_class: 'TASK_ERROR',
            retryable: true,
            next_action: 'RETRY_LATER',
            suggestedDelayMs: 1500,
            count_attempt: true,
            error: message || String(error),
            isTimeout: false,
            details,
        };
    }

    /**
     * @param {any} target
     */
    _recordFailure(target) {
        if (!this.circuitBreakers.has(target)) {
            this.circuitBreakers.set(target, {
                state: 'CLOSED',
                failures: 0,
                threshold: ADAPTER_CONFIG.CIRCUIT_BREAKER_THRESHOLD,
                timeout: ADAPTER_CONFIG.CIRCUIT_BREAKER_TIMEOUT_MS,
                lastFailureTime: null,
            });
        }

        const breaker = this.circuitBreakers.get(target);

        breaker.failures++;
        breaker.lastFailureTime = Date.now();

        if (breaker.failures >= breaker.threshold) {
            breaker.state = 'OPEN';
            this.stats.circuitBreakerTrips++;

            log(
                'WARN',
                `[DriverNERVAdapter] U2: Circuit breaker OPEN for ${target} (${breaker.failures} failures >= ${breaker.threshold} threshold)`
            );

            this.emit(ADAPTER_EVENTS.CIRCUIT_BREAKER_OPEN, {
                target,
                failures: breaker.failures,
                threshold: breaker.threshold,
                timeout: breaker.timeout,
            });
        }
    }

    _startPeriodicHealthCheck() {
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this._performHealthCheck({}, 'PERIODIC_HEALTH_CHECK');
            } catch (/** @type {any} */ err) {
                log('ERROR', `[DriverNERVAdapter] Periodic health check failed: ${err.message}`);
            }
        }, ADAPTER_CONFIG.HEALTH_CHECK_INTERVAL_MS);

        log(
            'INFO',
            `[DriverNERVAdapter] Periodic health check started (${ADAPTER_CONFIG.HEALTH_CHECK_INTERVAL_MS}ms interval)`
        );
    }

    _startTelemetryFlush() {
        this.telemetryFlushInterval = setInterval(() => {
            if (this.telemetryBuffer.length > 0) {
                this._flushTelemetry();
            }
        }, ADAPTER_CONFIG.TELEMETRY_FLUSH_INTERVAL_MS);

        log(
            'DEBUG',
            `[DriverNERVAdapter] Telemetry flush interval started (${ADAPTER_CONFIG.TELEMETRY_FLUSH_INTERVAL_MS}ms)`
        );
    }

    _startDegradedModeWarning() {
        this.degradedModeInterval = setInterval(() => {
            log('WARN', '[DriverNERVAdapter] MODO DEGRADADO - Browser Pool não disponível');

            this.emit(ADAPTER_EVENTS.DEGRADED_MODE, {
                reason: 'Browser Pool not available',
                suggestion: 'Configure browserEndpoint/proxy e reinicie',
            });

            this.stats.degradedModeWarnings++;
        }, ADAPTER_CONFIG.DEGRADED_MODE_WARNING_INTERVAL_MS);

        log(
            'INFO',
            `[DriverNERVAdapter] Degraded mode warning started (${ADAPTER_CONFIG.DEGRADED_MODE_WARNING_INTERVAL_MS}ms interval)`
        );
    }

    /**
     * @param {{ timeout?: number }} [options={}]
     */
    async shutdown(options = {}) {
        if (this._shutdownResult) {
            return this._shutdownResult;
        }

        if (this._shutdownPromise) {
            return this._shutdownPromise;
        }

        const timeout = options.timeout || ADAPTER_CONFIG.SHUTDOWN_TIMEOUT_MS;
        const startTime = Date.now();

        this._shutdownPromise = (async () => {
            log(
                'INFO',
                `[DriverNERVAdapter] Iniciando shutdown (${this.activeDrivers.size} drivers ativos, timeout: ${timeout}ms)`
            );

            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
                this.healthCheckInterval = null;
            }
            if (this.telemetryFlushInterval) {
                clearInterval(this.telemetryFlushInterval);
                this.telemetryFlushInterval = null;
            }
            if (this.degradedModeInterval) {
                clearInterval(this.degradedModeInterval);
                this.degradedModeInterval = null;
            }

            if (this._nervUnsubscribe) {
                try {
                    this._nervUnsubscribe();
                } catch (/** @type {any} */ err) {
                    log('WARN', `[DriverNERVAdapter] Falha ao remover listener NERV: ${err.message}`);
                } finally {
                    this._nervUnsubscribe = null;
                }
            }

            if (this.telemetryBuffer.length > 0) {
                try {
                    await this._withTimeout(this._flushTelemetry(), 5000, 'final_telemetry_flush');
                } catch (/** @type {any} */ err) {
                    log(
                        'WARN',
                        `[DriverNERVAdapter] Final telemetry flush failed during shutdown: ${err?.message || String(err)}`
                    );
                }
            }

            const entries = Array.from(this.activeDrivers.entries());
            const shutdownPromises = entries.map(([taskId, entry]) => {
                return (async () => {
                    try {
                        await this._withTimeout(
                            this._finallyCleanup(taskId, entry.page, entry.driver, entry.listeners),
                            timeout,
                            `shutdown_cleanup:${taskId}`
                        );
                        return { taskId, success: true };
                    } catch (/** @type {any} */ err) {
                        log('ERROR', `[DriverNERVAdapter] Erro ao liberar driver ${taskId}: ${err.message}`);
                        return { taskId, success: false, error: err.message };
                    }
                })();
            });

            const results = await Promise.allSettled(shutdownPromises);

            const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const failedCount = results.length - successCount;
            const duration = Date.now() - startTime;

            this.activeDrivers.clear();

            this._shutdownResult = {
                total: results.length,
                success: successCount,
                failed: failedCount,
                duration,
            };

            this.emit(ADAPTER_EVENTS.SHUTDOWN, this._shutdownResult);

            log(
                'INFO',
                `[DriverNERVAdapter] Shutdown concluído (${successCount}/${results.length} success, ${duration}ms)`
            );

            return this._shutdownResult;
        })();

        try {
            return await this._shutdownPromise;
        } finally {
            this._shutdownPromise = null;
        }
    }

    getStats() {
        const uptime = Date.now() - this.stats.startTime;
        const avgTaskDuration =
            this.stats.tasksExecuted > 0 ? Math.round(this.stats.totalTaskDuration / this.stats.tasksExecuted) : 0;

        return {
            ...this.stats,
            activeDrivers: this.activeDrivers.size,
            uptime,
            avgTaskDuration,
            circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([target, breaker]) => ({
                target,
                state: breaker.state,
                failures: breaker.failures,
                threshold: breaker.threshold,
                timeout: breaker.timeout,
            })),
        };
    }

    /**
     * @param {any} taskId
     * @param {any} result
     * @param {any} task
     * @param {any} [correlationId]
     */
    async _persistResponse(taskId, result, task, correlationId) {
        const saver = this.config?.saveResponse;
        if (typeof saver !== 'function') return null;
        return await saver(taskId, result, task, correlationId);
    }
}

/**
 * @typedef {object} CreateConfig
 * @property {*} _ Propriedades definidas via runtime.
 */
/**
 * @typedef {object} CreateNerv
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * @typedef {object} CreateBrowserPool
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Factory function para criar instância do DriverNERVAdapter
 *
 * **Side-effects:** N/A
 * **Semântica:** Cria nova instância do DriverNERVAdapter conectada ao NERV e pool de browsers.
 * **Unidades:** N/A
 *
 * @param {CreateNerv} nerv - Instância do sistema NERV
 * @param {CreateBrowserPool} browserPool - Pool de browsers para alocação
 * @param {CreateConfig} config - Configuração do adapter
 * @returns {DriverNERVAdapter} Nova instância do DriverNERVAdapter
 */
export const create = (nerv, browserPool, config) => {
    return new DriverNERVAdapter(nerv, browserPool, config);
};

/**
 * Classe do adapter NERV para drivers
 *
 * **Side-effects:** N/A
 * **Semântica:** Classe principal para adaptação entre sistema NERV e drivers de LLM.
 * **Unidades:** N/A
 *
 * @type {function}
 */
export { DriverNERVAdapter };

/**
 * Configurações do adapter NERV
 *
 * **Side-effects:** N/A
 * **Semântica:** Configurações de timeouts, limites e intervalos para operação do adapter.
 * **Unidades:** Milissegundos para timeouts, números inteiros para contadores.
 *
 * @type {Object<string, number>}
 */
export { ADAPTER_CONFIG };

/**
 * Eventos emitidos pelo adapter NERV
 *
 * **Side-effects:** N/A
 * **Semântica:** Enumeração de eventos para comunicação com sistemas externos.
 * **Unidades:** N/A
 *
 * @type {Object<string, string>}
 */
export { ADAPTER_EVENTS };
