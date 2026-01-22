/* ==========================================================================
   src/driver/modules/triage.js
   Audit Level: 500 — Instrumented Diagnostic Triage (IPC 2.0)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Realizar autópsias em tempo real na interface para detectar
                     travamentos, bloqueios e anomalias sistêmicas.
   Sincronizado com: BaseDriver V320, RemediationEngine V550, i18n.js V32.
========================================================================== */

const stabilizer = require('./stabilizer');

const {
    STATUS_VALUES: STATUS_VALUES
} = require('@core/constants/tasks.js');

const i18n = require('@core/i18n');
const { log } = require('@core/logger');

const SNAPSHOT_DELAY_MS = 600;
const MAX_TEXT_PARTS = 1000;

/**
 * Realiza um diagnóstico profundo de "Stall" (travamento) na página.
 * @param {object} page - Instância do Puppeteer.
 * @param {string} langCode - Código de idioma para análise semântica.
 * @returns {Promise<object>} Diagnóstico estruturado para o Supervisor.
 */
async function diagnoseStall(page, langCode = 'en') {
    // 1. Verificação de Pulso de CPU (Event Loop Lag)
    const lag = await stabilizer.measureEventLoopLag(page);
    if (lag > 1500) {
        return {
            type: 'BROWSER_FROZEN',
            severity: 'CRITICAL',
            evidence: { lag_ms: lag },
            ts: Date.now()
        };
    }

    const errorTerms = await i18n.getTerms('error_indicators', langCode);
    const closeTerms = await i18n.getTerms('close_actions', langCode);

    try {
        const diagnosis = await page.evaluate(
            async (errors, closers, delayMs, maxParts) => {
                const Probe = {
                    /**
                     * Varredura Consolidada em passagem única (Single-Pass Scan).
                     */
                    // eslint-disable-next-line complexity -- Page scanning requires complex state management
                    scan: (
                        root = document,
                        acc = { textParts: [], nodeCount: 0, hasPassword: false, spinners: [], buttons: [] },
                        depth = 0
                    ) => {
                        if (depth > 15) {
                            return acc;
                        }
                        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
                        let node = walker.currentNode;

                        while (node) {
                            if (node.nodeType === 1) {
                                acc.nodeCount++;
                                const tag = node.tagName;

                                if (tag === 'INPUT' && node.type === 'password') {
                                    acc.hasPassword = true;
                                }
                                if (node.matches('.spinner, .loading, [aria-busy="true"]')) {
                                    acc.spinners.push(node);
                                }
                                if (tag === 'BUTTON' || node.getAttribute('role') === 'button') {
                                    acc.buttons.push(node);
                                }

                                if (acc.textParts.length < maxParts) {
                                    const text = (node.innerText || '').slice(0, 100);
                                    const attrs =
                                        (node.getAttribute('title') || '') + (node.getAttribute('aria-label') || '');
                                    if (text.length > 2 || attrs.length > 2) {
                                        acc.textParts.push(`${text}:${attrs}`);
                                    }
                                }

                                if (node.shadowRoot) {
                                    Probe.scan(node.shadowRoot, acc, depth + 1);
                                }
                                if (tag === 'IFRAME') {
                                    try {
                                        if (node.contentDocument) {
                                            Probe.scan(node.contentDocument, acc, depth + 1);
                                        }
                                    } catch {
                                        // Ignore cross-origin iframe access errors
                                    }
                                }
                            }
                            node = walker.nextNode();
                        }
                        return acc;
                    },

                    /**
                     * Detecta erros visuais (vermelho/laranja) em botões e alertas.
                     */
                    checkVisualError: buttons => {
                        const candidates = buttons.filter(b =>
                            b.matches('[role="alert"], .error, .warning, [class*="error"]')
                        );
                        for (const el of candidates) {
                            if (!el.isConnected || el.innerText.length < 3) {
                                continue;
                            }
                            const style = window.getComputedStyle(el);
                            if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
                                continue;
                            }

                            const parseRGB = str => {
                                const m = str.match(/\d+/g);
                                return m && m.length >= 3 ? { r: +m[0], g: +m[1], b: +m[2] } : null;
                            };

                            const fg = parseRGB(style.color);
                            const bg = parseRGB(style.backgroundColor);

                            const isAlert = c =>
                                c &&
                                ((c.r > 180 && c.g < 100 && c.b < 100) || // Vermelho
                                    (c.r > 200 && c.g > 100 && c.g < 200 && c.b < 80)); // Laranja

                            if (isAlert(fg) || isAlert(bg)) {
                                return el.innerText;
                            }
                        }
                        return null;
                    }
                };

                // Captura Snapshot 1
                const snap1 = Probe.scan();
                const startTime = performance.now();

                // Intervalo para detecção de entropia (movimento do DOM)
                await new Promise(r => {
                    setTimeout(r, delayMs);
                });

                // Captura Snapshot 2
                const snap2 = Probe.scan();

                const fullText = snap2.textParts.join('|').toLowerCase();

                // 2. BLOQUEIOS DE INFRAESTRUTURA / SEGURANÇA
                if (
                    fullText.includes('cloudflare') ||
                    fullText.includes('captcha') ||
                    document.querySelector('[id*="challenge"]')
                ) {
                    return { type: 'CAPTCHA_CHALLENGE', severity: 'CRITICAL', evidence: { detector: 'semantic_html' } };
                }
                if (snap2.hasPassword) {
                    return { type: 'LOGIN_REQUIRED', severity: 'HIGH', evidence: { detector: 'input_type_password' } };
                }

                // 3. BARREIRAS DE RENDERIZAÇÃO
                const hasMajorBarrier = Array.from(document.querySelectorAll('iframe')).some(f => {
                    try {
                        if (f.contentDocument) {
                            return false;
                        }
                    } catch {
                        const r = f.getBoundingClientRect();
                        return r.width > window.innerWidth * 0.4 && r.height > window.innerHeight * 0.4;
                    }
                    return false;
                });
                if (hasMajorBarrier && snap2.nodeCount < 50) {
                    return {
                        type: 'INFRA_BARRIER_DETECTED',
                        severity: 'HIGH',
                        evidence: { type: 'cross_origin_iframe' }
                    };
                }


                // 4. LIMITES E ERROS SEMÂNTICOS
                if (['limit', 'limite', 'quota', 'too many'].some(p => fullText.includes(p))) {
                    return { type: 'LIMIT_REACHED', severity: 'HIGH', evidence: { text: 'quota_exhausted' } };
                }

                const foundError = errors.find(term => fullText.includes(term.toLowerCase()));
                if (foundError) {
                    return { type: 'GENERIC_ERROR_TEXT', severity: 'MEDIUM', evidence: { term: foundError } };
                }

                // 5. ERRO VISUAL (Cores de Alerta)
                const visualErrorText = Probe.checkVisualError(snap2.buttons);
                if (visualErrorText) {
                    return {
                        type: 'VISUAL_ERROR_DETECTED',
                        severity: 'MEDIUM',
                        evidence: { text: visualErrorText.slice(0, 100) }
                    };
                }

                // 6. FIM ABRUPTO (Botão de Retry sem botão de Stop)
                const retryBtn = snap2.buttons.find(
                    b => closers.some(c => (b.innerText || '').toLowerCase().includes(c)) && b.offsetParent !== null
                );
                const stopBtn = snap2.buttons.find(
                    b =>
                        (b.querySelector('svg rect') || (b.innerText || '').toLowerCase().includes('stop')) &&
                        b.offsetParent !== null
                );
                if (retryBtn && !stopBtn) {
                    return { type: 'FINISHED_ABRUPTLY', severity: 'MEDIUM', evidence: { has_retry: true } };
                }

                // 7. LOOP LÓGICO (Spinning sem alteração de conteúdo)
                const semanticChanged = snap1.textParts.join('') !== snap2.textParts.join('');
                const domMutated = snap1.nodeCount !== snap2.nodeCount;
                const isSpinning = snap2.spinners.some(s => s.offsetParent !== null);

                if (!semanticChanged && !domMutated && isSpinning) {
                    return {
                        type: 'LOGICAL_LOOP',
                        severity: 'MEDIUM',
                        evidence: { duration_ms: performance.now() - startTime, is_spinning: true }
                    };
                }

                return null;
            },
            errorTerms,
            closeTerms,
            SNAPSHOT_DELAY_MS,
            MAX_TEXT_PARTS
        );

        // Retorna o diagnóstico encontrado ou um objeto de "Saúde OK"
        return diagnosis || { type: STATUS_VALUES.HEALTHY, severity: 'NONE', ts: Date.now() };
    } catch (e) {
        log('ERROR', `Falha na autópsia V70: ${e.message}`);
        return {
            type: 'DIAGNOSTIC_CRASH',
            severity: 'HIGH',
            evidence: { error: e.message },
            ts: Date.now()
        };
    }
}

module.exports = { diagnoseStall };
