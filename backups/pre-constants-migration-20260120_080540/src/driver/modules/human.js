/* ==========================================================================
   src/driver/modules/human.js
   Audit Level: 500 — Instrumented Biomechanics (IPC 2.0 Singularity)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Simulação biomecânica de mouse e teclado.
                     Agora suporta ganchos de amostragem para telemetria.
========================================================================== */

const { createCursor } = require('ghost-cursor');
const { log } = require('../../core/logger');

const cursorCache = new WeakMap();

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
        z: 'asx'
    }
};

function gaussianRandom(mean = 0, stdev = 1) {
    const u = 1 - Math.random();
    const v = 1 - Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdev + mean;
}

function getCursor(page) {
    if (!cursorCache.has(page)) {
        const cursor = createCursor(page);
        cursor.toggleRandomMove(true);
        cursorCache.set(page, cursor);
    }
    return cursorCache.get(page);
}

async function detectKeyboardLayout(page) {
    try {
        return page.evaluate(() => {
            if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
                return 'qwerty';
            }
            const lang = (navigator.language || 'en').toLowerCase();
            return lang.includes('fr') ? 'azerty' : 'qwerty';
        });
    } catch (e) {
        return 'qwerty';
    }
}

async function wakeUpMove(page) {
    try {
        if (!page || page.isClosed()) {
            return;
        }
        const cursor = getCursor(page);
        const view = page.viewport() || { width: 1280, height: 720 };
        const padX = view.width * 0.1;
        const padY = view.height * 0.1;
        await cursor.move({
            x: padX + Math.random() * (view.width - padX * 2),
            y: padY + Math.random() * (view.height - padY * 2)
        });
    } catch (_e) {
        // Ignore wake-up move errors
    }
}

/**
 * Realiza um clique humano com variância gaussiana.
 * @param {object} onPulse - [V500] Callback para reportar coordenadas ao IPC.
 */
async function humanClick(page, ctx, selector, offsetX = 0, offsetY = 0, signal = null, onPulse = null) {
    if (signal?.aborted || page.isClosed()) {
        return;
    }
    const cursor = getCursor(page);

    try {
        const rect = await ctx.evaluate(sel => {
            const el = document.querySelector(sel);
            if (!el) {
                return null;
            }
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
        }, selector);

        if (!rect) {
            throw new Error('ELEMENT_NOT_VISIBLE');
        }

        const stdDevFactor = 0.12;
        const randX = rect.w > 10 ? gaussianRandom(0, rect.w * stdDevFactor) : 0;
        const randY = rect.h > 10 ? gaussianRandom(0, rect.h * stdDevFactor) : 0;

        const targetX = offsetX + rect.x + rect.w / 2 + randX;
        const targetY = offsetY + rect.y + rect.h / 2 + randY;

        // [V500] Reporta o movimento final antes do clique
        if (onPulse) {
            onPulse({ type: 'MOUSE_MOVE', coords: { x: targetX, y: targetY } });
        }

        await cursor.move({ x: targetX, y: targetY });
        await new Promise(r => {
            setTimeout(r, 100 + Math.random() * 100);
        });
        await page.mouse.down();
        await new Promise(r => {
            setTimeout(r, 40 + Math.random() * 40);
        });
        await page.mouse.up();
    } catch (e) {
        await ctx.click(selector).catch(() => {});
    }
}

/**
 * Realiza digitação humana com erros, correções e ritmo adaptativo.
 * @param {object} onPulse - [V500] Callback para reportar cada tecla ao IPC.
 */
async function humanType(page, ctx, selector, text, currentLag = 0, signal = null, onPulse = null) {
    const layoutKey = await detectKeyboardLayout(page);
    const neighbors = LAYOUTS[layoutKey] || LAYOUTS.qwerty;
    let charsSinceLastPause = 0;

    await ctx.focus(selector).catch(() => {});

    for (let i = 0; i < text.length; i++) {
        if (signal?.aborted || page.isClosed()) {
            break;
        }

        // Focus Lock
        if (i % 25 === 0) {
            const focusOk = await ctx
                .evaluate(sel => {
                    const el = document.querySelector(sel);
                    let active = document.activeElement;
                    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
                        active = active.shadowRoot.activeElement;
                    }
                    return active === el || (el && el.contains(active));
                }, selector)
                .catch(() => false);

            if (!focusOk) {
                await ctx.focus(selector).catch(() => {});
                await new Promise(r => {
                    setTimeout(r, 200);
                });
            }
        }

        const char = text[i];
        const lowerChar = char.toLowerCase();

        // [V500] Reporta o pulso de digitação
        if (onPulse) {
            onPulse({ type: 'KEY_PRESS', char, index: i, total: text.length });
        }

        // Typos e Transposição
        if (i > 2 && Math.random() < 0.012) {
            if (Math.random() > 0.7 && text[i + 1]) {
                await page.keyboard.type(text[i + 1] + char);
                i++;
            } else {
                const list = neighbors[lowerChar];
                const typo = list && list.length > 0 ? list[Math.floor(Math.random() * list.length)] : text[i - 1];
                await page.keyboard.type(typo || ' ');
            }
            await new Promise(r => {
                setTimeout(r, 300 + currentLag * 0.5);
            });
            await page.keyboard.press('Backspace');
        }

        const needsShift = /[A-Z!@#$%^&*()_+|:<>?]/.test(char);
        if (needsShift) {
            await page.keyboard.down('Shift');
            await new Promise(r => {
                setTimeout(r, 30 + Math.random() * 30);
            });
        }

        await page.keyboard.type(char);

        if (needsShift) {
            await new Promise(r => {
                setTimeout(r, 20 + Math.random() * 20);
            });
            await page.keyboard.up('Shift');
        }

        // Ritmo Adaptativo
        let flightTime = 45 + Math.random() * 40;
        if (/[.,\n?!]/.test(char)) {
            flightTime += 180;
        }
        if (currentLag > 100) {
            flightTime += currentLag * 0.3;
        }
        await new Promise(r => {
            setTimeout(r, Math.min(flightTime, 800));
        });

        // Fadiga Estocástica
        charsSinceLastPause++;
        if (charsSinceLastPause > 30 && Math.random() < charsSinceLastPause / 220) {
            const pause = 400 + Math.random() * 1000;
            await new Promise(r => {
                setTimeout(r, pause);
            });
            if (pause > 800 && Math.random() > 0.6) {
                await wakeUpMove(page).catch(() => {});
            }
            charsSinceLastPause = 0;
        }
    }
}

module.exports = { humanClick, humanType, wakeUpMove };
