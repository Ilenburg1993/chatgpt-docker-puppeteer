// @ts-check
/**
 * Sanitized client-observed latency evidence for ChatGPT TTFT experiments.
 *
 * This store deliberately contains timings and closed experiment labels only. It must never persist prompts,
 * completions, HAR bodies, URLs, tokens, cookies, public IPs or other raw client/network payloads.
 *
 * @module copilot/mcp/diagnostics/latency/client/evidence
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { MCP_WORKSPACE_ROOT, toMcpWorkspaceRelativePath } from '#copilot/mcp/public/workspace';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createBoundConfiguredJsonlStore } from '../persistence/index.js';

export const DEFAULT_CLIENT_LATENCY_EVIDENCE_RELATIVE_PATH = 'src/copilot/.ai/mcp/client-latency-evidence.jsonl';
const DEFAULT_MAX_ENTRIES = 2_000;
const MAX_ENTRIES = 20_000;
const MAX_READ_BYTES = 4 * 1024 * 1024;
const CLIENT_LATENCY_EVIDENCE_PATH = path.resolve(MCP_WORKSPACE_ROOT, DEFAULT_CLIENT_LATENCY_EVIDENCE_RELATIVE_PATH);
const CLIENT_LATENCY_EVIDENCE_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'mcp.diagnostics.latency.client-evidence',
        exactPaths: [CLIENT_LATENCY_EVIDENCE_PATH],
        operations: ['append', 'read', 'write'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);
const CLIENT_LATENCY_EVIDENCE_STORE = createBoundConfiguredJsonlStore({
    filePath: CLIENT_LATENCY_EVIDENCE_PATH,
    io: CLIENT_LATENCY_EVIDENCE_IO,
    maxReadBytes: MAX_READ_BYTES,
});

/**
 * @typedef {'manual' | 'har' | 'client-observer'} ClientLatencyEvidenceSource
 *
 * @typedef {'low' | 'medium' | 'high' | 'unknown'} ClientThinkingMode
 *
 * @typedef {{
 *     schemaVersion: 1;
 *     sampleId: string;
 *     recordedAt: string;
 *     observedAt: string;
 *     source: ClientLatencyEvidenceSource;
 *     ttftMs: number;
 *     firstToolDispatchMs: number | null;
 *     turnCompleteMs: number | null;
 *     conditions: {
 *         thinkingMode: ClientThinkingMode;
 *         modelLabel: string | null;
 *         networkLabel: string | null;
 *         conversationLabel: string | null;
 *         clientLabel: string | null;
 *         vpnLabel: string | null;
 *         seriesId: string | null;
 *     };
 * }} ClientLatencyEvidenceEntry
 */

/**
 * @param {{
 *     observedAt?: string;
 *     source: ClientLatencyEvidenceSource;
 *     ttftMs: number;
 *     firstToolDispatchMs?: number | null;
 *     turnCompleteMs?: number | null;
 *     thinkingMode?: ClientThinkingMode;
 *     modelLabel?: string | null;
 *     networkLabel?: string | null;
 *     conversationLabel?: string | null;
 *     clientLabel?: string | null;
 *     vpnLabel?: string | null;
 *     seriesId?: string | null;
 * }} evidence
 * @param {{ maxEntries?: number }} [options]
 */
export async function appendClientLatencyEvidence(evidence, options = {}) {
    const maxEntries = boundedInteger(options.maxEntries, DEFAULT_MAX_ENTRIES, 1, MAX_ENTRIES);
    const nowIso = new Date().toISOString();
    /** @type {ClientLatencyEvidenceEntry} */
    const entry = {
        schemaVersion: 1,
        sampleId: randomUUID(),
        recordedAt: nowIso,
        observedAt: normalizeObservedAt(evidence.observedAt, nowIso),
        source: evidence.source,
        ttftMs: boundedTiming(evidence.ttftMs),
        firstToolDispatchMs: optionalTiming(evidence.firstToolDispatchMs),
        turnCompleteMs: optionalTiming(evidence.turnCompleteMs),
        conditions: {
            thinkingMode: evidence.thinkingMode ?? 'unknown',
            modelLabel: nullableLabel(evidence.modelLabel),
            networkLabel: nullableLabel(evidence.networkLabel),
            conversationLabel: nullableLabel(evidence.conversationLabel),
            clientLabel: nullableLabel(evidence.clientLabel),
            vpnLabel: nullableLabel(evidence.vpnLabel),
            seriesId: nullableLabel(evidence.seriesId),
        },
    };
    const { retainedEntries } = await CLIENT_LATENCY_EVIDENCE_STORE.appendRecord(entry, { maxEntries });
    return {
        persisted: true,
        path: toMcpWorkspaceRelativePath(CLIENT_LATENCY_EVIDENCE_PATH),
        retainedEntries,
        entry,
    };
}

/**
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{
 *     ok: boolean;
 *     path: string;
 *     entries: ClientLatencyEvidenceEntry[];
 *     truncatedByBytes: boolean;
 *     error?: string;
 * }>}
 */
export async function readClientLatencyEvidence(options = {}) {
    const limit = boundedInteger(options.limit, 500, 1, 5_000);
    try {
        const tail = await CLIENT_LATENCY_EVIDENCE_STORE.readTail({
            maxLines: Math.min(10_000, Math.max(limit, limit * 2)),
            maxBytes: MAX_READ_BYTES,
        });
        const entries = tail.records
            .map(normalizeEvidenceEntry)
            .filter((entry) => entry !== null)
            .slice(-limit);
        return {
            ok: true,
            path: toMcpWorkspaceRelativePath(CLIENT_LATENCY_EVIDENCE_PATH),
            entries: /** @type {ClientLatencyEvidenceEntry[]} */ (entries),
            truncatedByBytes: tail.truncatedByByteLimit,
        };
    } catch (error) {
        if (isNotFoundError(error)) {
            return {
                ok: true,
                path: toMcpWorkspaceRelativePath(CLIENT_LATENCY_EVIDENCE_PATH),
                entries: [],
                truncatedByBytes: false,
            };
        }
        return {
            ok: false,
            path: toMcpWorkspaceRelativePath(CLIENT_LATENCY_EVIDENCE_PATH),
            entries: [],
            truncatedByBytes: false,
            error: sanitizeError(error),
        };
    }
}

/**
 * @param {ClientLatencyEvidenceEntry[]} entries
 */
export function summarizeClientLatencyEvidence(entries) {
    const overall = summarizeEvidenceRows(entries);
    const byThinkingMode = groupEvidence(entries, (entry) => entry.conditions.thinkingMode);
    const byModel = groupEvidence(entries, (entry) => entry.conditions.modelLabel ?? '(unlabeled)');
    const byNetwork = groupEvidence(entries, (entry) => entry.conditions.networkLabel ?? '(unlabeled)');
    const byConversation = groupEvidence(entries, (entry) => entry.conditions.conversationLabel ?? '(unlabeled)');
    const byClient = groupEvidence(entries, (entry) => entry.conditions.clientLabel ?? '(unlabeled)');
    const byVpn = groupEvidence(entries, (entry) => entry.conditions.vpnLabel ?? '(unlabeled)');
    const bySeries = groupEvidence(entries, (entry) => entry.conditions.seriesId ?? '(unlabeled)');
    const high = byThinkingMode.find((row) => row.label === 'high') ?? null;
    const medium = byThinkingMode.find((row) => row.label === 'medium') ?? null;
    const highMedian = high?.ttft.p50Ms ?? null;
    const mediumMedian = medium?.ttft.p50Ms ?? null;
    return {
        authority: 'client-provided-sanitized-latency-evidence',
        overall,
        byThinkingMode,
        byModel,
        byNetwork,
        byConversation,
        byClient,
        byVpn,
        bySeries,
        thinkingHighVsMedium:
            high && medium && highMedian !== null && mediumMedian !== null
                ? {
                      highCount: high.count,
                      mediumCount: medium.count,
                      highP50Ms: highMedian,
                      mediumP50Ms: mediumMedian,
                      deltaMs: highMedian - mediumMedian,
                      ratio: mediumMedian > 0 ? roundRatio(highMedian / mediumMedian) : null,
                      sufficientForDirectionalComparison: high.count >= 5 && medium.count >= 5,
                  }
                : {
                      highCount: high?.count ?? 0,
                      mediumCount: medium?.count ?? 0,
                      highP50Ms: highMedian,
                      mediumP50Ms: mediumMedian,
                      deltaMs: null,
                      ratio: null,
                      sufficientForDirectionalComparison: false,
                  },
    };
}

/** @param {ClientLatencyEvidenceEntry[]} rows */
function summarizeEvidenceRows(rows) {
    return {
        count: rows.length,
        sources: countBy(rows.map((entry) => entry.source)),
        ttft: summarizeNumbers(rows.map((entry) => entry.ttftMs)),
        firstToolDispatch: summarizeNumbers(rows.map((entry) => entry.firstToolDispatchMs)),
        turnComplete: summarizeNumbers(rows.map((entry) => entry.turnCompleteMs)),
        firstObservedAt: rows.length > 0 ? (rows.map((entry) => entry.observedAt).sort()[0] ?? null) : null,
        lastObservedAt:
            rows.length > 0
                ? (rows
                      .map((entry) => entry.observedAt)
                      .sort()
                      .at(-1) ?? null)
                : null,
    };
}

/**
 * @param {ClientLatencyEvidenceEntry[]} rows
 * @param {(entry: ClientLatencyEvidenceEntry) => string} selector
 */
function groupEvidence(rows, selector) {
    /** @type {Map<string, ClientLatencyEvidenceEntry[]>} */
    const groups = new Map();
    for (const row of rows) {
        const label = selector(row);
        const bucket = groups.get(label) ?? [];
        bucket.push(row);
        groups.set(label, bucket);
    }
    return [...groups.entries()]
        .map(([label, groupRows]) => ({ label, ...summarizeEvidenceRows(groupRows) }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

/** @param {(number | null | undefined)[]} values */
export function summarizeClientLatencyNumbers(values) {
    return summarizeNumbers(values);
}

/** @param {(number | null | undefined)[]} values */
function summarizeNumbers(values) {
    const sorted = values
        .filter((value) => value !== null && value !== undefined)
        .map((value) => Number(value))
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
        count: sorted.length,
        averageMs: sorted.length > 0 ? Math.round(total / sorted.length) : null,
        p25Ms: percentile(sorted, 0.25),
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        minMs: sorted.at(0) ?? null,
        maxMs: sorted.at(-1) ?? null,
    };
}

/** @param {string[]} values */
function countBy(values) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
    return counts;
}

/** @param {number[]} sorted @param {number} quantile */
function percentile(sorted, quantile) {
    if (sorted.length === 0) return null;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
    return Math.round(sorted[index] ?? 0);
}

/** @param {string | undefined} observedAt @param {string} fallback */
function normalizeObservedAt(observedAt, fallback) {
    if (!observedAt) return fallback;
    const parsed = Date.parse(observedAt);
    if (!Number.isFinite(parsed)) throw new Error('observedAt must be a valid ISO-8601 timestamp.');
    return new Date(parsed).toISOString();
}

/** @param {unknown} value */
function boundedTiming(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10 * 60 * 1000) {
        throw new Error('Latency evidence must be a finite duration between 0 and 600000ms.');
    }
    return Math.round(parsed);
}

/** @param {unknown} value */
function optionalTiming(value) {
    return value === null || value === undefined ? null : boundedTiming(value);
}

/** @param {unknown} value */
function nullableLabel(value) {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
}

/** @param {unknown} value @returns {ClientLatencyEvidenceEntry | null} */
function normalizeEvidenceEntry(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = /** @type {Record<string, unknown>} */ (value);
    if (
        record['schemaVersion'] !== 1 ||
        typeof record['sampleId'] !== 'string' ||
        typeof record['observedAt'] !== 'string' ||
        typeof record['ttftMs'] !== 'number' ||
        !record['conditions'] ||
        typeof record['conditions'] !== 'object'
    ) {
        return null;
    }
    return /** @type {ClientLatencyEvidenceEntry} */ (record);
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
