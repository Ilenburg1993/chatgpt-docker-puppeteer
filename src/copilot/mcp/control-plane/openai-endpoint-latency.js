// @ts-check
/**
 * Fixed OpenAI/ChatGPT endpoint latency observer with bounded local history.
 *
 * This module measures only the network path visible from the DevContainer.
 * It never claims to observe ChatGPT client/model scheduling or UI TTFT.
 *
 * @module copilot/mcp/control-plane/openai-endpoint-latency
 */

import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { appendTextLocked, withIoResourceLock, writeFileAtomic } from '#copilot/infra/public/io';
import { getMcpWorkspaceRoot, toWorkspaceRelativePath } from './paths.js';

export const OPENAI_ENDPOINT_LATENCY_TARGETS = Object.freeze([
    Object.freeze({ id: 'chatgpt-web', hostname: 'chatgpt.com', path: '/', method: 'HEAD' }),
    Object.freeze({ id: 'chatgpt-websocket-host', hostname: 'ws.chatgpt.com', path: '/', method: 'HEAD' }),
    Object.freeze({ id: 'openai-api', hostname: 'api.openai.com', path: '/v1/models', method: 'HEAD' }),
]);

export const DEFAULT_OPENAI_ENDPOINT_LATENCY_HISTORY_RELATIVE_PATH =
    'src/copilot/.ai/mcp/openai-endpoint-latency.jsonl';

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_SAMPLE_COUNT = 3;
const MAX_SAMPLE_COUNT = 10;
const DEFAULT_MAX_HISTORY_SNAPSHOTS = 1_000;
const MAX_HISTORY_SNAPSHOTS = 10_000;
const MAX_HISTORY_READ_BYTES = 4 * 1024 * 1024;
const DEFAULT_BASELINE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{
 *   id: string;
 *   hostname: string;
 *   method: string;
 *   ok: boolean;
 *   observedAt: string;
 *   statusCode: number | null;
 *   protocol: string | null;
 *   alpn: string | null;
 *   remoteFamily: string | null;
 *   edgeColo: string | null;
 *   timings: {
 *     dnsMs: number | null;
 *     tcpMs: number | null;
 *     tlsMs: number | null;
 *     ttfbMs: number | null;
 *     serverWaitMs: number | null;
 *     bodyMs: number | null;
 *     totalMs: number;
 *   };
 *   error: string | null;
 * }} OpenAiEndpointLatencySample
 *
 * @typedef {{
 *   id: string;
 *   hostname: string;
 *   samples: number;
 *   successful: number;
 *   successRate: number;
 *   statuses: number[];
 *   edgeColos: Record<string, number>;
 *   timings: {
 *     dns: ReturnType<typeof summarizeNumbers>;
 *     tcp: ReturnType<typeof summarizeNumbers>;
 *     tls: ReturnType<typeof summarizeNumbers>;
 *     ttfb: ReturnType<typeof summarizeNumbers>;
 *     serverWait: ReturnType<typeof summarizeNumbers>;
 *     total: ReturnType<typeof summarizeNumbers>;
 *   };
 * }} OpenAiEndpointLatencyTargetSummary
 *
 * @typedef {{
 *   schemaVersion: 1;
 *   observedAt: string;
 *   authority: 'observed-from-devcontainer-to-fixed-openai-endpoints';
 *   sampleCount: number;
 *   timeoutMs: number;
 *   targets: OpenAiEndpointLatencyTargetSummary[];
 * }} OpenAiEndpointLatencySnapshot
 */

/**
 * Measure fixed OpenAI/ChatGPT endpoints using fresh HTTPS connections.
 * DNS/TCP/TLS/TTFB are measured on the same request path whenever Node emits
 * the corresponding socket milestones. No response body is retained.
 *
 * @param {{ sampleCount?: number; timeoutMs?: number }} [options]
 * @returns {Promise<{ snapshot: OpenAiEndpointLatencySnapshot; samples: OpenAiEndpointLatencySample[] }>}
 */
export async function measureOpenAiEndpointLatency(options = {}) {
    const sampleCount = boundedInteger(options.sampleCount, DEFAULT_SAMPLE_COUNT, 1, MAX_SAMPLE_COUNT);
    const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 500, 10_000);
    /** @type {OpenAiEndpointLatencySample[]} */
    const samples = [];
    for (let round = 0; round < sampleCount; round += 1) {
        const roundSamples = await Promise.all(
            OPENAI_ENDPOINT_LATENCY_TARGETS.map((target) => probeFixedOpenAiHttpsTarget(target, timeoutMs)),
        );
        samples.push(...roundSamples);
    }
    return {
        snapshot: buildOpenAiEndpointLatencySnapshot(samples, sampleCount, timeoutMs),
        samples,
    };
}

/**
 * @param {{ id: string; hostname: string; path: string; method: string }} target
 * @param {number} timeoutMs
 * @returns {Promise<OpenAiEndpointLatencySample>}
 */
export function probeFixedOpenAiHttpsTarget(target, timeoutMs) {
    const start = performance.now();
    const observedAt = new Date().toISOString();
    return new Promise((resolve) => {
        let settled = false;
        /** @type {number | null} */
        let lookupAt = null;
        /** @type {number | null} */
        let connectAt = null;
        /** @type {number | null} */
        let secureAt = null;
        /** @type {number | null} */
        let responseAt = null;
        /** @type {import('node:tls').TLSSocket | null} */
        let socketRef = null;

        const request = https.request(
            {
                hostname: target.hostname,
                port: 443,
                path: target.path,
                method: target.method,
                agent: false,
                servername: target.hostname,
                rejectUnauthorized: true,
                headers: {
                    accept: '*/*',
                    'user-agent': 'workspace-openai-endpoint-latency/1.0',
                    connection: 'close',
                },
            },
            (response) => {
                responseAt = performance.now();
                const statusCode = response.statusCode ?? null;
                const protocol = `HTTP/${response.httpVersion}`;
                const edgeColo = extractCloudflareColo(response.headers['cf-ray']);
                response.resume();
                response.once('end', () => {
                    const endedAt = performance.now();
                    finish({
                        ok: statusCode !== null,
                        statusCode,
                        protocol,
                        edgeColo,
                        endedAt,
                    });
                });
            },
        );

        const timer = setTimeout(() => {
            request.destroy(new Error(`HTTPS ${target.hostname} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
        timer.unref?.();

        request.once('socket', (socket) => {
            socketRef = /** @type {import('node:tls').TLSSocket} */ (socket);
            socket.once('lookup', () => {
                lookupAt = performance.now();
            });
            socket.once('connect', () => {
                connectAt = performance.now();
            });
            socket.once('secureConnect', () => {
                secureAt = performance.now();
            });
        });
        request.once('error', (error) => {
            finish({
                ok: false,
                statusCode: null,
                protocol: null,
                edgeColo: null,
                endedAt: performance.now(),
                error: sanitizeError(error),
            });
        });
        request.end();

        /**
         * @param {{ ok: boolean; statusCode: number | null; protocol: string | null; edgeColo: string | null; endedAt: number; error?: string }} result
         */
        function finish(result) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const tlsStart = connectAt ?? lookupAt ?? start;
            const tcpStart = lookupAt ?? start;
            const serverStart = secureAt ?? connectAt ?? lookupAt ?? start;
            resolve({
                id: target.id,
                hostname: target.hostname,
                method: target.method,
                ok: result.ok,
                observedAt,
                statusCode: result.statusCode,
                protocol: result.protocol,
                alpn: socketRef?.alpnProtocol || null,
                remoteFamily: socketRef?.remoteFamily || null,
                edgeColo: result.edgeColo,
                timings: {
                    dnsMs: lookupAt === null ? null : elapsedBetween(start, lookupAt),
                    tcpMs: connectAt === null ? null : elapsedBetween(tcpStart, connectAt),
                    tlsMs: secureAt === null ? null : elapsedBetween(tlsStart, secureAt),
                    ttfbMs: responseAt === null ? null : elapsedBetween(start, responseAt),
                    serverWaitMs: responseAt === null ? null : elapsedBetween(serverStart, responseAt),
                    bodyMs: responseAt === null ? null : elapsedBetween(responseAt, result.endedAt),
                    totalMs: elapsedBetween(start, result.endedAt),
                },
                error: result.error ?? null,
            });
        }
    });
}

/**
 * @param {OpenAiEndpointLatencySample[]} samples
 * @param {number} sampleCount
 * @param {number} timeoutMs
 * @returns {OpenAiEndpointLatencySnapshot}
 */
export function buildOpenAiEndpointLatencySnapshot(samples, sampleCount, timeoutMs) {
    return {
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        authority: 'observed-from-devcontainer-to-fixed-openai-endpoints',
        sampleCount,
        timeoutMs,
        targets: OPENAI_ENDPOINT_LATENCY_TARGETS.map((target) => summarizeTargetSamples(target, samples)),
    };
}

/**
 * @param {{ id: string; hostname: string }} target
 * @param {OpenAiEndpointLatencySample[]} allSamples
 * @returns {OpenAiEndpointLatencyTargetSummary}
 */
function summarizeTargetSamples(target, allSamples) {
    const samples = allSamples.filter((sample) => sample.id === target.id);
    const successful = samples.filter((sample) => sample.ok);
    const statuses = [...new Set(samples.map((sample) => sample.statusCode).filter((value) => value !== null))].sort(
        (left, right) => Number(left) - Number(right),
    );
    /** @type {Record<string, number>} */
    const edgeColos = {};
    for (const sample of samples) {
        if (!sample.edgeColo) continue;
        edgeColos[sample.edgeColo] = (edgeColos[sample.edgeColo] ?? 0) + 1;
    }
    return {
        id: target.id,
        hostname: target.hostname,
        samples: samples.length,
        successful: successful.length,
        successRate: samples.length > 0 ? roundRatio(successful.length / samples.length) : 0,
        statuses: /** @type {number[]} */ (statuses),
        edgeColos,
        timings: {
            dns: summarizeNumbers(samples.map((sample) => sample.timings.dnsMs)),
            tcp: summarizeNumbers(samples.map((sample) => sample.timings.tcpMs)),
            tls: summarizeNumbers(samples.map((sample) => sample.timings.tlsMs)),
            ttfb: summarizeNumbers(samples.map((sample) => sample.timings.ttfbMs)),
            serverWait: summarizeNumbers(samples.map((sample) => sample.timings.serverWaitMs)),
            total: summarizeNumbers(samples.map((sample) => sample.timings.totalMs)),
        },
    };
}

/**
 * Persist one compact endpoint snapshot and trim history by snapshot count.
 *
 * @param {OpenAiEndpointLatencySnapshot} snapshot
 * @param {{ maxSnapshots?: number; filePath?: string }} [options]
 */
export async function appendOpenAiEndpointLatencySnapshot(snapshot, options = {}) {
    const filePath = resolveHistoryPath(options.filePath);
    const maxSnapshots = boundedInteger(options.maxSnapshots, DEFAULT_MAX_HISTORY_SNAPSHOTS, 1, MAX_HISTORY_SNAPSHOTS);
    const entry = `${JSON.stringify(snapshot)}\n`;
    try {
        const { value: retainedSnapshots } = await withIoResourceLock(
            filePath,
            async () => {
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await appendTextLocked(filePath, entry, {
                    encoding: 'utf8',
                    advisoryLimits: { domain: 'openai-endpoint-latency-history' },
                });
                return trimHistory(filePath, maxSnapshots);
            },
            { operation: 'openai-endpoint-latency-history', target: filePath, riskClass: 'low' },
        );
        return {
            persisted: true,
            path: toWorkspaceRelativePath(filePath),
            maxSnapshots,
            retainedSnapshots,
        };
    } catch (error) {
        return {
            persisted: false,
            path: toWorkspaceRelativePath(filePath),
            error: sanitizeError(error),
        };
    }
}

/**
 * @param {{ limit?: number; filePath?: string }} [options]
 * @returns {Promise<{ ok: boolean; path: string; entries: OpenAiEndpointLatencySnapshot[]; truncatedByBytes: boolean; error?: string }>}
 */
export async function readOpenAiEndpointLatencyHistory(options = {}) {
    const filePath = resolveHistoryPath(options.filePath);
    const limit = boundedInteger(options.limit, 200, 1, 2_000);
    try {
        const stats = await fs.stat(filePath);
        const start = Math.max(0, stats.size - MAX_HISTORY_READ_BYTES);
        const handle = await fs.open(filePath, 'r');
        try {
            const length = stats.size - start;
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, start);
            let raw = buffer.toString('utf8');
            if (start > 0) raw = raw.slice(Math.max(0, raw.indexOf('\n') + 1));
            const entries = raw
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map(safeParseSnapshot)
                .filter((entry) => entry !== null)
                .slice(-limit);
            return {
                ok: true,
                path: toWorkspaceRelativePath(filePath),
                entries: /** @type {OpenAiEndpointLatencySnapshot[]} */ (entries),
                truncatedByBytes: start > 0,
            };
        } finally {
            await handle.close();
        }
    } catch (error) {
        if (isNotFoundError(error)) {
            return { ok: true, path: toWorkspaceRelativePath(filePath), entries: [], truncatedByBytes: false };
        }
        return {
            ok: false,
            path: toWorkspaceRelativePath(filePath),
            entries: [],
            truncatedByBytes: false,
            error: sanitizeError(error),
        };
    }
}

/**
 * Build a historical baseline from persisted snapshots.
 *
 * @param {OpenAiEndpointLatencySnapshot[]} entries
 * @param {number} [now]
 * @param {number} [windowMs]
 */
export function summarizeOpenAiEndpointLatencyHistory(entries, now = Date.now(), windowMs = DEFAULT_BASELINE_WINDOW_MS) {
    const cutoff = now - windowMs;
    /** @type {Map<string, { hostname: string; ttfb: number[]; total: number[]; tls: number[]; snapshots: number }>} */
    const buckets = new Map();
    for (const entry of entries) {
        const observedAt = Date.parse(entry.observedAt);
        if (!Number.isFinite(observedAt) || observedAt < cutoff || observedAt > now) continue;
        for (const target of entry.targets ?? []) {
            const bucket = buckets.get(target.id) ?? { hostname: target.hostname, ttfb: [], total: [], tls: [], snapshots: 0 };
            bucket.snapshots += 1;
            pushFinite(bucket.ttfb, target.timings?.ttfb?.p50Ms);
            pushFinite(bucket.total, target.timings?.total?.p50Ms);
            pushFinite(bucket.tls, target.timings?.tls?.p50Ms);
            buckets.set(target.id, bucket);
        }
    }
    return [...buckets.entries()]
        .map(([id, bucket]) => ({
            id,
            hostname: bucket.hostname,
            snapshots: bucket.snapshots,
            ttfb: summarizeNumbers(bucket.ttfb),
            total: summarizeNumbers(bucket.total),
            tls: summarizeNumbers(bucket.tls),
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * @param {OpenAiEndpointLatencySnapshot} current
 * @param {ReturnType<typeof summarizeOpenAiEndpointLatencyHistory>} baseline
 */
export function compareOpenAiEndpointLatencyToBaseline(current, baseline) {
    const baselineById = new Map(baseline.map((row) => [row.id, row]));
    return current.targets.map((target) => {
        const previous = baselineById.get(target.id);
        const currentTtfb = target.timings.ttfb.p50Ms;
        const baselineTtfb = previous?.ttfb.p50Ms ?? null;
        const ratio = currentTtfb !== null && baselineTtfb !== null && baselineTtfb > 0 ? roundRatio(currentTtfb / baselineTtfb) : null;
        const deltaMs = currentTtfb !== null && baselineTtfb !== null ? Math.round(currentTtfb - baselineTtfb) : null;
        return {
            id: target.id,
            hostname: target.hostname,
            currentTtfbP50Ms: currentTtfb,
            baselineTtfbP50Ms: baselineTtfb,
            ttfbRatio: ratio,
            ttfbDeltaMs: deltaMs,
            regression:
                ratio !== null && currentTtfb !== null && baselineTtfb !== null
                    ? ratio >= 2 && currentTtfb - baselineTtfb >= 150
                    : false,
        };
    });
}

/** @param {Array<number | null | undefined>} values */
export function summarizeNumbers(values) {
    const sorted = values
        .filter((value) => value !== null && value !== undefined)
        .map((value) => Number(value))
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
        count: sorted.length,
        averageMs: sorted.length > 0 ? Math.round(total / sorted.length) : null,
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        minMs: sorted.at(0) ?? null,
        maxMs: sorted.at(-1) ?? null,
    };
}

/** @param {string | string[] | undefined} raw */
function extractCloudflareColo(raw) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') return null;
    const match = value.match(/-([A-Z]{3})$/u);
    return match?.[1] ?? null;
}

/** @param {number} start @param {number} end */
function elapsedBetween(start, end) {
    return Math.max(0, Math.round(end - start));
}

/** @param {number[]} sorted @param {number} quantile */
function percentile(sorted, quantile) {
    if (sorted.length === 0) return null;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
    return Math.round(sorted[index] ?? 0);
}

/** @param {number[]} target @param {unknown} value */
function pushFinite(target, value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) target.push(parsed);
}

/** @param {string | undefined} overridePath */
function resolveHistoryPath(overridePath) {
    return overridePath ?? path.join(getMcpWorkspaceRoot(), DEFAULT_OPENAI_ENDPOINT_LATENCY_HISTORY_RELATIVE_PATH);
}

/** @param {string} filePath @param {number} maxSnapshots */
async function trimHistory(filePath, maxSnapshots) {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim());
    if (lines.length <= maxSnapshots) return lines.length;
    const retained = lines.slice(-maxSnapshots);
    await writeFileAtomic(filePath, `${retained.join('\n')}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        riskClass: 'low',
        advisoryLimits: { domain: 'openai-endpoint-latency-history-trim', maxSnapshots },
    });
    return retained.length;
}

/** @param {string} line @returns {OpenAiEndpointLatencySnapshot | null} */
function safeParseSnapshot(line) {
    try {
        const parsed = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        const record = /** @type {Record<string, unknown>} */ (parsed);
        if (record['schemaVersion'] !== 1 || typeof record['observedAt'] !== 'string' || !Array.isArray(record['targets'])) return null;
        return /** @type {OpenAiEndpointLatencySnapshot} */ (record);
    } catch {
        return null;
    }
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/** @param {number} value */
function roundRatio(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}

/** @param {unknown} error */
function isNotFoundError(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

/** @param {unknown} error */
function sanitizeError(error) {
    return error instanceof Error ? error.message : String(error);
}
