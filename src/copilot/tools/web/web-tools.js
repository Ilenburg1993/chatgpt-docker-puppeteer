// @ts-check
/**
 * src/copilot/tools/web/web-tools.js
 *
 * Custom Tools para acesso web. Inclui proteção SSRF (OWASP A10), telemetria de volume e validação de content-type.
 *
 * @module copilot/tools/web/web-tools
 * @see EventBus
 * @see module:copilot/lib/http-request
 * @see module:copilot/lib/url-validator
 */

import { getWebRateLimitPolicy, WEB_FETCH_DISABLED, WEB_SEARCH_DISABLED } from '#copilot/config';
import {
    buildIoMeta,
    evaluateIoUrlPolicy,
    IO_URL_MAX_REDIRECTS,
    logSwallowed,
    sanitizeIoTextOutput,
    toError,
    withIoMeta,
} from '#copilot/core';
import { publishIoOperation } from '#copilot/infra/public/events';
import { concatBufferViews, utf8ByteLength } from '#copilot/infra/public/buffer';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool } from '../infra/tool-factory.js';

// ─── SSRF Protection (via lib/url-validator.js) ──────────────────────────────

// ─── Rate limit simples (em memória, por processo) ───────────────────────────

/** @type {Map<number, number>} minute-bucket → request count */
const RATE_WINDOW = new Map();
const REDIRECT_BLOCKED_PORTS = new Set([22, 25, 3306, 5432, 6379, 8080, 8443, 9200, 27017]);

/**
 * Reset util para testes — limpa buckets de rate-limit em memória.
 *
 * @returns {void}
 */
export function resetWebToolsRateLimitWindowForTests() {
    RATE_WINDOW.clear();
}

/**
 * Registra volume local. Aplica limite por minuto para evitar abuso acidental.
 *
 * @returns {{ ok: boolean; count: number; limit: number; bucket: number; enforced: boolean }}
 */
function checkRateLimit() {
    const policy = getWebRateLimitPolicy();
    const bucket = Math.floor(Date.now() / 60_000);
    const count = RATE_WINDOW.get(bucket) ?? 0;
    const next = count + 1;
    RATE_WINDOW.set(bucket, next);
    // Remove buckets mais antigos para não crescer indefinidamente
    for (const [k] of RATE_WINDOW) {
        if (k < bucket - 1) RATE_WINDOW.delete(k);
    }
    return {
        ok: !policy.enforced || next <= policy.perMinute,
        count: next,
        limit: policy.perMinute,
        bucket,
        enforced: policy.enforced,
    };
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

/**
 * @param {string} urlText
 * @returns {void}
 */
function assertRedirectPortAllowed(urlText) {
    const parsed = new URL(urlText);
    const explicitPort = parsed.port ? Number.parseInt(parsed.port, 10) : null;
    if (explicitPort !== null && Number.isFinite(explicitPort) && REDIRECT_BLOCKED_PORTS.has(explicitPort)) {
        throw new Error(`Redirect bloqueado para porta sensível: ${explicitPort} (${urlText})`);
    }
}

// ─── Tool: web_fetch_local ───────────────────────────────────────────────────

/**
 * Segue redirects HTTP manualmente, validando cada URL intermediária com `evaluateIoUrlPolicy`. Respeita o limite
 * canônico de redirects em vez de delegar ao `fetch(redirect:'follow')` sem controle.
 *
 * @param {string} startUrl
 * @param {number} maxRedirects
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ response: Response; finalUrl: string; redirectCount: number }>}
 * @throws {Error} Se o número de redirects exceder o limite ou uma URL intermediária for bloqueada.
 */
async function fetchWithRedirectPolicy(startUrl, maxRedirects, opts = {}) {
    const AGENT_HEADERS = { 'User-Agent': 'github-copilot-agent/1.0' };
    let currentUrl = startUrl;
    let redirectCount = 0;

    for (;;) {
        const response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            headers: AGENT_HEADERS,
            ...(opts.signal ? { signal: opts.signal } : {}),
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
            const approvedUrl = check.url.toString();
            assertRedirectPortAllowed(approvedUrl);
            currentUrl = approvedUrl;
            redirectCount += 1;
            continue;
        }

        const responseUrl = typeof response.url === 'string' && response.url ? response.url : currentUrl;
        if (responseUrl !== currentUrl) {
            const check = evaluateIoUrlPolicy({ input: responseUrl });
            if (!check.ok || !check.url) {
                throw new Error(`Redirect bloqueado por policy: ${check.reason} (→ ${responseUrl})`);
            }
            const approvedUrl = check.url.toString();
            assertRedirectPortAllowed(approvedUrl);
            currentUrl = approvedUrl;
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
        const rate = checkRateLimit();
        if (!rate.ok) {
            return {
                success: false,
                error: `Rate limit local excedido (${rate.count}/${rate.limit} req/min). Tente novamente em instantes.`,
            };
        }

        if (!rate.enforced && rate.count > rate.limit) {
            log(
                'WARN',
                `[copilot/web_fetch] Volume alto detectado (${rate.count}/${rate.limit} req/min) em modo advisory.`,
            );
        }

        const inputUrlDecision = evaluateIoUrlPolicy({ input: url });
        if (!inputUrlDecision.ok || !inputUrlDecision.url) {
            log('WARN', `[copilot/web_fetch] URL bloqueada: ${inputUrlDecision.reason} (${url})`);
            return { success: false, error: `URL bloqueada por política de segurança: ${inputUrlDecision.reason}` };
        }
        const parsed = inputUrlDecision.url;

        const advisoryLimit = maxBytes ?? null;
        const maxRedirects = inputUrlDecision.maxRedirects ?? IO_URL_MAX_REDIRECTS;
        const timeoutBudgetMs =
            typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null;
        const controller = timeoutBudgetMs !== null ? new AbortController() : null;
        const timeoutHandle =
            controller && timeoutBudgetMs !== null
                ? setTimeout(() => controller.abort(new Error('Timeout')), timeoutBudgetMs)
                : null;

        try {
            const { response, finalUrl, redirectCount } = await fetchWithRedirectPolicy(
                parsed.toString(),
                maxRedirects,
                controller ? { signal: controller.signal } : {},
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
            // FIX WT-WEB-02: aplicar advisoryLimit no loop; cleanup robusto com cancel()+releaseLock().
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    received += value.byteLength;
                    chunks.push(value);
                    if (advisoryLimit !== null && received >= advisoryLimit) {
                        log('INFO', `[copilot/web_fetch] advisoryLimit ${advisoryLimit}B atingido — truncando.`);
                        break;
                    }
                }
            } finally {
                try {
                    await reader.cancel();
                } catch {
                    // no-op: best effort para liberar recursos do body stream
                }
                reader.releaseLock();
            }

            const text = new TextDecoder().decode(concatBufferViews(chunks, received));

            const sanitized = sanitizeIoTextOutput({ text });
            const io = buildIoMeta({
                operation: 'fetch',
                target: finalUrl,
                targetKind: 'url',
                bytesRead: utf8ByteLength(sanitized.text, 'web_fetch sanitized text'),
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
        } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
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
        const MAX_QUERY_CHARS = 500;
        const safeQuery = typeof query === 'string' ? query.slice(0, MAX_QUERY_CHARS).trim() : '';
        if (!safeQuery) {
            return { success: false, error: 'Query inválida.' };
        }

        const rate = checkRateLimit();
        if (!rate.ok) {
            return {
                success: false,
                error: `Rate limit local excedido (${rate.count}/${rate.limit} req/min). Tente novamente em instantes.`,
            };
        }

        if (!rate.enforced && rate.count > rate.limit) {
            log(
                'WARN',
                `[copilot/web_search] Volume alto detectado (${rate.count}/${rate.limit} req/min) em modo advisory.`,
            );
        }

        const requestedLimit =
            typeof maxResults === 'number' && Number.isFinite(maxResults) ? Math.floor(maxResults) : 10;
        const limit = Math.max(1, Math.min(50, requestedLimit));

        // F4.4 (UPG-09): tenta DDG Instant Answer JSON API primeiro (não requer JS, sem scraping frágil)
        const jsonUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(safeQuery)}&format=json&no_html=1&skip_disambig=1`;

        try {
            // FIX WT-WEB-01: redirect: 'follow' bypassa SSRF policy — usar 'error' para que redirecionamentos inesperados lancem erro
            const response = await fetch(jsonUrl, {
                method: 'GET',
                redirect: 'error',
                headers: {
                    'User-Agent': 'github-copilot-agent/1.0',
                    Accept: 'application/json',
                },
            });

            if (response.ok) {
                /** @type {Record<string, unknown> | null} */
                let data;
                try {
                    data = /** @type {Record<string, unknown>} */ (await response.json());
                } catch (jsonErr) {
                    const message = toError(jsonErr).message;
                    log(
                        'WARN',
                        `[copilot/web_search] DDG JSON API retornou payload inválido: ${message} — usando HTML scraping`,
                    );
                    data = null;
                }

                if (!data || typeof data !== 'object') {
                    throw new Error('DDG JSON API retornou payload não parseável.');
                }

                /** @type {{ title: string; url: string; snippet: string }[]} */
                const results = [];

                // AbstractText (resposta direta para queries com resultado instantâneo)
                if (data['AbstractText'] && data['AbstractURL']) {
                    results.push({
                        title: /** @type {string} */ (data['Heading'] ?? safeQuery),
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
                        bytesRead: utf8ByteLength(
                            JSON.stringify(sanitizedResults.results),
                            'web_search json results',
                        ),
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
                        `[copilot/web_search] DDG JSON API: query="${safeQuery}" → ${safeResults.length} resultados`,
                    );
                    return withIoMeta(
                        {
                            success: true,
                            query: safeQuery,
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
                    `[copilot/web_search] DDG JSON API retornou 0 resultados para query="${safeQuery}" — usando HTML scraping`,
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
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(safeQuery)}`;

        try {
            // FIX WT-WEB-01: redirect: 'follow' bypassa SSRF policy — usar 'error' para evitar SSRF por redirect
            const response = await fetch(searchUrl, {
                method: 'GET',
                redirect: 'error',
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
                    `[copilot/web_search] query="${safeQuery}" retornou 0 resultados — DDG pode estar bloqueando ou query sem correspondência.`,
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
                bytesRead: utf8ByteLength(JSON.stringify(sanitizedResults.results), 'web_search html results'),
                engine: 'duckduckgo.html',
                advisoryLimits: {
                    requestedMaxResults: maxResults ?? null,
                    limitMode: 'informative',
                    redactions: sanitizedResults.redactions,
                },
            });
            publishIoOperation(io, { success: true });
            log('INFO', `[copilot/web_search] query="${safeQuery}" → ${safeHtmlResults.length} resultados`);
            return withIoMeta(
                {
                    success: true,
                    query: safeQuery,
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
// WEB-01-FIX: tools web habilitadas por padrão e controladas por env flags.
export const webTools = [
    ...(WEB_FETCH_DISABLED ? [] : [webFetchTool]),
    ...(WEB_SEARCH_DISABLED ? [] : [webSearchTool]),
];
