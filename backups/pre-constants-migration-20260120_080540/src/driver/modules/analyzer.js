/* eslint-disable linebreak-style */
/* ==========================================================================
   src/driver/modules/analyzer.js
   Audit Level: 500 — Instrumented SADI Fortress (IPC 2.0)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Percepção visual profunda, identificação de elementos por
                     DNA (SVG/Atributos) e cálculo de confiança sensorial.
   Sincronizado com: BaseDriver V320, input_resolver.js V500, i18n.js V32.
========================================================================== */

const i18n = require('../../core/i18n');

/**
 * Assinaturas vetoriais (SVG) para identificação de botões de envio e parada.
 * Ignora variações de cor/tamanho focando apenas na geometria do ícone.
 */
const SVG_SIGNATURES = ['M2.01 21L23 12 2.01 3', 'M22 2L11 13', 'M15.854 11.854', 'M21 2L3 10l8 3 3 8z'].map(sig =>
    sig.replace(/[\s,]/g, '').slice(0, 20)
);

/**
 * SADI_LOGIC: Motor de percepção injetado no contexto do Browser.
 */
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
            } catch (e) {
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
                } catch (_e) {
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
                } catch (_e) {
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
        isOccluded: el => {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.1) {
                return true;
            }
            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) {
                return true;
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
                } catch (_e) {
                    // Ignore DOM access errors
                }
            }
            return false;
        },

        checkSystemStatus: () => {
            const stopBtn = SADI.query('[aria-label*="Stop"], [class*="stop"], [class*="typing"]')[0];
            const isAriaBusy = SADI.query('[aria-busy="true"]')[0];
            return !!(stopBtn || isAriaBusy);
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
            } catch (e) {
                path.push('barrier');
            }

            return {
                selector: getBase(el),
                isShadow: el.getRootNode() && el.getRootNode().nodeType === 11,
                context: win !== window.top ? 'iframe' : 'root',
                framePath: path.join(' > '),
                timestamp: Date.now()
            };
        }
    };
    return SADI;
};

/* ==========================================================================
   EXPORTS (API PÚBLICA INSTRUMENTADA)
========================================================================== */

async function findFrameByPath(page, framePath) {
    if (!framePath || framePath === 'root') {
        return page;
    }
    const frames = await page.frames();
    return (
        frames.find(f => {
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
            } catch (e) {
                return false;
            }
        }) || null
    );
}

/**
 * Localiza o campo de input com breakdown de confiança para telemetria.
 */
async function findChatInputSelector(page, langCode = 'en') {
    const keywords = await i18n.getTerms('input_placeholders', langCode);
    return page.evaluate(
        async (terms, svgSigs, logicFnStr) => {
            // FIXME: Refatorar para evitar new Function() - risco de segurança
            // eslint-disable-next-line no-new-func
            const SADI = new Function(`return (${logicFnStr})`)()(terms, svgSigs);
            const candidates = [
                ...new Set(SADI.query('textarea, div[contenteditable="true"], [role="textbox"]'))
            ].filter(el => !SADI.isOccluded(el));

            const scoreCandidate = el => {
                let score = 0;
                const rect = el.getBoundingClientRect();
                // Heurística de posição (Inputs de chat costumam estar na metade inferior)
                if (rect.top > window.innerHeight * 0.4) {
                    score += 100;
                }

                const text = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
                if (terms.some(k => text.includes(k))) {
                    score += 150;
                }

                // Bônus para elementos com IDs estáveis
                if (el.id && isNaN(el.id.charAt(0))) {
                    score += 50;
                }

                return score;
            };

            const best = candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
            return best
                ? {
                      protocol: SADI.generateProtocol(best),
                      confidence: scoreCandidate(best),
                      candidates_count: candidates.length
                  }
                : null;
        },
        keywords,
        SVG_SIGNATURES,
        sadiLogic.toString()
    );
}

/**
 * Localiza o botão de envio com validação geométrica e vetorial.
 */
async function findSendButtonSelector(page, inputProtocol) {
    return page.evaluate(
        async (proto, svgSigs, logicFnStr) => {
            // FIXME: Refatorar para evitar new Function() - risco de segurança
            // eslint-disable-next-line no-new-func
            const SADI = new Function(`return (${logicFnStr})`)()([], svgSigs);
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

                return score;
            };

            const best = buttons.sort((a, b) => scoreButton(b) - scoreButton(a))[0];
            return best
                ? {
                      protocol: SADI.generateProtocol(best),
                      confidence: scoreButton(best)
                  }
                : null;
        },
        inputProtocol,
        SVG_SIGNATURES,
        sadiLogic.toString()
    );
}

/**
 * Monitora a área de resposta para detectar atividade da IA.
 */
async function findResponseArea(page) {
    return page.evaluate(async logicFnStr => {
        // FIXME: Refatorar para evitar new Function() - risco de segurança
        // eslint-disable-next-line no-new-func
        const SADI = new Function(`return (${logicFnStr})`)()([], []);
        const containers = SADI.query('div, article, section, pre').filter(c => c.innerText.length > 5);
        const snapshot = containers.map(c => ({ el: c, len: c.innerText.length }));

        await new Promise(r => {
            setTimeout(r, 400);
        });

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
            best || containers.filter(c => c.isConnected).sort((a, b) => b.innerText.length - a.innerText.length)[0];
        return final
            ? {
                  protocol: SADI.generateProtocol(final),
                  isBusy: SADI.checkSystemStatus(),
                  growth_delta: maxDelta
              }
            : null;
    }, sadiLogic.toString());
}

async function validateCandidateInteractivity(page, protocol) {
    try {
        return page.evaluate(
            (proto, logicFnStr) => {
                // FIXME: Refatorar para evitar new Function() - risco de segurança
                // eslint-disable-next-line no-new-func
                const SADI = new Function(`return (${logicFnStr})`)()([], []);
                const el = SADI.query(proto.selector)[0];
                if (!el) {
                    return false;
                }
                try {
                    el.focus();
                } catch (e) {
                    return false;
                }
                const active = SADI.getActiveElement();
                return active === el || el.contains(active);
            },
            protocol,
            sadiLogic.toString()
        );
    } catch (e) {
        return false;
    }
}

module.exports = {
    findChatInputSelector,
    findSendButtonSelector,
    findResponseArea,
    validateCandidateInteractivity,
    findFrameByPath
};
