// @ts-check
/**
 * src/copilot/tools/web-tools.js
 *
 * Custom Tools para acesso web. Inclui proteção SSRF (OWASP A10), rate-limit interno e validação de content-type.
 *
 * @module copilot/tools/web-tools
 */

import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import { z } from 'zod';

// ─── SSRF Protection ─────────────────────────────────────────────────────────

/** Regex de hosts internos/privados. Case-insensitive. Bloquear para prevenir SSRF (OWASP A10). */
const PRIVATE_HOST_RE =
    /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|::1|fd[0-9a-f]{2}:)/i;

/** Esquemas de URL bloqueados. */
const BLOCKED_SCHEMES = new Set(['file:', 'ftp:', 'data:', 'javascript:']);

/**
 * Valida se uma URL é segura para fetch (anti-SSRF).
 *
 * @param {URL} url
 * @returns {{ safe: boolean; reason?: string }}
 */
function validateUrl(url) {
    if (BLOCKED_SCHEMES.has(url.protocol)) {
        return { safe: false, reason: `Esquema bloqueado: ${url.protocol}` };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return { safe: false, reason: `Protocolo não permitido: ${url.protocol}` };
    }
    if (PRIVATE_HOST_RE.test(url.hostname)) {
        return { safe: false, reason: `Host interno/privado bloqueado: ${url.hostname}` };
    }
    // Block numeric IPv4 forms that may bypass hostname checks
    const ipv4Parts = url.hostname.split('.');
    if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
        const ipNums = ipv4Parts.map(Number);
        const a = ipNums[0] ?? -1;
        const b = ipNums[1] ?? -1;
        const c = ipNums[2] ?? -1;
        if (
            a === 10 ||
            a === 127 ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 0 && b === 0 && c === 0)
        ) {
            return { safe: false, reason: `Endereço IP privado bloqueado: ${url.hostname}` };
        }
    }
    return { safe: true };
}

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
const webFetchTool = defineTool('web_fetch', {
    overridesBuiltInTool: true,
    description:
        'Busca o conteúdo de uma URL pública (HTTP/HTTPS). Apenas texto (text/*). ' +
        'Bloqueado para IPs privados, localhost e esquemas não-HTTP (proteção SSRF). ' +
        'Limite: 20 requisições/minuto.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
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
            })
        )
    ),
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
                chunks.reduce((acc, c) => {
                    const merged = new Uint8Array(acc.length + c.length);
                    merged.set(acc);
                    merged.set(c, acc.length);
                    return merged;
                }, new Uint8Array(0)),
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
const webSearchTool = defineTool('web_search', {
    overridesBuiltInTool: true,
    description:
        'Realiza busca na web via DuckDuckGo e retorna os primeiros resultados (título, URL, snippet). ' +
        'Use quando precisar de informações atuais da web que não estão no workspace. ' +
        'Não requer API key. Limite: 20 requisições/minuto (pool compartilhado com web_fetch).',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                query: z.string().min(1).max(400).describe('Consulta de busca'),
                maxResults: z
                    .number()
                    .int()
                    .min(1)
                    .max(10)
                    .optional()
                    .default(5)
                    .describe('Número máximo de resultados a retornar (padrão 5, máx 10)'),
            })
        )
    ),
    handler: async (/** @type {{ query: string; maxResults?: number }} */ { query, maxResults }) => {
        if (!checkRateLimit()) {
            return { success: false, error: `Rate limit excedido: máx ${MAX_REQUESTS_PER_MINUTE} req/min.` };
        }

        const limit = maxResults ?? 5;
        // DDG HTML endpoint (leve, sem JavaScript, sem rastreamento)
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

            // Extrai resultados via regex sobre o HTML do DDG Lite
            // Pattern: <a class="result__a" href="...">título</a> e <a class="result__snippet">snippet</a>
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
                } catch {
                    /* usa rawUrl */
                }

                results.push({
                    title: rawTitle.replace(/<[^>]+>/g, '').trim(),
                    url: finalUrl,
                    snippet: rawSnippet.replace(/<[^>]+>/g, '').trim(),
                });
            }

            // GAP-Q04 fix: avisar quando DDG retorna 0 resultados (possível bloqueio ou query sem match)
            if (results.length === 0) {
                log('WARN', `[copilot/web_search] query="${query}" retornou 0 resultados — DDG pode estar bloqueando ou query sem correspondência.`);
            }
            log('INFO', `[copilot/web_search] query="${query}" → ${results.length} resultados`);
            return { success: true, query, results };
        } catch (/** @type {any} */ e) {
            const msg = e?.name === 'AbortError' ? 'Timeout (15s)' : (e?.message ?? String(e));
            log('WARN', `[copilot/web_search] Erro: ${msg}`);
            return { success: false, error: msg };
        }
    },
});

/**
 * @type {import('@github/copilot-sdk').Tool[]}
 */
// SEC-V01 fix: webSearchTool desabilitado por padrão — ativar via WEB_SEARCH_ENABLED=true
export const webTools = [webFetchTool, ...(process.env['WEB_SEARCH_ENABLED'] === 'true' ? [webSearchTool] : [])];
