// @ts-check
/**
 * Bounded outbound HTTP helpers for MCP integrations and diagnostics.
 *
 * This module centralizes timeout, retry and response-text handling for read-only probes used by Cloudflare, OAuth and
 * MCP smoke diagnostics. It intentionally stays thin over the platform fetch implementation so callers keep protocol
 * semantics while avoiding duplicated timeout/retry code.
 *
 * @module copilot/mcp/integrations/http/client
 */

import { readBoundedResponseText } from '#copilot/infra/public/platform/http-response';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 1;
const DEFAULT_DELAY_MS = 0;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_RETRYABLE_STATUS = Object.freeze([0, 408, 425, 429, 500, 502, 503, 504, 530]);

/**
 * @typedef {{
 *     method?: string;
 *     headers?: HeadersInit;
 *     body?: BodyInit | null;
 *     timeoutMs?: number;
 *     signal?: AbortSignal;
 *     redirect?: RequestRedirect;
 *     cache?: RequestCache;
 *     maxBytes?: number;
 * }} McpFetchTextOptions
 *
 *
 * @typedef {{
 *     ok: boolean;
 *     status: number;
 *     rawBody: string;
 *     headers: Record<string, string>;
 *     error?: string;
 * }} McpFetchTextResult
 *
 *
 * @typedef {McpFetchTextOptions & {
 *     attempts?: number;
 *     delayMs?: number;
 *     retryStatuses?: readonly number[];
 * }} McpFetchRetryOptions
 *
 *
 * @typedef {McpFetchTextResult & { attempts: number }} McpFetchTextRetryResult
 */

/**
 * @param {string} url
 * @param {McpFetchTextOptions} [options]
 * @returns {Promise<McpFetchTextResult>}
 */
export async function mcpFetchText(url, options = {}) {
    try {
        const timeoutSignal = AbortSignal.timeout(normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS));
        const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
        /** @type {RequestInit} */
        const init = {
            method: options.method ?? 'GET',
            signal,
            ...(options.redirect !== undefined ? { redirect: options.redirect } : {}),
            ...(options.cache !== undefined ? { cache: options.cache } : {}),
        };
        if (options.headers !== undefined) init.headers = options.headers;
        if (options.body !== undefined) init.body = options.body;
        const response = await fetch(url, init);
        const headers = Object.fromEntries(response.headers.entries());
        const rawBody = await readBoundedResponseText(response, {
            defaultMaxBytes: DEFAULT_MAX_RESPONSE_BYTES,
            label: 'MCP outbound probe response',
            ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
        });
        return {
            ok: response.ok,
            status: response.status,
            rawBody,
            headers,
        };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            rawBody: '',
            headers: {},
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * @param {string} url
 * @param {McpFetchRetryOptions} [options]
 * @returns {Promise<McpFetchTextRetryResult>}
 */
export async function mcpFetchTextWithRetry(url, options = {}) {
    const attempts = normalizePositiveInteger(options.attempts, DEFAULT_ATTEMPTS);
    const delayMs = normalizeNonNegativeInteger(options.delayMs, DEFAULT_DELAY_MS);
    const retryStatuses = options.retryStatuses ?? DEFAULT_RETRYABLE_STATUS;
    /** @type {McpFetchTextRetryResult | undefined} */
    let last;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const current = await mcpFetchText(url, options);
        last = { ...current, attempts: attempt };
        if (current.ok || !retryStatuses.includes(current.status) || attempt >= attempts) return last;
        if (options.signal?.aborted) return cancelledRetryResult(attempt, options.signal);
        if (delayMs > 0 && !(await sleep(delayMs, options.signal)))
            return cancelledRetryResult(attempt, options.signal);
    }
    return last ?? { ok: false, status: 0, rawBody: '', headers: {}, error: 'fetch-not-run', attempts: 0 };
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number; signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: boolean; status?: number; error?: string }>}
 */
export async function mcpFetchStatus(url, options = {}) {
    const result = await mcpFetchText(url, {
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    return result.error ? { ok: false, error: result.error } : { ok: result.ok, status: result.status };
}

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizePositiveInteger(value, fallback) {
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeNonNegativeInteger(value, fallback) {
    return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

/** @param {number} attempts @param {AbortSignal | undefined} signal @returns {McpFetchTextRetryResult} */
function cancelledRetryResult(attempts, signal) {
    const reason = signal?.reason;
    return {
        ok: false,
        status: 0,
        rawBody: '',
        headers: {},
        error: reason instanceof Error ? reason.message : reason === undefined ? 'request-aborted' : String(reason),
        attempts,
    };
}

/**
 * Interruptible retry delay. Returns false instead of throwing when caller cancellation wins the delay.
 *
 * @param {number} ms
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<boolean>}
 */
function sleep(ms, signal) {
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve(true);
        }, ms);
        timer.unref();
        const onAbort = () => {
            clearTimeout(timer);
            resolve(false);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
