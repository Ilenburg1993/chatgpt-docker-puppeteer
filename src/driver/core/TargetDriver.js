/* ==========================================================================
   src/driver/core/TargetDriver.js v2.0
   Audit Level: 800 — Sovereign Contract Master (Validation Edition)
   Status: PRODUCTION (Protocol 12 - State Machine Validated)
   Responsabilidade: Classe abstrata mestre. Define o contrato de execução,
                     gerencia a máquina de estados validada e o canal de sinais vitais.
   Sincronizado com: BaseDriver V800, DriverLifecycleManager V70,
                     TelemetryBridge V500.

   Changelog v2.0:
   - State transition matrix (validação de transições)
   - AbortSignal integration (cancelamento automático)
   - Capabilities schema validation
   - Health metrics expandidos (12+ campos)
   - State history tracking (últimas 20 transições)
   - Telemetria avançada (7+ eventos)
   - Error tracking e counter
   - JSDoc completo
========================================================================== */

const EventEmitter = require('events');

const {
    STATUS_VALUES: STATUS_VALUES
} = require('@core/constants/tasks.js');

const { log } = require('@core/logger');

/* ==========================================================================
   CONFIGURAÇÃO (v2.0 - ZERO MAGIC NUMBERS)
========================================================================== */

const TARGETDRIVER_CONFIG = Object.freeze({
    // State Timeouts (ms)
    STATE_TIMEOUT_WARNING_MS: 30000,     // 30s
    STATE_TIMEOUT_ERROR_MS: 120000,      // 2min

    // Health Check
    HEALTH_CHECK_INTERVAL_MS: 5000,      // 5s

    // State History
    MAX_STATE_HISTORY_SIZE: 20,

    // Capabilities
    DEFAULT_CAPABILITIES: Object.freeze({
        text_generation: true,
        image_generation: false,
        file_upload: false,
        context_reset: true,
        streaming_events: false
    }),

    // Memory
    MAX_EVENT_LISTENERS: 50
});

/* ==========================================================================
   EVENTOS PADRONIZADOS (v2.0 - The IPC 2.0 Pulse)
========================================================================== */

const EVENTS = Object.freeze({
    STATE_CHANGE: 'state_change', // Transições da máquina de estados
    STATE_ENTERED: 'state_entered', // ✅ v2.0: Entrada em novo estado
    STATE_EXITING: 'state_exiting', // ✅ v2.0: Saída de estado atual
    STATE_TIMEOUT_WARNING: 'state_timeout_warn', // ✅ v2.0: Estado stuck por muito tempo
    CAPABILITIES_CHANGED: 'caps_change', // Mudança em habilidades técnicas
    DESTROYED: 'destroyed', // Sinal para Factory limpar cache
    VITAL: 'driver:vital', // Canal sensorial para TelemetryBridge
    WARNING: 'warning', // Alertas não fatais
    DEBUG: 'debug', // Dados de depuração técnica
    ABORT_SIGNAL_RECEIVED: 'abort_received' // ✅ v2.0: AbortSignal disparado
});

/* ==========================================================================
   ESTADOS VITAIS (v2.0 - Engine States)
========================================================================== */

const STATES = Object.freeze({
    IDLE: STATUS_VALUES.IDLE, // Ocioso, aguardando tarefa
    PREPARING: 'PREPARING', // Configurando contexto/modelo
    TYPING: 'TYPING', // Executando interação biomecânica
    WAITING: 'WAITING', // Aguardando resposta da IA
    STALLED: STATUS_VALUES.STALLED // Detectado provável travamento
});

/* ==========================================================================
   STATE TRANSITION MATRIX (v2.0 - Validação de Transições)
========================================================================== */

const STATE_TRANSITIONS = Object.freeze({
    [STATES.IDLE]: [STATES.PREPARING],
    [STATES.PREPARING]: [STATES.TYPING, STATES.IDLE],
    [STATES.TYPING]: [STATES.WAITING, STATES.IDLE],
    [STATES.WAITING]: [STATES.IDLE, STATES.STALLED],
    [STATES.STALLED]: [STATES.IDLE]
});

/* ==========================================================================
   CAPABILITIES SCHEMA (v2.0 - Validação de Capabilities)
========================================================================== */

const CAPABILITIES_SCHEMA = Object.freeze([
    'text_generation',
    'image_generation',
    'file_upload',
    'context_reset',
    'streaming_events',
    'vision',
    'tools',
    'code_interpreter',
    'web_browsing',
    'dalle',
    'function_calling'
]);

/**
 * Classe abstrata base para todos os drivers de LLM.
 * Define contrato de execução, gerencia estados validados e emite telemetria.
 *
 * ✅ v2.0: State transition matrix, AbortSignal integration, capabilities validation
 *
 * @abstract
 * @extends EventEmitter
 *
 * @property {object} page - Puppeteer page instance
 * @property {object} config - Task configuration
 * @property {AbortSignal} signal - Cancellation signal
 * @property {string} name - Driver name
 * @property {boolean} destroyed - Destruction flag
 * @property {string} correlationId - Correlation ID for tracing
 *
 * @fires TargetDriver#STATE_CHANGE - State transitions
 * @fires TargetDriver#STATE_ENTERED - Entering new state
 * @fires TargetDriver#STATE_EXITING - Exiting current state
 * @fires TargetDriver#STATE_TIMEOUT_WARNING - State stuck too long
 * @fires TargetDriver#CAPABILITIES_CHANGED - Capability updates
 * @fires TargetDriver#DESTROYED - Driver destroyed
 * @fires TargetDriver#VITAL - Telemetry vitals
 * @fires TargetDriver#WARNING - Non-fatal warnings
 * @fires TargetDriver#DEBUG - Debug information
 * @fires TargetDriver#ABORT_SIGNAL_RECEIVED - AbortSignal triggered
 */
class TargetDriver extends EventEmitter {
    /**
     * Construtor do TargetDriver - Classe abstrata base.
     *
     * @param {object} page - Instância da página do Puppeteer
     * @param {object} config - Configuração da tarefa (clonada)
     * @param {AbortSignal} [signal] - Sinal soberano vindo do LifecycleManager
     *
     * @throws {Error} Se tentar instanciar TargetDriver diretamente
     */
    constructor(page, config, signal) {
        super();

        // Proteção de Classe Abstrata
        if (this.constructor === TargetDriver) {
            throw new Error('[TARGET_DRIVER] Erro Fatal: Classe abstrata não pode ser instanciada diretamente.');
        }

        // ✅ v2.0: Readonly properties (configurable para permitir null em destroy)
        Object.defineProperty(this, 'page', {
            value: page,
            writable: false,
            configurable: true,
            enumerable: true
        });

        Object.defineProperty(this, 'config', {
            value: config,
            writable: false,
            enumerable: true
        });

        Object.defineProperty(this, '_createdAt', {
            value: Date.now(),
            writable: false,
            enumerable: false
        });

        this.signal = signal;
        this.name = 'Generic';
        this.destroyed = false;
        this.correlationId = null;

        // Propriedades da Máquina de Estados
        this._state = STATES.IDLE;
        this.stateUpdated = Date.now();

        // ✅ v2.0: State history tracking
        this._stateHistory = [];

        // ✅ v2.0: Error tracking
        this._errorCount = 0;
        this._lastError = null;

        // Capacidades Técnicas Iniciais (Manifesto de Habilidades)
        this._capabilities = { ...TARGETDRIVER_CONFIG.DEFAULT_CAPABILITIES };

        // ✅ v2.0: AbortSignal integration
        this._setupAbortListener();
    }

    /* ==========================================================================
      INTERNAL UTILITIES (v2.0)
  ========================================================================== */

    /**
     * Configura listener para AbortSignal.
     * ✅ v2.0: Sincroniza estado automaticamente com cancelamento
     *
     * @private
     */
    _setupAbortListener() {
        if (this.signal) {
            this.signal.addEventListener('abort', () => {
                this._handleAbort();
            });
        }
    }

    /**
     * Handler para AbortSignal disparado.
     * ✅ v2.0: Reseta estado para IDLE automaticamente
     *
     * @private
     */
    _handleAbort() {
        if (this.destroyed) return;

        this.emit(EVENTS.ABORT_SIGNAL_RECEIVED, {
            currentState: this._state,
            correlationId: this.correlationId,
            ts: Date.now()
        });

        log('WARN', `[${this.name}] AbortSignal received. Resetting state to IDLE.`, this.correlationId);

        // Reset to IDLE (bypass validation se necessário)
        if (this._state !== STATES.IDLE) {
            try {
                this.setState(STATES.IDLE);
            } catch (_err) {
                // Force reset se validação falhar
                this._state = STATES.IDLE;
                this.stateUpdated = Date.now();
            }
        }
    }

    /**
     * Valida se transição de estado é permitida.
     * ✅ v2.0: State transition matrix
     *
     * @param {string} from - Estado atual
     * @param {string} to - Estado desejado
     * @throws {Error} Se transição não for válida
     * @private
     */
    _validateTransition(from, to) {
        const validTargets = STATE_TRANSITIONS[from] || [];

        if (!validTargets.includes(to)) {
            throw new Error(
                `[${this.name}] Invalid state transition: ${from} → ${to}. ` +
                    `Valid transitions from ${from}: ${validTargets.join(', ')}`
            );
        }
    }

    /**
     * Valida schema de capabilities.
     * ✅ v2.0: Type safety para capabilities
     *
     * @param {object} caps - Capabilities a validar
     * @throws {Error} Se capability desconhecida ou tipo inválido
     * @private
     */
    _validateCapabilities(caps) {
        for (const key of Object.keys(caps)) {
            if (!CAPABILITIES_SCHEMA.includes(key)) {
                throw new Error(
                    `[${this.name}] Unknown capability: "${key}". ` +
                        `Valid capabilities: ${CAPABILITIES_SCHEMA.join(', ')}`
                );
            }
            if (typeof caps[key] !== 'boolean') {
                throw new Error(`[${this.name}] Capability "${key}" must be boolean, got ${typeof caps[key]}`);
            }
        }
    }

    /* ==========================================================================
      GESTÃO DE ESTADO E CAPACIDADES (v2.0)
  ========================================================================== */

    /**
     * Getter para estado atual.
     * @returns {string} Estado atual
     */
    get state() {
        return this._state;
    }

    /**
     * Altera o estado interno e emite telemetria de transição.
     * ✅ v2.0: Valida transição via state transition matrix
     *
     * @param {string} newState - Membro da constante STATES
     * @throws {Error} Se estado inválido ou transição não permitida
     */
    setState(newState) {
        if (this.destroyed) {
            return;
        }

        // Validate state exists
        if (!STATES[newState]) {
            throw new Error(`[${this.name}] Tentativa de transição para estado inválido: "${newState}"`);
        }

        if (this._state !== newState) {
            const now = Date.now();
            const oldState = this._state;
            const duration = now - this.stateUpdated;

            // ✅ v2.0: Validate transition
            this._validateTransition(oldState, newState);

            // ✅ v2.0: Emit state exiting
            this.emit(EVENTS.STATE_EXITING, {
                state: oldState,
                to: newState,
                duration_ms: duration,
                ts: now
            });

            this._state = newState;
            this.stateUpdated = now;

            // ✅ v2.0: Update state history
            this._stateHistory.push({
                from: oldState,
                to: newState,
                ts: now,
                duration_ms: duration
            });

            if (this._stateHistory.length > TARGETDRIVER_CONFIG.MAX_STATE_HISTORY_SIZE) {
                this._stateHistory.shift();
            }

            // Original STATE_CHANGE event
            this.emit(EVENTS.STATE_CHANGE, {
                from: oldState,
                to: newState,
                ts: now,
                duration_ms: duration
            });

            // ✅ v2.0: Emit state entered
            this.emit(EVENTS.STATE_ENTERED, {
                state: newState,
                from: oldState,
                ts: now
            });
        }
    }

    /**
     * Retorna histórico de transições de estado.
     * ✅ v2.0: State history tracking
     *
     * @returns {Array} Últimas transições (max 20)
     */
    getStateHistory() {
        return [...this._stateHistory];
    }

    /**
     * Atualiza o mapa de capacidades técnicas do robô e notifica o sistema.
     * ✅ v2.0: Valida schema de capabilities
     *
     * @param {object} newCaps - Objeto com as novas capacidades
     * @throws {Error} Se capability inválida
     */
    updateCapabilities(newCaps) {
        if (this.destroyed) {
            return;
        }

        // ✅ v2.0: Validate capabilities schema
        this._validateCapabilities(newCaps);

        const oldCaps = { ...this._capabilities };
        this._capabilities = { ...this._capabilities, ...newCaps };
        this.emit(EVENTS.CAPABILITIES_CHANGED, { old: oldCaps, new: this._capabilities });
    }

    /**
     * Retorna cópia das capabilities atuais.
     * @returns {object} Capabilities
     */
    getCapabilities() {
        return { ...this._capabilities };
    }

    /* ==========================================================================
      DIAGNÓSTICO E SAÚDE (v2.0 - EXPANDED METRICS)
  ========================================================================== */

    /**
     * Retorna um snapshot da saúde operacional do driver.
     * ✅ v2.0: Expandido com performance metrics
     *
     * Usado pelo Supervisor para detecção de Drifts.
     *
     * @returns {Promise<object>} Health status com métricas
     */
    async getHealth() {
        const isPageAlive = !!(this.page && !this.page.isClosed());
        const stateAge = Date.now() - this.stateUpdated;
        const uptime = Date.now() - this._createdAt;

        return {
            // Status geral
            status: this.destroyed ? 'DEAD' : isPageAlive ? 'OK' : 'DEGRADED',
            state: this._state,
            stateAge,

            // ✅ v2.0: Performance metrics
            metrics: {
                listenerCount: this.listenerCount(EVENTS.VITAL),
                stateStuckWarning: stateAge > TARGETDRIVER_CONFIG.STATE_TIMEOUT_WARNING_MS,
                stateStuckError: stateAge > TARGETDRIVER_CONFIG.STATE_TIMEOUT_ERROR_MS,
                uptime,
                errorCount: this._errorCount,
                stateTransitions: this._stateHistory.length
            },

            // ✅ v2.0: Capabilities snapshot
            capabilities: this.getCapabilities(),

            // ✅ v2.0: Error info
            lastError: this._lastError,

            // Legacy fields
            isPageAttached: isPageAlive,
            name: this.name,
            correlationId: this.correlationId
        };
    }

    /**
     * Retorna estatísticas de erros.
     * ✅ v2.0: Error tracking
     *
     * @returns {object} Error stats
     */
    getErrorStats() {
        return {
            errorCount: this._errorCount,
            lastError: this._lastError
        };
    }

    /* ==========================================================================
      API PÚBLICA (CONTRATO OBRIGATÓRIO)
  ========================================================================== */

    /**
     * Otimiza a página para performance.
     * @returns {Promise<void>}
     */
    async optimizePage() {
        return Promise.resolve();
    }

    /* ==========================================================================
      MÉTODOS ABSTRATOS (v2.0 - IMPROVED ERROR MESSAGES)

      Devem ser implementados obrigatoriamente pelas classes filhas
  ========================================================================== */

    /**
     * Valida se página está pronta para execução.
     * @abstract
     * @returns {Promise<void>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async validatePage() {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'validatePage' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`
        );
    }

    /**
     * Prepara contexto para execução.
     * @abstract
     * @param {object} _taskSpec - Especificação da task
     * @returns {Promise<void>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async prepareContext(_taskSpec) {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'prepareContext' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`
        );
    }

    /**
     * Envia prompt para LLM.
     * @abstract
     * @param {string} _text - Texto do prompt
     * @param {string} _taskId - ID da task
     * @param {AbortSignal} _signal - Sinal de cancelamento
     * @returns {Promise<void>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async sendPrompt(_text, _taskId, _signal) {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'sendPrompt' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`
        );
    }

    /**
     * Aguarda conclusão da resposta.
     * @abstract
     * @param {object} _startSnapshot - Snapshot inicial
     * @param {AbortSignal} _signal - Sinal de cancelamento
     * @returns {Promise<void>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async waitForCompletion(_startSnapshot, _signal) {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'waitForCompletion' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`
        );
    }

    /**
     * Captura estado atual da interface.
     * @abstract
     * @returns {Promise<object>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async captureState() {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'captureState' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`
        );
    }

    /**
     * Para geração em andamento.
     * @abstract
     * @returns {Promise<void>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async stopGeneration() {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'stopGeneration' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`
        );
    }

    /**
     * Commit de aprendizado (opcional).
     * @returns {Promise<void>}
     */
    async commitLearning() {
        return Promise.resolve();
    }

    /**
     * Sobrescrita de segurança para emissão de eventos.
     * ✅ v2.0: Bloqueia emissões após destruição e registra erros
     *
     * Bloqueia emissões após a destruição da instância.
     *
     * @param {string} event - Nome do evento
     * @param {...any} args - Argumentos do evento
     * @returns {boolean} Se evento foi emitido
     */
    emit(event, ...args) {
        if (this.destroyed && event !== EVENTS.DESTROYED) {
            // ✅ v2.0: Track emit errors
            this._errorCount++;
            this._lastError = {
                type: 'EMIT_AFTER_DESTROY',
                event,
                ts: Date.now()
            };

            log('WARN', `[${this.name}] Tentativa de emit após destroy: ${event}`, this.correlationId);

            return false;
        }
        return super.emit(event, ...args);
    }

    /**
     * Destruição profunda da instância e sinalização para a Factory.
     * ✅ v2.0: Cleanup garantido e telemetria de errors
     *
     * Garante que o robô seja removido do cache e a memória seja liberada.
     *
     * @returns {Promise<void>}
     */
    async destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;

        // [R2] Notifica a Factory para remoção imediata do cache de instâncias
        this.emit(EVENTS.DESTROYED);

        this.removeAllListeners();

        // ✅ v2.0: Nullify readonly properties (configurable: true allows this)
        Object.defineProperty(this, 'page', { value: null });

        // Clear references
        this.signal = null;

        try {
            log(
                'DEBUG',
                `[${this.name}] Driver destruído. Referências de memória limpas. Errors: ${this._errorCount}`,
                this.correlationId
            );
        } catch (_e) {
            // Ignore logging errors during cleanup
        }
    }
}

/* ==========================================================================
   EXPORTS (v2.0)
========================================================================== */

// Exportação de Constantes para uso externo
TargetDriver.EVENTS = EVENTS;
TargetDriver.STATES = STATES;

module.exports = TargetDriver;

// ✅ v2.0: Export configs para testing/introspection
module.exports.TARGETDRIVER_CONFIG = TARGETDRIVER_CONFIG;
module.exports.STATE_TRANSITIONS = STATE_TRANSITIONS;
module.exports.CAPABILITIES_SCHEMA = CAPABILITIES_SCHEMA;
