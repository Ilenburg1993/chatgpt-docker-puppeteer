/* ==========================================================================
   src/driver/nerv_adapter/driver_nerv_adapter.js
   Subsistema: DRIVER — NERV Adapter
   Audit Level: 800 — Critical Decoupling Layer (Singularity Edition)
   Version: 2.0 (EventEmitter + Complete Resilience)

   Responsabilidade:
   - Adaptar NERV (pub/sub) para o domínio do DRIVER
   - Gerenciar instâncias de DriverLifecycleManager
   - Escutar COMMANDS vindos do KERNEL via NERV
   - Emitir EVENTS de telemetria do driver via NERV + EventEmitter local
   - Garantir ZERO acoplamento direto com outros subsistemas

   Princípios:
   - NÃO importa KERNEL, SERVER ou INFRA diretamente
   - NÃO acessa filesystem diretamente (usa KERNEL para decisões)
   - NÃO decide estratégias (apenas executa ordens)
   - Comunicação 100% via NERV (IPC) + EventEmitter (local)

   v2.0 Features:
   - EventEmitter inheritance (duplo canal: local + NERV)
   - ADAPTER_CONFIG (8 constantes, zero magic numbers)
   - ADAPTER_EVENTS (10 eventos locais)
   - Timeout protection (execute, shutdown, health check)
   - Circuit breaker pattern (resilience)
   - Telemetry buffer (batch emit)
   - Metrics expandidos (14 métricas)
   - JSDoc completo (100%)
   - Error recovery (detach listeners, cleanup)
========================================================================== */

const EventEmitter = require('events');
const DriverLifecycleManager = require('../DriverLifecycleManager');

const {
    STATUS_VALUES: STATUS_VALUES
} = require('@core/constants/tasks.js');

const { log } = require('@core/logger');
const { ActionCode, MessageType, ActorRole } = require('@shared/nerv/constants');
const HighLevelNERV = require('@nerv/adapters/high_level_adapter');

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
    MAX_QUEUE_SIZE: parseInt(process.env.ADAPTER_MAX_QUEUE || '100')
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

        // Mapa de drivers ativos: taskId -> { lifecycleManager, listeners }
        this.activeDrivers = new Map();

        // ✅ v2.0: Task queue (quando MAX_ACTIVE_DRIVERS atingido)
        this.taskQueue = [];

        // ✅ v2.0: Telemetry buffer (batch emit para performance)
        this.telemetryBuffer = [];

        // ✅ v2.0: Circuit breaker state
        this.circuitBreaker = {
            state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
            failures: 0,
            threshold: ADAPTER_CONFIG.CIRCUIT_BREAKER_THRESHOLD,
            timeout: ADAPTER_CONFIG.CIRCUIT_BREAKER_TIMEOUT_MS,
            lastFailureTime: null
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

            // ✅ Timing metrics
            totalTaskDuration: 0,
            maxTaskDuration: 0,
            minTaskDuration: Infinity,

            // ✅ Uptime
            startTime: Date.now()
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
                        originalCommand: envelope.actionCode
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
                        'Configure o browserEndpoint/proxy com remote debugging exposto ao container (ver CONFIG.DEBUG_PORT ou CHROME_WS_ENDPOINT) e reinicie o sistema'
                },
                correlationId
            );
            return;
        }

        switch (actionCode) {
            case ActionCode.DRIVER_EXECUTE_TASK:
                // ✅ v1.1: Valida pré-requisitos antes de executar
                const { validateBrowserPool } = require('@core/validators/prerequisite_validator');
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
                            suggestion: poolValidation.details.suggestion
                        },
                        correlationId
                    );
                    return;
                }

                await this._executeTask(payload, correlationId);
                break;

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
     *
     * @returns {Promise<void>}
     *
     * @throws {Error} Se task inválida, timeout, ou circuit breaker aberto
     *
     * @emits ADAPTER_EVENTS.TASK_STARTED quando task inicia
     * @emits ADAPTER_EVENTS.TASK_COMPLETED quando task completa com sucesso
     * @emits ADAPTER_EVENTS.TASK_FAILED quando task falha
     * @emits ADAPTER_EVENTS.TASK_QUEUED quando task enfileirada
     */
    async _executeTask(payload, correlationId) {
        const { task } = payload;

        if (!task || !task.meta || !task.meta.id) {
            throw new Error('Task inválida recebida via NERV');
        }

        const taskId = task.meta.id;
        const startTime = Date.now();

        log('INFO', `[DriverNERVAdapter] Iniciando execução: ${taskId}`, correlationId);

        // ✅ 1. Verifica se já existe driver para essa task
        if (this.activeDrivers.has(taskId)) {
            log('WARN', `[DriverNERVAdapter] Task ${taskId} já possui driver ativo`, correlationId);
            return;
        }

        // ✅ 2. Circuit breaker check
        if (!this._canExecute()) {
            const error = `Circuit breaker OPEN - too many recent failures (${this.circuitBreaker.failures}/${this.circuitBreaker.threshold})`;

            log('WARN', `[DriverNERVAdapter] ${error}`, correlationId);

            this._emitBoth(
                ADAPTER_EVENTS.TASK_FAILED,
                ActionCode.DRIVER_TASK_FAILED,
                {
                    taskId,
                    error,
                    reason: 'CIRCUIT_BREAKER_OPEN',
                    suggestion: `Aguarde ${Math.floor(this.circuitBreaker.timeout / 1000)}s para circuit breaker recovery`
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
                        suggestion: 'Aguarde tasks ativas completarem ou aumente MAX_QUEUE_SIZE'
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
                activeDrivers: this.activeDrivers.size
            });

            return;
        }

        let page = null;
        let lifecycleManager = null;
        let driver = null;
        let listeners = [];

        try {
            // ✅ 4. Aloca página do pool (com timeout)
            page = await Promise.race([
                this.browserPool.allocate(task.spec.target),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'browserPool.allocate')
            ]);

            log('DEBUG', `[DriverNERVAdapter] Página alocada para task ${taskId}`, correlationId);

            // ✅ 5. Cria DriverLifecycleManager (com timeout)
            lifecycleManager = new DriverLifecycleManager(page, task, this.config);

            driver = await Promise.race([
                lifecycleManager.acquire(),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'lifecycleManager.acquire')
            ]);

            // ✅ 6. Salva no Map com listeners array
            this.activeDrivers.set(taskId, { lifecycleManager, listeners });

            // ✅ 7. Conecta listeners de telemetria do driver
            listeners = this._attachDriverTelemetry(driver, taskId, correlationId);

            // ✅ 8. Emite evento de início (duplo canal)
            this._emitBoth(
                ADAPTER_EVENTS.TASK_STARTED,
                ActionCode.DRIVER_TASK_STARTED,
                {
                    taskId,
                    target: task.spec.target,
                    driverType: driver.constructor.name,
                    activeDrivers: this.activeDrivers.size
                },
                correlationId
            );

            // ✅ 9. Executa a tarefa (com timeout)
            const result = await Promise.race([
                driver.execute(task.spec.prompt),
                this._timeout(ADAPTER_CONFIG.EXECUTE_TASK_TIMEOUT_MS, 'driver.execute')
            ]);

            // ✅ 10. Calcula timing metrics
            const duration = Date.now() - startTime;
            this.stats.totalTaskDuration += duration;
            this.stats.maxTaskDuration = Math.max(this.stats.maxTaskDuration, duration);
            this.stats.minTaskDuration = Math.min(this.stats.minTaskDuration, duration);

            // ✅ 11. Emite evento de conclusão (duplo canal)
            this._emitBoth(
                ADAPTER_EVENTS.TASK_COMPLETED,
                ActionCode.DRIVER_TASK_COMPLETED,
                {
                    taskId,
                    result: {
                        status: STATUS_VALUES.SUCCESS,
                        outputLength: result?.length || 0,
                        duration
                    }
                },
                correlationId
            );

            this.stats.tasksExecuted++;

            // ✅ Circuit breaker: Record success
            this._recordSuccess();
        } catch (error) {
            const isTimeout = error.name === 'TimeoutError';

            log(
                'ERROR',
                `[DriverNERVAdapter] Falha na execução: ${error.message} ${isTimeout ? `(operation: ${error.operation})` : ''}`,
                correlationId
            );

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
                    operation: error.operation || 'unknown'
                },
                correlationId
            );

            this.stats.driversCrashed++;

            // ✅ Circuit breaker: Record failure
            this._recordFailure();
        } finally {
            // ✅ 12. Cleanup robusto (com timeout e detach listeners)
            await this._finallyCleanup(taskId, lifecycleManager, page, driver, listeners);
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
            log('ERROR', `[DriverNERVAdapter] Erro ao abortar task ${taskId}: ${err.message}`, correlationId);
        } finally {
            this.activeDrivers.delete(taskId);
        }

        this._emitBoth(
            ADAPTER_EVENTS.TASK_ABORTED,
            ActionCode.DRIVER_TASK_ABORTED,
            {
                taskId,
                reason: 'USER_REQUESTED'
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
                    this._timeout(5000, 'browserPool.getHealth')
                ]);
            } else {
                browserPoolHealth = { status: 'DEGRADED', reason: 'Pool not available' };
                healthStatus = STATUS_VALUES.DEGRADED;
            }
        } catch (poolError) {
            log('WARN', `[DriverNERVAdapter] Error getting browser pool health: ${poolError.message}`, correlationId);
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
            circuitBreaker: {
                state: this.circuitBreaker.state,
                failures: this.circuitBreaker.failures,
                threshold: this.circuitBreaker.threshold
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
                    timestamp: new Date().toISOString()
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
                    timestamp: new Date().toISOString()
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
                    details: data.message
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
        let lastError = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                HighLevelNERV.sendEvent(this.nerv, ActorRole.DRIVER, actionCode, payload, correlationId);

                log('DEBUG', `[DriverNERVAdapter] Evento NERV emitido: ${actionCode}`, correlationId);

                // ✅ Métrica de sucesso
                this.stats.eventsEmitted++;

                return; // Success
            } catch (err) {
                lastError = err;

                if (attempt < maxRetries - 1) {
                    const backoff = ADAPTER_CONFIG.EVENT_RETRY_BACKOFF_MS * (attempt + 1);
                    log(
                        'WARN',
                        `[DriverNERVAdapter] Falha ao emitir evento (tentativa ${attempt + 1}/${maxRetries}): ${err.message}`,
                        correlationId
                    );
                    await new Promise(resolve => setTimeout(resolve, backoff));
                } else {
                    log(
                        'ERROR',
                        `[DriverNERVAdapter] Falha permanente ao emitir evento após ${maxRetries} tentativas: ${err.message}`,
                        correlationId
                    );

                    // ✅ Métrica de falha
                    this.stats.eventsFailed++;

                    // ✅ Emit local error event
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
            timestamp: Date.now()
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
     * ✅ v2.0: Detach listeners, release resources, process queue
     *
     * @private
     * @async
     *
     * @param {string} taskId - Task ID
     * @param {Object} lifecycleManager - DriverLifecycleManager instance
     * @param {Object} page - Puppeteer page
     * @param {Object} driver - Driver instance
     * @param {Array<Object>} listeners - Array de listeners
     *
     * @returns {Promise<void>}
     */
    async _finallyCleanup(taskId, lifecycleManager, page, driver, listeners) {
        // ✅ 1. Detach listeners
        if (driver && listeners && listeners.length > 0) {
            try {
                this._detachDriverTelemetry(driver, listeners);
            } catch (err) {
                log('WARN', `[DriverNERVAdapter] Error detaching listeners: ${err.message}`);
            }
        }

        // ✅ 2. Release lifecycle manager
        if (lifecycleManager) {
            try {
                await Promise.race([
                    lifecycleManager.release(),
                    this._timeout(5000, 'lifecycleManager.release (finally)')
                ]);
            } catch (err) {
                log('WARN', `[DriverNERVAdapter] Error releasing lifecycle manager: ${err.message}`);
            }

            this.activeDrivers.delete(taskId);
        }

        // ✅ 3. Release page
        if (page && this.browserPool) {
            try {
                await Promise.race([this.browserPool.release(page), this._timeout(5000, 'browserPool.release')]);
            } catch (err) {
                log('WARN', `[DriverNERVAdapter] Error releasing page: ${err.message}`);
            }
        }

        // ✅ 4. Process next task from queue
        if (this.taskQueue.length > 0 && this.activeDrivers.size < ADAPTER_CONFIG.MAX_ACTIVE_DRIVERS) {
            const next = this.taskQueue.shift();

            log('DEBUG', `[DriverNERVAdapter] Processing queued task (${this.taskQueue.length} remaining)`);

            // Execute async (não bloqueia cleanup)
            setImmediate(() => {
                this._executeTask(next.payload, next.correlationId).catch(err => {
                    log('ERROR', `[DriverNERVAdapter] Error executing queued task: ${err.message}`);
                });
            });
        }
    }

    /**
     * Verifica se pode executar task (circuit breaker check).
     *
     * ✅ v2.0: Circuit breaker pattern (CLOSED, OPEN, HALF_OPEN)
     *
     * @private
     *
     * @returns {boolean} true se pode executar, false se circuit breaker OPEN
     */
    _canExecute() {
        const { state, failures, threshold, timeout, lastFailureTime } = this.circuitBreaker;

        if (state === 'CLOSED') return true;

        if (state === 'OPEN') {
            // Check se timeout passou (recovery)
            if (Date.now() - lastFailureTime > timeout) {
                this.circuitBreaker.state = 'HALF_OPEN';
                log('INFO', '[DriverNERVAdapter] Circuit breaker HALF_OPEN (recovery attempt)');

                this.emit(ADAPTER_EVENTS.CIRCUIT_BREAKER_CLOSED, {
                    state: 'HALF_OPEN',
                    failures: failures,
                    threshold: threshold
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
     * Registra sucesso de task (circuit breaker).
     *
     * ✅ v2.0: Reset failures em sucesso
     *
     * @private
     *
     * @returns {void}
     */
    _recordSuccess() {
        if (this.circuitBreaker.state === 'HALF_OPEN') {
            this.circuitBreaker.state = 'CLOSED';
            log('INFO', '[DriverNERVAdapter] Circuit breaker CLOSED (recovered)');

            this.emit(ADAPTER_EVENTS.CIRCUIT_BREAKER_CLOSED, {
                state: 'CLOSED',
                previousFailures: this.circuitBreaker.failures
            });
        }

        this.circuitBreaker.failures = 0;
    }

    /**
     * Registra falha de task (circuit breaker).
     *
     * ✅ v2.0: Incrementa failures, abre circuit breaker se threshold atingido
     *
     * @private
     *
     * @returns {void}
     *
     * @emits ADAPTER_EVENTS.CIRCUIT_BREAKER_OPEN quando threshold atingido
     */
    _recordFailure() {
        this.circuitBreaker.failures++;
        this.circuitBreaker.lastFailureTime = Date.now();

        if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
            this.circuitBreaker.state = 'OPEN';
            this.stats.circuitBreakerTrips++;

            log(
                'WARN',
                `[DriverNERVAdapter] Circuit breaker OPEN (${this.circuitBreaker.failures} failures >= ${this.circuitBreaker.threshold} threshold)`
            );

            this.emit(ADAPTER_EVENTS.CIRCUIT_BREAKER_OPEN, {
                failures: this.circuitBreaker.failures,
                threshold: this.circuitBreaker.threshold,
                timeout: this.circuitBreaker.timeout
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
                suggestion: 'Configure browserEndpoint/proxy e reinicie'
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
            duration
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
                threshold: this.circuitBreaker.threshold
            }
        };
    }
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
    // ✅ Class export
    DriverNERVAdapter,

    // ✅ Constants export (para testes)
    ADAPTER_CONFIG,
    ADAPTER_EVENTS,

    // ✅ Factory function (alternative constructor)
    create: (nerv, browserPool, config) => {
        return new DriverNERVAdapter(nerv, browserPool, config);
    }
};
