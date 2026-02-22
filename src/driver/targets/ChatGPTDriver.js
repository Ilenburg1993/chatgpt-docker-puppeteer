// @ts-check - Type checking rigoroso habilitado (arquivo core)
import BaseDriver from '#driver/core/BaseDriver';
import { STATUS_VALUES } from '#core/constants/tasks';
import { DRIVER_NAMES } from '#core/constants';
import * as triage from '../modules/triage.js';
import * as adaptive from '#logic/adaptive';
import * as analyzer from '#shared/sadi/analyzer';
import * as stabilizer from '#shared/page_stability/stabilizer';
import { log } from '#core/logger';
import StructuredExtractor from '../extractors/structured_extractor.js';
import LLMJudge from '#validation/llm_judge';

/**
 * Protocolo retornado pelo SADI (shape permissivo usado neste driver).
 * `framePath` pode vir como array de segmentos.
 * @typedef {{ selector: string, context?: string, framePath?: string | string[] }} AnalyzerProtocol
 */

/**
 * Protocolo mínimo aceito pelo FrameNavigator.
 * @typedef {{ context: string, framePath: string }} FrameNavProtocol
 */

/**
 * Resposta mínima de navegação usada neste driver.
 * @typedef {{ ok(): boolean, status(): number }} HttpResponseLike
 */

/**
 * Normaliza protocolo do SADI para o contrato esperado pelo FrameNavigator.
 *
 * @param {AnalyzerProtocol | null | undefined} protocol
 * @returns {FrameNavProtocol}
 */
function toFrameNavProtocol(protocol) {
    const rawFramePath = protocol?.framePath;
    const framePath = Array.isArray(rawFramePath)
        ? rawFramePath.filter(Boolean).join(' > ')
        : typeof rawFramePath === 'string'
          ? rawFramePath
          : '';

    const context = typeof protocol?.context === 'string' && protocol.context.length > 0
        ? protocol.context
        : 'root';

    return { context, framePath };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * ✅ v2.0: CHATGPT_CONFIG - Zero magic numbers
 */
const CHATGPT_CONFIG = Object.freeze({
    // Perception Loop
    STABLE_CYCLES_TARGET: 3,
    PERCEPTION_INTERVAL_MS: 800,
    MIN_RESPONSE_LENGTH: 10,

    // Timeouts
    MAX_WAIT_TIME_MS: 600000,        // 10min (previne hang)
    STALL_WARNING_MS: 30000,         // 30s
    NAVIGATION_TIMEOUT_MS: 30000,    // 30s
    CONTINUATION_DELAY_MS: 2000,     // 2s

    // Model Switching
    DEFAULT_MODEL_ID: 'gpt-5.2',

    // Retry
    STOP_GENERATION_MAX_RETRIES: 3,
    STOP_GENERATION_RETRY_DELAY_MS: 1000
});

/**
 * ✅ v2.0: SUPPORTED_MODELS - Validação de modelo
 * Sistema universal de LLMs - Modelos iniciais: GPT-5.2 (padrão) e GPT-5-mini
 * Outros LLMs podem ser adicionados conforme necessário
 */
const SUPPORTED_MODELS = Object.freeze([
    'gpt-5.2',
    'gpt-5-mini',
    'gpt-5',
    // Outros LLMs serão adicionados aqui (Gemini, Claude, etc.)
]);

// ============================================================================
// CHATGPT DRIVER
// ============================================================================

class ChatGPTDriver extends BaseDriver {
    /**
     * ChatGPT Driver - Especialista em interface OpenAI.
     * Implementa percepção incremental, thought pruning (o1/o3), auto-continuation.
     *
     * ✅ v3.0: BREAKING CHANGE - Constructor recebe APENAS config
     * - page e signal são null inicialmente (herdados via BaseDriver → TargetDriver)
     * - Use attachContext(page, signal) antes de executar
     *
     * ✅ v2.0: sendPrompt implementation, AbortSignal integration, timeout protection
     *
     * @param {object} config - Task configuration
     * @param {string} config.target - Must be 'chatgpt'
     * @param {string} [config.DEFAULT_MODEL_ID] - Default model (default: gpt-5.2)
     * @param {number} [config.STABLE_CYCLES] - Stable cycles target (default: 3)
     * @param {boolean} [config.LLM_JUDGE_ENABLED] - Ativa validação LLM-as-Judge.
     * @param {string} [config.LLM_JUDGE_MODEL] - Modelo para validação.
     * @param {number} [config.LLM_JUDGE_TIMEOUT] - Timeout da validação em ms.
     */
    constructor(config) {
        super(config);

        this.name = DRIVER_NAMES.CHATGPT;
        this.currentDomain = 'chatgpt.com';

        // ✅ v2.0: Use CHATGPT_CONFIG
        this.stableCyclesTarget = config.STABLE_CYCLES || CHATGPT_CONFIG.STABLE_CYCLES_TARGET;
        this.defaultModel = config.DEFAULT_MODEL_ID || CHATGPT_CONFIG.DEFAULT_MODEL_ID;

        // ✅ Response Capture V2.0: Inicializar extractors
        this.structuredExtractor = new StructuredExtractor();
        this.llmJudge = new LLMJudge({
            enabled: config.LLM_JUDGE_ENABLED !== false, // Habilitado por padrão
            driver: null, // Será configurado após attachContext
            model: config.LLM_JUDGE_MODEL || 'gpt-5-mini', // GPT-5-mini para validação (mais rápido)
            timeout: config.LLM_JUDGE_TIMEOUT || 15000,
        });

        // Telemetria de execução (Response V2)
        this.executionStartTime = null;
        this.continuationCount = 0;
        this.thoughtBlocksPruned = 0;

        // ✅ v2.0: Declarar capabilities (TargetDriver v2.0 validation)
        this.updateCapabilities({
            text_generation: true,
            image_generation: true, // DALL-E integration
            file_upload: true, // Attachments
            context_reset: true, // Model switching
            streaming_events: true, // Incremental perception
            vision: true, // Vision capabilities (GPT-5.2)
            tools: true, // Function calling
            code_interpreter: true, // Data analysis
            web_browsing: false, // Não suportado nativamente
            dalle: true, // DALL-E integration
            function_calling: true, // Advanced function calling
        });
    }

    // ========================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS
    // ========================================================================

    /**
     * Executa 1 prompt → 1 resposta (contrato do TargetDriver).
     *
     * @param {string} prompt
     * @returns {Promise<any>}
     * @override
     */
    async execute(prompt) {
        if (!this.isContextAttached()) {
            throw new Error('CONTEXT_NOT_ATTACHED');
        }

        const text = typeof prompt === 'string' ? prompt : String(prompt ?? '');
        if (!text.trim()) {
            throw new Error('PROMPT_EMPTY');
        }

        // Preflight: valida página/interface e falha com reason codes úteis para o SSOT.
        await this.validatePage();

        if (this.signal?.aborted) {
            throw new Error('OPERATION_ABORTED');
        }

        const startSnapshot = await this.captureState();
        await this.prepareContext({ model: this.config?.model, config: this.config });
        await this.sendPrompt(text, { humanTyping: true });
        const result = await this.waitForCompletion(startSnapshot, this.signal);

        this.setState(STATUS_VALUES.IDLE);
        return result;
    }

    /**
     * Valida se a página está em estado utilizável.
     * Verifica URL válida + Interface LLM carregada.
     *
     * @returns {Promise<boolean>} true se página válida
     * @override
     */
    async validatePage() {
        const { validateLLMPage, validateLLMInterface } = await import('#core/validators/prerequisite_validator');

        // Valida URL
        const pageValidation = await validateLLMPage(this.page);
        if (!pageValidation.valid) {
            const err = new Error(`PREREQUISITE_FAILED: ${pageValidation.reason}`);
            err.details = pageValidation.details;
            throw err;
        }

        // Valida interface carregada
        const interfaceValidation = await validateLLMInterface(/** @type {import('puppeteer-core').Page} */ (this.page));
        if (!interfaceValidation.valid) {
            const err = new Error(`PREREQUISITE_FAILED: ${interfaceValidation.reason}`);
            err.details = interfaceValidation.details;
            throw err;
        }

        return true;
    }

    /**
     * Captura o estado atual da conversa (contagem de mensagens do assistente).
     *
     * @returns {Promise<number>} Número de mensagens do assistente detectadas
     * @override
     */
    async captureState() {
        try {
            return await this.page.evaluate(() => {
                const msgs = document.querySelectorAll(
                    'div[data-message-author-role="assistant"], article[data-testid*="conversation-turn"]'
                );
                return msgs.length;
            });
        } catch (err) {
            // ✅ BUG #3: Error handling robusto
            log('WARN', `[${this.name}] captureState failed: ${err.message}`, this.correlationId);

            this.emit('warning', {
                context: 'captureState',
                error: err.message,
                fallback: 0,
            });

            return 0; // Fallback seguro
        }
    }

    /**
     * Prepara o ambiente para execução da tarefa.
     * Realiza troca de modelo ou reset de contexto se necessário.
     *
     * ✅ v2.0: Validação de modelo + validação de navegação
     *
     * @param {object} taskSpec - Especificação da tarefa
     * @param {string} [taskSpec.model] - ID do modelo (ex: 'gpt-5.2', 'gpt-5-mini')
     * @param {object} [taskSpec.config] - Configurações adicionais
     * @param {boolean} [taskSpec.config.reset_context] - Forçar reset de contexto
     * @param {boolean} [taskSpec.config.require_history] - Manter histórico de conversa
     * @returns {Promise<void>}
     * @throws {Error} Se modelo não suportado ou navegação falhar
     * @override
     */
    async prepareContext(taskSpec) {
        this.setState('PREPARING');

        const modelId = taskSpec?.model || this.defaultModel;

        // ✅ MELHORIA #9: Validar modelo suportado
        if (!SUPPORTED_MODELS.includes(modelId)) {
            const error = `Unsupported model: ${modelId}. Valid models: ${SUPPORTED_MODELS.join(', ')}`;
            log('ERROR', `[${this.name}] ${error}`, this.correlationId);
            throw new Error(error);
        }

        this._emitVital('PROGRESS_UPDATE', {
            step: 'MODEL_SYNCHRONIZATION',
            model: modelId,
        });

        const targetUrl = `https://chatgpt.com/?model=${modelId}`;
        const currentUrl = this.page.url();
        const isConversation = currentUrl.includes('/c/');
        const wrongModel = !currentUrl.includes(modelId) && !currentUrl.includes(`model=${modelId}`);
        const forceReset = taskSpec?.config?.reset_context;

        if (forceReset || wrongModel || (isConversation && !taskSpec.config?.require_history)) {
            log('INFO', `[${this.name}] Ajustando modelo para: ${modelId}`, this.correlationId);

            try {
                // ✅ BUG #4: Validar navegação
                const response = /** @type {HttpResponseLike | null} */ (await this.page.goto(targetUrl, {
                    waitUntil: 'networkidle2',
                    timeout: CHATGPT_CONFIG.NAVIGATION_TIMEOUT_MS,
                }));

                if (!response || !response.ok()) {
                    throw new Error(`Navigation failed: HTTP ${response ? response.status() : 'NO_RESPONSE'}`);
                }

                // Aguardar estabilidade da página
                const isStable = await stabilizer.waitForStability(this);
                if (!isStable) {
                    throw new Error('Page not stable after navigation');
                }
            } catch (err) {
                log('ERROR', `[${this.name}] prepareContext navigation failed: ${err.message}`, this.correlationId);
                throw err; // Propaga para BaseDriver.executeTask
            }
        }

        this.setState(STATUS_VALUES.IDLE);
    }

    /**
     * Envia prompt para o ChatGPT via textarea.
     * Utiliza biomechanics para typing humanizado e SADI para detecção de elementos.
     *
     * ✅ v2.0: Implementação do método abstrato (TargetDriver requirement)
     *
     * @param {string} prompt - Texto do prompt a enviar
     * @param {object} [options={}] - Opções adicionais
     * @param {boolean} [options.humanTyping=true] - Usar typing humanizado
     * @param {number} [options.delay=0] - Delay antes de enviar (ms)
     * @returns {Promise<void>}
     * @throws {Error} Se textarea ou botão send não encontrado
     * @override
     */
    async sendPrompt(prompt, options = {}) {
        this.setState('TYPING');

        // ✅ Response Capture V2.0: Guardar prompt atual para LLM-as-Judge
        this.currentPrompt = prompt;
        this.executionStartTime = new Date().toISOString();
        this.continuationCount = 0;
        this.thoughtBlocksPruned = 0;

        const { humanTyping = true, delay = 0 } = /** @type {{ humanTyping?: boolean, delay?: number }} */ (options || {});

        this._emitVital('PROGRESS_UPDATE', {
            step: 'SENDING_PROMPT',
            promptLength: prompt.length,
            humanTyping,
        });

        // 1. Encontrar textarea via SADI
        const inputProtocol = await analyzer.findChatInputSelector(this.page);
        if (!inputProtocol || !inputProtocol.protocol) {
            throw new Error('Textarea not found');
        }

        const { ctx } = await this.frameNavigator.getExecutionContext(
            toFrameNavProtocol(/** @type {AnalyzerProtocol} */ (/** @type {unknown} */ (inputProtocol.protocol))),
            this.signal
        );

        // 2. Limpar textarea
        await ctx.evaluate(proto => {
            const textarea = document.querySelector(proto.selector);
            if (textarea) {
                textarea.value = '';
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, inputProtocol.protocol);

        // 3. Digitar prompt
        if (humanTyping) {
            await this.biomechanics.typeText(ctx, inputProtocol.protocol.selector, prompt, this.signal);
        } else {
            await ctx.type(inputProtocol.protocol.selector, prompt);
        }

        // 4. Delay opcional
        if (delay > 0) {
            await new Promise(r => setTimeout(r, delay));
        }

        // 5. Encontrar e clicar botão send
        const sendProtocol = await analyzer.findSendButtonSelector(this.page, inputProtocol.protocol);
        if (!sendProtocol || !sendProtocol.protocol) {
            throw new Error('Send button not found');
        }

        const { ctx: sendCtx, offsetX, offsetY } = await this.frameNavigator.getExecutionContext(
            toFrameNavProtocol(/** @type {AnalyzerProtocol} */ (/** @type {unknown} */ (sendProtocol.protocol))),
            this.signal
        );
        const rect = await this.biomechanics.getStableRect(sendCtx, sendProtocol.protocol.selector);

        if (!rect) {
            throw new Error('Send button rect not stable');
        }

        await this.page.mouse.click(offsetX + rect.x + rect.w / 2, offsetY + rect.y + rect.h / 2);

        this._emitVital('PROGRESS_UPDATE', { step: 'PROMPT_SENT' });

        log('INFO', `[${this.name}] Prompt enviado (${prompt.length} chars)`, this.correlationId);
    }

    /**
     * Aguarda a conclusão da geração com percepção incremental.
     * Implementa loop de polling com detecção de:
     * - Text growth (streaming detection)
     * - Stall detection via watchdog
     * - Auto-continuation (botões "Continue generating")
     * - Thought pruning (o1/o3 models)
     *
     * ✅ v2.0: AbortSignal integration, timeout máximo, telemetria expandida, empty response detection
     *
     * @param {number} startSnapshot - Estado inicial (message count)
     * @param {AbortSignal} [signal] - Sinal de cancelamento externo
     * @returns {Promise<any>} Resposta completa com metadados de captura
     * @throws {Error} OPERATION_ABORTED, STALL_DETECTED, LIMIT_REACHED, EMPTY_RESPONSE, etc
     * @override
     */
    async waitForCompletion(startSnapshot, signal) {
        // ✅ BUG #5: Timeout máximo (previne hang)
        const MAX_WAIT_TIME_MS = CHATGPT_CONFIG.MAX_WAIT_TIME_MS;
        const startTime = Date.now();

        let lastText = '';
        let stableCycles = 0;
        let continuationCount = 0; // ✅ MELHORIA #6: Auto-continue counter
        let loopIteration = 0; // ✅ MELHORIA #1: Telemetria de ciclo

        this.setState('WAITING');

        // Watchdog de Mutação (Browser-Side) para detecção de Stall
        await this.page.evaluate(() => {
            if (window.__wd_obs) {
                window.__wd_obs.disconnect();
            }
            window.__wd_last_change = Date.now();
            window.__wd_obs = new MutationObserver(() => (window.__wd_last_change = Date.now()));
            window.__wd_obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        });

        while (true) {
            loopIteration++;

            try {
                // ✅ BUG #2: Integrar AbortSignal corretamente (TargetDriver + método)
                const effectiveSignal = signal || this.signal;
                if (effectiveSignal?.aborted || this.signal?.aborted) {
                    throw new Error('OPERATION_ABORTED');
                }

                // ✅ BUG #5: Timeout máximo
                const elapsed = Date.now() - startTime;
                if (elapsed > MAX_WAIT_TIME_MS) {
                    log(
                        'ERROR',
                        `[${this.name}] waitForCompletion timeout (${MAX_WAIT_TIME_MS}ms)`,
                        this.correlationId
                    );
                    throw new Error(`WAIT_TIMEOUT: Elapsed ${elapsed}ms`);
                }

                this._assertPageAlive();

                // 1. Diagnóstico de Bloqueios (Triage)
                const lang = await this.page.evaluate(() => document.documentElement.lang || 'pt');
                const diagnosis = await triage.diagnoseStall(this.page, lang);

                if (['LIMIT_REACHED', 'CAPTCHA_CHALLENGE', 'LOGIN_REQUIRED'].includes(diagnosis.type)) {
                    this._emitVital('TRIAGE_ALERT', diagnosis);
                    throw new Error(diagnosis.type);
                }

                // 2. Extração via SADI V19
                const responseArea = await analyzer.findResponseArea(this.page);
                let currentText = '';

                if (responseArea && responseArea.protocol) {
                    const { ctx } = await this.frameNavigator.getExecutionContext(
                        toFrameNavProtocol(/** @type {AnalyzerProtocol} */ (/** @type {unknown} */ (responseArea.protocol))),
                        this.signal
                    );

                    // Extração com Poda de Pensamento (NASA Standard Pruning)
                    const extractionResult = await ctx.evaluate(proto => {
                        const msgs = Array.from(document.querySelectorAll(proto.selector));
                        const targetMsg = msgs[msgs.length - 1];
                        if (!targetMsg) {
                            return { text: '', pruned: 0, textLengthBefore: 0 };
                        }

                        const textLengthBefore = targetMsg.innerText.length;
                        const clone = targetMsg.cloneNode(true);

                        // ✅ MELHORIA #12: Remove elementos de raciocínio interno (o1/o3) e metadados de UI
                        const thoughts = clone.querySelectorAll(
                            // o1/o3 reasoning blocks
                            '[data-testid*="thought"]', // Oficial: <div data-testid="thought-block-123">
                            '.thought-block', // Classe CSS genérica
                            '[class*="thought"]', // Qualquer classe com "thought"
                            '[data-message-role="thought"]', // Role attribute

                            // UI metadata
                            'details', // Collapsible sections (thinking process)
                            '.sr-only' // Screen reader only elements
                        );
                        const count = thoughts.length;
                        thoughts.forEach(t => t.remove());

                        return {
                            text: clone.innerText.trim(),
                            pruned: count,
                            textLengthBefore,
                        };
                    }, responseArea.protocol);

                    currentText = extractionResult.text || '';

                    // ✅ MELHORIA #5: Thought pruning metrics expandidas
                    if (extractionResult.pruned > 0) {
                        // ✅ Response Capture V2.0: Acumular total de thought blocks removidos
                        this.thoughtBlocksPruned += extractionResult.pruned;

                        const textLengthAfter = currentText.length;
                        const ratio =
                            extractionResult.textLengthBefore > 0
                                ? ((textLengthAfter / extractionResult.textLengthBefore) * 100).toFixed(2)
                                : 0;

                        this._emitVital('THOUGHT_PRUNING', {
                            count: extractionResult.pruned,
                            textLengthBefore: extractionResult.textLengthBefore,
                            textLengthAfter,
                            retentionRatio: ratio,
                            model: this.defaultModel,
                            selector: responseArea.protocol.selector,
                        });

                        log(
                            'DEBUG',
                            `[${this.name}] Pruned ${extractionResult.pruned} thought blocks (${ratio}% text retained)`,
                            this.correlationId
                        );
                    }
                }

                // 3. Telemetria de Progresso
                const textDelta = currentText.length - lastText.length;

                // ✅ MELHORIA #1: Telemetria de percepção incremental
                this._emitVital('PERCEPTION_CYCLE', {
                    cycle: loopIteration,
                    textLength: currentText.length,
                    delta: textDelta,
                    stableCycles,
                    elapsedMs: Date.now() - startTime,
                    isBusy: responseArea?.isBusy || false,
                });

                if (textDelta > 0) {
                    this._emitVital('TEXT_DELTA', {
                        length: currentText.length,
                        delta: textDelta,
                        status: 'STREAMING',
                    });
                    stableCycles = 0;
                    lastText = currentText;
                } else if (currentText.length > 0 && currentText === lastText) {
                    stableCycles++;
                }

                // 4. Auto-Continuação
                const didContinue = await this.page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const btn = buttons.find(b => {
                        const txt = (b.innerText || '').toLowerCase();
                        return b.offsetParent !== null && (txt.includes('continue') || txt.includes('regenerate'));
                    });
                    if (btn) {
                        btn.click();
                        return true;
                    }
                    return false;
                });

                if (didContinue) {
                    continuationCount++; // ✅ MELHORIA #6: Incrementa counter

                    this._emitVital('AUTO_CONTINUATION', {
                        count: continuationCount,
                        textLengthCurrent: currentText.length,
                        elapsedMs: Date.now() - startTime,
                    });

                    log(
                        'INFO',
                        `[${this.name}] Acionando botão de continuação (${continuationCount}x).`,
                        this.correlationId
                    );

                    await new Promise(r => {
                        setTimeout(r, CHATGPT_CONFIG.CONTINUATION_DELAY_MS);
                    });
                    stableCycles = 0;
                    continue;
                }

                // 5. Critério de Conclusão
                if (stableCycles >= this.stableCyclesTarget && currentText.length > 0) {
                    // ✅ MELHORIA #10: Empty response detection
                    if (currentText.trim().length === 0) {
                        log(
                            'WARN',
                            `[${this.name}] Empty response after ${stableCycles} stable cycles`,
                            this.correlationId
                        );
                        throw new Error('EMPTY_RESPONSE');
                    }

                    const MIN_RESPONSE_LENGTH = CHATGPT_CONFIG.MIN_RESPONSE_LENGTH;
                    if (currentText.length < MIN_RESPONSE_LENGTH) {
                        log(
                            'WARN',
                            `[${this.name}] Response too short (${currentText.length} chars, min ${MIN_RESPONSE_LENGTH})`,
                            this.correlationId
                        );
                        throw new Error('RESPONSE_TOO_SHORT');
                    }

                    this._emitVital('GENERATION_COMPLETE', {
                        textLength: currentText.length,
                        stableCycles,
                        continuations: continuationCount,
                        elapsedMs: Date.now() - startTime,
                    });

                    // ✅ Response Capture V2.0: Extração estruturada
                    const extractedContent = await this.structuredExtractor.extract(this.page, responseArea.protocol);

                    // ✅ Response Capture V2.0: Telemetria de geração
                    const generation = {
                        model: this.defaultModel,
                        started_at: this.executionStartTime || new Date(startTime).toISOString(),
                        completed_at: new Date().toISOString(),
                        duration_ms: Date.now() - startTime,
                        tokens_estimate: this._estimateTokens(currentText),
                        continuations: continuationCount,
                        thought_blocks_pruned: this.thoughtBlocksPruned,
                        retry_attempts: 0, // Será preenchido pelo Kernel
                    };

                    // ✅ Response Capture V2.0: Validação LLM-as-Judge (opcional)
                    let validation = null;
                    if (this.llmJudge.enabled && this.currentPrompt) {
                        try {
                            validation = await this.llmJudge.validate(this.currentPrompt, currentText, signal);
                        } catch (_err) {
                            log(
                                'WARN',
                                `[${this.name}] LLM-as-Judge falhou, continuando sem validação`,
                                this.correlationId
                            );
                        }
                    }

                    // ✅ Response Capture V2.0: Response V2 completa
                    const responseV2 = {
                        content: extractedContent,
                        generation,
                        validation,
                        preview: extractedContent.preview,
                    };

                    this.setState(STATUS_VALUES.IDLE);
                    return responseV2;
                }

                // 6. Stall Adaptativo
                const lastChange = await this.page.evaluate(() => window.__wd_last_change);
                const browserNow = await this.page.evaluate(() => Date.now());
                const adaptiveData = await adaptive.getAdjustedTimeout(this.currentDomain, 0, 'STREAM');
                const watchdogIdleTime = browserNow - lastChange;

                if (watchdogIdleTime > adaptiveData.timeout) {
                    if (responseArea && responseArea.isBusy) {
                        // IA ainda ativa fisicamente, renovamos a paciência
                        await this.page.evaluate(() => (window.__wd_last_change = Date.now()));
                        continue;
                    }

                    // ✅ MELHORIA #11: Stall metrics detalhadas
                    this._emitVital('STALL_DETECTED', {
                        timeoutMs: adaptiveData.timeout,
                        elapsedMs: Date.now() - startTime,
                        lastTextLength: lastText.length,
                        stableCycles,
                        continuations: continuationCount,
                        responseAreaBusy: responseArea?.isBusy || false,
                        currentUrl: this.page.url(),
                        watchdogIdleSince: watchdogIdleTime,
                    });

                    throw new Error(`STALL_DETECTED: Latência excedeu ${adaptiveData.timeout}ms`);
                }
            } catch (loopErr) {
                if (loopErr.message.includes('context was destroyed')) {
                    log('WARN', '[DRIVER] Re-sincronizando contexto de resposta...', this.correlationId);
                    await new Promise(r => {
                        setTimeout(r, 1500);
                    });
                } else {
                    throw loopErr;
                }
            }

            await new Promise(r => {
                setTimeout(r, CHATGPT_CONFIG.PERCEPTION_INTERVAL_MS);
            });
        }
    }

    /**
     * Interrompe a geração ativa via SADI.
     * Tenta clicar no botão stop, se falhar usa ESC key como fallback.
     *
     * ✅ v2.0: Retry logic, fallback com ESC key, retorna status
     *
     * @param {number} [maxRetries] - Número máximo de tentativas
     * @returns {Promise<boolean>} true se sucesso, false se fallback usado
     * @override
     */
    async stopGeneration(maxRetries = CHATGPT_CONFIG.STOP_GENERATION_MAX_RETRIES) {
        // ✅ MELHORIA #8: Retry logic
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            log(
                'WARN',
                `[${this.name}] Interrompendo geração (tentativa ${attempt}/${maxRetries})...`,
                this.correlationId
            );

            const stopped = await this._tryStopGeneration();

            if (stopped) {
                return true;
            }

            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, CHATGPT_CONFIG.STOP_GENERATION_RETRY_DELAY_MS));
            }
        }

        log('ERROR', `[${this.name}] stopGeneration failed after ${maxRetries} attempts`, this.correlationId);
        return false;
    }

    /**
     * Tentativa única de parar geração.
     *
     * @returns {Promise<boolean>} true se sucesso, false caso contrário
     * @private
     */
    async _tryStopGeneration() {
        const stopProtocol = await analyzer.findSendButtonSelector(this.page, {
            selector: '[aria-label*="Stop"], .stop-button',
        });

        if (stopProtocol && stopProtocol.protocol) {
            const { ctx, offsetX, offsetY } = await this.frameNavigator.getExecutionContext(
                toFrameNavProtocol(/** @type {AnalyzerProtocol} */ (/** @type {unknown} */ (stopProtocol.protocol))),
                this.signal
            );
            const rect = await this.biomechanics.getStableRect(ctx, stopProtocol.protocol.selector);

            if (rect) {
                await this.page.mouse.click(offsetX + rect.x + rect.w / 2, offsetY + rect.y + rect.h / 2);
                this._emitVital('GENERATION_STOPPED', { method: 'STOP_BUTTON' });
                return true;
            }
        }

        // ✅ BUG #6: Fallback com ESC key
        log('WARN', `[${this.name}] Stop button not found, trying ESC key...`, this.correlationId);
        await this.page.keyboard.press('Escape');

        this._emitVital('GENERATION_STOPPED', {
            method: 'ESC_FALLBACK',
        });

        return false; // Fallback usado
    }

    /**
     * Destrói o driver e limpa recursos.
     * Desconecta MutationObserver do watchdog.
     *
     * ✅ v2.0: Validação de cleanup, logging de erros
     *
     * @returns {Promise<void>}
     * @override
     */
    async destroy() {
        try {
            if (this.page && !this.page.isClosed()) {
                // ✅ BUG #7: Validar cleanup de MutationObserver
                const wasDisconnected = await this.page.evaluate(() => {
                    if (window.__wd_obs) {
                        try {
                            window.__wd_obs.disconnect();
                            delete window.__wd_obs;
                            delete window.__wd_last_change;
                            return true;
                        } catch (_err) {
                            return false;
                        }
                    }
                    return false;
                });

                if (wasDisconnected) {
                    log('DEBUG', `[${this.name}] MutationObserver cleaned up`, this.correlationId);
                } else {
                    log('WARN', `[${this.name}] MutationObserver cleanup failed or not present`, this.correlationId);
                }
            }
        } catch (err) {
            log('WARN', `[${this.name}] destroy cleanup error: ${err.message}`, this.correlationId);
        }

        await super.destroy();
    }

    /**
     * Estima número de tokens baseado no texto
     * Usa heurística: ~4 caracteres = 1 token (inglês/português)
     *
     * @param {string} text - Texto para estimar
     * @returns {number} - Estimativa de tokens
     * @private
     */
    _estimateTokens(text) {
        if (!text || typeof text !== 'string') {
            return 0;
        }
        // Heurística simples: 1 token ≈ 4 caracteres
        return Math.ceil(text.length / 4);
    }
}

export default ChatGPTDriver;

/**
 * Configurações do driver ChatGPT
 *
 * **Side-effects:** N/A
 * **Semântica:** Configurações de timeouts, intervalos e limites para operação do driver ChatGPT.
 * **Unidades:** Milissegundos para timeouts, números inteiros para contadores.
 *
 * @type {Object<string, any>}
 */
export { CHATGPT_CONFIG };

/**
 * Modelos suportados pelo driver ChatGPT
 *
 * **Side-effects:** N/A
 * **Semântica:** Lista de identificadores de modelos LLM suportados pelo driver.
 * **Unidades:** N/A
 *
 * @type {string[]}
 */
export { SUPPORTED_MODELS };
