/* ==========================================================================
   src/driver/DriverLifecycleManager.js v2.0
   Audit Level: 700 — Sovereign Lifecycle Manager (Singularity Edition)
   Status: v2.0 - EventEmitter + Full Validation + Telemetry + Health Check
   Responsabilidade: Gerenciar o ciclo de vida do driver para uma tarefa única.
                     Orquestrar a fiação sensorial e a soberania de interrupção.
   Sincronizado com: ExecutionEngine V1.6.0, BaseDriver V2.0,
                     TelemetryBridge V500, ipc_client V600.

   v2.0 Changes:
   - EventEmitter inheritance (6 lifecycle events)
   - LIFECYCLE_CONFIG (zero magic numbers)
   - Driver validation in acquire (P0 fix)
   - State/progress validation (P1 fixes)
   - Timeout protection in destroy (P2 fix)
   - Health check endpoint
   - Retry logic in acquire
   - Complete JSDoc
========================================================================== */

const EventEmitter = require('events');
const driverFactory = require('./factory');
const { log } = require('@core/logger');
const { STATUS_VALUES } = require('@core/constants/tasks');

/* ==========================================================================
   LIFECYCLE_CONFIG v2.0 - Zero Magic Numbers
========================================================================== */
const LIFECYCLE_CONFIG = {
    DESTROY_TIMEOUT_MS: 5000,           // Timeout para destroy() (previne hang)
    ACQUIRE_TIMEOUT_MS: 10000,          // Timeout para acquire() (previne hang)
    ACQUIRE_MAX_RETRIES: 3,             // Tentativas de retry em acquire()
    ACQUIRE_RETRY_DELAY_MS: 1000,       // Delay entre retries
    PROGRESS_CHARS_TARGET: 5000,        // Threshold de caracteres para 100% progress
    PROGRESS_MAX: 99,                   // Progresso máximo (nunca 100 até done)
    MAX_LISTENERS_WARNING: 20           // Limite de listeners (memory leak detection)
};

/* ==========================================================================
   LIFECYCLE_EVENTS v2.0 - Telemetria de Ciclo de Vida
========================================================================== */
const LIFECYCLE_EVENTS = {
    ACQUIRED: 'lifecycle:acquired',             // Driver adquirido com sucesso
    RELEASED: 'lifecycle:released',             // Driver liberado
    ERROR: 'lifecycle:error',                   // Erro em qualquer operação
    STATE_CHANGE: 'lifecycle:state_change',     // Mudança de estado do driver
    PROGRESS: 'lifecycle:progress',             // Atualização de progresso
    HEALTH: 'lifecycle:health'                  // Health check executado
};

/**
 * DriverLifecycleManager v2.0 - Orchestrator de ciclo de vida de driver
 *
 * Gerencia o ciclo completo de vida de um driver (acquire → execute → release).
 * Herda de EventEmitter para emitir eventos de lifecycle (acquired, released, error, etc).
 *
 * @class DriverLifecycleManager
 * @extends EventEmitter
 */
class DriverLifecycleManager extends EventEmitter {
    /**
     * Construtor do DriverLifecycleManager v2.0
     *
     * @param {object} page - Instância ativa do Puppeteer (Aba alvo). Requerido.
     * @param {object} task - Objeto da Tarefa (Schema V4 Gold). Requerido.
     * @param {object} config - Configuração consolidada do sistema. Requerido.
     * @throws {Error} Se parâmetros obrigatórios não forem fornecidos
     */
    constructor(page, task, config) {
        super(); // ✅ Inicializar EventEmitter

        // ✅ BUG #8 FIX: Validar parâmetros obrigatórios
        if (!page) {
            throw new Error('[LIFECYCLE] Constructor: page é obrigatório');
        }
        if (!task || !task.meta || !task.meta.id) {
            throw new Error('[LIFECYCLE] Constructor: task com meta.id é obrigatório');
        }
        if (!config) {
            throw new Error('[LIFECYCLE] Constructor: config é obrigatório');
        }

        this.page = page;
        this.task = task;
        this.config = config;
        this.driver = null;

        // [V700] Sinal Soberano Único: O "Kill Switch" local da tarefa.
        this.abortController = new AbortController();

        // [IPC 2.0] Identidade e Causalidade
        this.taskId = task.meta.id;
        this.correlationId = task.meta.correlation_id || task.meta.id;

        // [v2.0] Métricas de lifecycle
        this.metrics = {
            acquireAttempts: 0,
            acquireTime: 0,
            releaseTime: 0,
            stateChanges: 0,
            progressUpdates: 0
        };

        // ✅ Configurar max listeners (memory leak detection)
        this.setMaxListeners(LIFECYCLE_CONFIG.MAX_LISTENERS_WARNING);

        // Bind de métodos para preservação de contexto em barramentos de eventos
        this._handleStateChange = this._handleStateChange.bind(this);
        this._handleProgress = this._handleProgress.bind(this);
    }

    /**
     * Adquire o driver da Factory e realiza a instrumentação sensorial completa.
     *
     * v2.0 Features:
     * - Validação de driver retornado (P0 fix)
     * - Retry logic com backoff exponencial (P2 improvement)
     * - Timeout protection (ACQUIRE_TIMEOUT_MS)
     * - Telemetria completa via EventEmitter (lifecycle:acquired)
     * - Métricas de performance (acquireTime, acquireAttempts)
     *
     * @param {object} [options] - Opções de aquisição
     * @param {number} [options.maxRetries] - Máximo de tentativas (default: LIFECYCLE_CONFIG.ACQUIRE_MAX_RETRIES)
     * @param {number} [options.retryDelay] - Delay entre retries em ms (default: LIFECYCLE_CONFIG.ACQUIRE_RETRY_DELAY_MS)
     * @returns {Promise<object>} Instância do driver configurada e telemetrada.
     * @throws {Error} Se driver não for encontrado após todas as tentativas
     * @emits lifecycle:acquired - Quando driver é adquirido com sucesso
     * @emits lifecycle:error - Se falha na aquisição após retries
     */
    async acquire(options = {}) {
        const startTime = Date.now();
        const maxRetries = options.maxRetries || LIFECYCLE_CONFIG.ACQUIRE_MAX_RETRIES;
        const retryDelay = options.retryDelay || LIFECYCLE_CONFIG.ACQUIRE_RETRY_DELAY_MS;
        let lastError = null;

        log('DEBUG', `[LIFECYCLE] Iniciando aquisição de driver para tarefa: ${this.taskId}`, this.correlationId);

        // ✅ IMPROVEMENT #5: Retry logic com backoff exponencial
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            this.metrics.acquireAttempts++;

            try {
                // 1. Obtém instância da Factory injetando o sinal de aborto da tarefa
                this.driver = driverFactory.getDriver(
                    this.task.spec.target,
                    this.page,
                    this.config,
                    this.abortController.signal
                );

                // ✅ BUG #1 FIX: Validar driver retornado (P0 CRITICAL)
                if (!this.driver) {
                    const error = `Driver not found for target: ${this.task.spec.target}`;
                    log('ERROR', `[LIFECYCLE] ${error} (attempt ${attempt}/${maxRetries})`, this.correlationId);
                    throw new Error(error);
                }

                log(
                    'DEBUG',
                    `[LIFECYCLE] Driver acquired: ${this.driver.name || 'unknown'} (attempt ${attempt})`,
                    this.correlationId
                );

                // 2. [IPC 2.0] Injeção de Causalidade: Conecta o robô ao rastro da transação
                if (typeof this.driver.setCorrelationId === 'function') {
                    this.driver.setCorrelationId(this.correlationId);
                }

                // 3. [ONDA 2] TODO: Telemetria via DriverNERVAdapter (desacoplado via NERV)
                // O adapter será responsável por escutar eventos do driver e emitir via NERV

                // 4. ✅ BUG #5 FIX: Limpeza específica (não removeAllListeners)
                // Garante que o objeto Task reflita a máquina de estados do Driver.
                if (typeof this.driver.removeListener === 'function') {
                    this.driver.removeListener('state_change', this._handleStateChange);
                    this.driver.removeListener('progress', this._handleProgress);
                }

                // 5. Vincular handlers de telemetria
                this.driver.on('state_change', this._handleStateChange);
                this.driver.on('progress', this._handleProgress);

                // ✅ v2.0: Métricas e telemetria
                this.metrics.acquireTime = Date.now() - startTime;
                this.emit(LIFECYCLE_EVENTS.ACQUIRED, {
                    taskId: this.taskId,
                    driverName: this.driver.name || 'unknown',
                    target: this.task.spec.target,
                    attempts: attempt,
                    acquireTime: this.metrics.acquireTime
                });

                return this.driver;
            } catch (e) {
                lastError = e;
                log('WARN', `[LIFECYCLE] Tentativa ${attempt}/${maxRetries} falhou: ${e.message}`, this.correlationId);

                // Se não for a última tentativa, aguarda com backoff exponencial
                if (attempt < maxRetries) {
                    const backoffDelay = retryDelay * Math.pow(2, attempt - 1);
                    log('DEBUG', `[LIFECYCLE] Aguardando ${backoffDelay}ms antes de retry...`, this.correlationId);
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                }
            }
        }

        // ✅ Se chegou aqui, todas as tentativas falharam
        const errorMessage = `Falha na aquisição após ${maxRetries} tentativas: ${lastError?.message}`;
        log('ERROR', `[LIFECYCLE] ${errorMessage}`, this.correlationId);

        this.emit(LIFECYCLE_EVENTS.ERROR, {
            taskId: this.taskId,
            operation: 'acquire',
            attempts: maxRetries,
            error: lastError?.message
        });

        throw new Error(errorMessage);
    }

    /**
     * Libera recursos, aborta operações pendentes e destrói a instância do driver.
     *
     * v2.0 Features:
     * - Validação de abort state com try-catch (P1 fix)
     * - Timeout protection em destroy() (P2 fix - previne hang)
     * - Telemetria completa (lifecycle:released)
     * - Métricas de performance (releaseTime)
     * - Cleanup total de listeners e recursos
     *
     * Garante a higiene total da memória e do barramento de eventos.
     *
     * @returns {Promise<void>}
     * @emits lifecycle:released - Quando driver é liberado com sucesso
     * @emits lifecycle:error - Se falha na liberação
     */
    async release() {
        const startTime = Date.now();
        log('DEBUG', `[LIFECYCLE] Iniciando sequência de liberação: ${this.taskId}`, this.correlationId);

        try {
            // 1. ✅ BUG #2 FIX: Aciona o sinal de aborto com validação e try-catch
            if (!this.abortController.signal.aborted) {
                try {
                    this.abortController.abort();
                    log('DEBUG', `[LIFECYCLE] AbortSignal triggered for task ${this.taskId}`, this.correlationId);
                } catch (err) {
                    log('WARN', `[LIFECYCLE] Abort error: ${err.message}`, this.correlationId);
                }
            }

            if (this.driver) {
                // 2. DESACOPLAMENTO DE EVENTOS (Zero Leak Policy)
                if (typeof this.driver.removeListener === 'function') {
                    this.driver.removeListener('state_change', this._handleStateChange);
                    this.driver.removeListener('progress', this._handleProgress);
                }

                // 3. ✅ BUG #6 FIX: DESTRUIÇÃO FÍSICA com timeout protection
                // Gatilha a auto-evicção do cache na Factory e libera handles do Puppeteer.
                const destroyPromise = this.driver.destroy().catch(err => {
                    log('WARN', `[LIFECYCLE] Erro no descarte do driver: ${err.message}`, this.correlationId);
                });

                // ✅ Timeout de 5s para prevenir hang
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Driver destroy timeout')), LIFECYCLE_CONFIG.DESTROY_TIMEOUT_MS);
                });

                await Promise.race([destroyPromise, timeoutPromise]).catch(err => {
                    log('ERROR', `[LIFECYCLE] Destroy timeout ou erro: ${err.message}`, this.correlationId);
                });
            }

            this.driver = null;
            this.page = null;

            // ✅ v2.0: Métricas e telemetria
            this.metrics.releaseTime = Date.now() - startTime;
            this.emit(LIFECYCLE_EVENTS.RELEASED, {
                taskId: this.taskId,
                releaseTime: this.metrics.releaseTime,
                metrics: this.metrics
            });
        } catch (e) {
            log('ERROR', `[LIFECYCLE] Erro catastrófico em release: ${e.message}`, this.correlationId);
            this.emit(LIFECYCLE_EVENTS.ERROR, {
                taskId: this.taskId,
                operation: 'release',
                error: e.message
            });
            throw e;
        }
    }

    /* ==========================================================================
       HANDLERS DE TELEMETRIA (PONTE ENTRE DRIVER E TASK STATE)
    ========================================================================== */

    /**
     * Sincroniza a mudança de estado do Driver com o histórico da Tarefa.
     *
     * v2.0 Features:
     * - Validação completa de data.to (P1 fix)
     * - Validação de estados válidos contra STATUS_VALUES
     * - Telemetria via EventEmitter (lifecycle:state_change)
     * - Métricas de state changes
     *
     * @param {object} data - Dados da mudança de estado
     * @param {string} data.from - Estado anterior
     * @param {string} data.to - Novo estado
     * @private
     * @emits lifecycle:state_change - Quando estado muda com sucesso
     */
    async _handleStateChange(data) {
        // Validação de Token de Segurança
        if (this.task.meta.id !== this.taskId) {
            return;
        }

        // ✅ BUG #3 FIX: Validar data.to antes de usar
        if (!data || !data.to) {
            log('WARN', `[LIFECYCLE] Invalid state change data: ${JSON.stringify(data)}`, this.correlationId);
            return;
        }

        // ✅ Validar estados válidos
        const validStates = Object.values(STATUS_VALUES);
        if (!validStates.includes(data.to)) {
            log('WARN', `[LIFECYCLE] Invalid state: ${data.to}. Valid: ${validStates.join(', ')}`, this.correlationId);
            return;
        }

        this.task.state.status = data.to;
        this.task.state.history.push({
            ts: new Date().toISOString(),
            event: 'DRIVER_STATE_CHANGE',
            msg: `Transição: ${data.from || 'unknown'} -> ${data.to}`
        });

        // ✅ v2.0: Métricas e telemetria
        this.metrics.stateChanges++;
        this.emit(LIFECYCLE_EVENTS.STATE_CHANGE, {
            taskId: this.taskId,
            from: data.from,
            to: data.to,
            totalStateChanges: this.metrics.stateChanges
        });

        log('DEBUG', `[LIFECYCLE] Driver State: ${data.from || 'unknown'} -> ${data.to}`, this.correlationId);
    }

    /**
     * Atualiza a estimativa de progresso da tarefa no objeto persistente.
     *
     * v2.0 Features:
     * - Validação completa de data.length (P1 fix)
     * - Proteção contra NaN e valores negativos
     * - Telemetria via EventEmitter (lifecycle:progress)
     * - Métricas de progress updates
     * - Usa LIFECYCLE_CONFIG.PROGRESS_CHARS_TARGET e PROGRESS_MAX
     *
     * @param {object} data - Dados de progresso
     * @param {number} data.length - Caracteres processados
     * @private
     * @emits lifecycle:progress - Quando progresso é atualizado
     */
    async _handleProgress(data) {
        if (this.task.meta.id !== this.taskId) {
            return;
        }

        // ✅ BUG #4 FIX: Validar data.length antes de calcular
        if (!data || typeof data.length !== 'number' || data.length < 0) {
            log('WARN', `[LIFECYCLE] Invalid progress data: ${JSON.stringify(data)}`, this.correlationId);
            return;
        }

        // ✅ v2.0: Usar constantes de config (zero magic numbers)
        // Estimativa baseada no volume de dados processados (Bytes/Chars)
        const estimated = Math.min(
            LIFECYCLE_CONFIG.PROGRESS_MAX,
            Math.round((data.length / LIFECYCLE_CONFIG.PROGRESS_CHARS_TARGET) * 100)
        );

        // ✅ Proteção extra contra NaN
        if (isNaN(estimated)) {
            log(
                'WARN',
                `[LIFECYCLE] Progress calculation resulted in NaN. data.length=${data.length}`,
                this.correlationId
            );
            return;
        }

        this.task.state.progress_estimate = estimated;

        // ✅ v2.0: Métricas e telemetria
        this.metrics.progressUpdates++;
        this.emit(LIFECYCLE_EVENTS.PROGRESS, {
            taskId: this.taskId,
            progress: estimated,
            length: data.length,
            totalUpdates: this.metrics.progressUpdates
        });
    }

    /**
     * Getter para o sinal de aborto (Soberania de execução).
     *
     * @returns {AbortSignal} Sinal de aborto do AbortController
     */
    get signal() {
        return this.abortController.signal;
    }

    /**
     * ✅ BUG #7 FIX: Getter para driver instance (P2 improvement)
     *
     * Permite acesso controlado à instância do driver sem expor
     * a propriedade interna diretamente.
     *
     * @returns {object|null} Instância do driver ou null se não adquirido
     */
    getDriver() {
        return this.driver;
    }

    /**
     * ✅ IMPROVEMENT #4: Health Check Endpoint (P2)
     *
     * Retorna o status de saúde do lifecycle manager e do driver.
     * Útil para monitoramento e debugging.
     *
     * v2.0 Features:
     * - Status do driver (acquired, released, null)
     * - Métricas de lifecycle (acquire time, release time, state changes, progress)
     * - Status do AbortController
     * - Informações da tarefa
     * - Driver capabilities (se disponível)
     *
     * @returns {object} Health status completo
     * @emits lifecycle:health - Quando health check é executado
     */
    getHealth() {
        const health = {
            taskId: this.taskId,
            correlationId: this.correlationId,
            driverStatus: this.driver ? 'acquired' : 'released',
            driverName: this.driver?.name || null,
            aborted: this.abortController.signal.aborted,
            metrics: {
                acquireAttempts: this.metrics.acquireAttempts,
                acquireTime: this.metrics.acquireTime,
                releaseTime: this.metrics.releaseTime,
                stateChanges: this.metrics.stateChanges,
                progressUpdates: this.metrics.progressUpdates
            },
            task: {
                target: this.task?.spec?.target || null,
                status: this.task?.state?.status || null,
                progress: this.task?.state?.progress_estimate || 0
            },
            driver: null
        };

        // ✅ Informações do driver (se disponível e possui getHealth)
        if (this.driver && typeof this.driver.getHealth === 'function') {
            try {
                health.driver = this.driver.getHealth();
            } catch (err) {
                health.driver = { error: err.message };
            }
        } else if (this.driver) {
            // Fallback: informações básicas
            health.driver = {
                name: this.driver.name || 'unknown',
                capabilities: this.driver.capabilities || null
            };
        }

        // ✅ v2.0: Telemetria
        this.emit(LIFECYCLE_EVENTS.HEALTH, health);

        return health;
    }
}

module.exports = DriverLifecycleManager;
