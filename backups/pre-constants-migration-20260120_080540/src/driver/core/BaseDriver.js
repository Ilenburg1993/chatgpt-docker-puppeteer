/* ==========================================================================
   src/driver/core/BaseDriver.js
   Audit Level: 700 — Sovereign Modular Orchestrator (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Coordenar subsistemas de execução física e emitir telemetria
                     sensorial de alta fidelidade via barramento de eventos.
   Sincronizado com: ExecutionEngine V1.6.0, DriverLifecycleManager V70,
                     TelemetryBridge V500, InputResolver V700.
========================================================================== */

const TargetDriver = require('./TargetDriver');
const { log } = require('../../core/logger');

// Subsistemas Modulares (Músculos e Sentidos Físicos)
const RecoverySystem = require('../modules/recovery_system');
const HandleManager = require('../modules/handle_manager');
const InputResolver = require('../modules/input_resolver');
const FrameNavigator = require('../modules/frame_navigator');
const BiomechanicsEngine = require('../modules/biomechanics_engine');
const SubmissionController = require('../modules/submission_controller');

class BaseDriver extends TargetDriver {
    /**
     * @param {object} page - Instância ativa do Puppeteer.
     * @param {object} config - Configuração da tarefa (clonada).
     * @param {AbortSignal} signal - Sinal soberano de interrupção.
     */
    constructor(page, config, signal) {
        super(page, config, signal);
        this.name = 'BaseUniversalDriver';
        this.currentDomain = this._updateDomain();
        this.correlationId = null; // O Fio de Ariadne

        // [V700] Instanciação da Malha Modular de Execução
        this.recovery = new RecoverySystem(this);
        this.handles = new HandleManager(this);
        this.inputResolver = new InputResolver(this);
        this.frameNavigator = new FrameNavigator(this);
        this.biomechanics = new BiomechanicsEngine(this);
        this.submission = new SubmissionController(this);
    }

    /**
     * Injeta o rastro de causalidade para todos os sinais emitidos por este driver.
     * @param {string} id - UUID de correlação da transação.
     */
    setCorrelationId(id) {
        this.correlationId = id;
        // Propaga o ID para o resolvedor de input (vital para logs de DNA)
        if (this.inputResolver) {
            this.inputResolver.driver = this;
        }
        log('DEBUG', `[DRIVER] Contexto de rastro sincronizado: ${id}`, id);
    }

    /* ======================================================================
     SISTEMA DE SINAIS VITAIS (TELEMETRIA DESACOPLADA)
  ====================================================================== */

    /**
     * Emite um sinal vital capturado pela TelemetryBridge.
     * Mantém o Driver agnóstico ao transporte (IPC/Socket).
     *
     * @param {string} type - Categoria (SADI_PERCEPTION, HUMAN_PULSE, etc).
     * @param {object} payload - Dados técnicos da ação/percepção.
     */
    _emitVital(type, payload) {
        this.emit('driver:vital', {
            type,
            payload,
            correlationId: this.correlationId,
            ts: Date.now()
        });
    }

    /* ======================================================================
     UTILITÁRIOS DE INFRAESTRUTURA
  ====================================================================== */

    _assertPageAlive() {
        if (!this.page || this.page.isClosed()) {
            throw new Error('TARGET_CLOSED');
        }
    }

    _updateDomain() {
        try {
            const url = this.page.url();
            if (!url || url === 'about:blank' || !url.startsWith('http')) {
                return 'initialization';
            }
            return new URL(url).hostname.replace(/^www\./, '');
        } catch (e) {
            return 'unknown_context';
        }
    }

    /* ======================================================================
     API PÚBLICA (EXECUÇÃO INSTRUMENTADA)
  ====================================================================== */

    /**
     * Executa o envio do prompt com narração sensorial em tempo real.
     * Segue o fluxo: Estabilização -> Percepção -> Navegação -> Biomecânica -> Envio.
     */
    async sendPrompt(text, taskId, signal) {
        // 1. Check de Aborto Precoce (Nível Kernel)
        if (signal?.aborted) {
            throw new Error('OPERATION_ABORTED');
        }

        // 2. Aguarda Ociosidade (Telemetria integrada no Biomechanics)
        await this.biomechanics.waitIfBusy(taskId);

        let attempts = 0;
        const errorHistory = [];

        while (attempts < 4) {
            try {
                // Check de interrupção entre tentativas
                if (signal?.aborted) {
                    throw new Error('OPERATION_ABORTED');
                }

                await this.handles.clearAll();
                this._assertPageAlive();

                if (attempts > 0) {
                    await this.page.bringToFront().catch(() => {});
                }

                // 3. RESOLUÇÃO DE INTERFACE (Governada por DNA V4 Gold)
                // O InputResolver V700 emite SADI_PERCEPTION internamente
                const proto = await this.inputResolver.resolve();

                // 4. NAVEGAÇÃO DE CONTEXTO (IFrames/ShadowDOM)
                // O FrameNavigator V500 emite PROGRESS_UPDATE por nível de profundidade
                const execContext = await this.frameNavigator.getExecutionContext(proto);

                // 5. PREPARAÇÃO BIOMECÂNICA (Scroll + Click + Focus)
                await this.biomechanics.prepareElement(execContext, proto.selector);

                // 6. DIGITAÇÃO HUMANA (Com Human Jitter e Throttling)
                await this.biomechanics.clearInput(execContext.ctx, proto.selector);
                this.setState(TargetDriver.STATES.TYPING);

                // Emite HUMAN_PULSE via ganchos do BiomechanicsEngine
                await this.biomechanics.typeText(execContext.ctx, proto.selector, text, signal);

                // 7. SUBMISSÃO ATÔMICA (Prevenção de duplicidade)
                await this.submission.submit(execContext.ctx, proto.selector, taskId);

                this.setState(TargetDriver.STATES.IDLE);
                return;
            } catch (err) {
                if (err.message === 'OPERATION_ABORTED') {
                    throw err;
                }

                // 8. DIAGNÓSTICO DE FALHA (Instrumentação de Triage)
                this._emitVital('TRIAGE_ALERT', {
                    type: 'EXECUTION_RETRY',
                    severity: 'MEDIUM',
                    evidence: { attempt: attempts, error: err.message }
                });

                errorHistory.push({
                    attempt: attempts,
                    error: err.message.substring(0, 200),
                    ts: Date.now()
                });

                if (errorHistory.length > 10) {
                    errorHistory.shift();
                }

                // 9. RECUPERAÇÃO ESCALONADA (Tiers 0-3)
                await this.recovery.applyTier(err, attempts, taskId);
                attempts++;
            } finally {
                await this.handles.clearAll();
                await this.biomechanics.releaseModifiers();
            }
        }

        const finalErr = new Error('EXECUTION_FAIL');
        finalErr.history = errorHistory;
        throw finalErr;
    }

    /**
     * Cleanup profundo da instância e invalidação de caches de subsistemas.
     */
    async destroy() {
        try {
            await this.handles.clearAll();
        } catch (_e) {
            /* Ignore cleanup errors */
        }
        try {
            await this.biomechanics.releaseModifiers();
        } catch (_e) {
            /* Ignore release errors */
        }

        // Invalidação de estados de subsistemas
        this.inputResolver.clearCache();
        this.submission.clearLock();

        this.removeAllListeners();
        log('DEBUG', `[${this.name}] Ciclo de Driver encerrado. Recursos liberados.`, this.correlationId);
    }
}

module.exports = BaseDriver;
