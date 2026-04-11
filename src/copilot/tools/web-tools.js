// @ts-check
/**
 * src/copilot/tools/web-tools.js
 *
 * Custom Tools para acesso web. Inclui proteção SSRF (OWASP A10), rate-limit interno e validação de content-type.
 *
 * @module copilot/tools/web-tools
 * @see module:copilot/lib/http-request
 * @see module:copilot/lib/url-validator
 */

import { WEB_SEARCH_DISABLED } from '#copilot/config';
import { logSwallowed, validateUrl } from '#copilot/core';
import { log } from '#copilot/observability';
import { z } from 'zod';
import { buildTool } from './tool-factory.js';

// ─── SSRF Protection (via lib/url-validator.js) ──────────────────────────────

// ─── Rate limit simples (em memória, por processo) ───────────────────────────

/** @type {Map<number, number>} minute-bucket → request count */
const RATE_WINDOW = new Map();
const MAX_REQUESTS_PER_MINUTE = 20;

/**
 * Verifica e registra rate limit.
 *
 * @returns {boolean} true se dentro do limite, false se excedido
 */
function checkRateLimit() {
    const bucket = Math.floor(Date.now() / 60_000);
    const count = RATE_WINDOW.get(bucket) ?? 0;
    if (count >= MAX_REQUESTS_PER_MINUTE) return false;
    RATE_WINDOW.set(bucket, count + 1);
    // Remove buckets mais antigos para não crescer indefinidamente
    for (const [k] of RATE_WINDOW) {
        if (k < bucket - 1) RATE_WINDOW.delete(k);
    }
    return true;
}

// ─── Tool: web_fetch ─────────────────────────────────────────────────────────

/**
 * Tool: web_fetch — busca o conteúdo de uma URL pública com proteção SSRF.
 */
const webFetchTool = buildTool({
    name: 'web_fetch',
    overridesBuiltInTool: true,
    requiresApproval: false,
    description:
        'Busca o conteúdo de uma URL pública (HTTP/HTTPS). Apenas texto (text/*). ' +
        'Bloqueado para IPs privados, localhost e esquemas não-HTTP (proteção SSRF). ' +
        'Limite: 20 requisições/minuto.',
    parameters: z.object({
        url: z.string().url().describe('URL completa da página a buscar (https:// recomendado)'),
        maxBytes: z
            .number()
            .int()
            .min(1)
            .max(512_000)
            .optional()
            .default(131_072)
            .describe('Tamanho máximo da resposta em bytes (padrão 128 KB, máx 512 KB)'),
        timeoutMs: z
            .number()
            .int()
            .min(1000)
            .max(30_000)
            .optional()
            .default(10_000)
            .describe('Timeout em ms (padrão 10 s, máx 30 s)'),
    }),
    handler: async (
        /** @type {{ url: string; maxBytes?: number; timeoutMs?: number }} */ { url, maxBytes, timeoutMs },
    ) => {
        // Rate limit
        if (!checkRateLimit()) {
            return { success: false, error: `Rate limit excedido: máx ${MAX_REQUESTS_PER_MINUTE} req/min.` };
        }

        // Parse + validate URL
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return { success: false, error: 'URL inválida.' };
        }

        const { safe, reason } = validateUrl(parsed);
        if (!safe) {
            log('WARN', `[copilot/web_fetch] URL bloqueada: ${reason} (${url})`);
            return { success: false, error: `URL bloqueada por política de segurança: ${reason}` };
        }

        const limit = maxBytes ?? 131_072;
        const timeout = timeoutMs ?? 10_000;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);

            let response;
            try {
                response = await fetch(parsed.toString(), {
                    method: 'GET',
                    signal: controller.signal,
                    redirect: 'follow',
                    headers: { 'User-Agent': 'github-copilot-agent/1.0' },
                });
            } finally {
                clearTimeout(timer);
            }

            // Validate redirect target (prevent header-injection redirect to internal)
            const finalUrl = response.url ? new URL(response.url) : parsed;
            const redirectCheck = validateUrl(finalUrl);
            if (!redirectCheck.safe) {
                log('WARN', `[copilot/web_fetch] Redirect bloqueado para host privado: ${finalUrl.hostname}`);
                return { success: false, error: `Redirect bloqueado: ${redirectCheck.reason}` };
            }

            const contentType = response.headers.get('content-type') ?? '';
            if (!contentType.startsWith('text/')) {
                return {
                    success: false,
                    error: `Content-type não suportado: '${contentType}'. Apenas text/* é aceito.`,
                };
            }

            // Read with size limit
            const reader = response.body?.getReader();
            if (!reader) return { success: false, error: 'Resposta sem corpo.' };

            let received = 0;
            const chunks = /** @type {Uint8Array[]} */ ([]);
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                received += value.byteLength;
                if (received > limit) {
                    void reader.cancel();
                    chunks.push(value.slice(0, value.byteLength - (received - limit)));
                    break;
                }
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

            log('INFO', `[copilot/web_fetch] ${url} → ${response.status} (${text.length} chars)`);
            return {
                success: true,
                url: response.url,
                status: response.status,
                contentType,
                truncated: received > limit,
                length: text.length,
                content: text,
            };
        } catch (/** @type {any} */ e) {
            const msg = e?.name === 'AbortError' ? `Timeout após ${timeout}ms` : (e?.message ?? String(e));
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
    overridesBuiltInTool: true,
    requiresApproval: false,
    description:
        'Realiza busca na web via DuckDuckGo e retorna os primeiros resultados (título, URL, snippet). ' +
        'Use quando precisar de informações atuais da web que não estão no workspace. ' +
        'Não requer API key. Limite: 20 requisições/minuto (pool compartilhado com web_fetch).',
    parameters: z.object({
        query: z.string().min(1).max(400).describe('Consulta de busca'),
        maxResults: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .default(5)
            .describe('Número máximo de resultados a retornar (padrão 5, máx 10)'),
    }),
    handler: async (/** @type {{ query: string; maxResults?: number }} */ { query, maxResults }) => {
        if (!checkRateLimit()) {
            return { success: false, error: `Rate limit excedido: máx ${MAX_REQUESTS_PER_MINUTE} req/min.` };
        }

        const limit = maxResults ?? 5;

        // F4.4 (UPG-09): tenta DDG Instant Answer JSON API primeiro (não requer JS, sem scraping frágil)
        const jsonUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);

            let response;
            try {
                response = await fetch(jsonUrl, {
                    method: 'GET',
                    signal: controller.signal,
                    redirect: 'follow',
                    headers: {
                        'User-Agent': 'github-copilot-agent/1.0',
                        Accept: 'application/json',
                    },
                });
            } finally {
                clearTimeout(timer);
            }

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
                            return validateUrl(new URL(r.url)).safe;
                        } catch {
                            return false;
                        }
                    });
                    log(
                        'INFO',
                        `[copilot/web_search] DDG JSON API: query="${query}" → ${safeResults.length} resultados`,
                    );
                    return { success: true, query, results: safeResults.slice(0, limit) };
                }
                // Sem resultados JSON — cai para HTML scraping
                log(
                    'WARN',
                    `[copilot/web_search] DDG JSON API retornou 0 resultados para query="${query}" — usando HTML scraping`,
                );
            }
        } catch (/** @type {any} */ e) {
            if (e?.name === 'AbortError') {
                return { success: false, error: 'Timeout (15s)' };
            }
            log('WARN', `[copilot/web_search] DDG JSON API falhou (${e?.message ?? e}) — usando HTML scraping`);
        }

        // Fallback: HTML scraping DDG Lite
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);

            let response;
            try {
                response = await fetch(searchUrl, {
                    method: 'GET',
                    signal: controller.signal,
                    redirect: 'follow',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; github-copilot-agent/1.0)',
                        Accept: 'text/html',
                    },
                });
            } finally {
                clearTimeout(timer);
            }

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
                } catch (/** @type {any} */ e) {
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
                    return validateUrl(new URL(r.url)).safe;
                } catch {
                    return false;
                }
            });
            log('INFO', `[copilot/web_search] query="${query}" → ${safeHtmlResults.length} resultados`);
            return { success: true, query, results: safeHtmlResults };
        } catch (/** @type {any} */ e) {
            const msg = e?.name === 'AbortError' ? 'Timeout (15s)' : (e?.message ?? String(e));
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
