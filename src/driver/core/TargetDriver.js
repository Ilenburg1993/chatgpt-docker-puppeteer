/** @import {Page} from "puppeteer-core" */
// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { DRIVER_NAMES } from '#core/constants';
import { STATUS_VALUES } from '#core/constants/tasks';
import { isDomainMatch } from '#core/domain_matcher';
import { log } from '#core/logger';
import EventEmitter from 'node:events';

/* ==========================================================================
   CONFIGURAÇÃO (v2.0 - ZERO MAGIC NUMBERS)
========================================================================== */

/** Constante/valor exportado: TARGETDRIVER_CONFIG. */
const TARGETDRIVER_CONFIG = Object.freeze({
    // State Timeouts (ms)
    STATE_TIMEOUT_WARNING_MS: 30000, // 30s
    STATE_TIMEOUT_ERROR_MS: 120000, // 2min

    // Health Check
    HEALTH_CHECK_INTERVAL_MS: 5000, // 5s

    // State History
    MAX_STATE_HISTORY_SIZE: 20,

    // Capabilities
    DEFAULT_CAPABILITIES: Object.freeze({
        text_generation: true,
        image_generation: false,
        file_upload: false,
        context_reset: true,
        streaming_events: false,
    }),

    // Memory
    MAX_EVENT_LISTENERS: 50,
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
    ABORT_SIGNAL_RECEIVED: 'abort_received', // ✅ v2.0: AbortSignal disparado
    CONTEXT_ATTACHED: 'context_attached', // ✅ v3.0: Context attached (page + signal)
    CONTEXT_DETACHED: 'context_detached', // ✅ v3.0: Context detached
    CONTEXT_HOT_SWAP: 'context_hot_swap', // ✅ v3.1: Context re-attached (Hot Pool)
});

/* ==========================================================================
   ESTADOS VITAIS (v2.0 - Engine States)
========================================================================== */

const STATES = Object.freeze({
    UNATTACHED: 'UNATTACHED', // ✅ v3.0: Sem context (page/signal null) - Pool state
    IDLE: STATUS_VALUES.IDLE, // Ocioso, aguardando tarefa (context attached)
    PREPARING: 'PREPARING', // Configurando contexto/modelo
    TYPING: 'TYPING', // Executando interação biomecânica
    WAITING: 'WAITING', // Aguardando resposta da IA
    STALLED: STATUS_VALUES.STALLED, // Detectado provável travamento
});

/* ==========================================================================
   STATE TRANSITION MATRIX (v2.0 - Validação de Transições)
========================================================================== */

/** Constante/valor exportado: STATE_TRANSITIONS. */
const STATE_TRANSITIONS = Object.freeze({
    [STATES.UNATTACHED]: [STATES.IDLE], // ✅ v3.0: UNATTACHED → IDLE (via attachContext)
    [STATES.IDLE]: [STATES.PREPARING, STATES.UNATTACHED], // ✅ v3.0: IDLE → UNATTACHED (via detachContext)
    [STATES.PREPARING]: [STATES.TYPING, STATES.IDLE],
    [STATES.TYPING]: [STATES.WAITING, STATES.IDLE],
    [STATES.WAITING]: [STATES.IDLE, STATES.STALLED],
    [STATES.STALLED]: [STATES.IDLE],
});

/* ==========================================================================
   CAPABILITIES SCHEMA (v2.0 - Validação de Capabilities)
========================================================================== */

/** Constante/valor exportado: CAPABILITIES_SCHEMA. */
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
    'function_calling',
]);

/**
 * Classe abstrata base para todos os drivers de LLM. Define contrato de execução, gerencia estados validados e emite
 * telemetria.
 *
 * ✅ v3.0: Pool-ready architecture (attach/detach context) ✅ v2.0: State transition matrix, AbortSignal integration,
 * capabilities validation
 *
 * @abstract
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
 * @fires TargetDriver#CONTEXT_ATTACHED - Context attached (page + signal)
 * @fires TargetDriver#CONTEXT_DETACHED - Context detached
 * @extends EventEmitter
 * @property {Page | null} page - Puppeteer page instance (null se UNATTACHED)
 * @property {object} config - Driver configuration (immutable)
 * @property {AbortSignal | null} signal - Cancellation signal (null se UNATTACHED)
 * @property {string} name - Driver name
 * @property {boolean} destroyed - Destruction flag
 * @property {string} correlationId - Correlation ID for tracing
 */
class TargetDriver extends EventEmitter {
    /** @type {any} */
    config;

    /** @type {string} */
    name;

    /** @type {number | undefined} */
    _createdAt;

    /** @type {string} */
    _state;

    /**
     * Construtor do TargetDriver - Classe abstrata base.
     *
     * ✅ v3.0: BREAKING CHANGE - Constructor agora recebe APENAS config
     *
     * - page e signal são null inicialmente (estado UNATTACHED)
     * - Use attachContext(page, signal) para injetar context antes de executar
     *
     * @param {object} config - Configuração do driver (clonada para imutabilidade)
     * @param {string} config.target - Target específico (chatgpt, gemini, etc)
     * @param {number} [config.timeout] - Timeout em milissegundos
     * @throws {Error} Se tentar instanciar TargetDriver diretamente
     * @throws {Error} Se config não fornecido
     */
    constructor(config) {
        super();

        // Proteção de Classe Abstrata
        if (this.constructor === TargetDriver) {
            throw new Error('[TARGET_DRIVER] Erro Fatal: Classe abstrata não pode ser instanciada diretamente.');
        }

        // ✅ v3.0: Validar config obrigatório
        if (!config || typeof config !== 'object') {
            throw new Error('[TARGET_DRIVER] Parameter "config" is required and must be an object');
        }

        // ✅ v3.0: page e signal são NULL inicialmente (estado UNATTACHED)
        /** @type {Page | null} */
        this.page = null;
        this.signal = null;

        // ✅ v2.0: Readonly config (configurable para permitir null em destroy)
        Object.defineProperty(this, 'config', {
            value: { ...config }, // Clone para imutabilidade
            writable: false,
            enumerable: true,
        });

        Object.defineProperty(this, '_createdAt', {
            value: Date.now(),
            writable: false,
            enumerable: false,
        });

        this.name = DRIVER_NAMES.GENERIC;
        this.destroyed = false;
        // Always initialize with a string so typed code doesn't need null-guards.
        // BaseDriver may overwrite with its own correlationId generator.
        this.correlationId = `drv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        // Propriedades da Máquina de Estados
        // ✅ v3.0: Estado inicial UNATTACHED (sem context)
        /** @type {string} */
        this._state = STATES.UNATTACHED;
        this.stateUpdated = Date.now();

        // ✅ v2.0: State history tracking
        /** @type {any[]} */
        this._stateHistory = [];

        // ✅ v2.0: Error tracking
        this._errorCount = 0;
        this._lastError = null;

        // Capacidades Técnicas Iniciais (Manifesto de Habilidades)
        this._capabilities = { ...TARGETDRIVER_CONFIG.DEFAULT_CAPABILITIES };

        // ✅ v3.0: AbortSignal listener será configurado em attachContext()
        this._abortHandler = null;

        // ✅ P0-8: Page lifecycle event listeners (configurados em attachContext)
        /** @type {any[]} */
        this._pageEventListeners = [];
    }

    /* ==========================================================================
      INTERNAL UTILITIES (v2.0)
  ========================================================================== */

    /**
     * Configura listener para AbortSignal. ✅ v3.0: Chamado por attachContext() (não mais no constructor)
     *
     * @private
     */
    _setupAbortListener() {
        if (this.signal && !this._abortHandler) {
            this._abortHandler = () => {
                this._handleAbort();
            };
            this.signal.addEventListener('abort', this._abortHandler);
        }
    }

    /**
     * Remove listener de AbortSignal. ✅ v3.0: Chamado por detachContext()
     *
     * @private
     */
    _teardownAbortListener() {
        if (this.signal && this._abortHandler) {
            this.signal.removeEventListener('abort', this._abortHandler);
            this._abortHandler = null;
        }
    }

    /**
     * Configura listeners para page lifecycle events. ✅ P0-8: Previne resource leaks e adiciona telemetria para page
     * crashes. Segue padrão de PageLifecycleMonitor.js.
     *
     * @private
     */
    _setupPageLifecycleHandlers() {
        if (!this.page || this._pageEventListeners.length > 0) {
            return;
        }

        try {
            // 1. Page close event
            const closeHandler = () => {
                log('WARN', `[${this.name}] Page closed unexpectedly`, this.correlationId);
                this.emit(EVENTS.WARNING, {
                    type: 'PAGE_CLOSED',
                    correlationId: this.correlationId,
                    state: this._state,
                    ts: Date.now(),
                });

                // Reset to IDLE if not already UNATTACHED
                if (this._state !== STATES.UNATTACHED) {
                    try {
                        this.setState(STATES.IDLE);
                    } catch (/** @type {any} */ _) {
                        // If setState fails, force update
                        this._state = STATES.IDLE;
                        this.stateUpdated = Date.now();
                    }
                }
            };
            this.page.on('close', closeHandler);
            this._pageEventListeners.push({ event: 'close', handler: closeHandler });

            // 2. Page error event
            const errorHandler = (/** @type {any} */ err) => {
                log('ERROR', `[${this.name}] Page error: ${err.message}`, this.correlationId);
                this.emit(EVENTS.WARNING, {
                    type: 'PAGE_ERROR',
                    error: err.message,
                    correlationId: this.correlationId,
                    ts: Date.now(),
                });

                this._errorCount++;
                this._lastError = {
                    type: 'PAGE_ERROR',
                    message: err.message,
                    ts: Date.now(),
                };
            };
            this.page.on('error', errorHandler);
            this._pageEventListeners.push({ event: 'error', handler: errorHandler });

            // 3. Page disconnected event
            const disconnectHandler = () => {
                log('ERROR', `[${this.name}] Page disconnected`, this.correlationId);
                this.emit(EVENTS.WARNING, {
                    type: 'PAGE_DISCONNECTED',
                    correlationId: this.correlationId,
                    state: this._state,
                    ts: Date.now(),
                });

                // Reset to IDLE if not already UNATTACHED
                if (this._state !== STATES.UNATTACHED) {
                    try {
                        this.setState(STATES.IDLE);
                    } catch (/** @type {any} */ _) {
                        // If setState fails, force update
                        this._state = STATES.IDLE;
                        this.stateUpdated = Date.now();
                    }
                }
            };
            this.page.on('disconnected', disconnectHandler);
            this._pageEventListeners.push({ event: 'disconnected', handler: disconnectHandler });

            log(
                'DEBUG',
                `[${this.name}] Page lifecycle handlers attached (${this._pageEventListeners.length})`,
                this.correlationId,
            );
        } catch (/** @type {any} */ _rawErr) {
            const err = /** @type {any} */ (_rawErr);
            log('ERROR', `[${this.name}] Failed to attach page handlers: ${err.message}`, this.correlationId);
        }
    }

    /**
     * Remove listeners de page lifecycle events. ✅ P0-8: Previne memory leaks.
     *
     * @private
     */
    _teardownPageLifecycleHandlers() {
        if (!this.page || this._pageEventListeners.length === 0) {
            return;
        }

        try {
            this._pageEventListeners.forEach(({ event, handler }) => {
                /** @type {any} */ (this.page)?.off(event, handler);
            });
            this._pageEventListeners = [];
            log('DEBUG', `[${this.name}] Page lifecycle handlers removed`, this.correlationId);
        } catch (/** @type {any} */ _rawErr) {
            const err = /** @type {any} */ (_rawErr);
            log('WARN', `[${this.name}] Error removing page handlers: ${err.message}`, this.correlationId);
        }
    }

    /**
     * Handler para AbortSignal disparado. ✅ v2.0: Reseta estado para IDLE automaticamente
     *
     * @private
     */
    _handleAbort() {
        if (this.destroyed) return;

        this.emit(EVENTS.ABORT_SIGNAL_RECEIVED, {
            currentState: this._state,
            correlationId: this.correlationId,
            ts: Date.now(),
        });

        log('WARN', `[${this.name}] AbortSignal received. Resetting state to IDLE.`, this.correlationId);

        // Reset to IDLE (bypass validation se necessário)
        if (this._state !== STATES.IDLE) {
            try {
                this.setState(STATES.IDLE);
            } catch (/** @type {any} */ _err) {
                // Force reset se validação falhar
                this._state = STATES.IDLE;
                this.stateUpdated = Date.now();
            }
        }
    }

    /**
     * Valida se transição de estado é permitida. ✅ v2.0: State transition matrix
     *
     * @private
     * @param {string} from - Estado atual
     * @param {string} to - Estado desejado
     * @throws {Error} Se transição não for válida
     */
    _validateTransition(from, to) {
        const validTargets = STATE_TRANSITIONS[from] || [];

        if (!validTargets.includes(to)) {
            throw new Error(
                `[${this.name}] Invalid state transition: ${from} → ${to}. ` +
                    `Valid transitions from ${from}: ${validTargets.join(', ')}`,
            );
        }
    }

    /**
     * Valida schema de capabilities. ✅ v2.0: Type safety para capabilities
     *
     * @private
     * @param {object} caps - Capabilities a validar
     * @throws {Error} Se capability desconhecida ou tipo inválido
     */
    _validateCapabilities(caps) {
        for (const key of Object.keys(caps)) {
            if (!CAPABILITIES_SCHEMA.includes(key)) {
                throw new Error(
                    `[${this.name}] Unknown capability: "${key}". ` +
                        `Valid capabilities: ${CAPABILITIES_SCHEMA.join(', ')}`,
                );
            }
            if (typeof (/** @type {any} */ (caps)[key]) !== 'boolean') {
                throw new Error(
                    `[${this.name}] Capability "${key}" must be boolean, got ${typeof (/** @type {any} */ (caps)[key])}`,
                );
            }
        }
    }

    /* ==========================================================================
      CONTEXT MANAGEMENT (v3.0 - POOL-READY ARCHITECTURE)
  ========================================================================== */

    /**
     * Attach context (page + signal) ao driver ANTES de executar task.
     *
     * ✅ v3.0: Pool-ready - Driver pode ser reutilizado entre tasks ✅ v3.1: Hot-Swap - Permite reanexar signal se página
     * for a mesma (Hot Pool)
     *
     * PRÉ-CONDIÇÕES:
     *
     * - Driver em estado UNATTACHED OU (IDLE e mesma página)
     * - Driver não destruído
     * - Page válida (não null, não closed)
     * - Signal válido (AbortSignal instance)
     *
     * PÓS-CONDIÇÕES:
     *
     * - Driver em estado IDLE (ready para execute)
     * - Page attached
     * - Signal attached + listener configurado
     * - Evento CONTEXT_ATTACHED emitido
     *
     * @example
     *     const driver = factory.acquireFromPool('chatgpt');
     *     driver.attachContext(page, abortSignal, 'task-123');
     *     const response = await driver.execute(prompt);
     *
     * @param {Page} page - Puppeteer page instance
     * @param {AbortSignal} signal - Cancellation signal
     * @param {string} [correlationId] - Correlation ID para tracing
     * @returns {void}
     * @throws {Error} Se driver não está UNATTACHED, está destruído, ou parâmetros inválidos
     */
    attachContext(page, signal, /** @type {string | null} */ correlationId = null) {
        // Validações
        if (this.destroyed) {
            throw new Error(`[${this.name}] Cannot attach context: driver destroyed`);
        }

        // ✅ v3.1: Hot-Swap support
        const isHotSwap = this._state === STATES.IDLE && this.page === page;

        if (this._state !== STATES.UNATTACHED && !isHotSwap) {
            throw new Error(
                `[${this.name}] Cannot attach context: driver not UNATTACHED (current: ${this._state}). ` +
                    `Call detachContext() first.`,
            );
        }

        if (!page) {
            throw new Error(`[${this.name}] Cannot attach context: page is required`);
        }

        if (page.isClosed && page.isClosed()) {
            throw new Error(`[${this.name}] Cannot attach context: page is closed`);
        }

        if (!signal || !(signal instanceof AbortSignal)) {
            throw new Error(`[${this.name}] Cannot attach context: signal must be AbortSignal instance`);
        }

        // ✅ P0-U6: Domain validation (previne attach em página errada)
        if (this.config.expectedDomain) {
            const currentUrl = page.url ? page.url() : '';

            // Skip validation for about:blank (not navigated yet)
            if (
                currentUrl !== 'about:blank' &&
                currentUrl !== '' &&
                !isDomainMatch(currentUrl, /** @type {any} */ (this.config).expectedDomain)
            ) {
                throw new Error(
                    `[${this.name}] Domain mismatch: expected ${this.config.expectedDomain}, got ${currentUrl}`,
                );
            }
        }

        // Se for Hot Swap, remove listeners antigos antes de reconfigurar
        if (isHotSwap) {
            this._teardownAbortListener();
        }

        // Attach page + signal
        this.page = page;
        this.signal = signal;
        this.correlationId = correlationId || this.correlationId;

        // Setup AbortSignal listener
        this._setupAbortListener();

        // ✅ P0-8: Setup page lifecycle event listeners
        this._setupPageLifecycleHandlers();

        // Transição: UNATTACHED → IDLE
        if (this._state !== STATES.IDLE) {
            this.setState(STATES.IDLE);
        }

        // ✅ v3.1: Hot Pool - Se for Hot Swap (mesma página), emite evento diferenciado
        const eventType = isHotSwap ? EVENTS.CONTEXT_HOT_SWAP : EVENTS.CONTEXT_ATTACHED;

        // Telemetria
        this.emit(eventType, {
            pageUrl: page.url ? page.url() : 'unknown',
            correlationId,
            isHotSwap,
            ts: Date.now(),
        });

        log(
            'DEBUG',
            `[${this.name}] Context attached (${isHotSwap ? 'HOT' : 'COLD'}): ${correlationId || 'no-correlation'}`,
            this.correlationId,
        );
    }

    /**
     * Detach context (page + signal) do driver APÓS executar task.
     *
     * ✅ v3.0 (C2): Pool-ready - Driver volta para estado UNATTACHED (disponível para reuse). ✅ C2: Idempotência - Pode
     * ser chamado múltiplas vezes sem erro (force flag).
     *
     * PRÉ-CONDIÇÕES:
     *
     * - Driver não destruído (throw se destroyed=true)
     * - Driver em estado IDLE (recomendado, warning se não)
     *
     * PÓS-CONDIÇÕES:
     *
     * - Driver em estado UNATTACHED (ready para novo attach)
     * - Page = null
     * - Signal = null + listener removido
     * - correlationId = null
     * - Evento CONTEXT_DETACHED emitido
     *
     * @example
     *     const response = await driver.execute(prompt);
     *     driver.detachContext(); // Normal detach (IDLE required)
     *
     *     // C2: Force detach (finally block - garantir release)
     *     try {
     *         await driver.execute(prompt);
     *     } finally {
     *         driver.detachContext({ force: true }); // Sempre detach (mesmo se erro)
     *     }
     *
     * @param {object} [options] - Opções de detach
     * @param {boolean} [options.force=false] - Se true, ignora validação de estado (não throw). Default is `false`
     * @returns {void}
     * @throws {Error} Se driver destruído (sempre)
     * @throws {Error} Se driver não está IDLE E force=false
     */
    detachContext(options = {}) {
        const { force = false } = options;

        // ✅ C2: ALWAYS validate destroyed (não pode ser idempotente em drivers destruídos)
        if (this.destroyed) {
            throw new Error(`[${this.name}] Cannot detach context: driver destroyed`);
        }

        // ✅ C2: Idempotência - Se já UNATTACHED, nada a fazer (return early)
        if (this._state === STATES.UNATTACHED && !this.page && !this.signal) {
            log('DEBUG', `[${this.name}] Detach called but already UNATTACHED (idempotent call)`);
            return;
        }

        // ✅ C2: Validação de estado (somente se force=false)
        if (!force && this._state !== STATES.IDLE) {
            throw new Error(
                `[${this.name}] Cannot detach context: driver not IDLE (current: ${this._state}). ` +
                    `Call detachContext({ force: true }) to override.`,
            );
        }

        // ✅ C2: Warning se forçando detach em estado não-IDLE (telemetria crítica)
        if (force && this._state !== STATES.IDLE) {
            log(
                'WARN',
                `[${this.name}] FORCED detach: driver not IDLE (current: ${this._state}). ` +
                    `This may indicate incomplete task execution or error recovery.`,
                this.correlationId,
            );
        }

        const oldCorrelationId = this.correlationId;

        // Teardown AbortSignal listener
        this._teardownAbortListener();

        // ✅ P0-8: Teardown page lifecycle event listeners
        this._teardownPageLifecycleHandlers();

        // Detach page + signal
        this.page = null;
        this.signal = null;
        this.correlationId = /** @type {any} */ (null);

        // Transição: * → UNATTACHED
        // ✅ C2: Force setState (mesmo que validation falhe)
        try {
            this.setState(STATES.UNATTACHED);
        } catch (/** @type {any} */ _rawStateError) {
            const stateError = /** @type {any} */ (_rawStateError);
            // ✅ C2: Se setState falhar (transition inválida), force state
            log(
                'WARN',
                `[${this.name}] setState(UNATTACHED) failed: ${stateError.message}. ` + `Forcing state transition.`,
                oldCorrelationId,
            );
            this._state = STATES.UNATTACHED;
            this.stateUpdated = Date.now();
        }

        // Telemetria
        this.emit(EVENTS.CONTEXT_DETACHED, {
            previousCorrelationId: oldCorrelationId,
            forced: force && this._state !== STATES.IDLE,
            ts: Date.now(),
        });

        log('DEBUG', `[${this.name}] Context detached: ${oldCorrelationId || 'no-correlation'}`);
    }

    /**
     * Valida se driver está ready para executar task (context attached).
     *
     * ✅ v3.0: Pool-ready - Validação de pré-condições
     *
     * @example
     *     if (!driver.isContextAttached()) {
     *         throw new Error('Driver not ready: attach context first');
     *     }
     *
     * @returns {boolean} True se context attached e driver ready
     */
    isContextAttached() {
        return this.page !== null && this.signal !== null && this._state !== STATES.UNATTACHED;
    }

    /* ==========================================================================
      GESTÃO DE ESTADO E CAPACIDADES (v2.0)
  ========================================================================== */

    /**
     * Getter para estado atual.
     *
     * @returns {string} Estado atual
     */
    get state() {
        return this._state;
    }

    /**
     * Altera o estado interno e emite telemetria de transição. ✅ v2.0: Valida transição via state transition matrix
     *
     * @param {string} newState - Membro da constante STATES
     * @throws {Error} Se estado inválido ou transição não permitida
     */
    setState(newState) {
        if (this.destroyed) {
            return;
        }

        // Validate state exists
        if (!(/** @type {any} */ (STATES)[newState])) {
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
                ts: now,
            });

            this._state = newState;
            this.stateUpdated = now;

            // ✅ v2.0: Update state history
            this._stateHistory.push({
                from: oldState,
                to: newState,
                ts: now,
                duration_ms: duration,
            });

            if (this._stateHistory.length > TARGETDRIVER_CONFIG.MAX_STATE_HISTORY_SIZE) {
                this._stateHistory.shift();
            }

            // Original STATE_CHANGE event
            this.emit(EVENTS.STATE_CHANGE, {
                from: oldState,
                to: newState,
                ts: now,
                duration_ms: duration,
            });

            // ✅ v2.0: Emit state entered
            this.emit(EVENTS.STATE_ENTERED, {
                state: newState,
                from: oldState,
                ts: now,
            });
        }
    }

    /**
     * Retorna histórico de transições de estado. ✅ v2.0: State history tracking
     *
     * @returns {unknown[]} Últimas transições (max 20)
     */
    getStateHistory() {
        return [...this._stateHistory];
    }

    /**
     * Atualiza o mapa de capacidades técnicas do robô e notifica o sistema. ✅ v2.0: Valida schema de capabilities
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
     *
     * @returns {any} Capabilities
     */
    getCapabilities() {
        return { ...this._capabilities };
    }

    /* ==========================================================================
      DIAGNÓSTICO E SAÚDE (v2.0 - EXPANDED METRICS)
  ========================================================================== */

    /**
     * Retorna um snapshot da saúde operacional do driver. ✅ v2.0: Expandido com performance metrics
     *
     * Usado pelo Supervisor para detecção de Drifts.
     *
     * @returns {Promise<any>} Health status com métricas
     */
    async getHealth() {
        const isPageAlive = !!(this.page && !this.page.isClosed());
        const stateAge = Date.now() - this.stateUpdated;
        const uptime = Date.now() - (this._createdAt ?? 0);

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
                stateTransitions: this._stateHistory.length,
            },

            // ✅ v2.0: Capabilities snapshot
            capabilities: this.getCapabilities(),

            // ✅ v2.0: Error info
            lastError: this._lastError,

            // Legacy fields
            isPageAttached: isPageAlive,
            name: this.name,
            correlationId: this.correlationId,
        };
    }

    /**
     * Retorna estatísticas de erros. ✅ v2.0: Error tracking
     *
     * @returns {any} Error stats
     */
    getErrorStats() {
        return {
            errorCount: this._errorCount,
            lastError: this._lastError,
        };
    }

    /* ==========================================================================
      API PÚBLICA (CONTRATO OBRIGATÓRIO)
  ========================================================================== */

    /**
     * Otimiza a página para performance.
     *
     * @returns {Promise<boolean | void>}
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
     *
     * @abstract
     * @returns {Promise<boolean | void>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async validatePage() {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'validatePage' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`,
        );
    }

    /**
     * ✅ P0 BUG #3 FIX: Método abstrato execute() declarado explicitamente
     *
     * Executa uma tarefa (1 prompt → 1 resposta). Este é o método CORE de todo driver - representa 1 interação completa
     * com LLM.
     *
     * ✅ v3.0: VALIDAÇÃO - Requer context attached (page + signal)
     *
     * CONTRATO:
     *
     * - Input: prompt (string) - O texto a ser enviado para o LLM
     * - Output: response (string) - A resposta completa do LLM
     * - Timing: 2-5min (depende da complexidade do prompt)
     *
     * ESTADO:
     *
     * - IDLE → PREPARING → TYPING → WAITING → IDLE (sucesso)
     * - Qualquer estado → IDLE (abort via AbortSignal)
     *
     * PRÉ-CONDIÇÕES (v3.0):
     *
     * - Context attached (page não null, signal não null)
     * - Page não está closed (validatePage passou)
     * - Interface ready (validateLLMInterface passou)
     * - DNA loaded (getTargetRules executou)
     * - Estado inicial: IDLE
     *
     * INTEGRAÇÃO:
     *
     * - DNA: Usa selectors de dynamic_rules.json (this.dnaRules)
     * - BiomechanicsEngine: Typing biomimético, click submit
     * - AbortSignal: Checked a cada ciclo de perception loop
     * - Telemetria: Emite STATE_CHANGE, VITAL, progress events
     *
     * GARANTIAS ONTOLÓGICAS (v3.0):
     *
     * - Driver pode executar N tasks sequencialmente (reuse)
     * - Driver é agnóstico de task (só executa quando context attached)
     *
     * @example
     *     // ChatGPTDriver.execute() implementation:
     *     async execute(prompt) {
     *     // ✅ v3.0: Validar context attached
     *     if (!this.isContextAttached()) {
     *     throw new Error('Context not attached');
     *     }
     *
     *     this.setState('PREPARING');
     *     await this.prepareContext();
     *     this.setState('TYPING');
     *     await this.sendPrompt(prompt);
     *     this.setState('WAITING');
     *     const response = await this.waitForResponse();
     *     this.setState('IDLE');
     *     return response;
     *     }
     *
     * @abstract
     * @param {string} _prompt - Prompt a ser enviado para o LLM
     * @returns {Promise<string>} Resposta completa do LLM
     * @throws {Error} Se context não attached ou método não implementado
     */
    async execute(_prompt) {
        // ✅ v3.0: Validação de context attached
        if (!this.isContextAttached()) {
            throw new Error(
                `[${this.constructor.name}] CONTEXT_NOT_ATTACHED: Cannot execute without context. ` +
                    `Call attachContext(page, signal) before execute().`,
            );
        }

        throw new Error(
            `[${this.constructor.name}] ABSTRACT_METHOD_NOT_IMPLEMENTED: 'execute' não implementado. ` +
                `Classe ${this.constructor.name} DEVE implementar execute(prompt) para ser funcional. ` +
                `Veja contrato completo no JSDoc de TargetDriver.execute().`,
        );
    }

    /**
     * * Prepara contexto para execução.
     *
     * @abstract
     * @param {object} _taskSpec - Especificação da task
     * @returns {Promise<void>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async prepareContext(_taskSpec) {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'prepareContext' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`,
        );
    }

    /**
     * Envia prompt para LLM.
     *
     * @abstract
     * @param {string} _text - Texto do prompt
     * @param {string | object} [_taskId] - ID da task ou objeto de opções
     * @param {AbortSignal} [_signal] - Sinal de cancelamento
     * @returns {Promise<void>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async sendPrompt(_text, _taskId, _signal) {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'sendPrompt' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`,
        );
    }

    /**
     * Aguarda conclusão da resposta.
     *
     * @abstract
     * @param {object} _startSnapshot - Snapshot inicial
     * @param {AbortSignal} _signal - Sinal de cancelamento
     * @returns {Promise<void>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async waitForCompletion(_startSnapshot, _signal) {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'waitForCompletion' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`,
        );
    }

    /**
     * Captura estado atual da interface.
     *
     * @abstract
     * @returns {Promise<any>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async captureState() {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'captureState' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`,
        );
    }

    /**
     * Para geração em andamento.
     *
     * @abstract
     * @returns {Promise<boolean | void>}
     * @throws {Error} Sempre - deve ser implementado
     */
    async stopGeneration() {
        throw new Error(
            `[${this.constructor.name}] Método abstrato 'stopGeneration' não implementado. ` +
                `Classe ${this.constructor.name} deve implementar este método.`,
        );
    }

    /**
     * Commit de aprendizado (opcional).
     *
     * @returns {Promise<void>}
     */
    async commitLearning() {
        return Promise.resolve();
    }

    /**
     * Sobrescrita de segurança para emissão de eventos. ✅ v2.0: Bloqueia emissões após destruição e registra erros
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
                ts: Date.now(),
            };

            log('WARN', `[${this.name}] Tentativa de emit após destroy: ${event}`, this.correlationId);

            return false;
        }
        return super.emit(event, ...args);
    }

    /**
     * Destruição profunda da instância e sinalização para a Factory. ✅ v3.0: Garante detach de context antes de destroy
     *
     * Garante que o robô seja removido do cache e a memória seja liberada.
     *
     * @returns {Promise<void>}
     */
    async destroy() {
        if (this.destroyed) {
            return;
        }

        // FIXED (P0-1.4): Remove abort listener ANTES de detach para garantir cleanup
        // Previne leak se detachContext() lançar exceção
        this._teardownAbortListener();

        // ✅ P0-8: Teardown page lifecycle handlers ANTES de detach
        this._teardownPageLifecycleHandlers();

        // ✅ v3.0: Detach context se ainda attached
        if (this.isContextAttached()) {
            try {
                this.detachContext();
            } catch (/** @type {any} */ _rawErr) {
                const err = /** @type {any} */ (_rawErr);
                log('WARN', `[${this.name}] Error detaching context during destroy: ${err.message}`);
            }
        }

        this.destroyed = true;

        // [R2] Notifica a Factory para remoção imediata do cache de instâncias
        this.emit(EVENTS.DESTROYED);

        this.removeAllListeners();

        // Clear references
        this.page = null;
        this.signal = null;

        try {
            log(
                'DEBUG',
                `[${this.name}] Driver destruído. Referências de memória limpas. Errors: ${this._errorCount}`,
                this.correlationId,
            );
        } catch (/** @type {any} */ _e) {
            // Ignore logging errors during cleanup
        }
    }

    /**
     * ✅ v3.1: Hot/Cold State Management
     *
     * @returns {boolean} True se o driver está ATTACHED mas IDLE (Cold state)
     */
    get isCold() {
        return this._state === STATES.IDLE && this.page !== null && !this.page.isClosed();
    }

    /**
     * ✅ v3.1: Hot/Cold State Management
     *
     * @returns {boolean} True se o driver está ATTACHED e EXECUTING (Hot state)
     */
    get isHot() {
        return (
            this._state !== STATES.IDLE &&
            this._state !== STATES.UNATTACHED &&
            this.page !== null &&
            !this.page.isClosed()
        );
    }
}

/* ==========================================================================
   EXPORTS (v2.0)
========================================================================== */

// Exportação de Constantes para uso externo
TargetDriver.EVENTS = EVENTS;
TargetDriver.STATES = STATES;

export default TargetDriver;

/**
 * Configuração padrão do TargetDriver
 *
 * **Side-effects:** N/A **Semântica:** Configurações de timeouts, capacidades padrão e limites para operação do driver.
 * **Unidades:** Milissegundos para timeouts, números inteiros para contadores.
 *
 * @type {Object<string, any>}
 */
export { TARGETDRIVER_CONFIG };

/**
 * Matriz de transições de estado válidas
 *
 * **Side-effects:** N/A **Semântica:** Define transições permitidas entre estados da máquina de estados do driver.
 * **Unidades:** N/A
 *
 * @type {Object<string, string[]>}
 */
export { STATE_TRANSITIONS };

/**
 * Esquema de validação de capacidades do driver
 *
 * **Side-effects:** N/A **Semântica:** Lista de capacidades suportadas pelos drivers de LLM. **Unidades:** N/A
 *
 * @type {string[]}
 */
export { CAPABILITIES_SCHEMA };
