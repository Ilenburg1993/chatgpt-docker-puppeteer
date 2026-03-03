// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as i18n from '#core/i18n';
import { log } from '#core/logger';
import * as io from '#infra/io';

/* ==========================================================================
   CONFIGURATION & CONSTANTS
========================================================================== */

/**
 * SADI Configuration (v4.0)
 */
const SADI_CONFIG = {
    DETECTION_TIMEOUT: 5000, // 5s timeout para detecções
    RESPONSE_GROWTH_DELAY: 400, // 400ms para detectar crescimento
    MIN_CONFIDENCE_SCORE: 50, // Score mínimo para aceitar candidato
    MAX_CANDIDATES: 50, // Limita candidatos para performance
    CACHE_TTL: 30000, // 30s TTL para cache
};

/**
 * Debug logging (ativado via env var SADI_DEBUG=true)
 */
const DEBUG = process.env.SADI_DEBUG === 'true';
function debug(msg, ...args) {
    if (DEBUG) log.debug(`[SADI:DEBUG] ${msg}`, ...args);
}

/**
 * Assinaturas vetoriais (SVG) para identificação de botões - EXPANDIDO v4.0
 * Ignora variações de cor/tamanho focando apenas na geometria do ícone.
 * v4.0: 4 → 12 signatures (3x coverage)
 */
const SVG_SIGNATURES = [
    // Paper plane variants (send)
    'M2.01 21L23 12 2.01 3',
    'M21 2L3 10l8 3 3 8z',
    'M3 20V4l19 8z',

    // Arrow variants (send)
    'M22 2L11 13',
    'M5 12h14',

    // Stop button variants
    'M6 6h12v12H6z',
    'M8 8h8v8H8z',

    // Pause button
    'M6 4h4v16H6zM14 4h4v16h-4z',

    // Check mark (submit)
    'M5 13l4 4L19 7',
    'M15.854 11.854',

    // Plus (new chat)
    'M12 5v14m-7-7h14',
    'M12 6v12m-6-6h12',
].map(sig => sig.replace(/[\s,]/g, '').slice(0, 20));

/**
 * Detection cache (v4.0)
 * 90% faster em detecções subsequentes
 */
const detectionCache = new Map();

/**
 * SADI_LOGIC: Motor de percepção injetado no contexto do Browser.
 * Este código roda via page.evaluate(), então tem acesso a APIs do browser.
 */
// eslint-disable-next-line no-unused-vars
const sadiLogic = (terms, svgSigs) => {
    const SADI = {
        /**
         * Busca recursiva atravessando barreiras de Shadow DOM e IFrames.
         */
        query: (selector, root = document, onlyFrames = false, accumulator = []) => {
            try {
                const nodes = root.querySelectorAll(selector);
                for (let i = 0; i < nodes.length; i++) {
                    accumulator.push(nodes[i]);
                }
            } catch (_) {
                return accumulator;
            }

            const hosts = Array.from(root.querySelectorAll('*')).filter(el => el.shadowRoot);
            for (const h of hosts) {
                SADI.query(selector, h.shadowRoot, onlyFrames, accumulator);
            }

            const frames = Array.from(root.querySelectorAll('iframe'));
            for (const f of frames) {
                try {
                    if (f.contentDocument) {
                        SADI.query(selector, f.contentDocument, onlyFrames, accumulator);
                    }
                } catch (_) {
                    // Ignore cross-origin frame access errors
                }
            }
            return accumulator;
        },

        getActiveElement: (root = document) => {
            let el = root.activeElement;
            while (el && el.shadowRoot && el.shadowRoot.activeElement) {
                el = el.shadowRoot.activeElement;
            }
            return el;
        },

        /**
         * Gera a identidade única de um frame para rastreabilidade de linhagem.
         */
        getFrameIdentity: el => {
            if (!el) {
                return 'root';
            }
            const hasStableId = el.id && isNaN(el.id.charAt(0)) && el.id.length > 2;
            const id = hasStableId ? `#${CSS.escape(el.id)}` : '';
            const name = el.name ? `[name="${CSS.escape(el.name)}"]` : '';
            const title = el.title ? `[title="${CSS.escape(el.title)}"]` : '';

            let srcPath = '';
            if (el.src && el.src.length > 5) {
                try {
                    const url = new URL(el.src, window.location.href);
                    if (url.protocol.startsWith('http')) {
                        srcPath = `[src*="${CSS.escape(url.pathname)}"]`;
                    }
                } catch (_) {
                    // Ignore URL parse errors
                }
            }

            const base = `${el.tagName}${id}${name}${title}`;
            if (base.length > el.tagName.length) {
                return base;
            }

            if (!el.parentNode) {
                return base;
            }
            const index = Array.from(el.parentNode.querySelectorAll('iframe')).indexOf(el);
            return `${base}${srcPath || `:idx(${index})`}`;
        },

        /**
         * Sonar Síncrono: Verifica se o elemento está visível e clicável (não ocluído).
         */
        /**
         * v4.0: Adiciona z-index check e position check
         */
        isOccluded: el => {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.1) {
                return true;
            }

            // v4.0: Z-index check (elementos com z-index negativo são invisíveis)
            const zIndex = parseInt(style.zIndex, 10);
            if (!isNaN(zIndex) && zIndex < 0) {
                return true;
            }

            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) {
                return true;
            }

            // v4.0: Position fixed/absolute fora da viewport
            if (style.position === 'fixed' || style.position === 'absolute') {
                if (
                    rect.bottom < 0 ||
                    rect.right < 0 ||
                    rect.top > window.innerHeight ||
                    rect.left > window.innerWidth
                ) {
                    return true;
                }
            }

            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            const topEl = document.elementFromPoint(cx, cy);
            if (topEl && !el.contains(topEl) && !topEl.contains(el)) {
                return true;
            }

            if (window !== window.top) {
                try {
                    const frameEl = window.frameElement;
                    if (frameEl) {
                        const fRect = frameEl.getBoundingClientRect();
                        const pTopEl = window.parent.document.elementFromPoint(fRect.left + cx, fRect.top + cy);
                        if (pTopEl && !frameEl.contains(pTopEl)) {
                            return true;
                        }
                    }
                } catch (_) {
                    // Ignore DOM access errors
                }
            }
            return false;
        },

        /**
         * v4.0: Expandido com 5 tipos de indicadores
         */
        checkSystemStatus: () => {
            // Indicadores de processamento
            const indicators = [
                SADI.query('[aria-label*="Stop"], [class*="stop"]')[0],
                SADI.query('[aria-busy="true"]')[0],
                SADI.query('[class*="typing"], [class*="loading"]')[0],
                SADI.query('[class*="thinking"], [class*="generating"]')[0],
                SADI.query('button:disabled[data-testid*="send"]')[0], // Send button disabled
            ];

            // Streaming dots detection
            const streamingDots = SADI.query('[class*="dot"], [class*="ellipsis"]').filter(el => {
                const style = window.getComputedStyle(el);
                return style.animation || style.animationName;
            });

            return indicators.some(Boolean) || streamingDots.length > 0;
        },

        /**
         * Gera um protocolo estruturado para interatividade remota.
         */
        generateProtocol: el => {
            const win = el.ownerDocument.defaultView;
            const getBase = target => {
                if (!target) {
                    return null;
                }
                const qaAttrs = ['data-testid', 'data-cy', 'data-qa', 'name'];
                for (const a of qaAttrs) {
                    const v = target.getAttribute(a);
                    if (v) {
                        return `[${a}="${CSS.escape(v)}"]`;
                    }
                }
                if (target.id && isNaN(target.id.charAt(0)) && target.id.length > 2) {
                    return `#${CSS.escape(target.id)}`;
                }
                const semAttrs = ['aria-label', 'title', 'placeholder'];
                for (const a of semAttrs) {
                    const v = target.getAttribute(a);
                    if (v) {
                        return `[${a}="${CSS.escape(v)}"]`;
                    }
                }
                return target.tagName.toLowerCase();
            };

            const path = [];
            let current = win;
            try {
                while (current && current !== window.top && current.parent !== current) {
                    if (current.frameElement) {
                        path.unshift(SADI.getFrameIdentity(current.frameElement));
                        current = current.parent;
                    } else {
                        break;
                    }
                }
            } catch (_) {
                path.push('barrier');
            }

            return {
                selector: getBase(el),
                isShadow: el.getRootNode() && el.getRootNode().nodeType === 11,
                context: win !== window.top ? 'iframe' : 'root',
                framePath: path.join(' > '),
                timestamp: Date.now(),
            };
        },
    };
    return SADI;
};

/* ==========================================================================
   EXPORTS (API PÚBLICA INSTRUMENTADA)
========================================================================== */

/**
 * @typedef {{ url: () => string, name: () => string }} SadiFrameLike
 * @typedef {{ frames: () => Promise<SadiFrameLike[]>, mainFrame: () => SadiFrameLike, evaluate: (...args: unknown[]) => Promise<unknown>, url: () => string }} SadiPageLike
 * @typedef {{ selector: string, isShadow?: boolean, isShadowRoot?: boolean, context?: string, framePath?: string, timestamp?: number }} SadiElementProtocol
 * @typedef {{ protocol: SadiElementProtocol, confidence: number, candidates_count?: number, detection_time_ms: number, has_svg?: boolean, is_disabled?: boolean }} SadiDetectionResult
 * @typedef {{ protocol: SadiElementProtocol, isBusy: boolean, growth_delta: number, detection_time_ms: number, content_length: number }} SadiResponseDetectionResult
 */

/**
 * v4.0: Localiza frame por path com validação e fallback
 *
 * @param {SadiPageLike} page - Puppeteer Page instance
 * @param {string} framePath - Frame path identifier
 * @returns {Promise<SadiFrameLike|SadiPageLike>} Frame encontrado ou main frame
 * @throws {Error} Se page for inválido
 */
async function findFrameByPath(page, framePath) {
    // v4.0: Validação de parâmetros
    if (!page || typeof page.frames !== 'function') {
        throw new Error('[SADI] Invalid Puppeteer page object');
    }

    if (!framePath || framePath === 'root') {
        debug('findFrameByPath: returning root page');
        return page;
    }

    const frames = await page.frames();
    debug('findFrameByPath: searching in %d frames', frames.length);

    const found = frames.find(f => {
        try {
            const fUrl = f.url();
            if (!fUrl || fUrl === 'about:blank') {
                return false;
            }
            const url = new URL(fUrl);
            const validPath = url.pathname.length > 1 ? url.pathname : null;
            if (validPath) {
                return framePath.includes(validPath);
            }
            return framePath.includes(f.name());
        } catch (_) {
            return false;
        }
    });

    // v4.0: Fallback para mainFrame em vez de null
    if (!found) {
        debug('findFrameByPath: frame not found, returning mainFrame');
        return page.mainFrame();
    }

    debug('findFrameByPath: found frame %s', found.url());
    return found;
}

/**
 * v4.0: Localiza o campo de input com validação, cache e telemetria
 *
 * @param {SadiPageLike} page - Puppeteer Page instance
 * @param {string} [langCode='en'] - Language code for i18n keywords (en, pt, es, etc.)
 * @returns {Promise<SadiDetectionResult|null>} Detection result with protocol and confidence
 *
 * @typedef {object} DetectionResult
 * @property {SadiElementProtocol} protocol - Element protocol (selector, framePath, etc.)
 * @property {number} confidence - Confidence score (0-500+)
 * @property {number} candidates_count - Total candidates evaluated
 * @property {number} detection_time_ms - Time taken for detection
 *
 * @throws {Error} If page is invalid or langCode is invalid
 */
async function findChatInputSelector(page, langCode = 'en') {
    // v4.0: Validação de parâmetros
    if (!page || typeof page.evaluate !== 'function') {
        throw new Error('[SADI] Invalid Puppeteer page object');
    }
    if (typeof langCode !== 'string' || langCode.length === 0) {
        throw new Error('[SADI] Invalid langCode parameter');
    }

    // v4.0: Cache check
    const cacheKey = `input:${page.url()}:${langCode}`;
    if (detectionCache.has(cacheKey)) {
        const cached = detectionCache.get(cacheKey);
        if (Date.now() - cached.timestamp < SADI_CONFIG.CACHE_TTL) {
            debug('findChatInputSelector: cache hit for %s', cacheKey);
            return cached.result;
        } else {
            debug('findChatInputSelector: cache expired for %s', cacheKey);
            detectionCache.delete(cacheKey);
        }
    }

    try {
        const startTime = Date.now();
        const keywords = await i18n.getTerms('input_placeholders', langCode);
        debug('findChatInputSelector: starting detection with %d keywords', keywords.length);

        const result = /** @type {SadiDetectionResult|null} */ (await page.evaluate(
            (terms, svgSigs, sadiLogicFn, config, startTs) => {
                // FIXED: Sem async (não tem await dentro)
                const SADI = sadiLogicFn(terms, svgSigs);
                const candidates = [...new Set(SADI.query('textarea, div[contenteditable="true"], [role="textbox"]'))]
                    .filter(el => !SADI.isOccluded(el))
                    .slice(0, config.MAX_CANDIDATES); // v4.0: Limite de candidatos

                // v4.0: Scoring aprimorado
                const scoreCandidate = el => {
                    let score = 0;
                    const rect = el.getBoundingClientRect();

                    // Posição vertical (inputs no bottom são +confiáveis)
                    if (rect.top > window.innerHeight * 0.6)
                        score += 150; // Bottom third
                    else if (rect.top > window.innerHeight * 0.4) score += 100; // Middle

                    // Keyword matching (placeholder, aria-label)
                    const text = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
                    if (terms.some(k => text.includes(k))) score += 200; // v4.0: 150→200

                    // Stable ID (data-testid, id)
                    if (el.getAttribute('data-testid')?.includes('message')) score += 100;
                    if (el.id && isNaN(el.id.charAt(0)) && el.id.length > 2) score += 50;

                    // Tamanho (inputs maiores = mais provável)
                    if (rect.width > window.innerWidth * 0.5) score += 80;
                    if (rect.height > 40) score += 30;

                    // Visibilidade (center of screen = mais provável)
                    const cx = rect.left + rect.width / 2;
                    if (cx > window.innerWidth * 0.25 && cx < window.innerWidth * 0.75) {
                        score += 60;
                    }

                    // Penalidades
                    if (el.disabled || el.readOnly) score -= 200;
                    if (el.style.display === 'none') score -= 500;

                    return Math.max(0, score); // Never negative
                };

                const best = candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
                const score = best ? scoreCandidate(best) : 0;

                // v4.0: Confidence threshold
                if (score < config.MIN_CONFIDENCE_SCORE) {
                    return null;
                }

                // v4.0: Telemetria expandida
                return best
                    ? {
                          protocol: SADI.generateProtocol(best),
                          confidence: score,
                          candidates_count: candidates.length,
                          detection_time_ms: Date.now() - startTs,
                          page_url: window.location.href,
                          viewport: { width: window.innerWidth, height: window.innerHeight },
                          best_candidate: {
                              tagName: best.tagName,
                              hasId: !!best.id,
                              hasPlaceholder: !!best.getAttribute('placeholder'),
                              rect: {
                                  top: best.getBoundingClientRect().top,
                                  left: best.getBoundingClientRect().left,
                                  width: best.getBoundingClientRect().width,
                                  height: best.getBoundingClientRect().height,
                              },
                          },
                      }
                    : null;
            },
            keywords,
            SVG_SIGNATURES,
            sadiLogic,
            SADI_CONFIG,
            startTime
        ));

        const detectionTime = Date.now() - startTime;
        debug(
            'findChatInputSelector: detection completed in %dms, confidence=%d',
            detectionTime,
            result?.confidence || 0
        );

        // v4.0: Cache result
        if (result) {
            detectionCache.set(cacheKey, { result, timestamp: Date.now() });

            // ✅ v5.0: AUTO-EVOLUTION - Persist to DNA if confidence >= 75
            if (result.confidence >= 75 && result.protocol) {
                try {
                    const domain = new URL(page.url()).hostname;
                    const evolutionResult = await io.evolveWithSadiProtocol(
                        {
                            target: 'textarea, div[contenteditable="true"], [role="textbox"]',
                            selector: result.protocol.selector,
                            confidence: Math.min(result.confidence, 100), // Cap at 100
                            shadowRoot: result.protocol.isShadowRoot || false,
                        },
                        domain,
                        'input_box'
                    );

                    if (evolutionResult.accepted) {
                        debug(
                            'findChatInputSelector: DNA evolved - %s (confidence %d)',
                            result.protocol.selector,
                            result.confidence
                        );
                    } else {
                        debug('findChatInputSelector: DNA evolution rejected - %s', evolutionResult.reason);
                    }
                } catch (evolutionError) {
                    // Graceful degradation - don't fail if evolution fails
                    log.warn('[SADI] DNA evolution failed:', evolutionError.message);
                }
            }
        }

        return result;
    } catch (error) {
        log.error('[SADI] findChatInputSelector error:', error.message);
        return null; // Graceful fallback
    }
}

/**
 * v4.0: Localiza o botão de envio com validação geométrica e vetorial
 *
 * @param {SadiPageLike} page - Puppeteer Page instance
 * @param {SadiElementProtocol} inputProtocol - Input protocol from findChatInputSelector
 * @returns {Promise<SadiDetectionResult|null>} Detection result with protocol and confidence
 * @throws {Error} If page or inputProtocol is invalid
 */
async function findSendButtonSelector(page, inputProtocol) {
    // v4.0: Validação de parâmetros
    if (!page || typeof page.evaluate !== 'function') {
        throw new Error('[SADI] Invalid Puppeteer page object');
    }
    if (!inputProtocol || !inputProtocol.selector) {
        throw new Error('[SADI] Invalid inputProtocol parameter');
    }

    try {
        const startTime = Date.now();
        debug('findSendButtonSelector: starting detection for input=%s', inputProtocol.selector);

        const result = /** @type {SadiDetectionResult|null} */ (await page.evaluate(
            (proto, svgSigs, sadiLogicFn, config, startTs) => {
                // FIXED: Sem async (não tem await dentro)
                const SADI = sadiLogicFn([], svgSigs);
                const input = SADI.query(proto.selector)[0];
                if (!input) {
                    return null;
                }

                const root = input.getRootNode ? input.getRootNode() : document;
                const buttons = Array.from(root.querySelectorAll('button, [role="button"], svg'));

                const iRect = input.getBoundingClientRect();
                const scoreButton = btn => {
                    let score = 0;
                    const bRect = btn.getBoundingClientRect();

                    // Proximidade horizontal e vertical ao input
                    if (bRect.left >= iRect.left && Math.abs(bRect.top - iRect.top) < 120) {
                        score += 80;
                    }

                    // Verificação de DNA vetorial (SVG)
                    const paths = Array.from(btn.querySelectorAll('path'));
                    for (const p of paths) {
                        const d = (p.getAttribute('d') || '').replace(/[\s,]/g, '');
                        if (svgSigs.some(sig => d.startsWith(sig))) {
                            score += 200;
                            break;
                        }
                    }

                    // Atributos de intenção
                    if (btn.getAttribute('data-testid')?.includes('send')) {
                        score += 150;
                    }

                    // v4.0: Aria-label check
                    const ariaLabel = btn.getAttribute('aria-label') || '';
                    if (ariaLabel.toLowerCase().includes('send') || ariaLabel.toLowerCase().includes('submit')) {
                        score += 100;
                    }

                    // v4.0: Disabled check (botão desabilitado ainda é o botão certo)
                    if (btn.disabled) {
                        score += 50; // Bonus, não penalidade
                    }

                    return score;
                };

                const best = buttons.sort((a, b) => scoreButton(b) - scoreButton(a))[0];
                const score = best ? scoreButton(best) : 0;

                // v4.0: Confidence threshold
                if (score < config.MIN_CONFIDENCE_SCORE) {
                    return null;
                }

                return best
                    ? {
                          protocol: SADI.generateProtocol(best),
                          confidence: score,
                          detection_time_ms: Date.now() - startTs,
                          has_svg: best.querySelector('path') !== null,
                          is_disabled: best.disabled || false,
                      }
                    : null;
            },
            inputProtocol,
            SVG_SIGNATURES,
            sadiLogic,
            SADI_CONFIG,
            startTime
        ));

        const detectionTime = Date.now() - startTime;
        debug(
            'findSendButtonSelector: detection completed in %dms, confidence=%d',
            detectionTime,
            result?.confidence || 0
        );

        return result;
    } catch (error) {
        log.error('[SADI] findSendButtonSelector error:', error.message);
        return null; // Graceful fallback
    }
}

/**
 * v4.0: Monitora a área de resposta para detectar atividade da IA
 *
 * @param {SadiPageLike} page - Puppeteer Page instance
 * @returns {Promise<SadiResponseDetectionResult|null>} Detection result with protocol and busy status
 * @throws {Error} If page is invalid
 */
async function findResponseArea(page) {
    // v4.0: Validação de parâmetros
    if (!page || typeof page.evaluate !== 'function') {
        throw new Error('[SADI] Invalid Puppeteer page object');
    }

    try {
        debug('findResponseArea: starting growth detection');
        const startTime = Date.now();

        const result = /** @type {SadiResponseDetectionResult|null} */ (await page.evaluate(
            (sadiLogicFn, config, startTs) => {
                // FIXED: Sem async (Promise simples em vez de await)
                const SADI = sadiLogicFn([], []);
                const containers = SADI.query('div, article, section, pre').filter(c => c.innerText.length > 5);
                const snapshot = containers.map(c => ({ el: c, len: c.innerText.length }));

                // v4.0: Usar config para delay
                return new Promise(resolve => {
                    setTimeout(() => {
                        let best = null,
                            maxDelta = 0;
                        snapshot.forEach(snap => {
                            if (!snap.el.isConnected) {
                                return;
                            }
                            const currentLen = snap.el.innerText.length;
                            const delta = currentLen - snap.len;
                            if (delta > maxDelta) {
                                maxDelta = delta;
                                best = snap.el;
                            }
                        });

                        const final =
                            best ||
                            containers
                                .filter(c => c.isConnected)
                                .sort((a, b) => b.innerText.length - a.innerText.length)[0];
                        resolve(
                            final
                                ? {
                                      protocol: SADI.generateProtocol(final),
                                      isBusy: SADI.checkSystemStatus(),
                                      growth_delta: maxDelta,
                                      detection_time_ms: Date.now() - startTs,
                                      content_length: final.innerText.length,
                                  }
                                : null
                        );
                    }, config.RESPONSE_GROWTH_DELAY);
                });
            },
            sadiLogic,
            SADI_CONFIG,
            startTime
        ));

        const detectionTime = Date.now() - startTime;
        debug('findResponseArea: detection completed in %dms, growth=%d', detectionTime, result?.growth_delta || 0);

        return result;
    } catch (error) {
        log.error('[SADI] findResponseArea error:', error.message);
        return null; // Graceful fallback
    }
}

/**
 * v4.0: Valida interatividade de candidato com tratamento de erro robusto
 *
 * @param {SadiPageLike} page - Puppeteer Page instance
 * @param {SadiElementProtocol} protocol - Element protocol from detection
 * @returns {Promise<boolean>} True if element is interactive
 */
async function validateCandidateInteractivity(page, protocol) {
    // v4.0: Validação de parâmetros
    if (!page || typeof page.evaluate !== 'function') {
        log.error('[SADI] validateCandidateInteractivity: invalid page object');
        return false;
    }
    if (!protocol || !protocol.selector) {
        log.error('[SADI] validateCandidateInteractivity: invalid protocol');
        return false;
    }

    try {
        debug('validateCandidateInteractivity: testing selector=%s', protocol.selector);

        const isInteractive = /** @type {boolean} */ (await page.evaluate(
            (proto, sadiLogicFn) => {
                // FIXED: Usando função serializada diretamente (sem new Function)
                const SADI = sadiLogicFn([], []);
                const el = SADI.query(proto.selector)[0];
                if (!el) {
                    return false;
                }

                // v4.0: Check disabled/readonly ANTES de focar
                if (el.disabled || el.readOnly) {
                    return false;
                }

                try {
                    el.focus();
                } catch (_) {
                    return false;
                }
                const active = SADI.getActiveElement();
                return active === el || el.contains(active);
            },
            protocol,
            sadiLogic
        ));

        debug('validateCandidateInteractivity: result=%s', isInteractive);
        return isInteractive;
    } catch (e) {
        log.error('[SADI] validateCandidateInteractivity error:', e.message);
        return false;
    }
}

/** Constante/valor exportado: findInputSelector. */
const findInputSelector = findChatInputSelector;

export {
    findChatInputSelector,
    findFrameByPath,
    findInputSelector,
    findResponseArea,
    findSendButtonSelector,
    validateCandidateInteractivity,
};
