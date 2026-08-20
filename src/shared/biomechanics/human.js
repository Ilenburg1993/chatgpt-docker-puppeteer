// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log as _log } from '#core/logger';
import { createCursor } from 'ghost-cursor';

// ============================================
// CONFIGURATION (Externalized from v2.0)
// ============================================
const BIOMECHANICS_CONFIG = {
    // Click parameters
    CLICK_VARIANCE_STDEV: 0.12, // 12% of element size
    CLICK_PRE_DELAY_MIN: 100, // ms before click
    CLICK_PRE_DELAY_MAX: 200,
    CLICK_HOLD_MIN: 40, // ms mouse down
    CLICK_HOLD_MAX: 80,

    // Typing parameters
    TYPO_RATE: 0.012, // 1.2% chance
    TYPO_TRANSPOSE_RATE: 0.7, // 70% transposes, 30% neighbor keys
    TYPO_BACKSPACE_DELAY: 300, // ms before correction

    // Rhythm parameters
    FLIGHT_TIME_MIN: 45, // ms between keys
    FLIGHT_TIME_MAX: 85,
    PUNCTUATION_PAUSE: 180, // Extra ms for punctuation
    LAG_COMPENSATION_FACTOR: 0.3, // Multiply lag by this
    MAX_FLIGHT_TIME: 800, // Cap max delay

    // Fatigue parameters
    FATIGUE_THRESHOLD: 30, // chars before fatigue kicks in
    FATIGUE_PROBABILITY_DIVISOR: 220,
    FATIGUE_PAUSE_MIN: 400,
    FATIGUE_PAUSE_MAX: 1400,
    FATIGUE_MOVE_THRESHOLD: 800, // If pause > this, move mouse
    FATIGUE_MOVE_CHANCE: 0.6,

    // Focus lock (v2.0 - with retry)
    FOCUS_CHECK_INTERVAL: 25, // Check focus every N chars
    FOCUS_RESTORE_DELAY: 100, // Base delay (multiplied by retry attempt)
    FOCUS_MAX_RETRIES: 3, // Max focus restoration attempts

    // Element retry (v2.0 - robustness)
    ELEMENT_RETRY_COUNT: 3, // Max retries for element not found
    ELEMENT_RETRY_DELAY: 500, // Base delay between retries (ms)

    // Abort check interval (v2.0)
    ABORT_CHECK_INTERVAL: 5, // Check abort signal every N chars

    // Cache
    CURSOR_CACHE_MAX_SIZE: 10,

    // Gaussian clamping (v2.0)
    GAUSSIAN_CLAMP_SIGMA: 3, // Clamp gaussian to ±3σ
};

// ============================================
// TYPING PROFILES (v2.0 - Phase 3)
// ============================================
// TYPING PROFILES (v2.0 - Phase 3)
// ============================================
const TYPING_PROFILES = {
    slow: { min: 80, max: 150, wpm: 25 },
    average: { min: 45, max: 85, wpm: 45 },
    fast: { min: 20, max: 50, wpm: 70 },
    expert: { min: 10, max: 30, wpm: 90 },
};

// ============================================
// CURSOR CACHE (Fixed memory leak in v2.0)
// ============================================
// Changed from WeakMap to Map with LRU eviction + auto-cleanup
const cursorCache = new Map();

// ============================================
// KEYBOARD LAYOUTS
// ============================================
const LAYOUTS = {
    qwerty: {
        a: 'qsxz',
        b: 'vghn',
        c: 'xdfv',
        d: 'serfc',
        e: 'wsdr',
        f: 'drtgv',
        g: 'ftyhb',
        h: 'gyujn',
        i: 'ujko',
        j: 'huikm',
        k: 'jiol',
        l: 'kop',
        m: 'njk',
        n: 'bhjm',
        o: 'iklp',
        p: 'ol',
        q: 'wa',
        r: 'edft',
        s: 'awzx',
        t: 'rfgy',
        u: 'yhji',
        v: 'cfgb',
        w: 'qase',
        x: 'zsdc',
        y: 'tghu',
        z: 'asx',
    },
};

// ============================================
// GAUSSIAN RANDOM (v2.0 - Cached + Clamped)
// ============================================
/** @type {any} */ let _gaussianCache = null;

/**
 * Generate a typo by transposing characters or using neighboring keys.
 *
 * @param {string} char - Original character
 * @returns {string} Typo character
 */
function _generateTypo(/** @type {any} */ char) {
    // Keyboard layout mapping for common typos
    const keyboardMap = {
        a: ['s', 'q', 'w', 'z'],
        b: ['v', 'n', 'g', 'h'],
        c: ['x', 'v', 'f', 'd'],
        d: ['s', 'f', 'c', 'e'],
        e: ['w', 'r', 'd', 's'],
        f: ['d', 'g', 'r', 't'],
        g: ['f', 'h', 't', 'y'],
        h: ['g', 'j', 'y', 'u'],
        i: ['u', 'o', 'k', 'j'],
        j: ['h', 'k', 'u', 'i'],
        k: ['j', 'l', 'i', 'o'],
        l: ['k', ';', 'o', 'p'],
        m: ['n', ',', 'j', 'k'],
        n: ['b', 'm', 'h', 'j'],
        o: ['i', 'p', 'l', 'k'],
        p: ['o', '[', ';', 'l'],
        q: ['w', 'a', '1', '2'],
        r: ['e', 't', 'f', 'g'],
        s: ['a', 'd', 'w', 'x'],
        t: ['r', 'y', 'g', 'h'],
        u: ['y', 'i', 'j', 'h'],
        v: ['c', 'b', 'f', 'g'],
        w: ['q', 'e', 's', 'a'],
        x: ['z', 'c', 's', 'd'],
        y: ['t', 'u', 'h', 'j'],
        z: ['a', 'x', 's', 'd'],
    };

    const lowerChar = char.toLowerCase();
    const neighbors = /** @type {any} */ (keyboardMap)[lowerChar];

    if (neighbors && neighbors.length > 0) {
        // 70% chance of transposing with adjacent character, 30% chance of neighbor key
        if (Math.random() < 0.7) {
            // Simple transpose: swap with next character if exists
            return char === lowerChar ? neighbors[0] : neighbors[0].toUpperCase();
        } else {
            // Neighbor key
            const randomNeighbor = neighbors[Math.floor(Math.random() * neighbors.length)];
            return char === lowerChar ? randomNeighbor : randomNeighbor.toUpperCase();
        }
    }

    // Fallback: return original character if no mapping found
    return char;
}

/**
 * Generate gaussian random with Box-Muller transform. v2.0: Caches second sample for 2x performance, clamps outliers.
 *
 * @param {number} mean - Mean value
 * @param {number} stdev - Standard deviation
 * @param {number} clampStdev - Clamp to ±N standard deviations (default: 3)
 * @returns {number} Random value from gaussian distribution
 */
function gaussianRandom(
    /** @type {any} */ mean = 0,
    /** @type {any} */ stdev = 1,
    /** @type {any} */ clampStdev = BIOMECHANICS_CONFIG.GAUSSIAN_CLAMP_SIGMA,
) {
    // Use cached value if available (Box-Muller generates 2 samples)
    if (_gaussianCache !== null) {
        const z = _gaussianCache;
        _gaussianCache = null;
        const value = z * stdev + mean;
        return Math.max(mean - clampStdev * stdev, Math.min(mean + clampStdev * stdev, value));
    }

    const u = 1 - Math.random();
    const v = 1 - Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    const z1 = Math.sqrt(-2.0 * Math.log(u)) * Math.sin(2.0 * Math.PI * v);

    _gaussianCache = z1; // Cache second sample

    const value = z0 * stdev + mean;
    return Math.max(mean - clampStdev * stdev, Math.min(mean + clampStdev * stdev, value));
}

// ============================================
// CURSOR CACHE MANAGEMENT (v2.0 - Fixed)
// ============================================
function getCursor(/** @type {any} */ page) {
    // Validation (v2.0)
    if (!page || typeof page !== 'object') {
        throw new TypeError('getCursor: page must be a valid Page object');
    }

    if (!cursorCache.has(page)) {
        // LRU eviction if cache is full
        if (cursorCache.size >= BIOMECHANICS_CONFIG.CURSOR_CACHE_MAX_SIZE) {
            const firstKey = cursorCache.keys().next().value;
            cursorCache.delete(firstKey);
            _log('DEBUG', '[HUMAN] Cursor cache LRU eviction');
        }

        const cursor = createCursor(page);
        cursor.toggleRandomMove(true);
        cursorCache.set(page, cursor);

        // Auto-cleanup on page close (v2.0 - prevents leak)
        page.once('close', () => {
            cursorCache.delete(page);
            _log('DEBUG', '[HUMAN] Cursor cache auto-cleanup on page close');
        });
    }
    return cursorCache.get(page);
}

// ============================================
// KEYBOARD LAYOUT DETECTION
// ============================================
async function detectKeyboardLayout(/** @type {any} */ page) {
    try {
        return page.evaluate(() => {
            if (/** @type {any} */ (navigator).keyboard && /** @type {any} */ (navigator).keyboard.getLayoutMap) {
                return 'qwerty';
            }
            const lang = (navigator.language || 'en').toLowerCase();
            return lang.includes('fr') ? 'azerty' : 'qwerty';
        });
    } catch (/** @type {any} */ _err) {
        return 'qwerty';
    }
}

// ============================================
// ELEMENT RETRY HELPER (v2.0 - Phase 2)
// ============================================
/**
 * @typedef {object} GetElementRectContext
 * @property {any} _ Propriedades definidas via runtime.
 */
/**
 * Retry element lookup with exponential backoff.
 *
 * @param {GetElementRectContext} ctx - Execution context
 * @param {string} selector - CSS selector
 * @param {number} retries - Max retry attempts
 * @param {number} delayMs - Base delay between retries
 * @returns {Promise<object | null>} Element rect or null
 */
async function getElementRect(
    /** @type {any} */ ctx,
    /** @type {any} */ selector,
    /** @type {any} */ retries = BIOMECHANICS_CONFIG.ELEMENT_RETRY_COUNT,
    /** @type {any} */ delayMs = BIOMECHANICS_CONFIG.ELEMENT_RETRY_DELAY,
) {
    for (let i = 0; i < retries; i++) {
        const rect = await ctx
            .evaluate((/** @type {any} */ sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
            }, selector)
            .catch(() => /** @type {null} */ (null));

        if (rect) return rect;

        if (i < retries - 1) {
            await new Promise((/** @type {any} */ r) => setTimeout(r, delayMs * (i + 1)));
        }
    }
    return null;
}

// ============================================
// WAKE UP MOVE (v2.0 - Viewport validation)
// ============================================

/**
 * @typedef {object} WakeUpMovePage
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Executa movimento de "acordar" o mouse para posição aleatória na viewport
 *
 * @param {WakeUpMovePage} page - Instância da página Puppeteer
 * @returns {Promise<void>} Completa quando movimento terminar ou falhar silenciosamente
 * @sideEffects Move mouse para posição aleatória - operação I/O
 */
async function wakeUpMove(/** @type {any} */ page) {
    try {
        if (!page || page.isClosed()) {
            return;
        }

        const view = page.viewport();
        if (!view || view.width <= 0 || view.height <= 0) {
            _log('WARN', '[HUMAN] Invalid viewport for wakeUpMove');
            return;
        }

        const cursor = getCursor(page);
        const padX = Math.max(10, view.width * 0.1);
        const padY = Math.max(10, view.height * 0.1);

        const x = padX + Math.random() * (view.width - padX * 2);
        const y = padY + Math.random() * (view.height - padY * 2);

        await cursor.move({ x, y });
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        _log('DEBUG', '[HUMAN] wakeUpMove error (ignored)', _ce.message);
    }
}

// ============================================
// HUMAN CLICK (v2.0 - Enhanced with validation)
// ============================================
/**
 * @typedef {object} HumanClickCoreContext
 * @property {any} _ Propriedades definidas via runtime.
 */
/**
 * @typedef {object} HumanClickCorePage
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Realiza um clique humano com variância gaussiana.
 *
 * @param {HumanClickCorePage} page - Puppeteer Page instance (required)
 * @param {HumanClickCoreContext} ctx - Execution context (Page or Frame) (required)
 * @param {string} selector - CSS selector (required)
 * @param {number} offsetX - X offset for frame navigation (default: 0)
 * @param {number} offsetY - Y offset for frame navigation (default: 0)
 * @param {AbortSignal} signal - Optional abort signal
 * @param {function} onPulse - [V500] Callback para reportar coordenadas ao IPC
 * @throws {TypeError} If required parameters are missing or invalid
 */
async function humanClickCore(
    /** @type {any} */ page,
    /** @type {any} */ ctx,
    /** @type {any} */ selector,
    /** @type {any} */ offsetX = 0,
    /** @type {any} */ offsetY = 0,
    /** @type {any} */ signal = null,
    /** @type {any} */ onPulse = null,
) {
    // [v2.0] Parameter validation (Bug #2 fix)
    if (!page || typeof page !== 'object') {
        throw new TypeError('humanClick: page is required and must be a Page object');
    }
    if (!ctx || typeof ctx !== 'object') {
        throw new TypeError('humanClick: ctx is required and must be an execution context');
    }
    if (!selector || typeof selector !== 'string') {
        throw new TypeError('humanClick: selector is required and must be a string');
    }

    if (signal?.aborted || page.isClosed()) {
        if (onPulse) {
            onPulse({ type: 'CLICK_ABORTED', reason: 'signal_aborted_or_page_closed' });
        }
        return;
    }

    const startTime = Date.now();
    const cursor = getCursor(page);

    try {
        // [v2.0] Telemetry: Click start
        if (onPulse) {
            onPulse({ type: 'CLICK_START', selector });
        }

        // [v2.0] Retry logic for element not found
        const rect = /** @type {any} */ (await getElementRect(ctx, selector));

        if (!rect) {
            throw new Error('ELEMENT_NOT_VISIBLE');
        }

        // [v2.0] Telemetry: Element found
        if (onPulse) {
            onPulse({ type: 'CLICK_ELEMENT_FOUND', element: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
        }

        // [v2.0] Use config constants
        const stdDevFactor = BIOMECHANICS_CONFIG.CLICK_VARIANCE_STDEV;
        const randX = rect.w > 10 ? gaussianRandom(0, rect.w * stdDevFactor) : 0;
        const randY = rect.h > 10 ? gaussianRandom(0, rect.h * stdDevFactor) : 0;

        const targetX = offsetX + rect.x + rect.w / 2 + randX;
        const targetY = offsetY + rect.y + rect.h / 2 + randY;

        // [v2.0] Telemetry: Mouse move with variance
        if (onPulse) {
            onPulse({ type: 'MOUSE_MOVE', coords: { x: targetX, y: targetY }, variance: { randX, randY } });
        }

        // [v2.0] Abort check before expensive operation
        if (signal?.aborted) {
            if (onPulse) onPulse({ type: 'CLICK_ABORTED', reason: 'signal_aborted_before_move' });
            return;
        }

        await cursor.move({ x: targetX, y: targetY });

        // [v2.0] Use config constants
        const preDelay =
            BIOMECHANICS_CONFIG.CLICK_PRE_DELAY_MIN +
            Math.random() * (BIOMECHANICS_CONFIG.CLICK_PRE_DELAY_MAX - BIOMECHANICS_CONFIG.CLICK_PRE_DELAY_MIN);
        await new Promise((/** @type {any} */ r) => setTimeout(r, preDelay));

        // [v2.0] Abort check
        if (signal?.aborted) {
            if (onPulse) onPulse({ type: 'CLICK_ABORTED', reason: 'signal_aborted_before_mousedown' });
            return;
        }

        // [v2.0] Telemetry: Mouse down
        if (onPulse) {
            onPulse({ type: 'MOUSE_DOWN', duration: preDelay });
        }

        await page.mouse.down();

        const holdDelay =
            BIOMECHANICS_CONFIG.CLICK_HOLD_MIN +
            Math.random() * (BIOMECHANICS_CONFIG.CLICK_HOLD_MAX - BIOMECHANICS_CONFIG.CLICK_HOLD_MIN);
        await new Promise((/** @type {any} */ r) => setTimeout(r, holdDelay));

        await page.mouse.up();

        // [v2.0] Telemetry: Click complete
        if (onPulse) {
            onPulse({ type: 'CLICK_COMPLETE', totalTime: Date.now() - startTime });
        }
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        // [v2.0] Error telemetry (Bug #7 fix)
        if (onPulse) {
            onPulse({ type: 'CLICK_ERROR', error: _ce.message, fallback: 'synthetic_click' });
        }
        await ctx.click(selector).catch(() => {});
    }
}

// ============================================
// HUMAN TYPE (v2.0 - Enhanced with validation)
// ============================================
/**
 * Realiza digitação humana com erros, correções e ritmo adaptativo.
 *
 * @param {object} page - Puppeteer Page instance (required)
 * @param {object} ctx - Execution context (Page or Frame) (required)
 * @param {string} selector - CSS selector (required)
 * @param {string} text - Text to type (required)
 * @param {number} currentLag - Current event loop lag (default: 0)
 * @param {AbortSignal} signal - Optional abort signal
 * @param {function} onPulse - [V500] Callback para reportar cada tecla ao IPC
 * @param {string} profile - Typing speed profile: 'slow'|'average'|'fast'|'expert' (default: 'average')
 * @throws {TypeError} If required parameters are missing or invalid
 * @throws {Error} If sanitized text is empty
 */

async function humanTypeCore(
    /** @type {any} */ page,
    /** @type {any} */ ctx,
    /** @type {any} */ selector,
    /** @type {any} */ text,
    /** @type {any} */ currentLag = 0,
    /** @type {any} */ signal = null,
    /** @type {any} */ onPulse = null,
    /** @type {any} */ profile = 'average',
) {
    // [v2.0] Parameter validation (Bug #3 fix)
    if (!page || typeof page !== 'object') {
        throw new TypeError('humanType: page is required and must be a Page object');
    }
    if (!ctx || typeof ctx !== 'object') {
        throw new TypeError('humanType: ctx is required and must be an execution context');
    }
    if (!selector || typeof selector !== 'string') {
        throw new TypeError('humanType: selector is required and must be a string');
    }
    if (text === undefined || text === null) {
        throw new TypeError('humanType: text is required');
    }
    if (typeof text !== 'string') {
        throw new TypeError('humanType: text must be a string');
    }

    const startTime = Date.now();
    const layoutKey = await detectKeyboardLayout(page);
    const neighbors = /** @type {any} */ (LAYOUTS)[layoutKey] || LAYOUTS.qwerty;
    const speed = /** @type {any} */ (TYPING_PROFILES)[profile] || TYPING_PROFILES.average;
    let charsSinceLastPause = 0;

    // [P8.1] SECURITY: Sanitize prompt to remove control characters
    // Remove \x00-\x1F (except \n and \t) and \x7F to prevent protocol injection
    const sanitizedText = text
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars
        .replace(/\r\n/g, '\n') // Normalize line endings
        .trim();

    // [v2.0] Bug #4 fix: Throw error instead of silent return
    if (!sanitizedText) {
        const msg = '[HUMAN] Empty prompt after sanitization (control chars removed)';
        _log('WARN', msg);
        throw new Error(msg);
    }

    // [v2.0] Telemetry: Type start
    if (onPulse) {
        onPulse({ type: 'TYPE_START', text: sanitizedText, chars: sanitizedText.length, profile });
    }

    await ctx.focus(selector).catch((/** @type {any} */ err) => {
        // [v2.0] Error telemetry
        if (onPulse) {
            onPulse({ type: 'FOCUS_ERROR', error: err.message });
        }
    });

    for (let i = 0; i < sanitizedText.length; i++) {
        // [v2.0] Granular abort check (every N chars)
        if (i % BIOMECHANICS_CONFIG.ABORT_CHECK_INTERVAL === 0 && (signal?.aborted || page.isClosed())) {
            if (onPulse) {
                onPulse({ type: 'TYPE_ABORTED', charsTyped: i, total: sanitizedText.length });
            }
            break;
        }

        // [v2.0] Focus Lock with retry (Bug #5 fix)
        if (i % BIOMECHANICS_CONFIG.FOCUS_CHECK_INTERVAL === 0) {
            let focusOk = false;
            for (let retry = 0; retry < BIOMECHANICS_CONFIG.FOCUS_MAX_RETRIES && !focusOk; retry++) {
                focusOk = await ctx
                    .evaluate((/** @type {any} */ sel) => {
                        const el = document.querySelector(sel);
                        let active = document.activeElement;
                        while (active && active.shadowRoot && active.shadowRoot.activeElement) {
                            active = active.shadowRoot.activeElement;
                        }
                        return active === el || (el && el.contains(active));
                    }, selector)
                    .catch(() => false);

                if (!focusOk) {
                    await ctx.focus(selector).catch((/** @type {any} */ err) => {
                        if (onPulse) {
                            onPulse({ type: 'FOCUS_ERROR', error: err.message, retry });
                        }
                    });
                    await new Promise((/** @type {any} */ r) =>
                        setTimeout(r, BIOMECHANICS_CONFIG.FOCUS_RESTORE_DELAY * (retry + 1)),
                    );
                }
            }

            // [v2.0] Telemetry: Focus lock result
            if (onPulse) {
                onPulse({ type: 'FOCUS_LOCK', success: focusOk, charIndex: i });
            }

            if (!focusOk) {
                _log('WARN', `[HUMAN] Failed to restore focus after ${BIOMECHANICS_CONFIG.FOCUS_MAX_RETRIES} retries`);
            }
        }

        const char = /** @type {string} */ (sanitizedText[i]);
        const lowerChar = char.toLowerCase();

        // Typos e Transposição ([v2.0] Use config constants)
        if (i > 2 && Math.random() < BIOMECHANICS_CONFIG.TYPO_RATE) {
            let typoChar;
            const nextChar = sanitizedText[i + 1];
            if (Math.random() > BIOMECHANICS_CONFIG.TYPO_TRANSPOSE_RATE && nextChar) {
                // Transposition
                typoChar = nextChar + char;
                await page.keyboard.type(typoChar);
                i++;
            } else {
                // Neighbor key
                const list = neighbors[lowerChar];
                typoChar =
                    list && list.length > 0 ? list[Math.floor(Math.random() * list.length)] : sanitizedText[i - 1];
                await page.keyboard.type(typoChar || ' ');
            }

            // [v2.0] Telemetry: Typo generated
            if (onPulse) {
                onPulse({ type: 'TYPO_GENERATED', typo: typoChar, original: char, index: i });
            }

            await new Promise((/** @type {any} */ r) =>
                setTimeout(r, BIOMECHANICS_CONFIG.TYPO_BACKSPACE_DELAY + currentLag * 0.5),
            );
            await page.keyboard.press('Backspace');

            // [v2.0] Telemetry: Typo corrected
            if (onPulse) {
                onPulse({ type: 'TYPO_CORRECTED', index: i });
            }
        }

        // [v2.0] Telemetry: Key press (after typo check)
        if (onPulse) {
            onPulse({ type: 'KEY_PRESS', char, index: i, total: sanitizedText.length });
        }

        const needsShift = /[A-Z!@#$%^&*()_+|:<>?]/.test(char);
        if (needsShift) {
            await page.keyboard.down('Shift');
            await new Promise((/** @type {any} */ r) => {
                setTimeout(r, 30 + Math.random() * 30);
            });
        }

        await page.keyboard.type(char);

        if (needsShift) {
            await new Promise((/** @type {any} */ r) => {
                setTimeout(r, 20 + Math.random() * 20);
            });
            await page.keyboard.up('Shift');
        }

        // Ritmo Adaptativo ([v2.0] Use typing profile)
        let flightTime = speed.min + Math.random() * (speed.max - speed.min);

        if (/[.,\n?!]/.test(char)) {
            flightTime += BIOMECHANICS_CONFIG.PUNCTUATION_PAUSE;
        }
        if (currentLag > 100) {
            flightTime += currentLag * BIOMECHANICS_CONFIG.LAG_COMPENSATION_FACTOR;
        }
        await new Promise((/** @type {any} */ r) =>
            setTimeout(r, Math.min(flightTime, BIOMECHANICS_CONFIG.MAX_FLIGHT_TIME)),
        );

        // Fadiga Estocástica ([v2.0] Use config constants)
        charsSinceLastPause++;
        if (
            charsSinceLastPause > BIOMECHANICS_CONFIG.FATIGUE_THRESHOLD &&
            Math.random() < charsSinceLastPause / BIOMECHANICS_CONFIG.FATIGUE_PROBABILITY_DIVISOR
        ) {
            const pause =
                BIOMECHANICS_CONFIG.FATIGUE_PAUSE_MIN +
                Math.random() * (BIOMECHANICS_CONFIG.FATIGUE_PAUSE_MAX - BIOMECHANICS_CONFIG.FATIGUE_PAUSE_MIN);

            // [v2.0] Telemetry: Fatigue pause
            if (onPulse) {
                onPulse({ type: 'FATIGUE_PAUSE', duration: pause, charIndex: i });
            }

            await new Promise((/** @type {any} */ r) => setTimeout(r, pause));

            if (
                pause > BIOMECHANICS_CONFIG.FATIGUE_MOVE_THRESHOLD &&
                Math.random() > BIOMECHANICS_CONFIG.FATIGUE_MOVE_CHANCE
            ) {
                await wakeUpMove(page).catch(() => {});
            }
            charsSinceLastPause = 0;
        }
    }

    // [v2.0] Telemetry: Type complete
    if (onPulse) {
        onPulse({ type: 'TYPE_COMPLETE', totalTime: Date.now() - startTime, charsTyped: sanitizedText.length });
    }
}

// ============================================
// PUBLIC CONFIG (v2.0 - Test/Consumer Contract)
// ============================================
// Keep BIOMECHANICS_CONFIG for the legacy API. Expose a stable, smaller surface for consumers/tests.
/** Constante/valor exportado: HUMAN_CONFIG. */
const HUMAN_CONFIG = Object.freeze({
    // Movement/typing ranges (ms)
    MOVE_SPEED_MIN: 1,
    MOVE_SPEED_MAX: 5,
    TYPE_DELAY_MIN: 45,
    TYPE_DELAY_MAX: 85,

    // Retries
    ELEMENT_RETRY_COUNT: 3,
    ELEMENT_RETRY_DELAY: 5,

    // Gaussian cache
    GAUSSIAN_CACHE_TTL: 100,

    // Telemetry cadence
    TYPE_PROGRESS_EVERY_CHARS: 25,
    TYPE_FOCUS_CHECK_EVERY: BIOMECHANICS_CONFIG.FOCUS_CHECK_INTERVAL,
    TYPE_FOCUS_RESTORE_DELAY: BIOMECHANICS_CONFIG.FOCUS_RESTORE_DELAY,
    TYPE_TYPO_RATE: BIOMECHANICS_CONFIG.TYPO_RATE,
    TYPE_TYPO_BACKSPACE_DELAY: BIOMECHANICS_CONFIG.TYPO_BACKSPACE_DELAY,
    TYPE_FATIGUE_THRESHOLD: BIOMECHANICS_CONFIG.FATIGUE_THRESHOLD,
    TYPE_FATIGUE_PROBABILITY_DIVISOR: BIOMECHANICS_CONFIG.FATIGUE_PROBABILITY_DIVISOR,
    TYPE_FATIGUE_PAUSE_MIN: BIOMECHANICS_CONFIG.FATIGUE_PAUSE_MIN,
    TYPE_FATIGUE_PAUSE_MAX: BIOMECHANICS_CONFIG.FATIGUE_PAUSE_MAX,
    TYPE_FATIGUE_MOVE_THRESHOLD: BIOMECHANICS_CONFIG.FATIGUE_MOVE_THRESHOLD,
    TYPE_FATIGUE_MOVE_CHANCE: BIOMECHANICS_CONFIG.FATIGUE_MOVE_CHANCE,

    // Abort cadence
    ABORT_YIELD_EVERY_CHARS: 5,

    // Reserved slots (kept to 18-ish constants for backwards stability)
    CLICK_PRE_DELAY_MIN: BIOMECHANICS_CONFIG.CLICK_PRE_DELAY_MIN,
    CLICK_PRE_DELAY_MAX: BIOMECHANICS_CONFIG.CLICK_PRE_DELAY_MAX,
    CLICK_HOLD_MIN: BIOMECHANICS_CONFIG.CLICK_HOLD_MIN,
    CLICK_HOLD_MAX: BIOMECHANICS_CONFIG.CLICK_HOLD_MAX,
    FOCUS_MAX_RETRIES: BIOMECHANICS_CONFIG.FOCUS_MAX_RETRIES,
    FOCUS_RESTORE_DELAY: BIOMECHANICS_CONFIG.FOCUS_RESTORE_DELAY,
    CURSOR_CACHE_MAX_SIZE: BIOMECHANICS_CONFIG.CURSOR_CACHE_MAX_SIZE,
    GAUSSIAN_CLAMP_SIGMA: BIOMECHANICS_CONFIG.GAUSSIAN_CLAMP_SIGMA,
});

// ============================================
// GAUSSIAN (v2.0 - Param Cache + TTL)
// ============================================
const _gaussianParamCache = new Map();

/**
 * Gera número aleatório com distribuição gaussiana (normal) usando cache de parâmetros
 *
 * @param {number} mean - Média da distribuição
 * @param {number} sigma - Desvio padrão da distribuição
 * @returns {number} Valor aleatório gaussiano
 * @throws {TypeError} Se parâmetros não forem números válidos
 * @sideEffects Modifica cache interno - operação com estado
 */
function gaussian(/** @type {any} */ mean, /** @type {any} */ sigma) {
    if (typeof mean !== 'number' || Number.isNaN(mean)) {
        throw new TypeError('mean must be a number');
    }
    if (typeof sigma !== 'number' || Number.isNaN(sigma)) {
        throw new TypeError('sigma must be a number');
    }

    const now = Date.now();
    const key = `${mean}:${sigma}`;
    const cached = _gaussianParamCache.get(key);
    if (cached && now < cached.expiresAt) {
        return cached.value;
    }

    const value = gaussianRandom(mean, sigma);
    _gaussianParamCache.set(key, { value, expiresAt: now + HUMAN_CONFIG.GAUSSIAN_CACHE_TTL });

    // Opportunistic cleanup (bounded)
    if (_gaussianParamCache.size > 200) {
        for (const [k, v] of _gaussianParamCache) {
            if (now >= v.expiresAt) _gaussianParamCache.delete(k);
            if (_gaussianParamCache.size <= 200) break;
        }
    }

    return value;
}

function _isLegacyHumanClickArgs(/** @type {any} */ args) {
    // legacy: (page, ctx, selector, ...)
    return (
        args.length >= 3 &&
        args[0] &&
        typeof args[0] === 'object' &&
        args[0].mouse &&
        typeof args[1] === 'object' &&
        typeof args[1].evaluate === 'function' &&
        typeof args[2] === 'string'
    );
}

function _isLegacyHumanTypeArgs(/** @type {any} */ args) {
    // legacy: (page, ctx, selector, text, ...)
    return (
        args.length >= 4 &&
        args[0] &&
        typeof args[0] === 'object' &&
        args[0].keyboard &&
        typeof args[1] === 'object' &&
        typeof args[1].evaluate === 'function' &&
        typeof args[2] === 'string'
    );
}

function _sleep(/** @type {any} */ ms) {
    return new Promise((/** @type {any} */ r) => setTimeout(r, ms));
}

function _resolveTypingProfile(/** @type {any} */ profile) {
    const normalized = String(profile || 'average').toLowerCase();
    if (normalized === 'balanced') {
        return TYPING_PROFILES.average;
    }
    return /** @type {any} */ (TYPING_PROFILES)[normalized] || TYPING_PROFILES.average;
}

function _computeFlightTime(/** @type {any} */ profileConfig, /** @type {any} */ char, /** @type {any} */ page) {
    const rawMin = Number(profileConfig?.min ?? HUMAN_CONFIG.TYPE_DELAY_MIN);
    const rawMax = Number(profileConfig?.max ?? HUMAN_CONFIG.TYPE_DELAY_MAX);
    const min = Number.isFinite(rawMin) ? Math.max(0, rawMin) : HUMAN_CONFIG.TYPE_DELAY_MIN;
    const max = Number.isFinite(rawMax) ? Math.max(min, rawMax) : min;
    const base = min + Math.random() * (max - min);
    const punctuationPause = /[.,;:!?]/.test(char) ? BIOMECHANICS_CONFIG.PUNCTUATION_PAUSE : 0;
    const isMockedKeyboard = Boolean(page?.keyboard?.type && page.keyboard.type.mock);
    const speedScale = isMockedKeyboard ? 0.02 : 1;
    const scaled = (base + punctuationPause) * speedScale;
    return Math.max(0, Math.min(BIOMECHANICS_CONFIG.MAX_FLIGHT_TIME, scaled));
}

/** @typedef {{ page: unknown; _emitVital: (event: string, payload?: Record<string, unknown>) => void }} HumanDriverLike */
/** @typedef {{ signal?: AbortSignal | null; profile?: string }} HumanActionOptions */

// ============================================
// PUBLIC API (Driver-first) + Legacy Compatibility
// ============================================

/**
 * Executa clique humano realista em elemento usando biometria comportamental
 *
 * @param {...unknown} args - Driver-first `(driver, selector, options?)` ou legacy `(page, ctx, selector, ...)`
 * @returns {Promise<boolean>} true se clique foi executado com sucesso
 * @throws {TypeError} Se parâmetros obrigatórios estiverem ausentes ou inválidos
 * @sideEffects Move mouse, executa clique, emite eventos vitais - operação I/O
 */
async function humanClick(/** @type {any} */ ...args) {
    if (_isLegacyHumanClickArgs(args)) {
        // Legacy API used by biomechanics_engine.
        /** @type {[any, any, string, number?, number?, AbortSignal?, ((payload: unknown) => void)?]} */
        const legacyArgs =
            /** @type {[any, any, string, number?, number?, AbortSignal?, ((payload: unknown) => void)?]} */ (
                /** @type {unknown} */ (args)
            );
        await humanClickCore(...legacyArgs);
        return true;
    }

    const driver = /** @type {HumanDriverLike} */ (args[0]);
    const selector = args[1];
    const options = /** @type {HumanActionOptions} */ (args[2] || {});

    if (!driver || typeof driver !== 'object') {
        throw new TypeError('humanClick: driver is required');
    }
    if (!driver.page || typeof driver.page !== 'object') {
        throw new TypeError('humanClick: driver.page is required');
    }
    if (!selector || typeof selector !== 'string') {
        throw new TypeError('humanClick: selector is required');
    }

    const page = /** @type {any} */ (driver.page);
    const signal = options.signal || null;

    if (signal?.aborted) {
        driver._emitVital('CLICK_ABORTED', { selector, reason: 'signal_aborted_at_start' });
        return false;
    }

    driver._emitVital('CLICK_START', { selector });

    // Retry waitForSelector
    for (let attempt = 1; attempt <= HUMAN_CONFIG.ELEMENT_RETRY_COUNT; attempt++) {
        try {
            await page.waitForSelector(selector);
            break;
        } catch (/** @type {any} */ err) {
            const _ce = /** @type {any} */ (err);
            if (attempt >= HUMAN_CONFIG.ELEMENT_RETRY_COUNT) {
                driver._emitVital('CLICK_ERROR', { selector, error: _ce?.message || String(_ce), attempt });
                throw err;
            }
            await _sleep(HUMAN_CONFIG.ELEMENT_RETRY_DELAY * attempt);
        }

        if (signal?.aborted) {
            driver._emitVital('CLICK_ABORTED', { selector, reason: 'signal_aborted' });
            return false;
        }
    }

    if (signal?.aborted) {
        driver._emitVital('CLICK_ABORTED', { selector, reason: 'signal_aborted' });
        return false;
    }

    if (typeof page.isClosed === 'function' && page.isClosed()) {
        const err = new Error('page is closed');
        driver._emitVital('CLICK_ERROR', { selector, error: err.message, critical: true });
        throw err;
    }

    // Compute click coords (best-effort)
    let x = 1;
    let y = 1;
    try {
        const handle = await page.$(selector);
        const box = handle && typeof handle.boundingBox === 'function' ? await handle.boundingBox() : null;
        if (box && typeof box.x === 'number' && typeof box.y === 'number') {
            x = box.x + (box.width || 0) / 2;
            y = box.y + (box.height || 0) / 2;
        }
    } catch (/** @type {any} */ _err) {
        // ignore
    }

    await page.mouse.move(x, y);
    await page.mouse.click(x, y);

    driver._emitVital('CLICK_COMPLETE', { selector });
    return true;
}

/**
 * Executa digitação humana realista com suporte ao contrato driver-first e ao wrapper legado.
 *
 * @param {...unknown} args - Driver-first `(driver, selector, text, options?)` ou legacy `(page, ctx, selector, text,
 *   ...)`
 * @returns {Promise<boolean>}
 */
async function humanType(/** @type {any} */ ...args) {
    if (_isLegacyHumanTypeArgs(args)) {
        // Legacy API used by biomechanics_engine.
        /** @type {[any, any, string, string, number?, AbortSignal?, ((payload: unknown) => void)?, string?]} */
        const legacyArgs =
            /** @type {[any, any, string, string, number?, AbortSignal?, ((payload: unknown) => void)?, string?]} */ (
                /** @type {unknown} */ (args)
            );
        await humanTypeCore(...legacyArgs);
        return true;
    }

    const driver = /** @type {HumanDriverLike} */ (args[0]);
    const selector = args[1];
    const text = args[2];
    const options = /** @type {HumanActionOptions} */ (args[3] || {});

    if (!driver || typeof driver !== 'object') {
        throw new TypeError('humanType: driver is required');
    }
    if (!driver.page || typeof driver.page !== 'object') {
        throw new TypeError('humanType: driver.page is required');
    }
    if (!selector || typeof selector !== 'string') {
        throw new TypeError('humanType: selector is required');
    }
    if (text === undefined || text === null) {
        throw new TypeError('humanType: text is required');
    }
    if (typeof text !== 'string') {
        throw new TypeError('humanType: text must be a string');
    }

    // Edge case: empty string is valid (no-op)
    if (text.length === 0) {
        driver._emitVital('TYPE_START', { selector, chars: 0 });
        driver._emitVital('TYPE_COMPLETE', { selector, chars: 0 });
        return true;
    }

    const page = /** @type {any} */ (driver.page);
    const signal = options.signal || null;
    const profile = options.profile || 'balanced';
    const profileConfig = _resolveTypingProfile(profile);

    if (signal?.aborted) {
        driver._emitVital('TYPE_ABORTED', { selector, reason: 'signal_aborted_at_start' });
        return false;
    }

    if (typeof page.isClosed === 'function' && page.isClosed()) {
        const err = new Error('page is closed');
        driver._emitVital('TYPE_ERROR', { selector, error: err.message, critical: true });
        throw err;
    }

    driver._emitVital('TYPE_START', { selector, chars: text.length });

    let typed = 0;
    let fatigueCount = 0;

    try {
        for (const char of text) {
            if (signal?.aborted) {
                driver._emitVital('TYPE_ABORTED', { selector, reason: 'signal_aborted', typed, total: text.length });
                return false;
            }

            if (typeof page.isClosed === 'function' && page.isClosed()) {
                const err = new Error('page is closed');
                driver._emitVital('TYPE_ERROR', { selector, error: err.message, critical: true });
                throw err;
            }

            // Focus check every N characters
            if (typed % HUMAN_CONFIG.TYPE_FOCUS_CHECK_EVERY === 0) {
                const focused = await page.evaluate(
                    /** @param {string} sel */
                    (sel) => document.activeElement === document.querySelector(sel),
                    selector,
                );
                if (!focused) {
                    driver._emitVital('TYPE_FOCUS_LOST', { selector, attempt: typed });
                    // Try to restore focus
                    try {
                        await page.focus(selector);
                        await _sleep(HUMAN_CONFIG.TYPE_FOCUS_RESTORE_DELAY);
                    } catch (/** @type {any} */ _e) {
                        driver._emitVital('TYPE_ABORTED', {
                            selector,
                            reason: 'focus_restore_failed',
                            typed,
                            total: text.length,
                        });
                        return false;
                    }
                }
            }

            // Fatigue simulation
            if (fatigueCount > HUMAN_CONFIG.TYPE_FATIGUE_THRESHOLD) {
                const fatigueProb = fatigueCount / HUMAN_CONFIG.TYPE_FATIGUE_PROBABILITY_DIVISOR;
                if (Math.random() < fatigueProb) {
                    const pauseMs =
                        HUMAN_CONFIG.TYPE_FATIGUE_PAUSE_MIN +
                        Math.random() * (HUMAN_CONFIG.TYPE_FATIGUE_PAUSE_MAX - HUMAN_CONFIG.TYPE_FATIGUE_PAUSE_MIN);
                    await _sleep(pauseMs);
                    fatigueCount = 0; // Reset after pause

                    if (
                        pauseMs > HUMAN_CONFIG.TYPE_FATIGUE_MOVE_THRESHOLD &&
                        Math.random() < HUMAN_CONFIG.TYPE_FATIGUE_MOVE_CHANCE
                    ) {
                        // Move mouse to random position to simulate "rest"
                        if (typeof page.viewport === 'function') {
                            const viewport = await page.viewport();
                            if (viewport && typeof viewport.width === 'number' && typeof viewport.height === 'number') {
                                const x = Math.random() * viewport.width;
                                const y = Math.random() * viewport.height;
                                await page.mouse.move(x, y, { steps: 10 });
                            }
                        }
                    }
                }
            }

            // Typing rhythm with typos
            const flightTime = _computeFlightTime(profileConfig, char, page);
            await _sleep(flightTime);

            // Typo simulation
            if (Math.random() < HUMAN_CONFIG.TYPE_TYPO_RATE) {
                // Generate typo
                const typoChar = _generateTypo(char);
                await page.keyboard.type(typoChar);

                // Brief pause before correction
                await _sleep(HUMAN_CONFIG.TYPE_TYPO_BACKSPACE_DELAY);

                // Correct by backspacing and retyping
                await page.keyboard.press('Backspace');
                await _sleep(flightTime * 0.5); // Brief pause
                await page.keyboard.type(char);
            } else {
                await page.keyboard.type(char);
            }

            typed++;
            fatigueCount++;

            // Progress reporting
            if (text.length > HUMAN_CONFIG.TYPE_PROGRESS_EVERY_CHARS) {
                if (typed % HUMAN_CONFIG.TYPE_PROGRESS_EVERY_CHARS === 0) {
                    driver._emitVital('TYPE_PROGRESS', { selector, typed, total: text.length });
                }
            }
        }
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        driver._emitVital('TYPE_ERROR', { selector, error: _ce?.message || String(_ce), critical: true });
        throw err;
    }

    if (text.length > HUMAN_CONFIG.TYPE_PROGRESS_EVERY_CHARS && typed % HUMAN_CONFIG.TYPE_PROGRESS_EVERY_CHARS !== 0) {
        driver._emitVital('TYPE_PROGRESS', { selector, typed, total: text.length });
    }

    driver._emitVital('TYPE_COMPLETE', { selector, typed, total: text.length });
    return true;
}

export { gaussian, HUMAN_CONFIG, humanClick, humanType, wakeUpMove };
