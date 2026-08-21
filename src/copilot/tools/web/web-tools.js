// @ts-check
import { getWebRateLimitPolicy, WEB_FETCH_DISABLED, WEB_SEARCH_DISABLED } from '#copilot/config';
import { bufferIsUtf8, concatBufferViews, decodeUtf8Buffer, utf8ByteLength } from '#copilot/infra/public/platform';
import { publishIoOperation } from '#copilot/infra/public/telemetry';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool } from '../infra/tool-factory.js';
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

import {
    buildIoMeta,
    evaluateIoUrlPolicy,
    IO_URL_MAX_REDIRECTS,
    logSwallowed,
    sanitizeIoTextOutput,
    toError,
    withIoMeta,
} from '#copilot/core';

// ─── SSRF Protection (via lib/url-validator.js) ──────────────────────────────

// ─── Rate limit simples (em memória, por processo) ───────────────────────────

/** @type {Map<number, number>} minute-bucket → request count */
const RATE_WINDOW = new Map();
const REDIRECT_BLOCKED_PORTS = new Set([22, 25, 3306, 5432, 6379, 8080, 8443, 9200, 27017]);
const MAX_WEB_FETCH_BODY_BYTES = 64 * 1024;
const DEFAULT_WEB_FETCH_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_WEB_FETCH_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_WEB_SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;

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

/**
 * @param {Record<string, string> | undefined} headers
 * @returns {Record<string, string>}
 */
function sanitizeRequestHeaders(headers) {
    if (!headers || typeof headers !== 'object') return {};
    const blocked = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);
    /** @type {Record<string, string>} */
    const out = {};
    for (const [rawName, rawValue] of Object.entries(headers)) {
        const name = String(rawName).trim();
        if (!/^[A-Za-z0-9-]+$/u.test(name)) continue;
        const lowered = name.toLowerCase();
        if (blocked.has(lowered)) continue;
        const value = String(rawValue ?? '').trim();
        if (value.length === 0) continue;
        out[name] = value;
    }
    return out;
}

/**
 * @param {number | undefined} value
 * @returns {number}
 */
function resolveWebFetchMaxBytes(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.min(MAX_WEB_FETCH_RESPONSE_BYTES, Math.trunc(value))
        : DEFAULT_WEB_FETCH_RESPONSE_BYTES;
}

/**
 * Decodifica o prefixo coletado. Quando houve truncagem, remove somente uma sequência multibyte final incompleta.
 *
 * @param {Buffer} bytes
 * @param {boolean} truncated
 * @returns {{ text: string; returnedBytes: number; boundaryTrimmedBytes: number }}
 */
function decodeWebFetchBytes(bytes, truncated) {
    let safeBytes = bytes;
    if (truncated && !bufferIsUtf8(safeBytes)) {
        for (let trim = 1; trim <= Math.min(3, safeBytes.byteLength); trim += 1) {
            const candidate = safeBytes.subarray(0, safeBytes.byteLength - trim);
            if (!bufferIsUtf8(candidate)) continue;
            safeBytes = candidate;
            break;
        }
    }
    return {
        text: decodeUtf8Buffer(safeBytes, 'Resposta web contém bytes inválidos para UTF-8.'),
        returnedBytes: safeBytes.byteLength,
        boundaryTrimmedBytes: bytes.byteLength - safeBytes.byteLength,
    };
}

/**
 * Lê uma resposta textual completa com orçamento estrito. JSON/HTML de busca não pode ser parseado parcialmente.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @param {string} label
 * @returns {Promise<string>}
 */
async function readCompleteWebTextResponse(response, maxBytes, label) {
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new Error(`${label} excede limite de ${maxBytes} bytes.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`${label} sem corpo textual.`);
    /** @type {Uint8Array[]} */
    const chunks = [];
    let bytesRead = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesRead += value.byteLength;
            if (bytesRead > maxBytes) {
                throw new Error(`${label} excede limite de ${maxBytes} bytes.`);
            }
            chunks.push(value);
        }
    } finally {
        try {
            await reader.cancel();
        } catch {
            // best effort: a resposta já foi consumida ou rejeitada pelo budget
        }
        reader.releaseLock();
    }
    return decodeUtf8Buffer(concatBufferViews(chunks, bytesRead), `${label} contém bytes inválidos para UTF-8.`);
}

// ─── Tool: web_fetch_local ───────────────────────────────────────────────────

/**
 * Segue redirects HTTP manualmente, validando cada URL intermediária com `evaluateIoUrlPolicy`. Respeita o limite
 * canônico de redirects em vez de delegar ao `fetch(redirect:'follow')` sem controle.
 *
 * @param {string} startUrl
 * @param {number} maxRedirects
 * @param {{ method: 'GET' | 'POST' | 'PUT' | 'PATCH'; headers: Record<string, string>; body?: string }} request
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ response: Response; finalUrl: string; redirectCount: number }>}
 * @throws {Error} Se o número de redirects exceder o limite ou uma URL intermediária for bloqueada.
 */
async function fetchWithRedirectPolicy(startUrl, maxRedirects, request, opts = {}) {
    const baseHeaders = { 'User-Agent': 'github-copilot-agent/1.0', ...request.headers };
    let currentUrl = startUrl;
    let redirectCount = 0;

    for (;;) {
        if (redirectCount > 0 && request.method !== 'GET') {
            throw new Error('Redirect para métodos não-GET não é suportado por política de segurança.');
        }

        const response = await fetch(currentUrl, {
            method: request.method,
            redirect: 'manual',
            headers: baseHeaders,
            ...(request.body !== undefined ? { body: request.body } : {}),
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
        'Resposta limitada por bytes e timeout efetivo para evitar retenção ilimitada.',
    parameters: z.object({
        url: z.string().url()['describe']('URL completa da página a buscar (https:// recomendado)'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).optional()['describe']('Método HTTP. Default: GET.'),
        headers: z.record(z.string(), z.string()).optional()['describe']('Headers HTTP opcionais (sanitizados).'),
        body: z.string().optional()['describe']('Body textual opcional para métodos não-GET.'),
        maxBytes: z
            .number()
            .int()
            .min(1)
            .max(MAX_WEB_FETCH_RESPONSE_BYTES)
            .optional()
            ['describe'](`Máximo efetivo da resposta em bytes. Default: ${DEFAULT_WEB_FETCH_RESPONSE_BYTES}.`),
        timeoutMs: z
            .number()
            .int()
            .min(0)
            .optional()
            ['describe']('Timeout efetivo em ms (aborta a operação quando excedido).'),
    }),
    handler: async (
        /**
         * @type {{
         *     url: string;
         *     method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
         *     headers?: Record<string, string>;
         *     body?: string;
         *     maxBytes?: number;
         *     timeoutMs?: number;
         * }}
         */
        { url, method, headers, body, maxBytes, timeoutMs },
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

        const responseMaxBytes = resolveWebFetchMaxBytes(maxBytes);
        const maxRedirects = inputUrlDecision.maxRedirects ?? IO_URL_MAX_REDIRECTS;
        const timeoutBudgetMs =
            typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null;
        const safeMethod = method ?? 'GET';
        const safeHeaders = sanitizeRequestHeaders(headers);
        const safeBody = typeof body === 'string' ? body : undefined;
        const bodySizeBytes = safeBody ? utf8ByteLength(safeBody, 'web_fetch request body') : 0;

        if (safeMethod === 'GET' && safeBody !== undefined) {
            return { success: false, error: 'Body não é suportado para método GET.' };
        }
        if (safeBody && bodySizeBytes > MAX_WEB_FETCH_BODY_BYTES) {
            return {
                success: false,
                error: `Body excede limite de ${MAX_WEB_FETCH_BODY_BYTES} bytes (${bodySizeBytes} bytes).`,
            };
        }

        const signal = timeoutBudgetMs !== null ? AbortSignal.timeout(timeoutBudgetMs) : undefined;

        try {
            const { response, finalUrl, redirectCount } = await fetchWithRedirectPolicy(
                parsed.toString(),
                maxRedirects,
                { method: safeMethod, headers: safeHeaders, ...(safeBody !== undefined ? { body: safeBody } : {}) },
                signal ? { signal } : {},
            );

            if (redirectCount > 0) {
                log('INFO', `[copilot/web_fetch] ${redirectCount} redirect(s) seguido(s) → ${finalUrl}`);
            }

            const contentType = response.headers.get('content-type') ?? '';
            if (!contentType.toLowerCase().startsWith('text/')) {
                return {
                    success: false,
                    error: `Content-type não suportado: '${contentType}'. Apenas text/* é aceito.`,
                };
            }

            const reader = response.body?.getReader();
            if (!reader) return { success: false, error: 'Resposta sem corpo.' };

            let received = 0;
            let collectedBytes = 0;
            let truncated = false;
            const chunks = /** @type {Uint8Array[]} */ ([]);
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    received += value.byteLength;
                    const remaining = responseMaxBytes - collectedBytes;
                    if (remaining > 0) {
                        const accepted = value.byteLength <= remaining ? value : value.subarray(0, remaining);
                        chunks.push(accepted);
                        collectedBytes += accepted.byteLength;
                    }
                    if (value.byteLength > remaining) {
                        truncated = true;
                        log('INFO', `[copilot/web_fetch] maxBytes ${responseMaxBytes}B atingido — truncando.`);
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

            const decoded = decodeWebFetchBytes(concatBufferViews(chunks, collectedBytes), truncated);

            const sanitized = sanitizeIoTextOutput({ text: decoded.text });
            const io = buildIoMeta({
                operation: 'fetch',
                target: finalUrl,
                targetKind: 'url',
                bytesRead: received,
                engine: 'fetch',
                truncated,
                advisoryLimits: {
                    requestedMaxBytes: maxBytes ?? null,
                    effectiveMaxBytes: responseMaxBytes,
                    returnedBytes: decoded.returnedBytes,
                    boundaryTrimmedBytes: decoded.boundaryTrimmedBytes,
                    limitMode: 'enforced',
                    advisoryTimeoutMs: timeoutMs ?? null,
                    method: safeMethod,
                    requestBodyBytes: bodySizeBytes,
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
                    method: safeMethod,
                    contentType,
                    truncated,
                    maxBytes: responseMaxBytes,
                    advisoryMaxBytes: maxBytes ?? null,
                    advisoryTimeoutMs: timeoutMs ?? null,
                    bytesRead: received,
                    returnedBytes: decoded.returnedBytes,
                    boundaryTrimmedBytes: decoded.boundaryTrimmedBytes,
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
        query: z.string().min(1)['describe']('Consulta de busca'),
        maxResults: z.number().int().min(1).optional()['describe']('Número sugerido de resultados a retornar.'),
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
                    data = /** @type {Record<string, unknown>} */ (
                        JSON.parse(
                            await readCompleteWebTextResponse(
                                response,
                                MAX_WEB_SEARCH_RESPONSE_BYTES,
                                'Resposta JSON do DDG',
                            ),
                        )
                    );
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
                        bytesRead: utf8ByteLength(JSON.stringify(sanitizedResults.results), 'web_search json results'),
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

            const html = await readCompleteWebTextResponse(
                response,
                MAX_WEB_SEARCH_RESPONSE_BYTES,
                'Resposta HTML do DDG',
            );

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
