// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { DRIVER_DOMAINS, DRIVER_NAMES } from '#core/constants';
import { DriverReadinessGuard } from '../guards/DriverReadinessGuard.js';
import PageSessionTracker from '../trackers/PageSessionTracker.js';
import TargetDriver from './TargetDriver.js';

/* ==========================================================================
   CONFIGURAÇÃO (v2.0 - ZERO MAGIC NUMBERS)
========================================================================== */

/** Constante/valor exportado: BASEDRIVER_CONFIG. */
const BASEDRIVER_CONFIG = Object.freeze({
    // Retry Strategy
    MAX_RETRY_ATTEMPTS: 4,
    RETRY_BACKOFF_TYPE: 'exponential', // 'exponential', 'linear', 'fixed'
    RETRY_BASE_DELAY_MS: 1000,
    RETRY_MAX_DELAY_MS: 10000,

    // Error Management
    ERROR_HISTORY_SIZE: 4, // Matches MAX_RETRY_ATTEMPTS
    ERROR_MESSAGE_MAX_LENGTH: 200,

    // Timeouts
    PREREQUISITE_TIMEOUT_MS: 5000,
    MODULE_INSTANTIATION_TIMEOUT_MS: 3000,

    // Domain Tracking
    DOMAIN_UPDATE_INTERVAL_MS: 30000,
});

/* ==========================================================================
   ERROR CLASSIFICATION (v2.0)
========================================================================== */

/** Constante/valor exportado: ERROR_CLASSES. */
const ERROR_CLASSES = Object.freeze({
    ABORT: 'ABORT', // User cancellation
    FATAL: 'FATAL', // Non-recoverable
    TIMEOUT: 'TIMEOUT', // Time-based failures
    SELECTOR: 'SELECTOR', // DOM/selector issues
    TRANSIENT: 'TRANSIENT', // Retryable errors
});

const ERROR_PATTERNS = Object.freeze({
    [ERROR_CLASSES.ABORT]: ['OPERATION_ABORTED'],
    [ERROR_CLASSES.FATAL]: ['TARGET_CLOSED', 'PAGE_DESTROYED', 'Browser closed'],
    [ERROR_CLASSES.TIMEOUT]: ['timeout', 'Navigation timeout', 'waitForSelector', 'Waiting failed'],
    [ERROR_CLASSES.SELECTOR]: ['No node found', 'selector', 'querySelector', 'failed to find element'],
});

import { BiomechanicsEngine } from '../modules/biomechanics_engine.js';
import { FrameNavigator } from '../modules/frame_navigator.js';
import { HandleManager } from '../modules/handle_manager.js';
import { InputResolver } from '../modules/input_resolver.js';
import { RecoverySystem } from '../modules/recovery_system.js';
import { SubmissionController } from '../modules/submission_controller.js';

/** Classe exportada: default. */
class BaseDriver extends TargetDriver {
    /** @type {string} */
    name = '';

    /**
     * Construtor do BaseDriver - Orquestrador modular de execução.
     *
     * ✅ v3.0: BREAKING CHANGE - Constructor recebe APENAS config
     * - page e signal são null inicialmente (herdados de TargetDriver)
     * - Use attachContext(page, signal) antes de executar
     *
     * @param {object} config - Configuração da tarefa (clonada)
     * @param {string} config.target - Target específico (chatgpt, gemini, etc)
     *
     * @throws {Error} MODULE_INSTANTIATION_FAILED - Se subsistema falhar ao inicializar
     */
    constructor(config) {
        super(config);

        // Driver identification (writable so target drivers can override)
        this.name = DRIVER_NAMES.BASE_UNIVERSAL;

        // ✅ v3.0: currentDomain será atualizado quando page for attached
        this.currentDomain = null;

        // ✅ v2.0: Auto-generate correlation ID
        this.correlationId = this._generateCorrelationId();

        // [V800] Instanciação da Malha Modular de Execução
        // ✅ v3.0: Módulos instanciados IMEDIATAMENTE (não precisam de page)
        try {
            // ✅ BUG FIX: InputResolver DEVE ser criado ANTES de RecoverySystem
            // RecoverySystem.constructor() valida que driver.inputResolver existe
            this.inputResolver = new InputResolver(/** @type {any} */ (this));
            this.handles = new HandleManager(/** @type {any} */ (this));
            this.recovery = new RecoverySystem(/** @type {any} */ (this));
            this.frameNavigator = new FrameNavigator(/** @type {any} */ (this));
            this.biomechanics = new BiomechanicsEngine(/** @type {any} */ (this));
            this.submission = new SubmissionController(/** @type {any} */ (this));

            // ✅ Phase 1 (P0-U4): Readiness guard (pre-execution validation)
            this.readinessGuard = new DriverReadinessGuard(this);

            // ✅ Phase 2 (P1-U1): Session tracker (adaptive timeout)
            this.sessionTracker = new PageSessionTracker(this);

            // ✅ v2.0: Validate module instantiation
            this._validateModules();

            // ✅ v2.0: Propagate correlation to ALL modules
            this._propagateCorrelationToModules();
        } catch (/** @type {any} */ err) {
            log('ERROR', `[BASEDRIVER] Module instantiation failed: ${err.message}`, this.correlationId);
            throw new Error(`MODULE_INSTANTIATION_FAILED: ${err.message}`, { cause: err });
        }
    }

    /* ======================================================================
     INTERNAL UTILITIES (v2.0)
  ====================================================================== */

    /**
     * Gera ID de correlação único para rastreamento.
     * @returns {string} Correlation ID (formato: drv-{timestamp}-{random})
     * @private
     */
    _generateCorrelationId() {
        return `drv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Valida que todos os módulos foram instanciados corretamente.
     * @throws {Error} Se algum módulo for null/undefined
     * @private
     */
    _validateModules() {
        const requiredModules = [
            'recovery',
            'handles',
            'inputResolver',
            'frameNavigator',
            'biomechanics',
            'submission',
            'readinessGuard', // ✅ Phase 1 (P0-U4)
            'sessionTracker', // ✅ Phase 2 (P1-U1)
        ];

        for (const moduleName of requiredModules) {
            if (!(/** @type {any} */ (this)[moduleName])) {
                throw new Error(`Required module '${moduleName}' not instantiated`);
            }
        }
    }

    /**
     * Propaga correlation ID para TODOS os 8 módulos (v3.1 - Phase 2).
     * @private
     */
    _propagateCorrelationToModules() {
        const modules = [
            this.recovery,
            this.handles,
            this.inputResolver,
            this.frameNavigator,
            this.biomechanics,
            this.submission,
            this.readinessGuard, // ✅ Phase 1 (P0-U4)
            this.sessionTracker, // ✅ Phase 2 (P1-U1)
        ];

        modules.forEach(module => {
            if (module) {
                const moduleWithDriver = /** @type {{ driver?: unknown }} */ (/** @type {unknown} */ (module));
                moduleWithDriver.driver = this;
            }
        });
    }

    /**
     * Classifica erro em categorias para retry inteligente.
     *
     * @param {Error} err - Erro a classificar
     * @returns {string} Classe do erro (ABORT, FATAL, TIMEOUT, SELECTOR, TRANSIENT)
     * @private
     */
    _classifyError(err) {
        const message = err.message || '';

        // Check each error class patterns
        for (const [errorClass, patterns] of Object.entries(ERROR_PATTERNS)) {
            if (patterns.some(pattern => message.includes(pattern))) {
                return errorClass;
            }
        }

        return ERROR_CLASSES.TRANSIENT;
    }

    /**
     * Aplica backoff configurável entre tentativas.
     *
     * @param {number} attempt - Número da tentativa (0-based)
     * @returns {Promise<void>}
     * @private
     */
    async _applyBackoff(attempt) {
        const { RETRY_BACKOFF_TYPE, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS } = BASEDRIVER_CONFIG;

        let delay = Number(RETRY_BASE_DELAY_MS);

        if (RETRY_BACKOFF_TYPE === 'exponential') {
            delay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt), RETRY_MAX_DELAY_MS);
        } else if (RETRY_BACKOFF_TYPE === 'linear') {
            delay = Math.min(RETRY_BASE_DELAY_MS * (attempt + 1), RETRY_MAX_DELAY_MS);
        }
        // 'fixed' uses base delay

        this._emitVital('RETRY_BACKOFF', {
            attempt,
            delay,
            type: RETRY_BACKOFF_TYPE,
        });

        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Calcula timeout adaptativo baseado em métricas de sessão.
     * ✅ Phase 2 (P1-U2): Adaptive timeout adjustment
     *
     * @param {number} baseTimeout - Timeout base em milliseconds
     * @returns {number} Timeout ajustado (baseTimeout * multiplier)
     * @private
     */
    _calculateAdaptiveTimeout(baseTimeout) {
        const multiplier = this.sessionTracker.getTimeoutMultiplier();
        const adjustedTimeout = Math.round(baseTimeout * multiplier);

        if (multiplier > 1.0) {
            log(
                'DEBUG',
                `[BASEDRIVER] Adaptive timeout: ${baseTimeout}ms → ${adjustedTimeout}ms (${multiplier}x)`,
                this.correlationId
            );
        }

        return adjustedTimeout;
    }

    /**
     * Injeta o rastro de causalidade para todos os sinais emitidos por este driver.
     * ✅ v2.0: Propaga para TODOS os 6 módulos (vs apenas inputResolver em v1.1)
     *
     * @param {string} id - UUID de correlação da transação
     */
    setCorrelationId(id) {
        this.correlationId = id;

        // ✅ v2.0: Propagate to ALL modules
        this._propagateCorrelationToModules();

        log('DEBUG', `[DRIVER] Contexto de rastro sincronizado: ${id} (6 módulos)`, id);
    }

    /* ======================================================================
     SISTEMA DE SINAIS VITAIS (TELEMETRIA DESACOPLADA v2.0)
  ====================================================================== */

    /**
     * Emite um sinal vital capturado pela TelemetryBridge.
     * Mantém o Driver agnóstico ao transporte (IPC/Socket).
     * ✅ v2.0: Expandido de 1 evento para 18+ eventos em sendPrompt()
     *
     * @param {string} type - Categoria do evento
     * @param {object} payload - Dados técnicos da ação/percepção
     *
     * @emits driver:vital - Evento com type, payload, correlationId, timestamp
     */
    _emitVital(type, payload) {
        this.emit('driver:vital', {
            type,
            payload,
            correlationId: this.correlationId,
            ts: Date.now(),
        });
    }

    /* ======================================================================
     UTILITÁRIOS DE INFRAESTRUTURA (v2.0)
  ====================================================================== */

    /**
     * Verifica se página ainda está ativa.
     * @throws {Error} TARGET_CLOSED - Se página foi fechada
     */
    _assertPageAlive() {
        if (!this.page || this.page.isClosed()) {
            throw new Error('TARGET_CLOSED');
        }
    }

    /**
     * Atualiza e retorna o domínio atual da página.
     * ✅ v2.0: Emite evento quando domain muda
     *
     * @param {boolean} [emitEvent=false] - Se deve emitir evento de mudança
     * @returns {string} Domain atual (hostname sem www)
     * @private
     */
    _updateDomain(emitEvent = false) {
        const previousDomain = this.currentDomain;

        try {
            const url = /** @type {any} */ (this.page).url();
            if (!url || url === 'about:blank' || !url.startsWith('http')) {
                this.currentDomain = DRIVER_DOMAINS.INITIALIZATION;
                return this.currentDomain;
            }
            this.currentDomain = new URL(url).hostname.replace(/^www\./, '');
        } catch (/** @type {any} */ _e) {
            this.currentDomain = DRIVER_DOMAINS.UNKNOWN_CONTEXT;
        }

        // ✅ v2.0: Emit domain change
        if (emitEvent && previousDomain && previousDomain !== this.currentDomain) {
            this._emitVital('DOMAIN_CHANGED', {
                from: previousDomain,
                to: this.currentDomain,
            });
        }

        return this.currentDomain;
    }

    /**
     * Retorna status de saúde de todos os módulos.
     * ✅ v2.0: NEW - Module health diagnostics
     *
     * @returns {Promise<any>} Health status de cada módulo
     */
    async getModuleHealth() {
        return {
            recovery: this.recovery ? 'healthy' : 'missing',
            handles: this.handles ? 'healthy' : 'missing',
            inputResolver: this.inputResolver
                ? {
                      status: 'healthy',
                      cacheSize: this.inputResolver.protocolCache?.size || 0,
                  }
                : 'missing',
            frameNavigator: this.frameNavigator ? 'healthy' : 'missing',
            biomechanics: this.biomechanics ? 'healthy' : 'missing',
            submission: this.submission
                ? {
                      status: 'healthy',
                      locked: this.submission.isLocked?.() || false,
                  }
                : 'missing',
        };
    }

    /* ======================================================================
     API PÚBLICA (EXECUÇÃO INSTRUMENTADA v2.0)
  ====================================================================== */

    /**
     * Executa o envio do prompt com narração sensorial em tempo real.
     * Segue o fluxo: Validação → Estabilização → Percepção → Navegação → Biomecânica → Envio
     *
     * ✅ v2.0: Telemetria completa (18+ eventos), timing metrics, signal propagation
     *
     * @param {string} text - Conteúdo do prompt a enviar
     * @param {string|{ taskId?: string, [key: string]: unknown }} [taskId] - UUID da task ou objeto de contexto
     * @param {AbortSignal} [signal] - Sinal de cancelamento (opcional)
     * @returns {Promise<void>}
     *
     * @throws {Error} PREREQUISITE_FAILED - Página inválida para execução
     * @throws {Error} OPERATION_ABORTED - Sinal de cancelamento recebido
     * @throws {Error} EXECUTION_FAIL - Máximo de tentativas excedido
     *
     * @emits EXECUTION_START - Início de execução
     * @emits PREREQUISITE_CHECK - Resultado de validação
     * @emits DOMAIN_UPDATED - Domínio atual da página
     * @emits SELECTOR_RESOLVED - Seletor identificado
     * @emits CONTEXT_ACQUIRED - Contexto de execução obtido
     * @emits TYPING_START - Início de digitação
     * @emits SUBMISSION_SUCCESS - Envio bem-sucedido
     * @emits EXECUTION_SUCCESS - Execução completa com métricas
     * @emits RETRY_ATTEMPT - Tentativa de retry após falha
     * @emits EXECUTION_ABORTED - Cancelamento durante execução
     * @emits TRIAGE_ALERT - Falha em tentativa individual
     */
    async sendPrompt(text, taskId, signal) {
        const resolvedTaskId =
            typeof taskId === 'string'
                ? taskId
                : taskId && typeof taskId === 'object' && typeof taskId.taskId === 'string'
                  ? taskId.taskId
                  : 'task-unknown';

        // ✅ v2.0: Timing metrics
        const startTime = Date.now();
        const timings = {};
        let stepStart; // ✅ BUG FIX: Declare stepStart to avoid global implicit variable

        // ✅ Phase 2 (P1-U1): Record turn start
        const turnNumber = this.sessionTracker.recordTurn();

        // ✅ v2.0: Emit execution start
        this._emitVital('EXECUTION_START', {
            taskId: resolvedTaskId,
            textLength: text.length,
            correlationId: this.correlationId,
            turnNumber, // ✅ Phase 2: Include turn number
        });

        // ====================================================================
        // 0A. PRE-EXECUTION READINESS CHECK (Phase 1 - P0-U4)
        // ====================================================================
        stepStart = Date.now();

        // ✅ Phase 2 (P1-U2): Apply adaptive timeout
        const baseStabilityTimeout = 10000; // 10s base
        const adaptiveStabilityTimeout = this._calculateAdaptiveTimeout(baseStabilityTimeout);

        const readiness = /** @type {any} */ (
            await this.readinessGuard.validateReadiness({
                stabilityTimeout: adaptiveStabilityTimeout, // ✅ Phase 2: Adaptive timeout
                skipTriage: false,
                skipSession: true, // Phase 1: Session tracking not implemented yet
            })
        );

        timings.readinessCheck = Date.now() - stepStart;

        const checksObj =
            readiness && typeof readiness.checks === 'object' && readiness.checks !== null ? readiness.checks : {};
        const checksValues = Object.values(checksObj);
        const checksPass = checksValues.filter(Boolean).length;
        const checksFail = checksValues.length - checksPass;

        // ✅ Phase 1: Emit readiness check result
        this._emitVital('READINESS_CHECK', {
            ready: readiness.ready,
            checksPass,
            checksFail,
            issues: readiness.issues,
            duration: timings.readinessCheck,
        });

        // ✅ Phase 1: Abort if NOT ready
        if (!readiness.ready) {
            const fatalIssues = readiness.issues.filter((/** @type {any} */ i) => i.severity === 'FATAL');
            const error = /** @type {any} */ (
                new Error('READINESS_CHECK_FAILED: ' + fatalIssues.map((/** @type {any} */ i) => i.message).join('; '))
            );
            error.details = readiness;
            throw error;
        }

        // ====================================================================
        // 0B. VALIDAÇÃO DE PRÉ-REQUISITOS (Legacy validator)
        // ====================================================================
        stepStart = Date.now();

        const { validateLLMPage } = await import('#core/validators/prerequisite_validator');
        const pageValidation = await validateLLMPage(/** @type {any} */ (this.page));

        timings.prerequisite = Date.now() - stepStart;

        // ✅ v2.0: Emit prerequisite check (success or failure)
        this._emitVital('PREREQUISITE_CHECK', {
            valid: pageValidation.valid,
            reason: pageValidation.reason,
            duration: timings.prerequisite,
        });

        if (!pageValidation.valid) {
            const error = /** @type {any} */ (new Error(`PREREQUISITE_FAILED: ${pageValidation.reason}`));
            error.details = pageValidation.details;
            throw error;
        }

        // ====================================================================
        // 1. CHECK DE ABORTO PRECOCE
        // ====================================================================
        if (signal?.aborted) {
            this._emitVital('EXECUTION_ABORTED', { stage: 'pre-start', taskId: resolvedTaskId });
            throw new Error('OPERATION_ABORTED');
        }

        // ====================================================================
        // 2. AGUARDA OCIOSIDADE
        // ====================================================================
        stepStart = Date.now();
        await this.biomechanics.waitIfBusy(resolvedTaskId);
        timings.waitBusy = Date.now() - stepStart;

        // ✅ v2.0: Update domain with event emission
        this._updateDomain(true);
        this._emitVital('DOMAIN_UPDATED', { domain: this.currentDomain });

        let attempts = 0;
        const errorHistory = [];
        const { MAX_RETRY_ATTEMPTS, ERROR_MESSAGE_MAX_LENGTH } = BASEDRIVER_CONFIG;

        while (attempts < MAX_RETRY_ATTEMPTS) {
            try {
                // ================================================================
                // CHECK DE INTERRUPÇÃO ENTRE TENTATIVAS
                // ================================================================
                if (signal?.aborted) {
                    this._emitVital('EXECUTION_ABORTED', {
                        stage: 'retry-loop',
                        attempt: attempts,
                        taskId: resolvedTaskId,
                    });
                    throw new Error('OPERATION_ABORTED');
                }

                // ✅ v2.0: Emit retry attempt (if not first)
                if (attempts > 0) {
                    this._emitVital('RETRY_ATTEMPT', {
                        attempt: attempts,
                        maxAttempts: MAX_RETRY_ATTEMPTS,
                        errorHistory: errorHistory.length,
                    });
                }

                await this.handles.clearAll();
                this._assertPageAlive();

                // ================================================================
                // 3. RESOLUÇÃO DE INTERFACE (DNA V4 Gold)
                // ================================================================
                stepStart = Date.now();
                const proto = /** @type {any} */ (await this.inputResolver.resolve());
                timings.resolution = Date.now() - stepStart;

                // ✅ v2.0: Emit selector resolved
                this._emitVital('SELECTOR_RESOLVED', {
                    selector: proto.selector,
                    confidence: proto.confidence || 'unknown',
                    duration: timings.resolution,
                });

                // ✅ v2.0: Signal check after resolution
                if (signal?.aborted) {
                    this._emitVital('EXECUTION_ABORTED', { stage: 'post-resolution', taskId: resolvedTaskId });
                    throw new Error('OPERATION_ABORTED');
                }

                // ================================================================
                // 4. NAVEGAÇÃO DE CONTEXTO (IFrames/ShadowDOM)
                // ================================================================
                stepStart = Date.now();
                const execContext = /** @type {any} */ (await this.frameNavigator.getExecutionContext(proto));
                timings.navigation = Date.now() - stepStart;

                // ✅ v2.0: Emit context acquired
                this._emitVital('CONTEXT_ACQUIRED', {
                    depth: execContext.depth || 0,
                    type: execContext.type || 'main',
                    duration: timings.navigation,
                });

                // ✅ v2.0: Signal check after navigation
                if (signal?.aborted) {
                    this._emitVital('EXECUTION_ABORTED', { stage: 'post-navigation', taskId: resolvedTaskId });
                    throw new Error('OPERATION_ABORTED');
                }

                // ================================================================
                // 5. PREPARAÇÃO BIOMECÂNICA (Scroll + Click + Focus)
                // ================================================================
                stepStart = Date.now();
                await this.biomechanics.prepareElement(execContext, proto.selector);
                timings.preparation = Date.now() - stepStart;

                // ================================================================
                // 6. DIGITAÇÃO HUMANA (Com Human Jitter e Throttling)
                // ================================================================
                stepStart = Date.now();
                await this.biomechanics.clearInput(execContext.ctx, proto.selector);
                this.setState(TargetDriver.STATES.TYPING);

                // ✅ v2.0: Emit typing start
                this._emitVital('TYPING_START', {
                    textLength: text.length,
                    taskId: resolvedTaskId,
                });

                // ✅ v2.0: Propagate signal to biomechanics
                await this.biomechanics.typeText(execContext.ctx, proto.selector, text, /** @type {any} */ (signal));
                timings.typing = Date.now() - stepStart;

                // ✅ v2.0: Signal check after typing
                if (signal?.aborted) {
                    this._emitVital('EXECUTION_ABORTED', { stage: 'post-typing', taskId: resolvedTaskId });
                    throw new Error('OPERATION_ABORTED');
                }

                // ================================================================
                // 7. SUBMISSÃO ATÔMICA (Prevenção de duplicidade)
                // ================================================================
                stepStart = Date.now();
                await this.submission.submit(execContext.ctx, proto.selector, resolvedTaskId);
                timings.submission = Date.now() - stepStart;

                // ✅ v2.0: Emit submission success
                this._emitVital('SUBMISSION_SUCCESS', {
                    taskId: resolvedTaskId,
                    duration: timings.submission,
                });

                this.setState(TargetDriver.STATES.IDLE);

                // ================================================================
                // SUCCESS - EMIT METRICS
                // ================================================================
                const totalDuration = Date.now() - startTime;

                // ✅ Phase 2 (P1-U1): Record response time
                const { avgResponseTime, trend } = /** @type {any} */ (
                    this.sessionTracker.recordResponseTime(totalDuration, true)
                );

                // ✅ Phase 2 (P1-U3): Emit session metrics
                const sessionMetrics = /** @type {any} */ (this.sessionTracker.getMetrics());
                this._emitVital('SESSION_METRICS_UPDATE', {
                    turnNumber,
                    turnCount: sessionMetrics.turnCount,
                    avgResponseTime,
                    trend,
                    sessionHealth: sessionMetrics.sessionHealth,
                    healthLevel: sessionMetrics.healthLevel,
                    timeoutMultiplier: sessionMetrics.timeoutMultiplier,
                });

                this._emitVital('EXECUTION_SUCCESS', {
                    taskId: resolvedTaskId,
                    attempts: attempts + 1,
                    totalDuration,
                    timings: {
                        prerequisite: timings.prerequisite,
                        readinessCheck: timings.readinessCheck,
                        waitBusy: timings.waitBusy,
                        resolution: timings.resolution,
                        navigation: timings.navigation,
                        preparation: timings.preparation,
                        typing: timings.typing,
                        submission: timings.submission,
                    },
                    // ✅ Phase 2: Include session context
                    sessionContext: {
                        turnNumber,
                        avgResponseTime,
                        trend,
                        timeoutMultiplier: sessionMetrics.timeoutMultiplier,
                    },
                });

                return;
            } catch (/** @type {any} */ err) {
                // ================================================================
                // ERROR HANDLING v2.0
                // ================================================================

                // ✅ v2.0: Classify error
                const errorClass = this._classifyError(err);

                // Fatal errors - abort immediately
                if (errorClass === ERROR_CLASSES.ABORT || errorClass === ERROR_CLASSES.FATAL) {
                    throw err;
                }

                // ✅ v2.0: Emit triage alert with classification
                this._emitVital('TRIAGE_ALERT', {
                    type: 'EXECUTION_RETRY',
                    severity: errorClass === ERROR_CLASSES.TIMEOUT ? 'HIGH' : 'MEDIUM',
                    errorClass,
                    evidence: {
                        attempt: attempts,
                        error: err.message,
                        stack: err.stack?.substring(0, 300),
                    },
                });

                errorHistory.push({
                    attempt: attempts,
                    error: err.message.substring(0, ERROR_MESSAGE_MAX_LENGTH),
                    errorClass,
                    ts: Date.now(),
                });

                // ✅ v2.0: Removed dead code (errorHistory.length never > MAX_RETRY_ATTEMPTS)

                // ================================================================
                // 9. RECUPERAÇÃO ESCALONADA (Tiers 0-3)
                // ================================================================
                await this.recovery.applyTier(err, attempts, resolvedTaskId);

                // ✅ v2.0: Apply backoff before next attempt
                if (attempts < MAX_RETRY_ATTEMPTS - 1) {
                    await this._applyBackoff(attempts);
                }

                attempts++;
            } finally {
                await this.handles.clearAll();
                await this.biomechanics.releaseModifiers();
            }
        }

        // ====================================================================
        // FINAL FAILURE - MAX RETRIES EXCEEDED
        // ====================================================================
        const totalDuration = Date.now() - startTime;

        // ✅ Phase 2 (P1-U1): Record failed response time
        this.sessionTracker.recordResponseTime(totalDuration, false);

        const finalErr = /** @type {any} */ (new Error('EXECUTION_FAIL'));
        finalErr.history = errorHistory;
        finalErr.attempts = attempts;

        this._emitVital('EXECUTION_FAILED', {
            taskId: resolvedTaskId,
            attempts,
            errorHistory,
            totalDuration,
            // ✅ Phase 2: Include session context
            sessionContext: {
                turnNumber,
                turnCount: this.sessionTracker.turnCount,
                avgResponseTime: /** @type {any} */ (this.sessionTracker.getMetrics()).avgResponseTime,
            },
        });

        throw finalErr;
    }

    /**
     * Cleanup profundo da instância e invalidação de caches de subsistemas.
     * ✅ v2.0: Cleanup garantido com error collection e logging
     *
     * @returns {Promise<void>}
     */
    async destroy() {
        const cleanupErrors = [];

        // ✅ v2.0: Structured cleanup steps
        const cleanupSteps = [
            { name: 'handles', fn: async () => await this.handles.clearAll() },
            { name: 'biomechanics', fn: async () => await this.biomechanics.releaseModifiers() },
            { name: 'inputResolver', fn: () => this.inputResolver.clearCache() },
            { name: 'submission', fn: () => this.submission.clearLock() },
        ];

        for (const step of cleanupSteps) {
            try {
                await step.fn();
            } catch (/** @type {any} */ err) {
                const errorInfo = {
                    module: step.name,
                    error: err.message,
                };
                cleanupErrors.push(errorInfo);

                // ✅ v2.0: Log cleanup warnings (not silent)
                log('WARN', `[${this.name}] Cleanup ${step.name} failed: ${err.message}`, this.correlationId);
            }
        }

        // ✅ v2.0: Emit cleanup warnings if any errors occurred
        if (cleanupErrors.length > 0) {
            this._emitVital('CLEANUP_WARNINGS', {
                errors: cleanupErrors,
                totalErrors: cleanupErrors.length,
            });
        }

        this.removeAllListeners();

        log(
            'DEBUG',
            `[${this.name}] Ciclo de Driver encerrado. Recursos liberados. Erros: ${cleanupErrors.length}`,
            this.correlationId
        );
    }
}

export default BaseDriver;

/**
 * Configuração padrão do BaseDriver
 *
 * **Side-effects:** N/A
 * **Semântica:** Configurações de retry, timeouts e limites para operação do driver base.
 * **Unidades:** Milissegundos para timeouts, números inteiros para contadores.
 *
 * @type {Object<string, any>}
 */
export { BASEDRIVER_CONFIG };

/**
 * Classes de erro para classificação de falhas
 *
 * **Side-effects:** N/A
 * **Semântica:** Enumeração de tipos de erro para estratégia de recuperação adequada.
 * **Unidades:** N/A
 *
 * @type {Object<string, string>}
 */
export { ERROR_CLASSES };
