/* ==========================================================================
   src/driver/targets/ChatGPTDriver.js
   Audit Level: 500 — Ultimate ChatGPT Specialist (IPC 2.0 Singularity)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Especialista em interface OpenAI. Gerencia percepção de
                     resposta, poda de raciocínio (o1/o3) e telemetria de fluxo.
   Sincronizado com: BaseDriver V320, TelemetryBridge V500, stabilizer.js V500.
========================================================================== */

const BaseDriver = require('../core/BaseDriver');

const {
    STATUS_VALUES: STATUS_VALUES
} = require('../../core/constants/tasks.js');

const triage = require('../modules/triage');
const adaptive = require('../../logic/adaptive');
const analyzer = require('../modules/analyzer');
const stabilizer = require('../modules/stabilizer');
const { log } = require('../../core/logger');

class ChatGPTDriver extends BaseDriver {
    /**
     * @param {object} page - Puppeteer Page.
     * @param {object} config - Task Config.
     * @param {AbortSignal} signal - Sovereign Abort Signal.
     */
    constructor(page, config, signal) {
        super(page, config, signal);
        this.name = 'ChatGPT';
        this.currentDomain = 'chatgpt.com';
        this.stableCyclesTarget = config.STABLE_CYCLES || 3;
        this.defaultModel = config.DEFAULT_MODEL_ID || 'gpt-4o';
    }

    async validatePage() {
        const url = this.page.url();
        return url.includes('chatgpt.com') || url.includes('openai.com');
    }

    /**
     * Captura o estado atual da conversa (Contagem de turnos).
     */
    async captureState() {
        try {
            return this.page.evaluate(() => {
                const msgs = document.querySelectorAll(
                    'div[data-message-author-role="assistant"], article[data-testid*="conversation-turn"]'
                );
                return msgs.length;
            });
        } catch (_e) {
            return 0;
        }
    }

    /**
     * Prepara o ambiente para a tarefa (Troca de modelo / Reset).
     */
    async prepareContext(taskSpec) {
        this.setState('PREPARING');
        this._emitVital('PROGRESS_UPDATE', {
            step: 'MODEL_SYNCHRONIZATION',
            model: taskSpec?.model || this.defaultModel
        });

        const modelId = taskSpec?.model || this.defaultModel;
        const targetUrl = `https://chatgpt.com/?model=${modelId}`;

        const currentUrl = this.page.url();
        const isConversation = currentUrl.includes('/c/');
        const wrongModel = !currentUrl.includes(modelId) && !currentUrl.includes(`model=${modelId}`);
        const forceReset = taskSpec?.config?.reset_context;

        if (forceReset || wrongModel || (isConversation && !taskSpec.config?.require_history)) {
            log('INFO', `[${this.name}] Ajustando modelo para: ${modelId}`, this.correlationId);
            await this.page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // [V500] Usa o novo estabilizador instrumentado
            await stabilizer.waitForStability(this);
        }

        this.setState(STATUS_VALUES.IDLE);
    }

    /**
     * Loop de percepção incremental com filtragem de pensamento (o1/o3).
     */
    async waitForCompletion(startSnapshot, signal) {
        let lastText = '';
        let stableCycles = 0;

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
            try {
                if (signal?.aborted) {
                    throw new Error('OPERATION_ABORTED');
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
                    const { ctx } = await this.frameNavigator.getExecutionContext(responseArea.protocol);

                    // Extração com Poda de Pensamento (NASA Standard Pruning)
                    const extractionResult = await ctx.evaluate(proto => {
                        const msgs = Array.from(document.querySelectorAll(proto.selector));
                        const targetMsg = msgs[msgs.length - 1];
                        if (!targetMsg) {
                            return { text: '', pruned: 0 };
                        }

                        const clone = targetMsg.cloneNode(true);
                        // Remove elementos de raciocínio interno (o1/o3) e metadados de UI
                        const thoughts = clone.querySelectorAll(
                            '[data-testid*="thought"], .thought-block, [class*="thought"], [data-message-role="thought"], details, .sr-only'
                        );
                        const count = thoughts.length;
                        thoughts.forEach(t => t.remove());

                        return { text: clone.innerText.trim(), pruned: count };
                    }, responseArea.protocol);

                    currentText = extractionResult.text || '';

                    // [V500] Telemetria de Poda: Informa se a IA está em "modo de pensamento"
                    if (extractionResult.pruned > 0) {
                        this._emitVital('PROGRESS_UPDATE', {
                            step: 'THOUGHT_PRUNING_ACTIVE',
                            count: extractionResult.pruned
                        });
                    }
                }

                // 3. Telemetria de Progresso
                if (currentText.length > lastText.length) {
                    this._emitVital('PROGRESS_UPDATE', { length: currentText.length, status: 'STREAMING' });
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
                    this._emitVital('PROGRESS_UPDATE', { step: 'CONTINUING_GENERATION' });
                    log('INFO', `[${this.name}] Acionando botão de continuação.`, this.correlationId);
                    await new Promise(r => {
                        setTimeout(r, 2000);
                    });
                    stableCycles = 0;
                    continue;
                }

                // 5. Critério de Conclusão
                if (stableCycles >= this.stableCyclesTarget && currentText.length > 0) {
                    this._emitVital('PROGRESS_UPDATE', { step: 'GENERATION_COMPLETE' });
                    this.setState(STATUS_VALUES.IDLE);
                    return currentText;
                }

                // 6. Stall Adaptativo
                const lastChange = await this.page.evaluate(() => window.__wd_last_change);
                const browserNow = await this.page.evaluate(() => Date.now());
                const adaptiveData = await adaptive.getAdjustedTimeout(this.currentDomain, 0, 'STREAM');

                if (browserNow - lastChange > adaptiveData.timeout) {
                    if (responseArea && responseArea.isBusy) {
                        // IA ainda ativa fisicamente, renovamos a paciência
                        await this.page.evaluate(() => (window.__wd_last_change = Date.now()));
                        continue;
                    }
                    this._emitVital('TRIAGE_ALERT', {
                        type: 'STALL_DETECTED',
                        severity: 'MEDIUM',
                        evidence: { timeout: adaptiveData.timeout }
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
                setTimeout(r, 800);
            });
        }
    }

    /**
     * Interrompe a geração ativa via SADI.
     */
    async stopGeneration() {
        log('WARN', `[${this.name}] Interrompendo geração ativa...`, this.correlationId);
        const stopProtocol = await analyzer.findSendButtonSelector(this.page, {
            selector: '[aria-label*="Stop"], .stop-button'
        });

        if (stopProtocol && stopProtocol.protocol) {
            const { ctx, offsetX, offsetY } = await this.frameNavigator.getExecutionContext(stopProtocol.protocol);
            const rect = await this.biomechanics.getStableRect(ctx, stopProtocol.protocol.selector);
            if (rect) {
                await this.page.mouse.click(offsetX + rect.x + rect.w / 2, offsetY + rect.y + rect.h / 2);
                this._emitVital('PROGRESS_UPDATE', { step: 'GENERATION_STOPPED_MANUALLY' });
            }
        }
    }

    async destroy() {
        try {
            if (this.page && !this.page.isClosed()) {
                await this.page.evaluate(() => {
                    if (window.__wd_obs) {
                        window.__wd_obs.disconnect();
                    }
                });
            }
        } catch (_e) {
            // Ignore cleanup errors
        }
        await super.destroy();
    }
}

module.exports = ChatGPTDriver;
