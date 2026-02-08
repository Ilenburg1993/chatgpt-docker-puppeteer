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
    getTaskIdFromPayload
} from '#shared/nerv/envelope_reader';

// ============================================================================
// ADAPTER_CONFIG - Zero Magic Numbers
// ============================================================================

/**
 * Configuração do DriverNERVAdapter.
 * Todas as constantes configuráveis via environment variables.
 *
 * @const {Object} ADAPTER_CONFIG
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

    /** Tamanho máximo da fila de tasks - Default: 100 */
    MAX_QUEUE_SIZE: parseInt(process.env.ADAPTER_MAX_QUEUE || '100', 10),

    // ✅ U5: Smart Retry Configuration
    /** Máximo de retries para tasks - Default: 3 */
    MAX_RETRY_ATTEMPTS: parseInt(process.env.ADAPTER_MAX_RETRIES || '3', 10),

    /** Backoff inicial para retry (ms) - Default: 1000ms (1s → 2s → 4s) */
    RETRY_BACKOFF_MS: parseInt(process.env.ADAPTER_RETRY_BACKOFF || '1000', 10)
};

// ============================================================================
// ADAPTER_EVENTS - Eventos Locais (EventEmitter)
// ============================================================================

/**
 * Eventos emitidos pelo DriverNERVAdapter (EventEmitter).
 * Estes são eventos LOCAIS (subscribers no mesmo processo).
 * Para eventos NERV (IPC), usar ActionCode.DRIVER_*.
 *
 * @const {Object} ADAPTER_EVENTS
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

    SHUTDOWN: 'adapter:shutdown'
};

// ============================================================================
// DriverNERVAdapter Class (EventEmitter v2.0)
// ============================================================================

class DriverNERVAdapter extends EventEmitter {
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

        this.taskQueue = [];
        this.telemetryBuffer = [];

        this.circuitBreakers = new Map();

        // ✅ MUST exist (era bug crítico)
        this.abortedTasks = new Map();

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
            avgTotal: 0
        };

        this.stats = {
            tasksExecuted: 0,
            tasksAborted: 0,
            driversCrashed: 0,
            vitalsEmitted: 0,

            tasksRejected: 0,
            tasksTimedOut: 0,
            tasksQueued: 0,
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

            startTime: Date.now()
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
        this.nerv.onReceive(envelope => {
            const messageType = getMessageType(envelope);
            const actionCode = getActionCode(envelope);
            const correlationId = getCorrelationId(envelope);

            if (messageType !== MessageType.COMMAND) return;
            if (!actionCode || !actionCode.startsWith('DRIVER_')) return;

            this._handleDriverCommand(envelope).catch(err => {
                log(
                    'ERROR',
                    `[DriverNERVAdapter] Erro ao processar comando: ${err?.message || String(err)}`,
                    correlationId
                );

                let taskId;
                try {
                    taskId = getTaskIdFromPayload(getPayload(envelope));
                } catch (taskIdError) {
                    log('WARN', `[DriverNERVAdapter] Falha ao extrair taskId do comando: ${taskIdError?.message || String(taskIdError)}`, correlationId);
                    taskId = undefined;
                }

                void this._emitBoth(
                    ADAPTER_EVENTS.ERROR,
                    ActionCode.DRIVER_ERROR,
                    {
                        error: err?.message || String(err),
                        taskId,
                        originalCommand: actionCode,
                        reason: 'INFRASTRUCTURE_ERROR'
                    },
                    correlationId
                ).catch(emitErr => {
                    log(
                        'ERROR',
                        `[DriverNERVAdapter] Falha ao emitir DRIVER_ERROR: ${emitErr?.message || String(emitErr)}`,
                        correlationId
                    );
                });
            });
        });

        log('DEBUG', '[DriverNERVAdapter] Listeners configurados para DRIVER_* commands');
    }

    async _handleDriverCommand(envelope) {
        const actionCode = getActionCode(envelope);
        const payload = getPayload(envelope);
        const correlationId = getCorrelationId(envelope);

        let taskId = null;
        try {
            taskId = getTaskIdFromPayload(payload);
        } catch (taskIdError) {
            log('DEBUG', `[DriverNERVAdapter] getTaskIdFromPayload falhou, aplicando fallback: ${taskIdError?.message || String(taskIdError)}`, correlationId);
            taskId = payload?.taskId || payload?.task?.meta?.id || payload?.task?.id || null;
        }

        log('DEBUG', `[DriverNERVAdapter] Recebido comando: ${actionCode}`, correlationId);

        if (this.degradedMode && actionCode === ActionCode.DRIVER_EXECUTE_TASK) {
            log('WARN', `[DriverNERVAdapter] REJEITADO: Sistema em modo degradado (Browser Pool não disponível)`, correlationId);

            await this._emitBoth(
                ADAPTER_EVENTS.TASK_FAILED,
                ActionCode.DRIVER_TASK_FAILED,
                {
                    taskId,
                    reason: 'DEGRADED_MODE',
                    error: 'Sistema em modo degradado - Browser Pool não disponível',
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    suggestion:
                        'Configure o browserEndpoint/proxy com remote debugging exposto ao container (ver CONFIG.DEBUG_PORT ou CHROME_WS_ENDPOINT) e reinicie o sistema',
                    suggestedDelayMs: 1000
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

                    await this._emitBoth(
                        ADAPTER_EVENTS.TASK_FAILED,
                        ActionCode.DRIVER_TASK_FAILED,
                        {
                            taskId,
                            reason: poolValidation.reason,
                            error: poolValidation.details?.message || 'Pré-requisito não atendido',
                            suggestion: poolValidation.details?.suggestion,
                            retryable,
                            next_action: retryable ? 'RETRY_LATER' : 'ABORT',
                            ...(retryable ? { suggestedDelayMs: poolValidation.details?.suggestedDelayMs ?? 1000 } : {})
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

        const timings = {
            total: startTime,
            poolAcquire: null,
            contextAttach: null,
            execute: null,
            detach: null,
            release: null
        };

        // Abort controller interno (permite abort por comando mesmo se payload só tiver signal)
        const abortController = new AbortController();
        const signal = abortController.signal;

        let externalAbortForwarder = null;
        if (externalSignal) {
            externalAbortForwarder = () => {
                try {
                    abortController.abort(externalSignal.reason);
                } catch (abortReasonError) {
                    log('DEBUG', `[DriverNERVAdapter] Abort reason inválido para ${taskId}, usando abort sem reason: ${abortReasonError?.message || String(abortReasonError)}`, correlationId);
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
                    message: 'AbortSignal was already aborted before task execution started'
                },
                correlationId
            );

            this.stats.tasksAborted++;
            return;
        }

        if (this.activeDrivers.has(taskId)) {
            log('WARN', `[DriverNERVAdapter] Task ${taskId} já possui driver ativo`, correlationId);
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
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    suggestion: `Aguarde ${Math.floor(timeoutMs / 1000)}s para circuit breaker recovery`,
                    suggestedDelayMs: timeoutMs
                },
                correlationId
            );

            this.stats.tasksRejected++;
            return;
        }

        // ✅ 3. Limite de drivers ativos → enqueue (BUG: antes enfileirava sempre)
        if (this.activeDrivers.size >= ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS) {
            if (this.taskQueue.length >= ADAPTER_CONFIG.MAX_QUEUE_SIZE) {
                const error = `Task queue full (${this.taskQueue.length}/${ADAPTER_CONFIG.MAX_QUEUE_SIZE})`;

                log('WARN', `[DriverNERVAdapter] ${error}`, correlationId);

                await this._emitBoth(
                    ADAPTER_EVENTS.TASK_FAILED,
                    ActionCode.DRIVER_TASK_FAILED,
                    {
                        taskId,
                        error,
                        reason: 'QUEUE_FULL',
                        retryable: true,
                        next_action: 'RETRY_LATER',
                        suggestion: 'Aguarde tasks ativas completarem ou aumente MAX_QUEUE_SIZE',
                        suggestedDelayMs: 750
                    },
                    correlationId
                );

                this.stats.tasksRejected++;
                return;
            }

            this.taskQueue.push({ payload, correlationId });
            this.stats.tasksQueued++;

            log('INFO', `[DriverNERVAdapter] Task ${taskId} enfileirada (${this.taskQueue.length} in queue)`, correlationId);

            await this._emitBoth(
                ADAPTER_EVENTS.TASK_QUEUED,
                ActionCode.DRIVER_TASK_QUEUED,
                {
                    taskId,
                    queueSize: this.taskQueue.length,
                    activeDrivers: this.activeDrivers.size,
                    queuePosition: this.taskQueue.length,
                    retryable: true,
                    next_action: 'RETRY_LATER',
                    suggestedDelayMs: 500
                },
                correlationId
            );

            return;
        }

        let page = null;
        let driver = null;
        let listeners = [];
        let abortHandler = null;

        // Registra entry consistente (corrige mismatch com abort/shutdown)
        const activeEntry = {
            driver: null,
            page: null,
            listeners: [],
            abortController,
            externalAbortForwarder
        };
        this.activeDrivers.set(taskId, activeEntry);

        try {
            // Marca abortedTasks quando houver abort (interno ou externo)
            abortHandler = () => {
                log('WARN', `[DriverNERVAdapter] Abort signal received for task ${taskId}`, correlationId);

                const existing = this.abortedTasks.get(taskId) || {};
                this.abortedTasks.set(taskId, {
                    ...existing,
                    aborting: true,
                    abortReason: existing.abortReason || 'USER_ABORT',
                    timestamp: Date.now()
                });
            };
            signal.addEventListener('abort', abortHandler, { once: true });

            // Allocate page
            const poolAcquireStart = Date.now();
            page = await Promise.race([
                this.browserPool.allocate(target),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'browserPool.allocate')
            ]);
            activeEntry.page = page;

            log('DEBUG', `[DriverNERVAdapter] Página alocada para task ${taskId}`, correlationId);

            if (this.browserPool.updatePageTaskId) {
                this.browserPool.updatePageTaskId(page, taskId);
            }

            // Acquire driver
            driver = await Promise.race([
                driverFactory.acquireFromPool(target),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'driverFactory.acquireFromPool')
            ]);
            activeEntry.driver = driver;

            timings.poolAcquire = Date.now() - poolAcquireStart;

            log('DEBUG', `[DriverNERVAdapter] Driver acquired from pool: ${driver.target} (busy=${driver.busy})`, correlationId);

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
            } catch (pageUrlError) {
                log('DEBUG', `[DriverNERVAdapter] Não foi possível obter URL da página para ${taskId}: ${pageUrlError?.message || String(pageUrlError)}`, correlationId);
                pageUrl = null;
            }

            await this._emitBoth(
                ADAPTER_EVENTS.TASK_STARTED,
                ActionCode.DRIVER_TASK_STARTED,
                {
                    taskId,
                    target,
                    driverType: driver.constructor.name,
                    driverState: driver.state,
                    pageUrl,
                    activeDrivers: this.activeDrivers.size
                },
                correlationId
            );

            // Execute (timeout)
            const executeStart = Date.now();
            const result = await Promise.race([
                driver.execute(task.spec.prompt),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'driver.execute')
            ]);
            timings.execute = Date.now() - executeStart;

            const duration = Date.now() - startTime;
            this.stats.totalTaskDuration += duration;
            this.stats.maxTaskDuration = Math.max(this.stats.maxTaskDuration, duration);
            this.stats.minTaskDuration = Math.min(this.stats.minTaskDuration, duration);

            timings.total = duration;
            this._recordPerformanceMetrics(timings);

            // Persist response (sem ReferenceError)
            try {
                await this._persistResponse(taskId, result, task, correlationId);
                log('INFO', `[DriverNERVAdapter] Response saved for task ${taskId}`, correlationId);
            } catch (saveError) {
                log('ERROR', `[DriverNERVAdapter] Failed to save response for ${taskId}: ${saveError?.message || String(saveError)}`, correlationId);
            }

            await this._emitBoth(
                ADAPTER_EVENTS.TASK_COMPLETED,
                ActionCode.DRIVER_TASK_COMPLETED,
                {
                    taskId,
                    result,
                    timings: {
                        poolAcquire: timings.poolAcquire,
                        contextAttach: timings.contextAttach,
                        execute: timings.execute,
                        total: duration
                    }
                },
                correlationId
            );

            this.stats.tasksExecuted++;
            this._recordSuccess(target);
        } catch (error) {
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
                            message: 'Task execution was aborted by AbortSignal'
                        },
                        correlationId
                    );

                    abortEntry.reported = true;
                    this.abortedTasks.set(taskId, abortEntry);
                    this.stats.tasksAborted++;
                }
            } else {
                const errorType = this._classifyError(error);
                const canRetry = errorType === 'TRANSIENT' && retryCount < ADAPTER_CONFIG.MAX_RETRY_ATTEMPTS;

                if (canRetry) {
                    const backoffMs = ADAPTER_CONFIG.RETRY_BACKOFF_MS * Math.pow(2, retryCount);

                    log(
                        'WARN',
                        `[DriverNERVAdapter] U5: TRANSIENT error detected. Retrying (${retryCount + 1}/${ADAPTER_CONFIG.MAX_RETRY_ATTEMPTS}) after ${backoffMs}ms backoff`,
                        correlationId
                    );

                    this.stats.tasksRetried++;

                    await this._emitBoth(
                        ADAPTER_EVENTS.TASK_RETRYING,
                        ActionCode.DRIVER_TASK_STARTED,
                        {
                            taskId,
                            reason: 'RETRYING',
                            retryAttempt: retryCount + 1,
                            maxRetries: ADAPTER_CONFIG.MAX_RETRY_ATTEMPTS,
                            backoffMs,
                            errorType,
                            error: error?.message || String(error)
                        },
                        correlationId
                    );

                    await new Promise(resolve => setTimeout(resolve, backoffMs));

                    return this._executeTask(payload, correlationId, retryCount + 1);
                }

                const isTimeout = error?.name === 'TimeoutError';

                log(
                    'ERROR',
                    `[DriverNERVAdapter] U5: ${errorType} error - NO RETRY. ` +
                        `Error: ${error?.message || String(error)} ${isTimeout ? `(operation: ${error?.operation || 'unknown'})` : ''}`,
                    correlationId
                );

                if (retryCount > 0) {
                    this.stats.retriesFailed++;
                }

                if (isTimeout) {
                    this.stats.tasksTimedOut++;
                }

                await this._emitBoth(
                    ADAPTER_EVENTS.TASK_FAILED,
                    ActionCode.DRIVER_TASK_FAILED,
                    {
                        taskId,
                        error: error?.message || String(error),
                        reason: isTimeout ? 'EXECUTION_TIMEOUT' : 'TASK_EXECUTION_ERROR',
                        errorType: error?.constructor?.name || 'Error',
                        isTimeout,
                        operation: error?.operation || 'unknown',
                        errorClassification: errorType,
                        retriesAttempted: retryCount,
                        retryable: errorType === 'TRANSIENT',
                        next_action: errorType === 'TRANSIENT' ? 'RETRY_LATER' : 'ABORT',
                        suggestedDelayMs: errorType === 'TRANSIENT' ? ADAPTER_CONFIG.RETRY_BACKOFF_MS : 0
                    },
                    correlationId
                );

                this.stats.driversCrashed++;
                const targetForFailure = task?.spec?.target || payload?.target || 'chatgpt';
                this._recordFailure(targetForFailure);
            }
        } finally {
            // Cleanup listeners
            try {
                if (signal && abortHandler) {
                    signal.removeEventListener('abort', abortHandler);
                }
            } catch (removeAbortListenerError) {
                log('WARN', `[DriverNERVAdapter] Falha ao remover listener de abort interno para ${taskId}: ${removeAbortListenerError?.message || String(removeAbortListenerError)}`, correlationId);
            }

            // Remove forwarder do signal externo (evita leak)
            try {
                if (externalSignal && externalAbortForwarder) {
                    externalSignal.removeEventListener('abort', externalAbortForwarder);
                }
            } catch (removeExternalAbortError) {
                log('WARN', `[DriverNERVAdapter] Falha ao remover listener de abort externo para ${taskId}: ${removeExternalAbortError?.message || String(removeExternalAbortError)}`, correlationId);
            }

            this.abortedTasks.delete(taskId);

            await this._finallyCleanup(taskId, page, driver, listeners);
        }
    }

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
            reported: true
        });

        try {
            active.abortController?.abort(reason);
        } catch (abortError) {
            log('WARN', `[DriverNERVAdapter] Abort com reason falhou para ${taskId}: ${abortError?.message || String(abortError)}`, correlationId);
            try {
                active.abortController?.abort();
            } catch (fallbackAbortError) {
                log('WARN', `[DriverNERVAdapter] Abort fallback também falhou para ${taskId}: ${fallbackAbortError?.message || String(fallbackAbortError)}`, correlationId);
            }
        }

        await this._emitBoth(
            ADAPTER_EVENTS.TASK_ABORTED,
            ActionCode.DRIVER_TASK_ABORTED,
            {
                taskId,
                reason
            },
            correlationId
        );

        this.stats.tasksAborted++;
    }

    async _performHealthCheck(payload, correlationId) {
        let browserPoolHealth = null;
        let healthStatus = STATUS_VALUES.HEALTHY;

        try {
            if (this.browserPool) {
                browserPoolHealth = await Promise.race([
                    this.browserPool.getHealth(),
                    this._timeout(5000, 'browserPool.getHealth')
                ]);
            } else {
                browserPoolHealth = { status: 'DEGRADED', reason: 'Pool not available' };
                healthStatus = STATUS_VALUES.DEGRADED;
            }
        } catch (poolError) {
            log('ERROR', `[DriverNERVAdapter] Health check failed: ${poolError.message}`, correlationId);

            await this._emitError('health_check', poolError, null, correlationId, 'health_check');

            browserPoolHealth = {
                status: 'ERROR',
                error: poolError.message,
                isTimeout: poolError.name === 'TimeoutError'
            };
            healthStatus = STATUS_VALUES.UNHEALTHY;
        }

        const health = {
            adapter: healthStatus,
            activeDrivers: this.activeDrivers.size,
            queuedTasks: this.taskQueue.length,
            degradedMode: this.degradedMode,
            circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([target, breaker]) => ({
                target,
                state: breaker.state,
                failures: breaker.failures,
                threshold: breaker.threshold
            })),
            performance: {
                avgPoolAcquire: this.performanceMetrics.avgPoolAcquire,
                avgContextAttach: this.performanceMetrics.avgContextAttach,
                avgExecute: this.performanceMetrics.avgExecute,
                avgTotal: this.performanceMetrics.avgTotal
            },
            stats: { ...this.stats },
            browserPoolHealth,
            config: {
                maxActiveDrivers: ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS,
                maxQueueSize: ADAPTER_CONFIG.MAX_QUEUE_SIZE,
                executeTimeout: ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS,
                shutdownTimeout: ADAPTER_CONFIG.SHUTDOWN_TIMEOUT_MS,
                circuitBreakerThreshold: ADAPTER_CONFIG.CIRCUIT_BREAKER_THRESHOLD
            },
            uptime: Date.now() - this.stats.startTime
        };

        await this._emitBoth(ADAPTER_EVENTS.HEALTH_CHECK, ActionCode.DRIVER_HEALTH_REPORT, health, correlationId);

        this.stats.healthChecksPerformed++;

        log(
            'DEBUG',
            `[DriverNERVAdapter] Health check: ${healthStatus}, ${this.activeDrivers.size} drivers ativos, ${this.taskQueue.length} in queue`,
            correlationId
        );

        return health;
    }

    _recordPerformanceMetrics(timings) {
        const { poolAcquire, contextAttach, execute, total } = timings;

        if (poolAcquire !== null) {
            this.performanceMetrics.poolAcquireTimes.push(poolAcquire);
            if (this.performanceMetrics.poolAcquireTimes.length > 100) this.performanceMetrics.poolAcquireTimes.shift();
        }

        if (contextAttach !== null) {
            this.performanceMetrics.contextAttachTimes.push(contextAttach);
            if (this.performanceMetrics.contextAttachTimes.length > 100) this.performanceMetrics.contextAttachTimes.shift();
        }

        if (execute !== null) {
            this.performanceMetrics.executeTimes.push(execute);
            if (this.performanceMetrics.executeTimes.length > 100) this.performanceMetrics.executeTimes.shift();
        }

        if (total !== null) {
            this.performanceMetrics.totalTimes.push(total);
            if (this.performanceMetrics.totalTimes.length > 100) this.performanceMetrics.totalTimes.shift();
        }

        const avg = arr => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

        this.performanceMetrics.avgPoolAcquire = Math.round(avg(this.performanceMetrics.poolAcquireTimes));
        this.performanceMetrics.avgContextAttach = Math.round(avg(this.performanceMetrics.contextAttachTimes));
        this.performanceMetrics.avgExecute = Math.round(avg(this.performanceMetrics.executeTimes));
        this.performanceMetrics.avgTotal = Math.round(avg(this.performanceMetrics.totalTimes));
    }

    _attachDriverTelemetry(driver, taskId, correlationId) {
        const listeners = [];

        const stateChangeListener = data => {
            void this._emitBoth(
                ADAPTER_EVENTS.TASK_STATE_OBSERVED,
                ActionCode.DRIVER_STATE_OBSERVED,
                {
                    taskId,
                    stateTransition: data,
                    timestamp: new Date().toISOString()
                },
                correlationId
            );
        };
        driver.on('state_change', stateChangeListener);
        listeners.push({ event: 'state_change', listener: stateChangeListener });

        const progressListener = data => {
            this._bufferTelemetry(
                ActionCode.DRIVER_VITAL,
                {
                    taskId,
                    vitalType: 'PROGRESS',
                    data,
                    timestamp: new Date().toISOString()
                },
                correlationId
            );

            this.stats.vitalsEmitted++;
        };
        driver.on('progress', progressListener);
        listeners.push({ event: 'progress', listener: progressListener });

        const anomalyListener = data => {
            void this._emitBoth(
                ADAPTER_EVENTS.ERROR,
                ActionCode.DRIVER_ANOMALY,
                {
                    taskId,
                    anomalyType: data.type,
                    severity: data.severity,
                    details: data.message
                },
                correlationId
            );
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

    _detachDriverTelemetry(driver, listeners) {
        if (!listeners || listeners.length === 0) return;

        for (const { event, listener } of listeners) {
            try {
                driver.off(event, listener);
            } catch (err) {
                log('WARN', `[DriverNERVAdapter] Error removing listener ${event}: ${err.message}`);
            }
        }

        log('DEBUG', `[DriverNERVAdapter] Detached ${listeners.length} telemetry listeners`);
    }

    async _emitEvent(actionCode, payload, correlationId) {
        const maxRetries = ADAPTER_CONFIG.EVENT_RETRY_MAX_ATTEMPTS;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const envelope = HighLevelNERV.makeEnvelope({
                    actor: ActorRole.DRIVER,
                    messageType: MessageType.EVENT,
                    actionCode,
                    payload,
                    correlationId
                });

                if (!this.nerv || typeof this.nerv.emitEvent !== 'function') {
                    throw new Error('NERV instance with emitEvent required');
                }

                await this.nerv.emitEvent(envelope);

                log('DEBUG', `[DriverNERVAdapter] Evento NERV emitido: ${actionCode}`, correlationId);
                this.stats.eventsEmitted++;
                return;
            } catch (err) {
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
                        retries: maxRetries
                    });
                }
            }
        }
    }

    async _emitBoth(localEvent, nervActionCode, payload, correlationId) {
        this.emit(localEvent, { ...payload, correlationId });
        await this._emitEvent(nervActionCode, payload, correlationId);
    }

    _bufferTelemetry(actionCode, payload, correlationId) {
        this.telemetryBuffer.push({
            actionCode,
            payload,
            correlationId,
            timestamp: Date.now()
        });

        if (this.telemetryBuffer.length >= ADAPTER_CONFIG.TELEMETRY_BUFFER_SIZE) {
            this._flushTelemetry();
        }
    }

    _flushTelemetry() {
        if (this.telemetryBuffer.length === 0) return;

        const batch = [...this.telemetryBuffer];
        this.telemetryBuffer = [];

        for (const { actionCode, payload, correlationId } of batch) {
            void this._emitEvent(actionCode, payload, correlationId).catch(err => {
                log('WARN', `[DriverNERVAdapter] Error flushing telemetry: ${err.message}`);
            });
        }

        log('DEBUG', `[DriverNERVAdapter] Flushed ${batch.length} telemetry events`);
    }

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
                timestamp: Date.now()
            },
            correlationId
        );

        this.stats.tasksRejected++;
    }

    _timeout(ms, operation) {
        return new Promise((_, reject) => {
            setTimeout(() => {
                const error = new Error(`Timeout after ${ms}ms`);
                error.name = 'TimeoutError';
                error.operation = operation;
                reject(error);
            }, ms);
        });
    }

    async _finallyCleanup(taskId, page, driver, listeners) {
        if (driver && listeners && listeners.length > 0) {
            try {
                this._detachDriverTelemetry(driver, listeners);
            } catch (err) {
                log('WARN', `[DriverNERVAdapter] Error detaching listeners: ${err.message}`);
            }
        }

        if (driver) {
            try {
                if (typeof driver.detachContext === 'function') {
                    driver.detachContext({ force: true });
                }

                await Promise.race([
                    driverFactory.releaseToPool(driver),
                    this._timeout(5000, 'driverFactory.releaseToPool (finally)')
                ]);
            } catch (err) {
                log('WARN', `[DriverNERVAdapter] Error detaching/releasing driver: ${err.message}`);
            }
        }

        if (taskId) {
            this._cleanupDriver(taskId);
        }

        if (page && this.browserPool) {
            try {
                await Promise.race([this.browserPool.release(page), this._timeout(5000, 'browserPool.release')]);
            } catch (err) {
                log('WARN', `[DriverNERVAdapter] Error releasing page: ${err.message}`);
            }
        }

        this._processNextQueuedTask();
    }

    _processNextQueuedTask() {
        if (this.taskQueue.length === 0) return;

        if (this.activeDrivers.size >= ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS) {
            log(
                'DEBUG',
                `[DriverNERVAdapter] Queue has ${this.taskQueue.length} tasks but MAX_ACTIVE_DRIVERS reached ` +
                    `(${this.activeDrivers.size}/${ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS}). Waiting...`
            );
            return;
        }

        const next = this.taskQueue.shift();

        log(
            'DEBUG',
            `[DriverNERVAdapter] Processing queued task (${this.taskQueue.length} remaining, ${this.activeDrivers.size} active)`
        );

        setImmediate(() => {
            this._executeTask(next.payload, next.correlationId).catch(err => {
                log('ERROR', `[DriverNERVAdapter] Error executing queued task: ${err.message}`);
            });
        });
    }

    _cleanupDriver(taskId) {
        const entry = this.activeDrivers.get(taskId);
        if (!entry) return;

        this.activeDrivers.delete(taskId);

        const driverTarget = entry?.driver?.target || 'unknown';
        log('DEBUG', `[DriverNERVAdapter] Task ${taskId} cleaned from activeDrivers Map (driver=${driverTarget})`);
    }

    _canExecute(target) {
        if (!this.circuitBreakers.has(target)) {
            this.circuitBreakers.set(target, {
                state: 'CLOSED',
                failures: 0,
                threshold: ADAPTER_CONFIG.CIRCUIT_BREAKER_THRESHOLD,
                timeout: ADAPTER_CONFIG.CIRCUIT_BREAKER_TIMEOUT_MS,
                lastFailureTime: null
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
                    threshold: breaker.threshold
                });

                return true;
            }
            return false;
        }

        if (state === 'HALF_OPEN') return true;

        return true;
    }

    _recordSuccess(target) {
        if (!this.circuitBreakers.has(target)) return;

        const breaker = this.circuitBreakers.get(target);

        if (breaker.state === 'HALF_OPEN') {
            breaker.state = 'CLOSED';
            log('INFO', `[DriverNERVAdapter] U2: Circuit breaker CLOSED for ${target} (recovered)`);

            this.emit(ADAPTER_EVENTS.CIRCUIT_BREAKER_CLOSED, {
                target,
                state: 'CLOSED',
                previousFailures: breaker.failures
            });
        }

        breaker.failures = 0;
    }

    _classifyError(error) {
        const message = error?.message || '';
        const name = error?.name || '';

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
            return 'FATAL';
        }

        if (
            message.includes('ECONNREFUSED') ||
            message.includes('ENOTFOUND') ||
            message.includes('ETIMEDOUT') ||
            message.includes('ECONNRESET') ||
            message.includes('socket hang up')
        ) {
            return 'TRANSIENT';
        }

        if (name === 'TimeoutError' || message.toLowerCase().includes('timeout')) {
            return 'TRANSIENT';
        }

        if (message.match(/502|503|504/)) {
            return 'TRANSIENT';
        }

        if (message.toLowerCase().includes('abort') || name === 'AbortError') {
            return 'FATAL';
        }

        if (message.toLowerCase().includes('validation') || message.toLowerCase().includes('invalid')) {
            return 'FATAL';
        }

        if (message.match(/400|401|403|404/)) {
            return 'FATAL';
        }

        if (message.toLowerCase().includes('destroyed') || message.includes('Driver is null')) {
            return 'FATAL';
        }

        return 'TRANSIENT';
    }

    _recordFailure(target) {
        if (!this.circuitBreakers.has(target)) {
            this.circuitBreakers.set(target, {
                state: 'CLOSED',
                failures: 0,
                threshold: ADAPTER_CONFIG.CIRCUIT_BREAKER_THRESHOLD,
                timeout: ADAPTER_CONFIG.CIRCUIT_BREAKER_TIMEOUT_MS,
                lastFailureTime: null
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
                timeout: breaker.timeout
            });
        }
    }

    _startPeriodicHealthCheck() {
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this._performHealthCheck({}, 'PERIODIC_HEALTH_CHECK');
            } catch (err) {
                log('ERROR', `[DriverNERVAdapter] Periodic health check failed: ${err.message}`);
            }
        }, ADAPTER_CONFIG.HEALTH_CHECK_INTERVAL_MS);

        log('INFO', `[DriverNERVAdapter] Periodic health check started (${ADAPTER_CONFIG.HEALTH_CHECK_INTERVAL_MS}ms interval)`);
    }

    _startTelemetryFlush() {
        this.telemetryFlushInterval = setInterval(() => {
            if (this.telemetryBuffer.length > 0) {
                this._flushTelemetry();
            }
        }, ADAPTER_CONFIG.TELEMETRY_FLUSH_INTERVAL_MS);

        log('DEBUG', `[DriverNERVAdapter] Telemetry flush interval started (${ADAPTER_CONFIG.TELEMETRY_FLUSH_INTERVAL_MS}ms)`);
    }

    _startDegradedModeWarning() {
        this.degradedModeInterval = setInterval(() => {
            log('WARN', '[DriverNERVAdapter] MODO DEGRADADO - Browser Pool não disponível');

            this.emit(ADAPTER_EVENTS.DEGRADED_MODE, {
                reason: 'Browser Pool not available',
                suggestion: 'Configure browserEndpoint/proxy e reinicie'
            });

            this.stats.degradedModeWarnings++;
        }, ADAPTER_CONFIG.DEGRADED_MODE_WARNING_INTERVAL_MS);

        log('INFO', `[DriverNERVAdapter] Degraded mode warning started (${ADAPTER_CONFIG.DEGRADED_MODE_WARNING_INTERVAL_MS}ms interval)`);
    }

    async shutdown(options = {}) {
        const timeout = options.timeout || ADAPTER_CONFIG.SHUTDOWN_TIMEOUT_MS;
        const startTime = Date.now();

        log(
            'INFO',
            `[DriverNERVAdapter] Iniciando shutdown (${this.activeDrivers.size} drivers ativos, ${this.taskQueue.length} queued, timeout: ${timeout}ms)`
        );

        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
        if (this.telemetryFlushInterval) clearInterval(this.telemetryFlushInterval);
        if (this.degradedModeInterval) clearInterval(this.degradedModeInterval);

        if (this.telemetryBuffer.length > 0) {
            this._flushTelemetry();
        }

        const entries = Array.from(this.activeDrivers.entries());
        const shutdownPromises = entries.map(([taskId, entry]) => {
            return (async () => {
                try {
                    const p = this._finallyCleanup(taskId, entry.page, entry.driver, entry.listeners);
                    const t = new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timeout')), timeout));
                    await Promise.race([p, t]);
                    return { taskId, success: true };
                } catch (err) {
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
        this.taskQueue = [];

        const shutdownResult = {
            total: results.length,
            success: successCount,
            failed: failedCount,
            duration
        };

        this.emit(ADAPTER_EVENTS.SHUTDOWN, shutdownResult);

        log('INFO', `[DriverNERVAdapter] Shutdown concluído (${successCount}/${results.length} success, ${duration}ms)`);

        return shutdownResult;
    }

    getStats() {
        const uptime = Date.now() - this.stats.startTime;
        const avgTaskDuration =
            this.stats.tasksExecuted > 0 ? Math.round(this.stats.totalTaskDuration / this.stats.tasksExecuted) : 0;

        return {
            ...this.stats,
            activeDrivers: this.activeDrivers.size,
            queuedTasks: this.taskQueue.length,
            uptime,
            avgTaskDuration,
            circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([target, breaker]) => ({
                target,
                state: breaker.state,
                failures: breaker.failures,
                threshold: breaker.threshold,
                timeout: breaker.timeout
            }))
        };
    }

    async _persistResponse(taskId, result, task, correlationId) {
        const saver = this.config?.saveResponse;
        if (typeof saver !== 'function') return;
        await saver(taskId, result, task, correlationId);
    }
}

export const create = (nerv, browserPool, config) => {
    return new DriverNERVAdapter(nerv, browserPool, config);
};

export { DriverNERVAdapter, ADAPTER_CONFIG, ADAPTER_EVENTS };
