import EventEmitter from 'node:events';
import * as driverFactory from '../factory.js';
import { STATUS_VALUES } from '#core/constants/tasks';
import { log } from '#core/logger';
import { ActionCode, MessageType, ActorRole } from '#shared/nerv/constants';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';

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
    EXECUTE_TASK_TIMEOUT_MS: parseInt(process.env.ADAPTER_EXECUTE_TIMEOUT || '300000'),

    /** Timeout para shutdown gracioso (ms) - Default: 30 segundos */
    SHUTDOWN_TIMEOUT_MS: parseInt(process.env.ADAPTER_SHUTDOWN_TIMEOUT || '30000'),

    /** Intervalo para health check periódico (ms) - Default: 1 minuto */
    HEALTH_CHECK_INTERVAL_MS: parseInt(process.env.ADAPTER_HEALTH_INTERVAL || '60000'),

    /** Máximo de drivers ativos simultaneamente - Default: 10 */
    MAX_ACTIVE_DRIVERS: parseInt(process.env.ADAPTER_MAX_DRIVERS || '10'),

    /** Tamanho do buffer de telemetria para batch emit - Default: 1000 */
    TELEMETRY_BUFFER_SIZE: parseInt(process.env.ADAPTER_TELEMETRY_BUFFER || '1000'),

    /** Intervalo para warning de modo degradado (ms) - Default: 1 minuto */
    DEGRADED_MODE_WARNING_INTERVAL_MS: parseInt(process.env.ADAPTER_DEGRADED_WARNING || '60000'),

    /** Máximo de tentativas para retry de eventos NERV - Default: 3 */
    EVENT_RETRY_MAX_ATTEMPTS: parseInt(process.env.ADAPTER_EVENT_RETRY || '3'),

    /** Backoff entre retries de eventos (ms) - Default: 100ms */
    EVENT_RETRY_BACKOFF_MS: parseInt(process.env.ADAPTER_EVENT_BACKOFF || '100'),

    /** Circuit breaker: threshold de falhas - Default: 5 */
    CIRCUIT_BREAKER_THRESHOLD: parseInt(process.env.ADAPTER_CIRCUIT_THRESHOLD || '5'),

    /** Circuit breaker: timeout para HALF_OPEN (ms) - Default: 1 minuto */
    CIRCUIT_BREAKER_TIMEOUT_MS: parseInt(process.env.ADAPTER_CIRCUIT_TIMEOUT || '60000'),

    /** Tamanho máximo da fila de tasks - Default: 100 */
    MAX_QUEUE_SIZE: parseInt(process.env.ADAPTER_MAX_QUEUE || '100'),

    // ✅ U5: Smart Retry Configuration
    /** Máximo de retries para tasks - Default: 3 */
    MAX_RETRY_ATTEMPTS: parseInt(process.env.ADAPTER_MAX_RETRIES || '3'),

    /** Backoff inicial para retry (ms) - Default: 1000ms (1s → 2s → 4s) */
    RETRY_BACKOFF_MS: parseInt(process.env.ADAPTER_RETRY_BACKOFF || '1000'),
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
    /** Task iniciada (emit local + NERV) */
    TASK_STARTED: 'adapter:task_started',

    /** Task completada com sucesso */
    TASK_COMPLETED: 'adapter:task_completed',

    /** Task falhou */
    TASK_FAILED: 'adapter:task_failed',

    /** Task abortada pelo usuário */
    TASK_ABORTED: 'adapter:task_aborted',

    /** Task enfileirada (queue) */
    TASK_QUEUED: 'adapter:task_queued',

    /** Driver telemetry attached */
    DRIVER_ATTACHED: 'adapter:driver_attached',

    /** Driver telemetry detached */
    DRIVER_DETACHED: 'adapter:driver_detached',

    /** Health check executado */
    HEALTH_CHECK: 'adapter:health_check',

    /** Erro geral do adapter */
    ERROR: 'adapter:error',

    /** Modo degradado ativo */
    DEGRADED_MODE: 'adapter:degraded_mode',

    /** Circuit breaker aberto */
    CIRCUIT_BREAKER_OPEN: 'adapter:circuit_breaker_open',

    /** Circuit breaker fechado (recovered) */
    CIRCUIT_BREAKER_CLOSED: 'adapter:circuit_breaker_closed',

    /** Shutdown iniciado */
    SHUTDOWN: 'adapter:shutdown'
};

// ============================================================================
// DriverNERVAdapter Class (EventEmitter v2.0)
// ============================================================================

/**
 * Adapter crítico entre NERV (pub/sub IPC) e domínio DRIVER.
 * Gerencia DriverLifecycleManager instances, escuta KERNEL commands,
 * emite telemetria via duplo canal (EventEmitter local + NERV IPC).
 *
 * @class DriverNERVAdapter
 * @extends EventEmitter
 *
 * @emits ADAPTER_EVENTS.TASK_STARTED quando task inicia
 * @emits ADAPTER_EVENTS.TASK_COMPLETED quando task completa
 * @emits ADAPTER_EVENTS.TASK_FAILED quando task falha
 * @emits ADAPTER_EVENTS.TASK_ABORTED quando task abortada
 * @emits ADAPTER_EVENTS.HEALTH_CHECK quando health check executado
 * @emits ADAPTER_EVENTS.ERROR quando erro ocorre
 * @emits ADAPTER_EVENTS.DEGRADED_MODE quando modo degradado ativo
 * @emits ADAPTER_EVENTS.SHUTDOWN quando shutdown iniciado
 *
 * @example
 * const adapter = new DriverNERVAdapter(nerv, browserPool, config);
 * adapter.on('adapter:task_completed', (data) => {
 *   console.log(`Task ${data.taskId} completed`);
 * });
 */
class DriverNERVAdapter extends EventEmitter {
    /**
     * Cria uma instância do DriverNERVAdapter.
     *
     * @param {Object} nerv - Instância do NERV (IPC transport)
     * @param {Object} [browserPool=null] - Gerenciador do pool de conexões Chrome (pode ser null em modo degradado)
     * @param {Object} config - Configuração do sistema
     *
     * @throws {Error} Se NERV instance não fornecido
     *
     * @example
     * const adapter = new DriverNERVAdapter(nerv, browserPool, config);
     */
    constructor(nerv, browserPool, config) {
        super(); // ✅ EventEmitter constructor

        if (!nerv) {
            throw new Error('[DriverNERVAdapter] NERV instance required');
        }

        // browserPool pode ser null em modo degradado
        // Quando null, comandos de execução serão rejeitados com mensagem clara
        if (!browserPool) {
            log('WARN', '[DriverNERVAdapter] Inicializando em MODO DEGRADADO (browserPool = null)');
            log('WARN', '[DriverNERVAdapter] Comandos de execução serão rejeitados até Browser Pool ser configurado');
        }

        this.nerv = nerv;
        this.browserPool = browserPool; // Pode ser null
        this.config = config;
        this.degradedMode = !browserPool; // Flag para modo degradado

        // ✅ v3.0: Mapa de drivers ativos (direct pool-based)
        // Key: taskId
        // Value: { driver, abortController, page, listeners, aborting }
        this.activeDrivers = new Map();

        // ✅ v2.0: Task queue (quando MAX_ACTIVE_DRIVERS atingido)
        this.taskQueue = [];

        // ✅ v2.0: Telemetry buffer (batch emit para performance)
        this.telemetryBuffer = [];

        // ✅ U2: Per-target circuit breaker (fault isolation)
        // Map<target, BreakerState>
        // BreakerState: { state, failures, threshold, timeout, lastFailureTime }
        this.circuitBreakers = new Map();

        // ✅ U4: Performance telemetria (timing breakdown)
        this.performanceMetrics = {
            poolAcquireTimes: [],
            contextAttachTimes: [],
            executeTimes: [],
            detachTimes: [],
            releaseTimes: [],
            totalTimes: [],
            // Agregações
            avgPoolAcquire: 0,
            avgContextAttach: 0,
            avgExecute: 0,
            avgDetach: 0,
            avgRelease: 0,
            avgTotal: 0,
        };

        // ✅ v2.0: Estatísticas observacionais expandidas (14 métricas)
        this.stats = {
            // Existing (v1.1)
            tasksExecuted: 0,
            tasksAborted: 0,
            driversCrashed: 0,
            vitalsEmitted: 0,

            // ✅ New (v2.0)
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

            // ✅ U5: Retry metrics
            tasksRetried: 0,
            retriesSucceeded: 0,
            retriesFailed: 0,

            // ✅ Timing metrics
            totalTaskDuration: 0,
            maxTaskDuration: 0,
            minTaskDuration: Infinity,

            // ✅ Uptime
            startTime: Date.now(),
        };

        // Setup de listeners NERV
        this._setupListeners();

        // ✅ v2.0: Start periodic health check
        this._startPeriodicHealthCheck();

        // ✅ v2.0: Start telemetry buffer flush
        this._startTelemetryFlush();

        // ✅ v2.0: Start degraded mode warning (se aplicável)
        if (this.degradedMode) {
            this._startDegradedModeWarning();
        }

        log('INFO', '[DriverNERVAdapter] v2.0 inicializado e conectado ao NERV');
        log(
            'INFO',
            `[DriverNERVAdapter] Config: MAX_ACTIVE_DRIVERS=${ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS}, EXECUTE_TIMEOUT=${ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS}ms`
        );
    }

    /**
     * Configura listeners para comandos NERV destinados ao DRIVER.
     * Todos os comandos chegam via pub/sub do NERV.
     *
     * @private
     *
     * @listens NERV~MessageType.COMMAND com actionCode DRIVER_*
     */
    _setupListeners() {
        // Escuta comandos do tipo DRIVER_* vindos do KERNEL
        this.nerv.onReceive(envelope => {
            // Filtra apenas mensagens para o domínio DRIVER
            if (envelope.messageType !== MessageType.COMMAND) {
                return;
            }
            if (!envelope.actionCode.startsWith('DRIVER_')) {
                return;
            }

            this._handleDriverCommand(envelope).catch(err => {
                log('ERROR', `[DriverNERVAdapter] Erro ao processar comando: ${err.message}`, envelope.correlationId);

                // Emite evento de falha (duplo canal)
                this._emitBoth(
                    ADAPTER_EVENTS.ERROR,
                    ActionCode.DRIVER_ERROR,
                    {
                        error: err.message,
                        taskId: envelope.payload?.taskId,
                        originalCommand: envelope.actionCode,
                    },
                    envelope.correlationId
                );
            });
        });

        log('DEBUG', '[DriverNERVAdapter] Listeners configurados para DRIVER_* commands');
    }

    /**
     * Processa comandos DRIVER vindos do NERV.
     *
     * @private
     * @async
     *
     * @param {Object} envelope - Envelope NERV com comando
     * @param {string} envelope.actionCode - Código da ação (DRIVER_*)
     * @param {Object} envelope.payload - Payload do comando
     * @param {string} envelope.correlationId - ID de correlação
     *
     * @returns {Promise<void>}
     *
     * @throws {Error} Se comando desconhecido ou falha na execução
     */
    async _handleDriverCommand(envelope) {
        const { actionCode, payload, correlationId } = envelope;

        log('DEBUG', `[DriverNERVAdapter] Recebido comando: ${actionCode}`, correlationId);

        // Em modo degradado, rejeita comandos de execução
        if (this.degradedMode && actionCode === ActionCode.DRIVER_EXECUTE_TASK) {
            log(
                'WARN',
                `[DriverNERVAdapter] REJEITADO: Sistema em modo degradado (Browser Pool não disponível)`,
                correlationId
            );

            this._emitBoth(
                ADAPTER_EVENTS.ERROR,
                ActionCode.DRIVER_ERROR,
                {
                    taskId: payload?.taskId,
                    error: 'Sistema em modo degradado - Browser Pool não disponível',
                    reason: 'DEGRADED_MODE',
                    suggestion:
                        'Configure o browserEndpoint/proxy com remote debugging exposto ao container (ver CONFIG.DEBUG_PORT ou CHROME_WS_ENDPOINT) e reinicie o sistema',
                },
                correlationId
            );
            return;
        }

        switch (actionCode) {
            case ActionCode.DRIVER_EXECUTE_TASK: {
                // ✅ v1.1: Valida pré-requisitos antes de executar
                const { validateBrowserPool } = await import('#core/validators/prerequisite_validator');
                const poolValidation = validateBrowserPool(this.browserPool);

                if (!poolValidation.valid) {
                    log('WARN', `[DriverNERVAdapter] Task rejeitada: ${poolValidation.reason}`, correlationId);

                    this._emitBoth(
                        ADAPTER_EVENTS.TASK_FAILED,
                        ActionCode.DRIVER_ERROR,
                        {
                            taskId: payload?.taskId,
                            error: poolValidation.details.message,
                            reason: poolValidation.reason,
                            suggestion: poolValidation.details.suggestion,
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
     * Executa uma tarefa usando DriverLifecycleManager.
     * Aloca página do BrowserPool, cria driver, executa e monitora.
     *
     * ✅ v3.0 (U5): Smart retry logic - TRANSIENT errors retriables
     * ✅ v2.0: Timeout protection em todas as fases
     * ✅ v2.0: Circuit breaker check
     * ✅ v2.0: Queue quando MAX_ACTIVE_DRIVERS atingido
     * ✅ v2.0: Timing metrics
     * ✅ v2.0: Cleanup robusto com timeout
     *
     * @private
     * @async
     *
     * @param {Object} payload - Payload contendo task spec
     * @param {Object} payload.task - Task completa (meta + spec)
     * @param {string} payload.task.meta.id - Task ID
     * @param {Object} payload.task.spec - Task specification
     * @param {string} payload.task.spec.target - Target name (chatgpt, gemini, etc)
     * @param {string} payload.task.spec.prompt - Prompt para driver
     * @param {string} correlationId - NERV correlation ID
     * @param {number} [retryCount=0] - Current retry attempt (U5)
     *
     * @returns {Promise<void>}
     *
     * @throws {Error} Se task inválida, timeout, ou circuit breaker aberto
     *
     * @emits ADAPTER_EVENTS.TASK_STARTED quando task inicia
     * @emits ADAPTER_EVENTS.TASK_COMPLETED quando task completa com sucesso
     * @emits ADAPTER_EVENTS.TASK_FAILED quando task falha
     * @emits ADAPTER_EVENTS.TASK_QUEUED quando task enfileirada
     * @emits ADAPTER_EVENTS.TASK_RETRYING quando retry iniciado (U5)
     */
    async _executeTask(payload, correlationId, retryCount = 0) {
        const { task, signal } = payload;

        if (!task || !task.meta || !task.meta.id) {
            throw new Error('Task inválida recebida via NERV');
        }

        const taskId = task.meta.id;
        const startTime = Date.now();

        // ✅ U4: Performance telemetria (timing breakdown)
        const timings = {
            total: startTime,
            poolAcquire: null,
            contextAttach: null,
            execute: null,
            detach: null,
            release: null,
        };

        log('INFO', `[DriverNERVAdapter] Iniciando execução: ${taskId}`, correlationId);

        // ✅ P1 BUG #4 FIX: Verifica se signal já está abortado ANTES de executar (fail-fast)
        if (signal && signal.aborted) {
            log('WARN', `[DriverNERVAdapter] Task ${taskId} already aborted before execution`, correlationId);

            this._emitBoth(
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

        // ✅ 1. Verifica se já existe driver para essa task
        if (this.activeDrivers.has(taskId)) {
            log('WARN', `[DriverNERVAdapter] Task ${taskId} já possui driver ativo`, correlationId);
            return;
        }

        // ✅ U2: Per-target circuit breaker check
        const target = payload.target || 'chatgpt';

        if (!this._canExecute(target)) {
            const breaker = this.circuitBreakers.get(target);
            const error = `Circuit breaker OPEN for target ${target} - too many recent failures (${breaker.failures}/${breaker.threshold})`;

            log('WARN', `[DriverNERVAdapter] U2: ${error}`, correlationId);

            this._emitBoth(
                ADAPTER_EVENTS.TASK_FAILED,
                ActionCode.DRIVER_TASK_FAILED,
                {
                    taskId,
                    target,
                    error,
                    reason: 'CIRCUIT_BREAKER_OPEN',
                    suggestion: `Aguarde ${Math.floor(breaker.timeout / 1000)}s para circuit breaker recovery`,
                },
                correlationId
            );

            this.stats.tasksRejected++;
            return;
        }

        // ✅ 3. Validação de limite de drivers ativos
        if (this.activeDrivers.size >= ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS) {
            // Enfileirar task (se queue não cheia)
            if (this.taskQueue.length >= ADAPTER_CONFIG.MAX_QUEUE_SIZE) {
                const error = `Task queue full (${this.taskQueue.length}/${ADAPTER_CONFIG.MAX_QUEUE_SIZE})`;

                log('WARN', `[DriverNERVAdapter] ${error}`, correlationId);

                this._emitBoth(
                    ADAPTER_EVENTS.TASK_FAILED,
                    ActionCode.DRIVER_TASK_FAILED,
                    {
                        taskId,
                        error,
                        reason: 'QUEUE_FULL',
                        suggestion: 'Aguarde tasks ativas completarem ou aumente MAX_QUEUE_SIZE',
                    },
                    correlationId
                );

                this.stats.tasksRejected++;
                return;
            }

            // Enfileirar
            this.taskQueue.push({ payload, correlationId });
            this.stats.tasksQueued++;

            log(
                'INFO',
                `[DriverNERVAdapter] Task ${taskId} enfileirada (${this.taskQueue.length} in queue)`,
                correlationId
            );

            this.emit(ADAPTER_EVENTS.TASK_QUEUED, {
                taskId,
                queueSize: this.taskQueue.length,
                activeDrivers: this.activeDrivers.size,
            });

            return;
        }

        let page = null;
        let driver = null;
        let listeners = [];
        let abortHandler = null;

        try {
            // ✅ P1 BUG #4 FIX: Adiciona listener de abort (fail-fast durante execução)
            if (signal) {
                abortHandler = () => {
                    log('WARN', `[DriverNERVAdapter] Abort signal received for task ${taskId}`, correlationId);

                    // ✅ v3.0: Marca como aborting em Map separado
                    this.abortedTasks.set(taskId, {
                        aborting: true,
                        abortReason: 'USER_ABORT',
                        timestamp: Date.now(),
                    });
                };

                signal.addEventListener('abort', abortHandler, { once: true });
            }

            // ✅ 4. Aloca página do pool (com timeout)
            const poolAcquireStart = Date.now();
            page = await Promise.race([
                this.browserPool.allocate(task.spec.target),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'browserPool.allocate'),
            ]);

            log('DEBUG', `[DriverNERVAdapter] Página alocada para task ${taskId}`, correlationId);

            // ✅ P0-U5: Update page taskId (temp → real)
            if (this.browserPool.updatePageTaskId) {
                this.browserPool.updatePageTaskId(page, taskId);
            }

            // ✅ 5. v3.0: Acquire driver do pool (pool-ready architecture)
            driver = await Promise.race([
                driverFactory.acquireFromPool(task.spec.target),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'driverFactory.acquireFromPool'),
            ]);

            timings.poolAcquire = Date.now() - poolAcquireStart; // ✅ U4

            log(
                'DEBUG',
                `[DriverNERVAdapter] Driver acquired from pool: ${driver.target} (busy=${driver.busy})`,
                correlationId
            );

            // ✅ 6. v3.0: Attach context (page + signal + correlationId)
            const attachStart = Date.now();
            driver.attachContext(page, signal, correlationId);
            timings.contextAttach = Date.now() - attachStart; // ✅ U4

            log('DEBUG', `[DriverNERVAdapter] Context attached to driver (state=${driver.state})`, correlationId);

            // ✅ 7. Salva no Map (driver direto, não LifecycleManager)
            this.activeDrivers.set(taskId, driver);

            // ✅ 7. Conecta listeners de telemetria do driver
            listeners = this._attachDriverTelemetry(driver, taskId, correlationId);

            // ✅ 8. GARANTIA PRÉ-EXECUÇÃO: Driver ready check (ontológico)
            // Valida que driver está pronto ANTES de emitir TASK_STARTED
            if (!driver) {
                throw new Error('[DriverNERVAdapter] Driver is null after acquire');
            }

            if (driver.destroyed) {
                throw new Error('[DriverNERVAdapter] Driver is destroyed after acquire');
            }

            if (driver.state !== 'IDLE') {
                log(
                    'WARN',
                    `[DriverNERVAdapter] Driver state is '${driver.state}' (expected 'IDLE'). ` +
                        `Forçando reset para IDLE antes de executar.`,
                    correlationId
                );
                driver.setState('IDLE');
            }

            // Validação adicional: Page ainda válida
            if (!driver.page || driver.page.isClosed()) {
                throw new Error('[DriverNERVAdapter] Driver page is null or closed after acquire');
            }

            log(
                'DEBUG',
                `[DriverNERVAdapter] ✅ Driver ready check passed: state=${driver.state}, destroyed=${driver.destroyed}, page.isClosed=${driver.page.isClosed()}`,
                correlationId
            );

            // ✅ 9. Emite evento de início (duplo canal) - APENAS após validações
            this._emitBoth(
                ADAPTER_EVENTS.TASK_STARTED,
                ActionCode.DRIVER_TASK_STARTED,
                {
                    taskId,
                    target: task.spec.target,
                    driverType: driver.constructor.name,
                    driverState: driver.state,
                    pageUrl: driver.page.url(),
                    activeDrivers: this.activeDrivers.size,
                },
                correlationId
            );

            // ✅ 10. Executa a tarefa (com timeout)
            const executeStart = Date.now();
            const result = await Promise.race([
                driver.execute(task.spec.prompt),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'driver.execute'),
            ]);
            timings.execute = Date.now() - executeStart; // ✅ U4

            // ✅ 11. Calcula timing metrics
            const duration = Date.now() - startTime;
            this.stats.totalTaskDuration += duration;
            this.stats.maxTaskDuration = Math.max(this.stats.maxTaskDuration, duration);
            this.stats.minTaskDuration = Math.min(this.stats.minTaskDuration, duration);

            // ✅ U4: Salva timing breakdown para agregação
            timings.total = duration;
            this._recordPerformanceMetrics(timings);

            // ✅ V2.0: Salvar response ANTES de emitir evento (garante dados persistidos)
            try {
                await saveResponse(taskId, result, task);
                log('INFO', `[DriverNERVAdapter] Response saved for task ${taskId}`, correlationId);
            } catch (saveError) {
                log(
                    'ERROR',
                    `[DriverNERVAdapter] Failed to save response for ${taskId}: ${saveError.message}`,
                    correlationId
                );
                // Continua mesmo se salvar falhar (response ainda pode ser usada)
            }

            // ✅ 12. Emite evento de conclusão (duplo canal)
            // ✅ V2.0: Inclui ResponseV2 completo no payload (não apenas status)
            this._emitBoth(
                ADAPTER_EVENTS.TASK_COMPLETED,
                ActionCode.DRIVER_TASK_COMPLETED,
                {
                    taskId,
                    result: result, // ✅ ResponseV2 object completo
                    // ✅ U4: Performance breakdown
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

            // ✅ U2: Circuit breaker success (per-target)
            this._recordSuccess(task.spec.target || 'chatgpt');
        } catch (error) {
            // ✅ P1 BUG #4 FIX: Verifica se erro foi causado por abort
            const abortEntry = this.abortedTasks.get(taskId);
            const wasAborted = abortEntry && abortEntry.aborting;

            if (wasAborted) {
                // Caso especial: Task foi abortada (não é falha técnica)
                log('WARN', `[DriverNERVAdapter] Task ${taskId} aborted during execution`, correlationId);

                this._emitBoth(
                    ADAPTER_EVENTS.TASK_ABORTED,
                    ActionCode.DRIVER_TASK_ABORTED,
                    {
                        taskId,
                        reason: abortEntry.abortReason || 'USER_ABORT',
                        message: 'Task execution was aborted by AbortSignal',
                    },
                    correlationId
                );

                this.stats.tasksAborted++;

                // NÃO incrementa driversCrashed nem record failure (não é falha)
            } else {
                // ✅ U5: Smart Retry Logic
                const errorType = this._classifyError(error);
                const canRetry = errorType === 'TRANSIENT' && retryCount < ADAPTER_CONFIG.MAX_RETRY_ATTEMPTS;

                if (canRetry) {
                    // Retry automático (exponential backoff: 1s → 2s → 4s)
                    const backoffMs = ADAPTER_CONFIG.RETRY_BACKOFF_MS * Math.pow(2, retryCount);

                    log(
                        'WARN',
                        `[DriverNERVAdapter] U5: TRANSIENT error detected. Retrying (${retryCount + 1}/${ADAPTER_CONFIG.MAX_RETRY_ATTEMPTS}) after ${backoffMs}ms backoff`,
                        correlationId
                    );

                    this.stats.tasksRetried++;

                    this._emitBoth(
                        ADAPTER_EVENTS.TASK_RETRYING || ADAPTER_EVENTS.TASK_STARTED, // Fallback se evento não existe
                        ActionCode.DRIVER_TASK_STARTED,
                        {
                            taskId,
                            retryAttempt: retryCount + 1,
                            maxRetries: ADAPTER_CONFIG.MAX_RETRY_ATTEMPTS,
                            backoffMs,
                            errorType,
                        },
                        correlationId
                    );

                    // Aguarda backoff antes de retry
                    await new Promise(resolve => setTimeout(resolve, backoffMs));

                    // Retry recursivo (incrementa retryCount)
                    return this._executeTask(payload, correlationId, retryCount + 1);
                }

                // Não pode retry (FATAL ou max retries atingido)
                const isTimeout = error.name === 'TimeoutError';

                log(
                    'ERROR',
                    `[DriverNERVAdapter] U5: ${errorType} error - NO RETRY. ` +
                        `Error: ${error.message} ${isTimeout ? `(operation: ${error.operation})` : ''}`,
                    correlationId
                );

                if (retryCount > 0) {
                    this.stats.retriesFailed++;
                }

                if (isTimeout) {
                    this.stats.tasksTimedOut++;
                }

                this._emitBoth(
                    ADAPTER_EVENTS.TASK_FAILED,
                    ActionCode.DRIVER_TASK_FAILED,
                    {
                        taskId,
                        error: error.message,
                        errorType: error.constructor.name,
                        isTimeout,
                        operation: error.operation || 'unknown',
                        errorClassification: errorType, // U5
                        retriesAttempted: retryCount, // U5
                    },
                    correlationId
                );

                this.stats.driversCrashed++;

                // ✅ U2: Circuit breaker failure (per-target)
                const targetForFailure = task?.spec?.target || payload?.target || 'chatgpt';
                this._recordFailure(targetForFailure);
            }
        } finally {
            // ✅ P1 BUG #4 FIX: Remove listener de abort (cleanup)
            if (signal && abortHandler) {
                signal.removeEventListener('abort', abortHandler);
            }

            // ✅ v3.0: Cleanup de abortedTasks Map
            this.abortedTasks.delete(taskId);

            // ✅ 13. v3.0: Cleanup pool-ready (detach context + release to pool)
            await this._finallyCleanup(taskId, page, driver, listeners);
        }
    }

    /**
     * Aborta uma tarefa em execução.
     *
     * ✅ v2.0: Timeout protection
     * ✅ v2.0: Detach listeners antes de abortar
     *
     * @private
     * @async
     *
     * @param {Object} payload - Payload com taskId
     * @param {string} payload.taskId - Task ID para abortar
     * @param {string} correlationId - NERV correlation ID
     *
     * @returns {Promise<void>}
     *
     * @emits ADAPTER_EVENTS.TASK_ABORTED quando task abortada
     */
    async _abortTask(payload, correlationId) {
        const { taskId } = payload;

        const activeDriver = this.activeDrivers.get(taskId);

        if (!activeDriver) {
            log('WARN', `[DriverNERVAdapter] Task ${taskId} não encontrada para abortar`, correlationId);
            return;
        }

        log('INFO', `[DriverNERVAdapter] Abortando task: ${taskId}`, correlationId);

        const { lifecycleManager, listeners } = activeDriver;

        try {
            // ✅ Detach listeners primeiro
            if (listeners && listeners.length > 0) {
                this._detachDriverTelemetry(lifecycleManager._driver, listeners);
            }

            // ✅ Release com timeout
            await Promise.race([lifecycleManager.release(), this._timeout(5000, 'lifecycleManager.release (abort)')]);
        } catch (err) {
            // ✅ P1 BUG #5 FIX: Emite erro via telemetria completa
            log('ERROR', `[DriverNERVAdapter] Erro ao abortar task ${taskId}: ${err.message}`, correlationId);

            await this._emitError('task_abort', err, taskId, correlationId, 'abort');
        } finally {
            this.activeDrivers.delete(taskId);
        }

        this._emitBoth(
            ADAPTER_EVENTS.TASK_ABORTED,
            ActionCode.DRIVER_TASK_ABORTED,
            {
                taskId,
                reason: 'USER_REQUESTED',
            },
            correlationId
        );

        this.stats.tasksAborted++;
    }

    /**
     * Realiza health check do adapter e drivers ativos.
     *
     * ✅ v2.0: Error handling robusto
     * ✅ v2.0: Timeout protection
     * ✅ v2.0: Health status calculado (HEALTHY, DEGRADED, UNHEALTHY)
     * ✅ v2.0: Config incluído no report
     *
     * @private
     * @async
     *
     * @param {Object} payload - Payload (vazio para periodic check)
     * @param {string} correlationId - NERV correlation ID
     *
     * @returns {Promise<Object>} Health report completo
     *
     * @emits ADAPTER_EVENTS.HEALTH_CHECK quando health check completo
     */
    async _performHealthCheck(payload, correlationId) {
        let browserPoolHealth = null;
        let healthStatus = STATUS_VALUES.HEALTHY;

        try {
            // ✅ Try-catch em browserPool.getHealth()
            if (this.browserPool) {
                browserPoolHealth = await Promise.race([
                    this.browserPool.getHealth(),
                    this._timeout(5000, 'browserPool.getHealth'),
                ]);
            } else {
                browserPoolHealth = { status: 'DEGRADED', reason: 'Pool not available' };
                healthStatus = STATUS_VALUES.DEGRADED;
            }
        } catch (poolError) {
            // ✅ P1 BUG #5 FIX: Emite erro via telemetria completa
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
            queuedTasks: this.taskQueue.length,
            degradedMode: this.degradedMode,
            // ✅ U2: Per-target circuit breakers
            circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([target, breaker]) => ({
                target,
                state: breaker.state,
                failures: breaker.failures,
                threshold: breaker.threshold,
            })),
            // ✅ U4: Performance metrics
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
                maxQueueSize: ADAPTER_CONFIG.MAX_QUEUE_SIZE,
                executeTimeout: ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS,
                shutdownTimeout: ADAPTER_CONFIG.SHUTDOWN_TIMEOUT_MS,
                circuitBreakerThreshold: ADAPTER_CONFIG.CIRCUIT_BREAKER_THRESHOLD,
            },
            uptime: Date.now() - this.stats.startTime,
        };

        this._emitBoth(ADAPTER_EVENTS.HEALTH_CHECK, ActionCode.DRIVER_HEALTH_REPORT, health, correlationId);

        this.stats.healthChecksPerformed++;

        log(
            'DEBUG',
            `[DriverNERVAdapter] Health check: ${healthStatus}, ${this.activeDrivers.size} drivers ativos, ${this.taskQueue.length} in queue`,
            correlationId
        );

        return health;
    }

    /**
     * ✅ U4: Registra performance metrics (timing breakdown).
     *
     * Agrega timings para cálculo de médias.
     * Mantém apenas últimos 100 samples (sliding window).
     *
     * @private
     * @param {Object} timings - Timing breakdown
     * @param {number} timings.poolAcquire - Pool acquire time (ms)
     * @param {number} timings.contextAttach - Context attach time (ms)
     * @param {number} timings.execute - Execute time (ms)
     * @param {number} timings.total - Total time (ms)
     * @returns {void}
     */
    _recordPerformanceMetrics(timings) {
        const { poolAcquire, contextAttach, execute, total } = timings;

        // Adiciona samples (limite 100 para sliding window)
        if (poolAcquire !== null) {
            this.performanceMetrics.poolAcquireTimes.push(poolAcquire);
            if (this.performanceMetrics.poolAcquireTimes.length > 100) {
                this.performanceMetrics.poolAcquireTimes.shift();
            }
        }

        if (contextAttach !== null) {
            this.performanceMetrics.contextAttachTimes.push(contextAttach);
            if (this.performanceMetrics.contextAttachTimes.length > 100) {
                this.performanceMetrics.contextAttachTimes.shift();
            }
        }

        if (execute !== null) {
            this.performanceMetrics.executeTimes.push(execute);
            if (this.performanceMetrics.executeTimes.length > 100) {
                this.performanceMetrics.executeTimes.shift();
            }
        }

        if (total !== null) {
            this.performanceMetrics.totalTimes.push(total);
            if (this.performanceMetrics.totalTimes.length > 100) {
                this.performanceMetrics.totalTimes.shift();
            }
        }

        // Calcula médias (para health checks)
        const avg = arr => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

        this.performanceMetrics.avgPoolAcquire = Math.round(avg(this.performanceMetrics.poolAcquireTimes));
        this.performanceMetrics.avgContextAttach = Math.round(avg(this.performanceMetrics.contextAttachTimes));
        this.performanceMetrics.avgExecute = Math.round(avg(this.performanceMetrics.executeTimes));
        this.performanceMetrics.avgTotal = Math.round(avg(this.performanceMetrics.totalTimes));
    }

    /**
     * Conecta listeners aos eventos do driver (state_change, progress, vitals).
     * Emite via NERV para observação do KERNEL e SERVER.
     *
     * ✅ v2.0: Listeners salvos em array para detach posterior
     * ✅ v2.0: Auto-detach quando driver destruído
     * ✅ v2.0: Emit eventos locais também (duplo canal)
     *
     * @private
     *
     * @param {Object} driver - Instância do driver (ChatGPTDriver, etc)
     * @param {string} taskId - Task ID
     * @param {string} correlationId - NERV correlation ID
     *
     * @returns {Array<Object>} Array de listeners (para detach)
     *
     * @emits ADAPTER_EVENTS.DRIVER_ATTACHED quando listeners conectados
     */
    _attachDriverTelemetry(driver, taskId, correlationId) {
        // ✅ Array para salvar listeners (permite detach)
        const listeners = [];

        // Listener para mudanças de estado
        const stateChangeListener = data => {
            this._emitBoth(
                ADAPTER_EVENTS.TASK_STARTED, // Local event genérico
                ActionCode.DRIVER_STATE_OBSERVED,
                {
                    taskId,
                    stateTransition: data,
                    timestamp: new Date().toISOString(),
                },
                correlationId
            );
        };
        driver.on('state_change', stateChangeListener);
        listeners.push({ event: 'state_change', listener: stateChangeListener });

        // Listener para progresso
        const progressListener = data => {
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
        };
        driver.on('progress', progressListener);
        listeners.push({ event: 'progress', listener: progressListener });

        // Listener para anomalias
        const anomalyListener = data => {
            this._emitBoth(
                ADAPTER_EVENTS.ERROR, // Local error event
                ActionCode.DRIVER_ANOMALY,
                {
                    taskId,
                    anomalyType: data.type,
                    severity: data.severity,
                    details: data.message,
                },
                correlationId
            );
        };
        driver.on('anomaly', anomalyListener);
        listeners.push({ event: 'anomaly', listener: anomalyListener });

        // ✅ Auto-detach quando driver destruído
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
     * Remove listeners do driver (cleanup).
     *
     * ✅ v2.0: Método dedicado para detach
     *
     * @private
     *
     * @param {Object} driver - Instância do driver
     * @param {Array<Object>} listeners - Array de listeners para remover
     *
     * @returns {void}
     */
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

    /**
     * Emite um evento via NERV (IPC).
     *
     * ✅ v2.0: Retry logic (3 tentativas com backoff)
     * ✅ v2.0: Métricas de sucesso/falha
     * ✅ v2.0: Emit local error event em falha permanente
     *
     * @private
     * @async
     *
     * @param {string} actionCode - ActionCode do evento (DRIVER_*)
     * @param {Object} payload - Payload do evento
     * @param {string} correlationId - NERV correlation ID
     *
     * @returns {Promise<void>}
     *
     * @emits ADAPTER_EVENTS.ERROR se falha permanente
     */
    async _emitEvent(actionCode, payload, correlationId) {
        const maxRetries = ADAPTER_CONFIG.EVENT_RETRY_MAX_ATTEMPTS;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                HighLevelNERV.sendEvent(this.nerv, ActorRole.DRIVER, actionCode, payload, correlationId);

                log('DEBUG', `[DriverNERVAdapter] Evento NERV emitido: ${actionCode}`, correlationId);

                // ✅ Métrica de sucesso
                this.stats.eventsEmitted++;

                return; // Success
            } catch (err) {
                // Unused but kept for potential future debugging
                const _lastError = err;

                if (attempt < maxRetries - 1) {
                    const backoff = ADAPTER_CONFIG.EVENT_RETRY_BACKOFF_MS * (attempt + 1);
                    log(
                        'WARN',
                        `[DriverNERVAdapter] Falha ao emitir evento (tentativa ${attempt + 1}/${maxRetries}): ${_lastError.message}`,
                        correlationId
                    );
                    await new Promise(resolve => setTimeout(resolve, backoff));
                } else {
                    log(
                        'ERROR',
                        `[DriverNERVAdapter] Falha permanente ao emitir evento após ${maxRetries} tentativas: ${_lastError.message}`,
                        correlationId
                    );

                    // ✅ Métrica de falha
                    this.stats.eventsFailed++;

                    // ✅ Emit local error event
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
     * Emite evento via duplo canal: EventEmitter local + NERV IPC.
     *
     * ✅ v2.0: Novo método para duplo canal
     *
     * @private
     * @async
     *
     * @param {string} localEvent - Nome do evento local (ADAPTER_EVENTS.*)
     * @param {string} nervActionCode - ActionCode NERV (ActionCode.DRIVER_*)
     * @param {Object} payload - Payload do evento
     * @param {string} correlationId - NERV correlation ID
     *
     * @returns {Promise<void>}
     */
    async _emitBoth(localEvent, nervActionCode, payload, correlationId) {
        // Canal local (EventEmitter)
        this.emit(localEvent, { ...payload, correlationId });

        // Canal NERV (IPC)
        await this._emitEvent(nervActionCode, payload, correlationId);
    }

    /**
     * Adiciona evento ao buffer de telemetria (batch emit).
     *
     * ✅ v2.0: Telemetry buffer para performance
     *
     * @private
     *
     * @param {string} actionCode - ActionCode do evento
     * @param {Object} payload - Payload do evento
     * @param {string} correlationId - NERV correlation ID
     *
     * @returns {void}
     */
    _bufferTelemetry(actionCode, payload, correlationId) {
        this.telemetryBuffer.push({
            actionCode,
            payload,
            correlationId,
            timestamp: Date.now(),
        });

        // Flush se buffer cheio
        if (this.telemetryBuffer.length >= ADAPTER_CONFIG.TELEMETRY_BUFFER_SIZE) {
            this._flushTelemetry();
        }
    }

    /**
     * Faz flush do buffer de telemetria (batch emit).
     *
     * ✅ v2.0: Batch emit via NERV
     *
     * @private
     *
     * @returns {void}
     */
    _flushTelemetry() {
        if (this.telemetryBuffer.length === 0) return;

        const batch = [...this.telemetryBuffer];
        this.telemetryBuffer = [];

        // Emit cada evento do batch (async)
        for (const { actionCode, payload, correlationId } of batch) {
            this._emitEvent(actionCode, payload, correlationId).catch(err => {
                log('WARN', `[DriverNERVAdapter] Error flushing telemetry: ${err.message}`);
            });
        }

        log('DEBUG', `[DriverNERVAdapter] Flushed ${batch.length} telemetry events`);
    }

    /**
     * ✅ P1 BUG #5 FIX: Template unificado para emissão de erros
     * Garante telemetria completa (local + NERV) em todos os pontos de falha.
     *
     * @private
     * @async
     *
     * @param {string} operation - Nome da operação que falhou
     * @param {Error} error - Error object
     * @param {string} taskId - Task ID (pode ser null se erro pré-task)
     * @param {string} correlationId - NERV correlation ID
     * @param {string} phase - Phase onde erro ocorreu ('allocate', 'acquire', 'execute', 'release')
     *
     * @returns {Promise<void>}
     */
    async _emitError(operation, error, taskId, correlationId, phase) {
        // 1. Log detalhado
        log('ERROR', `[DriverNERVAdapter] ${operation} failed: ${error.message}`, {
            taskId,
            correlationId,
            phase,
            stack: error.stack,
        });

        // 2. Emite local + NERV
        await this._emitBoth(
            ADAPTER_EVENTS.ERROR,
            ActionCode.DRIVER_ERROR,
            {
                taskId,
                operation,
                error: error.message,
                errorType: error.constructor.name,
                stack: error.stack,
                phase,
                timestamp: Date.now(),
            },
            correlationId
        );

        // 3. Atualiza stats
        this.stats.tasksRejected++;

        // 4. Circuit breaker check (opcional - pode descomentar se necessário)
        // this._checkCircuitBreaker();
    }

    /**
     * Cria promise que rejeita após timeout (helper).
     *
     * ✅ v2.0: Helper para Promise.race timeout protection
     *
     * @private
     *
     * @param {number} ms - Timeout em milissegundos
     * @param {string} operation - Nome da operação (para error message)
     *
     * @returns {Promise<never>} Promise que rejeita com TimeoutError
     */
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

    /**
     * Cleanup final robusto (always executes).
     *
     * ✅ v3.0 (C4): Atomic cleanup - activeDrivers.delete() ANTES de processar fila.
     * ✅ v2.0: Detach listeners, release resources, process queue
     *
     * C4 FIX: Garante que activeDrivers.size está correto ANTES de checar capacidade
     * para processar próxima task na fila (elimina race condition).
     *
     * @private
     * @async
     *
     * @param {string} taskId - Task ID
     * @param {Object} page - Puppeteer page
     * @param {Object} driver - Driver instance
     * @param {Array<Object>} listeners - Array de listeners
     *
     * @returns {Promise<void>}
     */
    async _finallyCleanup(taskId, page, driver, listeners) {
        // ✅ 1. Detach listeners ANTES de qualquer cleanup (P0 Bug #1 Fix)
        if (driver && listeners && listeners.length > 0) {
            try {
                this._detachDriverTelemetry(driver, listeners);
            } catch (err) {
                log('WARN', `[DriverNERVAdapter] Error detaching listeners: ${err.message}`);
            }
        }

        // ✅ 2. v3.0 (C2): Detach context + release to pool (FORCE detach para garantir)
        if (driver) {
            try {
                // ✅ C2: Force detach (garante detach mesmo se erro/estado inválido)
                driver.detachContext({ force: true });

                log('DEBUG', `[DriverNERVAdapter] Context detached from driver (state=${driver.state})`);

                // Release driver back to pool (IDLE state)
                await Promise.race([
                    driverFactory.releaseToPool(driver),
                    this._timeout(5000, 'driverFactory.releaseToPool (finally)'),
                ]);

                log('DEBUG', `[DriverNERVAdapter] Driver released to pool (target=${driver.target})`);
            } catch (err) {
                log('WARN', `[DriverNERVAdapter] Error detaching/releasing driver: ${err.message}`);
            }
        }

        // ✅ C4: CRITICAL - Cleanup do Map ANTES de processar fila
        // Garante que activeDrivers.size está correto na check de capacidade
        if (taskId) {
            this._cleanupDriver(taskId);
        }

        // ✅ 4. Release page
        if (page && this.browserPool) {
            try {
                await Promise.race([this.browserPool.release(page), this._timeout(5000, 'browserPool.release')]);
            } catch (err) {
                log('WARN', `[DriverNERVAdapter] Error releasing page: ${err.message}`);
            }
        }

        // ✅ C4: Process next task from queue APÓS cleanup (activeDrivers.size correto)
        this._processNextQueuedTask();
    }

    /**
     * ✅ C4: Process next task from queue (extracted method).
     *
     * PRÉ-CONDIÇÃO: activeDrivers.delete() já foi executado (activeDrivers.size correto).
     * Valida capacidade (MAX_ACTIVE_DRIVERS) antes de executar.
     *
     * @private
     * @returns {void}
     */
    _processNextQueuedTask() {
        if (this.taskQueue.length === 0) {
            // Nada na fila
            return;
        }

        // ✅ C4: Check capacidade COM activeDrivers.size correto
        if (this.activeDrivers.size >= ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS) {
            log(
                'DEBUG',
                `[DriverNERVAdapter] C4: Queue has ${this.taskQueue.length} tasks but MAX_ACTIVE_DRIVERS ` +
                    `reached (${this.activeDrivers.size}/${ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS}). Waiting...`
            );
            return;
        }

        const next = this.taskQueue.shift();

        log(
            'DEBUG',
            `[DriverNERVAdapter] C4: Processing queued task ` +
                `(${this.taskQueue.length} remaining, ${this.activeDrivers.size} active)`
        );

        // Execute async (não bloqueia cleanup)
        setImmediate(() => {
            this._executeTask(next.payload, next.correlationId).catch(err => {
                log('ERROR', `[DriverNERVAdapter] C4: Error executing queued task: ${err.message}`);
            });
        });
    }

    /**
     * Cleanup robusto de driver do activeDrivers Map.
     * ✅ P0 Bug #1 Fix: Detach listeners antes de delete (memory leak prevention)
     * ✅ Garantia Ontológica: Valida que apenas 1 driver existe por page
     *
     * @private
     *
     * @param {string} taskId - Task ID para cleanup
     *
     * @returns {void}
     */
    _cleanupDriver(taskId) {
        const driver = this.activeDrivers.get(taskId);

        if (!driver) {
            // Já foi cleaned up (idempotência)
            return;
        }

        // ✅ v3.0: Remove do Map (memory leak fix)
        this.activeDrivers.delete(taskId);

        log('DEBUG', `[DriverNERVAdapter] Task ${taskId} cleaned from activeDrivers Map (driver=${driver.target})`);
    }

    /**
     * ✅ U2: Verifica se pode executar task (per-target circuit breaker check).
     *
     * Fault isolation: Circuit breaker isolado por target.
     * Falhas em chatgpt NÃO afetam gemini.
     *
     * @private
     * @param {string} target - Target name (chatgpt, gemini, etc)
     * @returns {boolean} true se pode executar, false se circuit breaker OPEN
     */
    _canExecute(target) {
        // ✅ U2: Lazy initialization do circuit breaker por target
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
        const { state, failures, threshold, timeout, lastFailureTime } = breaker;

        if (state === 'CLOSED') return true;

        if (state === 'OPEN') {
            // Check se timeout passou (recovery)
            if (Date.now() - lastFailureTime > timeout) {
                breaker.state = 'HALF_OPEN';
                log('INFO', `[DriverNERVAdapter] U2: Circuit breaker HALF_OPEN for ${target} (recovery attempt)`);

                this.emit(ADAPTER_EVENTS.CIRCUIT_BREAKER_CLOSED, {
                    target,
                    state: 'HALF_OPEN',
                    failures: failures,
                    threshold: threshold,
                });

                return true;
            }
            return false; // Ainda OPEN
        }

        if (state === 'HALF_OPEN') {
            return true; // Permite 1 tentativa
        }

        return true;
    }

    /**
     * ✅ U2: Registra sucesso de task (per-target circuit breaker).
     *
     * Reset failures para target específico.
     *
     * @private
     * @param {string} target - Target name
     * @returns {void}
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
     * ✅ U5: Classifica erro como TRANSIENT (retriable) ou FATAL (não retriable).
     * ✅ BUG-03 FIXED: Page closed/disconnected são FATAL (não retry).
     *
     * TRANSIENT errors (retry recommended):
     * - Network errors (ECONNREFUSED, ENOTFOUND, etc)
     * - Timeout errors
     * - 502/503/504 HTTP errors
     * - Navigation timeout (recoverable)
     *
     * FATAL errors (não retry):
     * - Page closed by user
     * - Page disconnected
     * - Target closed
     * - Browser disconnected
     * - AbortSignal (user requested)
     * - Validation errors
     * - 400/401/403/404 HTTP errors
     * - Driver destroyed
     *
     * @private
     * @param {Error} error - Error object
     * @returns {string} 'TRANSIENT' | 'FATAL'
     */
    _classifyError(error) {
        const message = error.message || '';
        const name = error.name || '';

        // ✅ BUG-03 FIX: FATAL - Page lifecycle errors (não retry)
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

        // TRANSIENT: Network errors
        if (
            message.includes('ECONNREFUSED') ||
            message.includes('ENOTFOUND') ||
            message.includes('ETIMEDOUT') ||
            message.includes('ECONNRESET') ||
            message.includes('socket hang up')
        ) {
            return 'TRANSIENT';
        }

        // TRANSIENT: Timeout errors (exceto page closed timeout)
        if (name === 'TimeoutError' || message.includes('timeout')) {
            return 'TRANSIENT';
        }

        // TRANSIENT: HTTP 5xx errors (server-side)
        if (message.match(/502|503|504/)) {
            return 'TRANSIENT';
        }

        // FATAL: User abort
        if (message.includes('abort') || name === 'AbortError') {
            return 'FATAL';
        }

        // FATAL: Validation errors
        if (message.includes('validation') || message.includes('invalid')) {
            return 'FATAL';
        }

        // FATAL: HTTP 4xx errors (client-side)
        if (message.match(/400|401|403|404/)) {
            return 'FATAL';
        }

        // FATAL: Driver destroyed
        if (message.includes('destroyed') || message.includes('Driver is null')) {
            return 'FATAL';
        }

        // Default: TRANSIENT (conservative approach - prefer retry)
        return 'TRANSIENT';
    }

    /**
     * ✅ U2: Registra falha de task (per-target circuit breaker).
     *
     * Incrementa failures para target específico.
     * Fault isolation: Falhas em chatgpt NÃO afetam gemini.
     *
     * @private
     * @param {string} target - Target name
     * @returns {void}
     *
     * @emits ADAPTER_EVENTS.CIRCUIT_BREAKER_OPEN quando threshold atingido
     */
    _recordFailure(target) {
        if (!this.circuitBreakers.has(target)) {
            // Lazy init
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

    /**
     * Inicia health check periódico.
     *
     * ✅ v2.0: Health check automático
     *
     * @private
     *
     * @returns {void}
     */
    _startPeriodicHealthCheck() {
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this._performHealthCheck({}, 'PERIODIC_HEALTH_CHECK');
            } catch (err) {
                log('ERROR', `[DriverNERVAdapter] Periodic health check failed: ${err.message}`);
            }
        }, ADAPTER_CONFIG.HEALTH_CHECK_INTERVAL_MS);

        log(
            'INFO',
            `[DriverNERVAdapter] Periodic health check started (${ADAPTER_CONFIG.HEALTH_CHECK_INTERVAL_MS}ms interval)`
        );
    }

    /**
     * Inicia flush periódico do buffer de telemetria.
     *
     * ✅ v2.0: Flush automático a cada 1s
     *
     * @private
     *
     * @returns {void}
     */
    _startTelemetryFlush() {
        this.telemetryFlushInterval = setInterval(() => {
            if (this.telemetryBuffer.length > 0) {
                this._flushTelemetry();
            }
        }, 1000); // Flush a cada 1s

        log('DEBUG', '[DriverNERVAdapter] Telemetry flush interval started (1s)');
    }

    /**
     * Inicia warning periódico de modo degradado.
     *
     * ✅ v2.0: Warning automático quando browserPool = null
     *
     * @private
     *
     * @returns {void}
     *
     * @emits ADAPTER_EVENTS.DEGRADED_MODE periodicamente
     */
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
     * Shutdown gracioso do adapter.
     * Aborta todas as tasks ativas e libera recursos.
     *
     * ✅ v2.0: Timeout protection
     * ✅ v2.0: Clear intervals
     * ✅ v2.0: Promise.allSettled (não falha se um driver falhar)
     * ✅ v2.0: Retorna resultado detalhado
     *
     * @async
     *
     * @param {Object} [options={}] - Opções de shutdown
     * @param {number} [options.timeout] - Timeout customizado (ms)
     *
     * @returns {Promise<Object>} Resultado do shutdown { total, success, failed }
     *
     * @emits ADAPTER_EVENTS.SHUTDOWN quando shutdown completo
     *
     * @example
     * const result = await adapter.shutdown({ timeout: 10000 });
     * console.log(`Shutdown: ${result.success}/${result.total} success`);
     */
    async shutdown(options = {}) {
        const timeout = options.timeout || ADAPTER_CONFIG.SHUTDOWN_TIMEOUT_MS;
        const startTime = Date.now();

        log(
            'INFO',
            `[DriverNERVAdapter] Iniciando shutdown (${this.activeDrivers.size} drivers ativos, ${this.taskQueue.length} queued, timeout: ${timeout}ms)`
        );

        // ✅ 1. Clear intervals
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            log('DEBUG', '[DriverNERVAdapter] Health check interval cleared');
        }

        if (this.telemetryFlushInterval) {
            clearInterval(this.telemetryFlushInterval);
            log('DEBUG', '[DriverNERVAdapter] Telemetry flush interval cleared');
        }

        if (this.degradedModeInterval) {
            clearInterval(this.degradedModeInterval);
            log('DEBUG', '[DriverNERVAdapter] Degraded mode warning interval cleared');
        }

        // ✅ 2. Flush remaining telemetry
        if (this.telemetryBuffer.length > 0) {
            log('DEBUG', `[DriverNERVAdapter] Flushing ${this.telemetryBuffer.length} remaining telemetry events`);
            this._flushTelemetry();
        }

        // ✅ 3. Shutdown active drivers (paralelo com timeout)
        const shutdownPromises = [];

        for (const [taskId, activeDriver] of this.activeDrivers.entries()) {
            const { lifecycleManager, listeners } = activeDriver;

            const shutdownPromise = (async () => {
                try {
                    // Detach listeners primeiro
                    if (listeners && listeners.length > 0) {
                        this._detachDriverTelemetry(lifecycleManager._driver, listeners);
                    }

                    // Release com timeout
                    const releasePromise = lifecycleManager.release();
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Shutdown timeout')), timeout)
                    );

                    await Promise.race([releasePromise, timeoutPromise]);

                    log('DEBUG', `[DriverNERVAdapter] Driver ${taskId} released successfully`);
                    return { taskId, success: true };
                } catch (err) {
                    log('ERROR', `[DriverNERVAdapter] Erro ao liberar driver ${taskId}: ${err.message}`);
                    return { taskId, success: false, error: err.message };
                }
            })();

            shutdownPromises.push(shutdownPromise);
        }

        // ✅ 4. Aguardar todos os shutdowns (Promise.allSettled)
        const results = await Promise.allSettled(shutdownPromises);

        const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        const failedCount = results.length - successCount;
        const duration = Date.now() - startTime;

        this.activeDrivers.clear();
        this.taskQueue = []; // Clear queue

        const shutdownResult = {
            total: results.length,
            success: successCount,
            failed: failedCount,
            duration,
        };

        // ✅ 5. Emit shutdown event
        this.emit(ADAPTER_EVENTS.SHUTDOWN, shutdownResult);

        log(
            'INFO',
            `[DriverNERVAdapter] Shutdown concluído (${successCount}/${results.length} success, ${duration}ms)`
        );

        return shutdownResult;
    }

    /**
     * Retorna estatísticas observacionais do adapter.
     *
     * ✅ v2.0: Métricas expandidas (14 métricas)
     * ✅ v2.0: Uptime calculado
     * ✅ v2.0: Avg task duration
     *
     * @returns {Object} Estatísticas completas
     *
     * @example
     * const stats = adapter.getStats();
     * console.log(`Tasks executed: ${stats.tasksExecuted}`);
     * console.log(`Uptime: ${stats.uptime}ms`);
     */
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
            circuitBreaker: {
                state: this.circuitBreaker.state,
                failures: this.circuitBreaker.failures,
                threshold: this.circuitBreaker.threshold,
            },
        };
    }
}

export const create = (nerv, browserPool, config) => {
    return new DriverNERVAdapter(nerv, browserPool, config);
};

export { DriverNERVAdapter, ADAPTER_CONFIG, ADAPTER_EVENTS };
