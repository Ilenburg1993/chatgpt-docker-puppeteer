// @ts-check
/**
 * Sanitized client-observed latency evidence for ChatGPT TTFT experiments.
 *
 * This store deliberately contains timings and closed experiment labels only.
 * It must never persist prompts, completions, HAR bodies, URLs, tokens, cookies,
 * public IPs or other raw client/network payloads.
 *
 * @module copilot/mcp/control-plane/client-latency-evidence
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { appendTextLocked, withIoResourceLock, writeFileAtomic } from '#copilot/infra/public/io';
import { getMcpWorkspaceRoot, toWorkspaceRelativePath } from './paths.js';

export const DEFAULT_CLIENT_LATENCY_EVIDENCE_RELATIVE_PATH = 'src/copilot/.ai/mcp/client-latency-evidence.jsonl';
const DEFAULT_MAX_ENTRIES = 2_000;
const MAX_ENTRIES = 20_000;
const MAX_READ_BYTES = 4 * 1024 * 1024;

/**
 * @typedef {'manual' | 'har' | 'client-observer'} ClientLatencyEvidenceSource
 * @typedef {'low' | 'medium' | 'high' | 'unknown'} ClientThinkingMode
 * @typedef {{
 *   schemaVersion: 1;
 *   sampleId: string;
 *   recordedAt: string;
 *   observedAt: string;
 *   source: ClientLatencyEvidenceSource;
 *   ttftMs: number;
 *   firstToolDispatchMs: number | null;
 *   turnCompleteMs: number | null;
 *   conditions: {
 *     thinkingMode: ClientThinkingMode;
 *     modelLabel: string | null;
 *     networkLabel: string | null;
 *     conversationLabel: string | null;
 *     clientLabel: string | null;
 *     vpnLabel: string | null;
 *     seriesId: string | null;
 *   };
 * }} ClientLatencyEvidenceEntry
 */

/**
 * @param {{
 *   observedAt?: string;
 *   source: ClientLatencyEvidenceSource;
 *   ttftMs: number;
 *   firstToolDispatchMs?: number | null;
 *   turnCompleteMs?: number | null;
 *   thinkingMode?: ClientThinkingMode;
 *   modelLabel?: string | null;
 *   networkLabel?: string | null;
 *   conversationLabel?: string | null;
 *   clientLabel?: string | null;
 *   vpnLabel?: string | null;
 *   seriesId?: string | null;
 * }} evidence
 * @param {{ maxEntries?: number; filePath?: string }} [options]
 */
export async function appendClientLatencyEvidence(evidence, options = {}) {
    const filePath = resolveEvidencePath(options.filePath);
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
    const { value: retainedEntries } = await withIoResourceLock(
        filePath,
        async () => {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await appendTextLocked(filePath, `${JSON.stringify(entry)}\n`, {
                encoding: 'utf8',
                advisoryLimits: { domain: 'client-latency-evidence' },
            });
            return trimEvidence(filePath, maxEntries);
        },
        { operation: 'client-latency-evidence', target: filePath, riskClass: 'low' },
    );
    return {
        persisted: true,
        path: toWorkspaceRelativePath(filePath),
        retainedEntries,
        entry,
    };
}

/**
 * @param {{ limit?: number; filePath?: string }} [options]
 * @returns {Promise<{ ok: boolean; path: string; entries: ClientLatencyEvidenceEntry[]; truncatedByBytes: boolean; error?: string }>}
 */
export async function readClientLatencyEvidence(options = {}) {
    const filePath = resolveEvidencePath(options.filePath);
    const limit = boundedInteger(options.limit, 500, 1, 5_000);
    try {
        const stats = await fs.stat(filePath);
        const start = Math.max(0, stats.size - MAX_READ_BYTES);
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
                .map(safeParseEntry)
                .filter((entry) => entry !== null)
                .slice(-limit);
            return {
                ok: true,
                path: toWorkspaceRelativePath(filePath),
                entries: /** @type {ClientLatencyEvidenceEntry[]} */ (entries),
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
        firstObservedAt: rows.length > 0 ? rows.map((entry) => entry.observedAt).sort()[0] ?? null : null,
        lastObservedAt: rows.length > 0 ? rows.map((entry) => entry.observedAt).sort().at(-1) ?? null : null,
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

/** @param {Array<number | null | undefined>} values */
export function summarizeClientLatencyNumbers(values) {
    return summarizeNumbers(values);
}

/** @param {Array<number | null | undefined>} values */
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

/** @param {string | undefined} overridePath */
function resolveEvidencePath(overridePath) {
    return overridePath ?? path.join(getMcpWorkspaceRoot(), DEFAULT_CLIENT_LATENCY_EVIDENCE_RELATIVE_PATH);
}

/** @param {string} filePath @param {number} maxEntries */
async function trimEvidence(filePath, maxEntries) {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim());
    if (lines.length <= maxEntries) return lines.length;
    const retained = lines.slice(-maxEntries);
    await writeFileAtomic(filePath, `${retained.join('\n')}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        riskClass: 'low',
        advisoryLimits: { domain: 'client-latency-evidence-trim', maxEntries },
    });
    return retained.length;
}

/** @param {string} line @returns {ClientLatencyEvidenceEntry | null} */
function safeParseEntry(line) {
    try {
        const parsed = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        const record = /** @type {Record<string, unknown>} */ (parsed);
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
