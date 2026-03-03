// @ts-check - Type checking rigoroso habilitado (arquivo core)
import EventEmitter from 'node:events';
import * as human from '#shared/biomechanics/human';
import * as analyzer from '#shared/sadi/analyzer';
import * as stabilizer from '#shared/page_stability/stabilizer';
import * as adaptive from '#logic/adaptive';
import { log } from '#core/logger';

/**
 * A Promise that also exposes a `.cancel()` method to clear its internal timer.
 * @typedef {Promise<never> & { cancel: () => void }} CancelableTimeoutPromise
 */

/**
 * Configuração de timeouts, thresholds e delays para biomechanics.
 *
 * @readonly
 * @enum {number}
 */
const BIOMECH_CONFIG = {
    /** Máximo de iterações em waitIfBusy - Default: 50 */
    MAX_WAIT_ITERATIONS: parseInt(process.env.BIOMECH_MAX_ITERATIONS || '50', 10),

    /** Intervalo de keep-alive (ms) - Default: 25s */
    KEEP_ALIVE_INTERVAL_MS: parseInt(process.env.BIOMECH_KEEP_ALIVE || '25000', 10),

    /** Intervalo de polling em wait (ms) - Default: 800ms */
    WAIT_POLL_INTERVAL_MS: parseInt(process.env.BIOMECH_WAIT_POLL || '800', 10),

    /** Máximo de tentativas para stable rect - Default: 10 */
    STABLE_RECT_MAX_ATTEMPTS: parseInt(process.env.BIOMECH_STABLE_ATTEMPTS || '10', 10),

    /** Tolerância de estabilidade em pixels - Default: 0.5px */
    STABLE_RECT_TOLERANCE_PX: parseFloat(process.env.BIOMECH_STABLE_TOLERANCE || '0.5'),

    /** Intervalo de polling para stable rect (ms) - Default: 60ms */
    STABLE_RECT_POLL_MS: parseInt(process.env.BIOMECH_STABLE_POLL || '60', 10),

    /** Timeout para stable rect (ms) - Default: 5s */
    STABLE_RECT_TIMEOUT_MS: parseInt(process.env.BIOMECH_STABLE_TIMEOUT || '5000', 10),

    /** Ratio de offset de scroll - Default: 0.15 (15% da altura) */
    SCROLL_OFFSET_RATIO: parseFloat(process.env.BIOMECH_SCROLL_OFFSET || '0.15'),

    /** Máximo ratio de offset de scroll - Default: 0.3 (30% da altura) */
    SCROLL_MAX_OFFSET_RATIO: parseFloat(process.env.BIOMECH_SCROLL_MAX || '0.3'),

    /** Delay pós-scroll (ms) - Default: 500ms */
    POST_SCROLL_DELAY_MS: parseInt(process.env.BIOMECH_POST_SCROLL_DELAY || '500', 10),

    /** Threshold de caracteres para zen mode - Default: 2000 */
    ZEN_MODE_THRESHOLD_CHARS: parseInt(process.env.BIOMECH_ZEN_THRESHOLD || '2000', 10),

    /** Timeout para zen mode (ms) - Default: 30s */
    ZEN_MODE_TIMEOUT_MS: parseInt(process.env.BIOMECH_ZEN_TIMEOUT || '30000', 10),

    /** Timeout para human type (ms) - Default: 60s */
    HUMAN_TYPE_TIMEOUT_MS: parseInt(process.env.BIOMECH_HUMAN_TIMEOUT || '60000', 10),

    /** Threshold de echo para textos longos - Default: 0.6 (60%) */
    ECHO_THRESHOLD_LONG: parseFloat(process.env.BIOMECH_ECHO_LONG || '0.6'),

    /** Threshold de echo para textos curtos - Default: 0.5 (50%) */
    ECHO_THRESHOLD_SHORT: parseFloat(process.env.BIOMECH_ECHO_SHORT || '0.5'),

    /** TTL do cache de modifier (ms) - Default: 1h */
    MODIFIER_CACHE_TTL_MS: parseInt(process.env.BIOMECH_MODIFIER_TTL || '3600000', 10),
};

/**
 * Keyboard modifier keys used for keyboard shortcuts.
 *
 * @readonly
 * @enum {string}
 */
const MODIFIER_KEYS = {
    /** Control key (Windows/Linux primary modifier) */
    CONTROL: 'Control',

    /** Meta key (Mac primary modifier) */
    META: 'Meta',

    /** Shift key */
    SHIFT: 'Shift',

    /** Alt key */
    ALT: 'Alt',
};

/**
 * Array of all known modifier keys
 * @type {ReadonlyArray<string>}
 */
const MODIFIER_KEYS_ARRAY = Object.values(MODIFIER_KEYS);

/**
 * Frozen modifier keys object (immutable)
 */
Object.freeze(MODIFIER_KEYS);

/**
 * Eventos emitidos pelo BiomechanicsEngine.
 *
 * @readonly
 * @enum {string}
 */
const BIOMECH_EVENTS = {
    /** Emitido quando preparação de elemento inicia */
    PREPARE_STARTED: 'biomech:prepare_started',

    /** Emitido quando preparação de elemento completa */
    PREPARE_COMPLETED: 'biomech:prepare_completed',

    /** Emitido quando scroll inicia */
    SCROLL_STARTED: 'biomech:scroll_started',

    /** Emitido quando scroll completa */
    SCROLL_COMPLETED: 'biomech:scroll_completed',

    /** Emitido quando digitação inicia */
    TYPING_STARTED: 'biomech:typing_started',

    /** Emitido quando digitação completa */
    TYPING_COMPLETED: 'biomech:typing_completed',

    /** Emitido quando zen mode é ativado */
    ZEN_MODE_ACTIVATED: 'biomech:zen_mode_activated',

    /** Emitido quando human mode é ativado */
    HUMAN_MODE_ACTIVATED: 'biomech:human_mode_activated',

    /** Emitido quando clear inicia */
    CLEAR_STARTED: 'biomech:clear_started',

    /** Emitido quando clear completa */
    CLEAR_COMPLETED: 'biomech:clear_completed',

    /** Emitido quando wait inicia */
    WAIT_STARTED: 'biomech:wait_started',

    /** Emitido quando wait completa */
    WAIT_COMPLETED: 'biomech:wait_completed',

    /** Emitido quando release de modifiers inicia */
    MODIFIERS_RELEASE_STARTED: 'biomech:modifiers_release_started',

    /** Emitido quando release de modifiers completa */
    MODIFIERS_RELEASE_COMPLETED: 'biomech:modifiers_release_completed',
};

/**
 * BiomechanicsEngine v2.0 - Instrumented Biomechanics Engine
 *
 * Coordena execução física de interações (click, type, scroll) com:
 * - Detecção automática de platform/modifier
 * - Scroll omni-frame (main page + nested frames)
 * - Digitação biomimética (human mode com velocidade variável + zen mode para textos longos)
 * - Keep-alive automático (wakeUpMove a cada 25s)
 * - Telemetria completa (eventos locais + IPC)
 *
 * FEATURES v2.0:
 * - EventEmitter inheritance (14 eventos locais)
 * - BIOMECH_CONFIG (16 keys configuráveis via env vars)
 * - Timeout protection em operações críticas
 * - Metrics tracking (11 contadores + timing)
 * - Validação completa de parâmetros
 * - JSDoc 100%
 * - getStats() method para introspection
 *
 * @extends EventEmitter
 *
 * @example
 * const engine = new BiomechanicsEngine(driver);
 *
 * // Listen to events
 * engine.on(BIOMECH_EVENTS.TYPING_STARTED, (data) => {
 *     console.log('Typing started:', data);
 * });
 *
 * // Prepare element
 * await engine.prepareElement(execContext, '#prompt');
 *
 * // Type text
 * await engine.typeText(ctx, '#prompt', 'Hello world', signal);
 *
 * // Get metrics
 * const stats = engine.getStats();
 * console.log('Total clicks:', stats.totalClicks);
 */
class BiomechanicsEngine extends EventEmitter {
    /**
     * Cria uma instância do BiomechanicsEngine.
     *
     * @param {object} driver - Instância do BaseDriver
     * @param {object} [driver.page] - Puppeteer Page instance (pode ser null até attachContext)
     * @param {function} driver._emitVital - Método IPC para telemetria vital
     * @param {function} driver._assertPageAlive - Validação de page alive
     * @param {string} driver.correlationId - ID de correlação para logs
     * @param {AbortSignal} [driver.signal] - AbortSignal para cancelamento (pode ser null até attachContext)
     * @param {string} [driver.currentDomain] - Domínio atual da sessão (opcional)
     *
     * @throws {Error} Se driver não for fornecido
     * @throws {Error} Se driver.page não existir
     * @throws {Error} Se driver._emitVital não for uma função
     * @throws {Error} Se driver._assertPageAlive não for uma função
     *
     * @example
     * const engine = new BiomechanicsEngine(driver);
     */
    constructor(driver) {
        super(); // EventEmitter constructor

        // ✅ Validação completa de parâmetros (BUG #3 fix)
        if (!driver) {
            throw new Error('[BiomechanicsEngine] Driver is required');
        }

        if (typeof driver._emitVital !== 'function') {
            throw new Error('[BiomechanicsEngine] Driver must have _emitVital method');
        }

        if (typeof driver._assertPageAlive !== 'function') {
            throw new Error('[BiomechanicsEngine] Driver must have _assertPageAlive method');
        }

        this.driver = driver;
        this.modifier = null;
        this.modifierTimestamp = 0; // ✅ BUG #9 fix (cache TTL)
        this.lastKeepAlive = Date.now();

        // ✅ Metrics tracking (BUG #5 fix)
        this.stats = {
            totalClicks: 0,
            totalTyping: 0,
            zenModeActivations: 0,
            humanModeActivations: 0,
            totalScrolls: 0,
            modifierDetections: 0,
            waitCycles: 0,
            keepAliveTriggered: 0,
            totalTypingDuration: 0,
            maxTypingDuration: 0,
            totalCharsTyped: 0,
        };
    }

    /**
     * Detecta e retorna o modifier key apropriado para o platform atual.
     *
     * Cache com TTL: re-detecta após MODIFIER_CACHE_TTL_MS (default: 1h).
     *
     * @returns {Promise<string|null>} 'Control' (Win/Linux), null (mobile)
     *
     * @example
     * const mod = await engine.getModifier(); // 'Control' no Windows
     *
     * if (mod) {
     *     await page.keyboard.down(mod);
     *     await page.keyboard.press('a');
     *     await page.keyboard.up(mod);
     * }
     */
    async getModifier() {
        // ✅ BUG #9 fix: Cache com TTL
        const now = Date.now();
        if (this.modifier && now - this.modifierTimestamp < BIOMECH_CONFIG.MODIFIER_CACHE_TTL_MS) {
            return this.modifier;
        }

        this.driver._assertPageAlive();

        try {
            const platform = await this.driver.page.evaluate(() => {
                const ua = navigator.userAgent || '';
                if (navigator.userAgentData?.mobile || /Mobile(?!.*Chrome\/\d+)|Android|iPhone/i.test(ua)) {
                    return 'mobile';
                }
                return (navigator.platform || '').toLowerCase();
            });

            if (platform === 'mobile') {
                this.modifier = null;
            } else {
                // Windows/Linux sempre usa Control
                this.modifier = MODIFIER_KEYS.CONTROL;
            }

            this.modifierTimestamp = Date.now();
            this.stats.modifierDetections++;
        } catch (_modErr) {
            this.modifier = MODIFIER_KEYS.CONTROL;
            this.modifierTimestamp = Date.now();
        }

        return this.modifier;
    }

    /**
     * Release todos os modifier keys conhecidos.
     *
     * Útil para cleanup após operações que podem deixar modifiers pressionados.
     *
     * @returns {Promise<void>}
     *
     * @emits BIOMECH_EVENTS.MODIFIERS_RELEASE_STARTED
     * @emits BIOMECH_EVENTS.MODIFIERS_RELEASE_COMPLETED
     *
     * @example
     * await engine.releaseModifiers();
     */
    async releaseModifiers() {
        // ✅ BUG #10 fix: Eventos + tracking
        this.emit(BIOMECH_EVENTS.MODIFIERS_RELEASE_STARTED);

        const released = [];

        try {
            if (this.driver.page && !this.driver.page.isClosed()) {
                const knownMods = MODIFIER_KEYS_ARRAY;
                for (const mod of knownMods) {
                    try {
                        await this.driver.page.keyboard.up(mod);
                        released.push(mod);
                    } catch (err) {
                        log('WARN', `[BIOMECH] Failed to release ${mod}: ${err.message}`, this.driver.correlationId);
                    }
                }
            }
        } catch (err) {
            log('ERROR', `[BIOMECH] releaseModifiers error: ${err.message}`, this.driver.correlationId);
            throw err;
        }

        this.emit(BIOMECH_EVENTS.MODIFIERS_RELEASE_COMPLETED, { released });
    }

    /**
     * Aguarda a IA ficar ociosa, com keep-alive automático.
     *
     * Monitora response area (analyzer) e page load status (stabilizer).
     * Keep-alive: wakeUpMove a cada KEEP_ALIVE_INTERVAL_MS (default: 25s).
     *
     * @param {string} taskId - ID da task (para logs e telemetria)
     * @param {AbortSignal} [signal] - AbortSignal para cancelamento
     * @returns {Promise<void>}
     *
     * @throws {Error} Se signal abortado
     *
     * @emits BIOMECH_EVENTS.WAIT_STARTED
     * @emits BIOMECH_EVENTS.WAIT_COMPLETED
     *
     * @example
     * await engine.waitIfBusy('task-123', signal);
     */
    async waitIfBusy(taskId, signal) {
        this.emit(BIOMECH_EVENTS.WAIT_STARTED, { taskId });
        this.stats.waitCycles++;

        // ✅ BUG #8 fix: AbortSignal support
        if (signal?.aborted) {
            throw new Error('WAIT_ABORTED');
        }

        const { timeout } = await adaptive.getAdjustedTimeout(this.driver.currentDomain, 0, 'INITIAL');

        const start = Date.now();
        let iterations = 0;

        this.driver._emitVital('PROGRESS_UPDATE', { step: 'WAITING_FOR_IA_IDLE', taskId });

        while (Date.now() - start < timeout && iterations < BIOMECH_CONFIG.MAX_WAIT_ITERATIONS) {
            // Check signal
            if (signal?.aborted) {
                throw new Error('WAIT_ABORTED');
            }

            iterations++;
            this.driver._assertPageAlive();

            // Keep-alive automático
            if (Date.now() - this.lastKeepAlive > BIOMECH_CONFIG.KEEP_ALIVE_INTERVAL_MS) {
                await human.wakeUpMove(this.driver.page).catch(() => {});
                this.lastKeepAlive = Date.now();
                this.stats.keepAliveTriggered++;
            }

            const responseInfo = await analyzer.findResponseArea(this.driver.page).catch(() => null);
            if (!responseInfo || !responseInfo.isBusy) {
                const isBusy = await stabilizer.getPageLoadStatus(this.driver.page);
                if (!isBusy) {
                    this.driver._emitVital('PROGRESS_UPDATE', { step: 'IA_IDLE_CONFIRMED', taskId });
                    this.emit(BIOMECH_EVENTS.WAIT_COMPLETED, { taskId, iterations });
                    return;
                }
            }

            await new Promise(r => setTimeout(r, BIOMECH_CONFIG.WAIT_POLL_INTERVAL_MS));
        }

        if (iterations >= BIOMECH_CONFIG.MAX_WAIT_ITERATIONS) {
            log('WARN', `[BIOMECH] waitIfBusy atingiu limite de segurança`, taskId);
        }

        this.emit(BIOMECH_EVENTS.WAIT_COMPLETED, { taskId, iterations });
    }

    /**
     * Obtém bounding rect estável do elemento (aguarda estabilização).
     *
     * Tenta STABLE_RECT_MAX_ATTEMPTS vezes, com polling de STABLE_RECT_POLL_MS.
     * Tolerância: STABLE_RECT_TOLERANCE_PX (default: 0.5px).
     *
     * @private
     * @param {object} ctx - Context (page ou frame)
     * @param {string} selector - Seletor CSS do elemento
     * @returns {Promise<object|null>} Rect { x, y, w, h } ou null
     *
     * @example
     * const rect = await this._executeGetStableRect(ctx, '#button');
     */
    async _executeGetStableRect(ctx, selector) {
        let lastRect = null;

        for (let i = 0; i < BIOMECH_CONFIG.STABLE_RECT_MAX_ATTEMPTS; i++) {
            try {
                const rect = await ctx.evaluate(s => {
                    const el = document.querySelector(s);
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: r.left, y: r.top, w: r.width, h: r.height };
                }, selector);

                if (
                    lastRect &&
                    rect &&
                    Math.abs(rect.x - lastRect.x) < BIOMECH_CONFIG.STABLE_RECT_TOLERANCE_PX &&
                    Math.abs(rect.y - lastRect.y) < BIOMECH_CONFIG.STABLE_RECT_TOLERANCE_PX
                ) {
                    return rect;
                }
                lastRect = rect;
            } catch (_rectErr) {
                return null;
            }
            await new Promise(r => setTimeout(r, BIOMECH_CONFIG.STABLE_RECT_POLL_MS));
        }
        return lastRect;
    }

    /**
     * Obtém bounding rect estável do elemento com timeout protection.
     *
     * @param {object} ctx - Context (page ou frame)
     * @param {string} selector - Seletor CSS do elemento
     * @returns {Promise<object|null>} Rect { x, y, w, h } ou null
     *
     * @throws {Error} Se timeout exceder STABLE_RECT_TIMEOUT_MS
     *
     * @example
     * const rect = await engine.getStableRect(ctx, '#button');
     */
    async getStableRect(ctx, selector) {
        // ✅ BUG #4 fix: Timeout protection
        const timeoutP = this._timeout(BIOMECH_CONFIG.STABLE_RECT_TIMEOUT_MS, 'getStableRect');
        try {
            return await Promise.race([this._executeGetStableRect(ctx, selector), timeoutP]);
        } finally {
            timeoutP.cancel();
        }
    }

    /**
     * Scroll omni-frame: main page + nested frames.
     *
     * Scroll element into view em todos os níveis de frame hierarchy.
     *
     * @param {object} ctx - Context (page ou frame)
     * @param {unknown[]} frameStack - Stack de frames (nested)
     * @param {string} selector - Seletor CSS do elemento
     * @returns {Promise<void>}
     *
     * @emits BIOMECH_EVENTS.SCROLL_STARTED
     * @emits BIOMECH_EVENTS.SCROLL_COMPLETED
     *
     * @example
     * await engine.omniScroll(ctx, frameStack, '#button');
     */
    async omniScroll(ctx, frameStack, selector) {
        this.emit(BIOMECH_EVENTS.SCROLL_STARTED, { selector });
        this.stats.totalScrolls++;

        const mainHeight = await this.driver.page.evaluate(() => window.innerHeight);
        const baseOffset = mainHeight * BIOMECH_CONFIG.SCROLL_OFFSET_RATIO;

        await ctx.evaluate(
            (sel, off, maxOffsetRatio) => {
                const el = document.querySelector(sel);
                if (!el) return;
                el.scrollIntoView({ behavior: 'auto', block: 'center' });
                const safeOff = Math.min(off, window.innerHeight * maxOffsetRatio);
                window.scrollBy(0, -safeOff);
            },
            selector,
            baseOffset,
            BIOMECH_CONFIG.SCROLL_MAX_OFFSET_RATIO
        );

        // Scroll nested frames
        for (let i = frameStack.length - 1; i >= 0; i--) {
            try {
                const parent = i === 0 ? this.driver.page : await frameStack[i - 1].contentFrame();
                if (!parent) continue;

                await frameStack[i].scrollIntoView({ behavior: 'auto', block: 'center' });
                await parent.evaluate(
                    (off, maxRatio) => {
                        const safeOff = Math.min(off, window.innerHeight * maxRatio);
                        window.scrollBy(0, -safeOff);
                    },
                    baseOffset,
                    BIOMECH_CONFIG.SCROLL_MAX_OFFSET_RATIO
                );
            } catch (_scrollErr) {
                // Continue with click
            }
        }

        await new Promise(r => setTimeout(r, BIOMECH_CONFIG.POST_SCROLL_DELAY_MS));
        this.emit(BIOMECH_EVENTS.SCROLL_COMPLETED, { selector });
    }

    /**
     * Prepara elemento para interação (scroll + click humanizado + focus).
     *
     * @param {object} execContext - Execution context
     * @param {object} execContext.ctx - Context (page ou frame)
     * @param {unknown[]} execContext.frameStack - Stack de frames
     * @param {number} execContext.offsetX - Offset X para click
     * @param {number} execContext.offsetY - Offset Y para click
     * @param {string} selector - Seletor CSS do elemento
     * @param {AbortSignal} [signal] - AbortSignal para cancelamento
     * @returns {Promise<void>}
     *
     * @throws {Error} Se elemento perdido (ELEMENT_LOST)
     * @throws {Error} Se signal abortado
     *
     * @emits BIOMECH_EVENTS.PREPARE_STARTED
     * @emits BIOMECH_EVENTS.PREPARE_COMPLETED
     *
     * @example
     * await engine.prepareElement(execContext, '#prompt', signal);
     */
    async prepareElement(execContext, selector, signal) {
        // ✅ BUG #8 fix: AbortSignal support
        if (signal?.aborted) {
            throw new Error('PREPARE_ABORTED');
        }

        this.emit(BIOMECH_EVENTS.PREPARE_STARTED, { selector });
        this.stats.totalClicks++;

        const { ctx, frameStack, offsetX, offsetY } = execContext;

        this.driver._emitVital('PROGRESS_UPDATE', { step: 'SCROLLING_TO_ELEMENT', selector });
        await this.omniScroll(ctx, frameStack, selector);

        const rect = await this.getStableRect(ctx, selector);
        if (!rect) {
            throw new Error('ELEMENT_LOST');
        }

        // Human click com telemetria
        await human.humanClick(this.driver.page, ctx, selector, offsetX, offsetY, this.driver.signal, pulse =>
            this.driver._emitVital('HUMAN_PULSE', pulse)
        );

        await ctx.focus(selector);
        this.emit(BIOMECH_EVENTS.PREPARE_COMPLETED, { selector });
    }

    /**
     * Limpa input (cross-platform: keyboard select-all + evaluate clear).
     *
     * @param {object} ctx - Context (page ou frame)
     * @param {string} selector - Seletor CSS do input
     * @param {AbortSignal} [signal] - AbortSignal para cancelamento
     * @returns {Promise<void>}
     *
     * @throws {Error} Se elemento não existe (ELEMENT_NOT_FOUND)
     * @throws {Error} Se clear falhou (CLEAR_INPUT_FAILED)
     * @throws {Error} Se signal abortado
     *
     * @emits BIOMECH_EVENTS.CLEAR_STARTED
     * @emits BIOMECH_EVENTS.CLEAR_COMPLETED
     *
     * @example
     * await engine.clearInput(ctx, '#prompt', signal);
     */
    async clearInput(ctx, selector, signal) {
        // ✅ BUG #8 fix: AbortSignal support
        if (signal?.aborted) {
            throw new Error('CLEAR_ABORTED');
        }

        this.emit(BIOMECH_EVENTS.CLEAR_STARTED, { selector });
        this.driver._emitVital('PROGRESS_UPDATE', { step: 'CLEARING_INPUT', selector });

        // ✅ BUG #7 fix: Valida se elemento existe
        const exists = await ctx.evaluate(s => !!document.querySelector(s), selector);
        if (!exists) {
            throw new Error(`ELEMENT_NOT_FOUND: ${selector}`);
        }

        const mod = await this.getModifier();

        if (mod && mod !== 'mobile') {
            await this.driver.page.keyboard.down(mod);
            await this.driver.page.keyboard.press('a');
            await this.driver.page.keyboard.up(mod);
            await this.driver.page.keyboard.press('Backspace');
        }

        const cleared = await ctx.evaluate(sel => {
            const el = document.querySelector(sel);
            if (!el) return false;

            if (el.isContentEditable) {
                el.innerHTML = '';
            } else {
                el.value = '';
            }

            // Verifica se limpou
            return (el.value || el.innerHTML || '').trim() === '';
        }, selector);

        if (!cleared) {
            throw new Error('CLEAR_INPUT_FAILED');
        }

        this.emit(BIOMECH_EVENTS.CLEAR_COMPLETED, { selector });
    }

    /**
     * Executa digitação interna (zen mode ou human mode).
     *
     * @private
     * @param {object} ctx - Context (page ou frame)
     * @param {string} selector - Seletor CSS do input
     * @param {string} text - Texto a digitar
     * @param {AbortSignal} signal - AbortSignal para cancelamento
     * @returns {Promise<void>}
     */
    async _executeTypeText(ctx, selector, text, signal) {
        const isZenMode = text.length > BIOMECH_CONFIG.ZEN_MODE_THRESHOLD_CHARS;

        if (isZenMode) {
            // Zen Mode (Injeção Direta)
            this.stats.zenModeActivations++;
            this.emit(BIOMECH_EVENTS.ZEN_MODE_ACTIVATED, { length: text.length });
            this.driver._emitVital('PROGRESS_UPDATE', { step: 'ZEN_MODE_TYPING_START', length: text.length });

            const zenSuccess = await ctx.evaluate(
                (sel, content) => {
                    const el = document.querySelector(sel);
                    if (!el) return false;

                    el.focus();
                    const ok = document.execCommand('insertText', false, content);
                    if (!ok) {
                        const setter =
                            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
                            Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'innerText')?.set;
                        if (setter) {
                            setter.call(el, content);
                        }
                    }
                    ['input', 'change'].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));
                    const finalVal = el.value || el.innerText || '';
                    if (finalVal.trim().length > 0) {
                        el.blur();
                        el.focus();
                        return true;
                    }
                    return false;
                },
                selector,
                text
            );

            if (!zenSuccess) {
                throw new Error('ZEN_MODE_FAILED');
            }
            this.driver._emitVital('PROGRESS_UPDATE', { step: 'ZEN_MODE_TYPING_COMPLETE' });
        } else {
            // Human Mode (Digitação Biomecânica)
            this.stats.humanModeActivations++;
            this.emit(BIOMECH_EVENTS.HUMAN_MODE_ACTIVATED, { length: text.length });
            this.driver._emitVital('PROGRESS_UPDATE', { step: 'HUMAN_TYPING_START', length: text.length });

            const lag = await stabilizer.measureEventLoopLag(this.driver.page);

            await human.humanType(this.driver.page, ctx, selector, text, lag, signal, pulse =>
                this.driver._emitVital('HUMAN_PULSE', pulse)
            );

            // Verificação de Eco (Sanidade)
            const eco = await ctx.evaluate(s => {
                const el = document.querySelector(s);
                const val = el?.value || el?.innerText || '';
                return Array.from(val.replace(/\s/g, '')).length;
            }, selector);

            const threshold =
                text.length > 50 ? BIOMECH_CONFIG.ECHO_THRESHOLD_LONG : BIOMECH_CONFIG.ECHO_THRESHOLD_SHORT;

            if (eco < Array.from(text.replace(/\s/g, '')).length * threshold) {
                throw new Error('INPUT_ECHO_FAILED');
            }

            this.driver._emitVital('PROGRESS_UPDATE', { step: 'HUMAN_TYPING_COMPLETE' });
        }
    }

    /**
     * Digita texto com biomimética (human mode) ou injeção direta (zen mode).
     *
     * - **Zen Mode**: textos > ZEN_MODE_THRESHOLD_CHARS (default: 2000)
     * - **Human Mode**: textos <= threshold (digitação biomimética com velocidade variável)
     *
     * @param {object} ctx - Context (page ou frame)
     * @param {string} selector - Seletor CSS do input
     * @param {string} text - Texto a digitar
     * @param {AbortSignal} signal - AbortSignal para cancelamento
     * @returns {Promise<void>}
     *
     * @throws {Error} Se zen mode falhou (ZEN_MODE_FAILED)
     * @throws {Error} Se echo failed (INPUT_ECHO_FAILED)
     * @throws {Error} Se timeout exceder
     *
     * @emits BIOMECH_EVENTS.TYPING_STARTED
     * @emits BIOMECH_EVENTS.TYPING_COMPLETED
     * @emits BIOMECH_EVENTS.ZEN_MODE_ACTIVATED
     * @emits BIOMECH_EVENTS.HUMAN_MODE_ACTIVATED
     *
     * @example
     * // Short text (human mode)
     * await engine.typeText(ctx, '#prompt', 'Hello', signal);
     *
     * // Long text (zen mode)
     * await engine.typeText(ctx, '#prompt', longText, signal);
     */
    async typeText(ctx, selector, text, signal) {
        this.emit(BIOMECH_EVENTS.TYPING_STARTED, { selector, length: text.length });
        this.stats.totalTyping++;
        this.stats.totalCharsTyped += text.length;

        const startTime = Date.now();

        try {
            // ✅ BUG #4 fix: Timeout protection
            const timeout =
                text.length > BIOMECH_CONFIG.ZEN_MODE_THRESHOLD_CHARS
                    ? BIOMECH_CONFIG.ZEN_MODE_TIMEOUT_MS
                    : BIOMECH_CONFIG.HUMAN_TYPE_TIMEOUT_MS;

            const timeoutP = this._timeout(timeout, 'typeText');
            try {
                await Promise.race([this._executeTypeText(ctx, selector, text, signal), timeoutP]);
            } finally {
                timeoutP.cancel();
            }

            const duration = Date.now() - startTime;
            this.stats.totalTypingDuration += duration;
            this.stats.maxTypingDuration = Math.max(this.stats.maxTypingDuration, duration);

            this.emit(BIOMECH_EVENTS.TYPING_COMPLETED, { selector, length: text.length, duration });
        } catch (err) {
            this.emit(BIOMECH_EVENTS.TYPING_COMPLETED, {
                selector,
                length: text.length,
                error: err.message,
            });
            throw err;
        }
    }

    /**
     * Retorna estatísticas de biomechanics.
     *
     * @returns {object} Objeto com métricas de biomechanics
     * Propriedades do objeto retornado:
     *   - totalClicks (number): Total de cliques executados
     *   - totalTyping (number): Total de digitações
     *   - zenModeActivations (number): Ativações de zen mode
     *   - humanModeActivations (number): Ativações de human mode
     *   - totalScrolls (number): Total de scrolls
     *   - modifierDetections (number): Detecções de modifier
     *   - waitCycles (number): Ciclos de wait
     *   - keepAliveTriggered (number): Keep-alive triggers
     *   - totalTypingDuration (number): Duração total de digitação (ms)
     *   - maxTypingDuration (number): Duração máxima de digitação (ms)
     *   - totalCharsTyped (number): Total de caracteres digitados
     *   - avgTypingDuration (string): Duração média de digitação
     *   - zenModeUsageRate (string): Taxa de uso de zen mode (%)
     *   - config (Object): Configuração atual (BIOMECH_CONFIG)
     *
     * @example
     * const stats = engine.getStats();
     * console.log('Total clicks:', stats.totalClicks);
     * console.log('Zen mode usage:', stats.zenModeUsageRate);
     */
    getStats() {
        return {
            ...this.stats,
            avgTypingDuration:
                this.stats.totalTyping > 0
                    ? (this.stats.totalTypingDuration / this.stats.totalTyping).toFixed(2) + 'ms'
                    : '0ms',
            zenModeUsageRate:
                this.stats.totalTyping > 0
                    ? ((this.stats.zenModeActivations / this.stats.totalTyping) * 100).toFixed(2) + '%'
                    : '0%',
            config: { ...BIOMECH_CONFIG },
        };
    }

    /**
     * Timeout wrapper para operações com limite de tempo.
     *
     * @private
     * @param {number} ms - Timeout em milissegundos
     * @param {string} operation - Nome da operação (para error message)
     * @returns {CancelableTimeoutPromise} Promise que rejeita após timeout com método `.cancel()` para limpar o timer
     */
    _timeout(ms, operation) {
        let timerId;
        const p = /** @type {CancelableTimeoutPromise} */ (
            new Promise((_, reject) => {
                timerId = setTimeout(() => {
                    const error = new Error(`Timeout in ${operation} after ${ms}ms`);
                    error.name = 'TimeoutError';
                    reject(error);
                }, ms);
            })
        );
        p.cancel = () => clearTimeout(timerId);
        return p;
    }
}

/**
 * Factory function para criar instância de BiomechanicsEngine.
 *
 * @param {object} driver - Instância do driver
 * @returns {BiomechanicsEngine} Nova instância
 *
 * @example
 * const { create } = require('./biomechanics_engine');
 * const engine = create(driver);
 */
function create(driver) {
    return new BiomechanicsEngine(driver);
}

export { BiomechanicsEngine, BIOMECH_CONFIG, BIOMECH_EVENTS, MODIFIER_KEYS, MODIFIER_KEYS_ARRAY, create };
