// @ts-check
/**
 * src/copilot/tools/web-tools.js
 *
 * Custom Tools para acesso web. Inclui proteção SSRF (OWASP A10), telemetria de volume e validação de content-type.
 *
 * @module copilot/tools/web-tools
 * @see EventBus
 * @see module:copilot/lib/http-request
 * @see module:copilot/lib/url-validator
 */

import { WEB_SEARCH_DISABLED } from '#copilot/config';
import {
    buildIoMeta,
    evaluateIoUrlPolicy,
    IO_URL_MAX_REDIRECTS,
    logSwallowed,
    sanitizeIoTextOutput,
    toError,
    withIoMeta,
} from '#copilot/core';
import { z } from 'zod';
import { publishIoOperation } from '../infra/io-observability.js';
import { log } from './logger.js';
import { buildTool } from './tool-factory.js';

// ─── SSRF Protection (via lib/url-validator.js) ──────────────────────────────

// ─── Rate limit simples (em memória, por processo) ───────────────────────────

/** @type {Map<number, number>} minute-bucket → request count */
const RATE_WINDOW = new Map();

/**
 * Reset util para testes — limpa buckets de rate-limit em memória.
 *
 * @returns {void}
 */
export function resetWebToolsRateLimitWindowForTests() {
    RATE_WINDOW.clear();
}

/**
 * Registra volume local. Limite é informativo e não bloqueia operações da LLM-B.
 *
 * @returns {boolean} Sempre true.
 */
function checkRateLimit() {
    const bucket = Math.floor(Date.now() / 60_000);
    const count = RATE_WINDOW.get(bucket) ?? 0;
    RATE_WINDOW.set(bucket, count + 1);
    // Remove buckets mais antigos para não crescer indefinidamente
    for (const [k] of RATE_WINDOW) {
        if (k < bucket - 1) RATE_WINDOW.delete(k);
    }
    return true;
}

/**
 * @param {{ title: string; url: string; snippet: string }[]} results
 * @returns {{ results: { title: string; url: string; snippet: string }[]; redactions: number; sanitized: boolean }}
 */
function sanitizeWebSearchResults(results) {
    let redactions = 0;
    let sanitized = false;
    return {
        results: results.map((result) => {
            const title = sanitizeIoTextOutput({ text: result.title });
            const snippet = sanitizeIoTextOutput({ text: result.snippet });
            redactions += title.redactions + snippet.redactions;
            sanitized = sanitized || title.sanitized || snippet.sanitized;
            return { ...result, title: title.text, snippet: snippet.text };
        }),
        redactions,
        sanitized,
    };
}

// ─── Tool: web_fetch_local ───────────────────────────────────────────────────

/**
 * Segue redirects HTTP manualmente, validando cada URL intermediária com `evaluateIoUrlPolicy`. Respeita o limite
 * canônico de redirects em vez de delegar ao `fetch(redirect:'follow')` sem controle.
 *
 * @param {string} startUrl
 * @param {number} maxRedirects
 * @returns {Promise<{ response: Response; finalUrl: string; redirectCount: number }>}
 * @throws {Error} Se o número de redirects exceder o limite ou uma URL intermediária for bloqueada.
 */
async function fetchWithRedirectPolicy(startUrl, maxRedirects) {
    const AGENT_HEADERS = { 'User-Agent': 'github-copilot-agent/1.0' };
    let currentUrl = startUrl;
    let redirectCount = 0;

    for (;;) {
        const response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            headers: AGENT_HEADERS,
        });

        const status = response.status;
        if (status >= 300 && status < 400) {
            if (redirectCount >= maxRedirects) {
                throw new Error(`Too many redirects (limit: ${maxRedirects})`);
            }
            const location = response.headers.get('location');
            if (!location) {
                throw new Error(`Redirect ${status} sem cabeçalho Location (${currentUrl})`);
            }
            // Resolve relative locations
            const resolvedUrl = new URL(location, currentUrl).toString();
            const check = evaluateIoUrlPolicy({ input: resolvedUrl });
            if (!check.ok || !check.url) {
                throw new Error(`Redirect bloqueado por policy: ${check.reason} (→ ${resolvedUrl})`);
            }
            currentUrl = check.url.toString();
            redirectCount += 1;
            continue;
        }

        const responseUrl = typeof response.url === 'string' && response.url ? response.url : currentUrl;
        if (responseUrl !== currentUrl) {
            const check = evaluateIoUrlPolicy({ input: responseUrl });
            if (!check.ok || !check.url) {
                throw new Error(`Redirect bloqueado por policy: ${check.reason} (→ ${responseUrl})`);
            }
            currentUrl = check.url.toString();
        }

        return { response, finalUrl: currentUrl, redirectCount };
    }
}

/**
 * Tool: web_fetch_local — busca o conteúdo de uma URL pública com proteção SSRF.
 */
const webFetchTool = buildTool({
    name: 'web_fetch_local',
    requiresApproval: false,
    description:
        'Fetch web local com proteção SSRF. Em runtimes com built-in do CLI (`web_fetch`), a built-in prevalece. ' +
        'Busca o conteúdo de uma URL pública (HTTP/HTTPS). Apenas texto (text/*). ' +
        'Bloqueado para IPs privados, localhost e esquemas não-HTTP (proteção SSRF). ' +
        'Volume/timeout são informativos e não bloqueiam a operação.',
    parameters: z.object({
        url: z.string().url().describe('URL completa da página a buscar (https:// recomendado)'),
        maxBytes: z.number().int().min(1).optional().describe('Tamanho informativo da resposta em bytes.'),
        timeoutMs: z.number().int().min(0).optional().describe('Timeout informativo em ms; não aborta a operação.'),
    }),
    handler: async (
        /** @type {{ url: string; maxBytes?: number; timeoutMs?: number }} */ { url, maxBytes, timeoutMs },
    ) => {
        checkRateLimit();

        const inputUrlDecision = evaluateIoUrlPolicy({ input: url });
        if (!inputUrlDecision.ok || !inputUrlDecision.url) {
            log('WARN', `[copilot/web_fetch] URL bloqueada: ${inputUrlDecision.reason} (${url})`);
            return { success: false, error: `URL bloqueada por política de segurança: ${inputUrlDecision.reason}` };
        }
        const parsed = inputUrlDecision.url;

        const advisoryLimit = maxBytes ?? null;
        const maxRedirects = inputUrlDecision.maxRedirects ?? IO_URL_MAX_REDIRECTS;

        try {
            const { response, finalUrl, redirectCount } = await fetchWithRedirectPolicy(
                parsed.toString(),
                maxRedirects,
            );

            if (redirectCount > 0) {
                log('INFO', `[copilot/web_fetch] ${redirectCount} redirect(s) seguido(s) → ${finalUrl}`);
            }

            const contentType = response.headers.get('content-type') ?? '';
            if (!contentType.startsWith('text/')) {
                return {
                    success: false,
                    error: `Content-type não suportado: '${contentType}'. Apenas text/* é aceito.`,
                };
            }

            const reader = response.body?.getReader();
            if (!reader) return { success: false, error: 'Resposta sem corpo.' };

            let received = 0;
            const chunks = /** @type {Uint8Array[]} */ ([]);
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                received += value.byteLength;
                chunks.push(value);
            }

            const text = new TextDecoder().decode(
                (() => {
                    const total = chunks.reduce((s, c) => s + c.length, 0);
                    const merged = new Uint8Array(total);
                    let offset = 0;
                    for (const c of chunks) {
                        merged.set(c, offset);
                        offset += c.length;
                    }
                    return merged;
                })(),
            );

            const sanitized = sanitizeIoTextOutput({ text });
            const io = buildIoMeta({
                operation: 'fetch',
                target: finalUrl,
                targetKind: 'url',
                bytesRead: Buffer.byteLength(sanitized.text, 'utf8'),
                engine: 'fetch',
                truncated: false,
                advisoryLimits: {
                    requestedMaxBytes: advisoryLimit,
                    advisoryTimeoutMs: timeoutMs ?? null,
                    redactions: sanitized.redactions,
                    policyDecision: inputUrlDecision.ok ? 'allow' : 'deny',
                    policyVersion: inputUrlDecision.policyVersion,
                    redirectCount,
                    maxRedirects,
                },
            });
            publishIoOperation(io, { success: true });
            log(
                'INFO',
                `[copilot/web_fetch] ${url} → ${response.status} · ${sanitized.text.length} chars · redirects=${redirectCount}`,
            );
            return withIoMeta(
                {
                    success: true,
                    url: finalUrl,
                    status: response.status,
                    contentType,
                    truncated: false,
                    advisoryMaxBytes: advisoryLimit,
                    advisoryTimeoutMs: timeoutMs ?? null,
                    bytesRead: received,
                    length: sanitized.text.length,
                    content: sanitized.text,
                    sanitized: sanitized.sanitized,
                    redactions: sanitized.redactions,
                    redirectCount,
                    maxRedirects,
                },
                { ...io, policyVersion: sanitized.policyVersion },
            );
        } catch (e) {
            const msg = toError(e).message ?? String(e);
            log('WARN', `[copilot/web_fetch] Erro: ${msg}`);
            return { success: false, error: msg };
        }
    },
});

// ─── Tool: web_search ────────────────────────────────────────────────────────

/**
 * Tool: web_search — realiza busca na web via DuckDuckGo Lite e retorna resultados estruturados. Não requer API key.
 * Usa o frontend HTML leve do DDG e extrai título, URL e snippet dos resultados.
 */
const webSearchTool = buildTool({
    name: 'web_search',
    requiresApproval: false,
    description:
        'Realiza busca na web via DuckDuckGo e retorna os primeiros resultados (título, URL, snippet). ' +
        'Use quando precisar de informações atuais da web que não estão no workspace. ' +
        'Não requer API key. Volume de uso é registrado como telemetria, sem rate-limit local bloqueante.',
    parameters: z.object({
        query: z.string().min(1).describe('Consulta de busca'),
        maxResults: z.number().int().min(1).optional().describe('Número sugerido de resultados a retornar.'),
    }),
    handler: async (/** @type {{ query: string; maxResults?: number }} */ { query, maxResults }) => {
        checkRateLimit();

        const limit =
            typeof maxResults === 'number' && Number.isFinite(maxResults) ? maxResults : Number.POSITIVE_INFINITY;

        // F4.4 (UPG-09): tenta DDG Instant Answer JSON API primeiro (não requer JS, sem scraping frágil)
        const jsonUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

        try {
            const response = await fetch(jsonUrl, {
                method: 'GET',
                redirect: 'follow',
                headers: {
                    'User-Agent': 'github-copilot-agent/1.0',
                    Accept: 'application/json',
                },
            });

            if (response.ok) {
                /** @type {Record<string, unknown>} */
                const data = await response.json();

                /** @type {{ title: string; url: string; snippet: string }[]} */
                const results = [];

                // AbstractText (resposta direta para queries com resultado instantâneo)
                if (data['AbstractText'] && data['AbstractURL']) {
                    results.push({
                        title: /** @type {string} */ (data['Heading'] ?? query),
                        url: /** @type {string} */ (data['AbstractURL']),
                        snippet: /** @type {string} */ (data['AbstractText']),
                    });
                }

                // RelatedTopics: array de tópicos relacionados
                const topics = Array.isArray(data['RelatedTopics']) ? data['RelatedTopics'] : [];
                for (const topic of topics) {
                    if (results.length >= limit) break;
                    // Tópicos simples têm FirstURL e Text
                    if (topic.FirstURL && topic.Text) {
                        results.push({
                            title: topic.Text.split(' - ')[0]?.trim() ?? topic.Text,
                            url: topic.FirstURL,
                            snippet: topic.Text,
                        });
                    }
                    // Tópicos agrupados têm Topics[]
                    if (Array.isArray(topic.Topics)) {
                        for (const sub of topic.Topics) {
                            if (results.length >= limit) break;
                            if (sub.FirstURL && sub.Text) {
                                results.push({
                                    title: sub.Text.split(' - ')[0]?.trim() ?? sub.Text,
                                    url: sub.FirstURL,
                                    snippet: sub.Text,
                                });
                            }
                        }
                    }
                }

                if (results.length > 0) {
                    // F6.4 (BUG-LEVE-04): filtrar URLs privadas/SSRF nos resultados DDG (JSON API)
                    const safeResults = results.filter((r) => {
                        try {
                            return evaluateIoUrlPolicy({ input: r.url }).ok;
                        } catch {
                            return false;
                        }
                    });
                    const sanitizedResults = sanitizeWebSearchResults(safeResults.slice(0, limit));
                    const io = buildIoMeta({
                        operation: 'search',
                        target: jsonUrl,
                        targetKind: 'url',
                        bytesRead: Buffer.byteLength(JSON.stringify(sanitizedResults.results), 'utf8'),
                        engine: 'duckduckgo.json',
                        advisoryLimits: {
                            requestedMaxResults: maxResults ?? null,
                            limitMode: 'informative',
                            redactions: sanitizedResults.redactions,
                        },
                    });
                    publishIoOperation(io, { success: true });
                    log(
                        'INFO',
                        `[copilot/web_search] DDG JSON API: query="${query}" → ${safeResults.length} resultados`,
                    );
                    return withIoMeta(
                        {
                            success: true,
                            query,
                            results: sanitizedResults.results,
                            advisoryMaxResults: maxResults ?? null,
                            sanitized: sanitizedResults.sanitized,
                            redactions: sanitizedResults.redactions,
                        },
                        io,
                    );
                }
                // Sem resultados JSON — cai para HTML scraping
                log(
                    'WARN',
                    `[copilot/web_search] DDG JSON API retornou 0 resultados para query="${query}" — usando HTML scraping`,
                );
            }
        } catch (e) {
            const err = toError(e);
            if (err.name === 'AbortError') {
                return { success: false, error: err.message || 'AbortError' };
            }
            log('WARN', `[copilot/web_search] DDG JSON API falhou (${toError(e).message ?? e}) — usando HTML scraping`);
        }

        // Fallback: HTML scraping DDG Lite
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(searchUrl, {
                method: 'GET',
                redirect: 'follow',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; github-copilot-agent/1.0)',
                    Accept: 'text/html',
                },
            });

            if (!response.ok) {
                return { success: false, error: `DDG retornou status ${response.status}` };
            }

            const html = await response.text();

            // Extrai resultados via regex sobre o HTML do DDG Lite.
            // AVISO: este parsing é frágil por design — depende do layout HTML do DDG que pode mudar sem aviso.
            // Se a extração começar a retornar 0 resultados consistentemente, verificar se as classes CSS
            // "result__a" e "result__snippet" ainda existem no HTML retornado por https://html.duckduckgo.com/html/
            /** @type {{ title: string; url: string; snippet: string }[]} */
            const results = [];

            const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
            const snippetRe = /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gs;

            const links = [...html.matchAll(linkRe)];
            const snippets = [...html.matchAll(snippetRe)];

            for (let i = 0; i < Math.min(limit, links.length); i++) {
                const rawUrl = links[i]?.[1] ?? '';
                const rawTitle = links[i]?.[2] ?? '';
                const rawSnippet = snippets[i]?.[1] ?? '';

                // DDG usa redirect URLs — extrai 'uddg' param ou usa diretamente
                let finalUrl = rawUrl;
                try {
                    const u = new URL(rawUrl.startsWith('/') ? `https://html.duckduckgo.com${rawUrl}` : rawUrl);
                    finalUrl = u.searchParams.get('uddg') ?? rawUrl;
                } catch (e) {
                    logSwallowed(e, 'web-tools.parseUrl');
                }

                results.push({
                    title: rawTitle.replace(/<[^>]+>/g, '').trim(),
                    url: finalUrl,
                    snippet: rawSnippet.replace(/<[^>]+>/g, '').trim(),
                });
            }

            // GAP-Q04 fix: avisar quando DDG retorna 0 resultados (possível bloqueio ou query sem match)
            if (results.length === 0) {
                log(
                    'WARN',
                    `[copilot/web_search] query="${query}" retornou 0 resultados — DDG pode estar bloqueando ou query sem correspondência.`,
                );
            }
            // F6.4 (BUG-LEVE-04): filtrar URLs privadas/SSRF nos resultados DDG (HTML scraping)
            const safeHtmlResults = results.filter((r) => {
                try {
                    return evaluateIoUrlPolicy({ input: r.url }).ok;
                } catch {
                    return false;
                }
            });
            const sanitizedResults = sanitizeWebSearchResults(safeHtmlResults);
            const io = buildIoMeta({
                operation: 'search',
                target: searchUrl,
                targetKind: 'url',
                bytesRead: Buffer.byteLength(JSON.stringify(sanitizedResults.results), 'utf8'),
                engine: 'duckduckgo.html',
                advisoryLimits: {
                    requestedMaxResults: maxResults ?? null,
                    limitMode: 'informative',
                    redactions: sanitizedResults.redactions,
                },
            });
            publishIoOperation(io, { success: true });
            log('INFO', `[copilot/web_search] query="${query}" → ${safeHtmlResults.length} resultados`);
            return withIoMeta(
                {
                    success: true,
                    query,
                    results: sanitizedResults.results,
                    advisoryMaxResults: maxResults ?? null,
                    sanitized: sanitizedResults.sanitized,
                    redactions: sanitizedResults.redactions,
                },
                io,
            );
        } catch (e) {
            const msg = toError(e).message ?? String(e);
            log('WARN', `[copilot/web_search] Erro: ${msg}`);
            return { success: false, error: msg };
        }
    },
});

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
// WEB-01-FIX: web_search habilitado por padrão — desativar via WEB_SEARCH_DISABLED=true
export const webTools = [webFetchTool, ...(WEB_SEARCH_DISABLED ? [] : [webSearchTool])];
