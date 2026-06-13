// @ts-check
/**
 * Persistent latency dashboard history for MCP runtime observability.
 *
 * The history intentionally stores compact dashboard summaries, not request payloads or tokens.
 *
 * @module copilot/mcp/control-plane/latency-history
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { appendTextLocked, withIoResourceLock, writeFileAtomic } from '#copilot/infra/public/io';
import { getMcpWorkspaceRoot, toWorkspaceRelativePath } from './paths.js';

export const DEFAULT_MCP_LATENCY_HISTORY_RELATIVE_PATH = 'src/copilot/.ai/mcp/latency-dashboard.jsonl';
const DEFAULT_MAX_LATENCY_HISTORY_SNAPSHOTS = 500;
const MAX_LATENCY_HISTORY_SNAPSHOTS = 10_000;
const MAX_LATENCY_HISTORY_READ_BYTES = 2 * 1024 * 1024;

/**
 * @typedef {{
 *     timestamp: string;
 *     status: string;
 *     sample?: Record<string, unknown>;
 *     summary?: Record<string, unknown>;
 *     budgets?: Record<string, unknown>;
 *     warnings?: string[];
 *     critical?: string[];
 *     phaseTotals?: Record<string, { averageMs?: number | null; calls?: number; totalDurationMs?: number }>;
 * }} McpLatencyDashboardSnapshot
 *
 * @typedef {{
 *     schemaVersion: 1;
 *     capturedAt: string;
 *     snapshot: McpLatencyDashboardSnapshot;
 * }} McpLatencyHistoryEntry
 */

/**
 * @param {McpLatencyDashboardSnapshot} snapshot
 * @param {{ maxSnapshots?: number; filePath?: string }} [options]
 * @returns {Promise<{ persisted: true; path: string; maxSnapshots: number; retainedSnapshots: number } | { persisted: false; error: string; path: string | null }>}
 */
export async function appendMcpLatencyDashboardSnapshot(snapshot, options = {}) {
    const filePath = getLatencyHistoryPath(options.filePath);
    const maxSnapshots = readMaxSnapshots(options.maxSnapshots);
    const entry = {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        snapshot: compactSnapshot(snapshot),
    };
    try {
        const { value: retainedSnapshots } = await withIoResourceLock(
            filePath,
            async () => {
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await appendTextLocked(filePath, `${JSON.stringify(entry)}\n`, {
                    encoding: 'utf8',
                    advisoryLimits: { domain: 'mcp-latency-history' },
                });
                return trimLatencyHistoryFile(filePath, maxSnapshots);
            },
            { operation: 'mcp-latency-history', target: filePath, riskClass: 'medium' },
        );
        return {
            persisted: true,
            path: toWorkspaceRelativePath(filePath),
            maxSnapshots,
            retainedSnapshots,
        };
    } catch (error) {
        return { persisted: false, error: sanitizeError(error), path: toWorkspaceRelativePath(filePath) };
    }
}

/**
 * @param {{ limit?: number; filePath?: string }} [options]
 * @returns {Promise<{ ok: true; path: string; entries: McpLatencyHistoryEntry[] } | { ok: false; path: string; error: string; entries: [] }>}
 */
export async function readMcpLatencyDashboardHistory(options = {}) {
    const filePath = getLatencyHistoryPath(options.filePath);
    const limit = readBoundedInteger(options.limit, 20, 1, 500);
    try {
        const stats = await fs.stat(filePath);
        const start = stats.size > MAX_LATENCY_HISTORY_READ_BYTES ? stats.size - MAX_LATENCY_HISTORY_READ_BYTES : 0;
        const handle = await fs.open(filePath, 'r');
        try {
            const length = stats.size - start;
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, start);
            const entries = parseHistoryLines(buffer.toString('utf8')).slice(-limit);
            return { ok: true, path: toWorkspaceRelativePath(filePath), entries };
        } finally {
            await handle.close();
        }
    } catch (error) {
        if (isNotFoundError(error)) return { ok: true, path: toWorkspaceRelativePath(filePath), entries: [] };
        return { ok: false, path: toWorkspaceRelativePath(filePath), error: sanitizeError(error), entries: [] };
    }
}

/**
 * @param {McpLatencyDashboardSnapshot} current
 * @param {McpLatencyDashboardSnapshot | null | undefined} previous
 * @returns {{ available: boolean; comparedTo: string | null; deltas: Record<string, number | null>; interpretation: string[] }}
 */
export function compareMcpLatencyDashboardSnapshots(current, previous) {
    if (!previous) return { available: false, comparedTo: null, deltas: {}, interpretation: ['No previous latency snapshot is available.'] };
    const deltas = {
        totalCalls: numericDelta(current.summary?.['totalCalls'], previous.summary?.['totalCalls']),
        totalErrors: numericDelta(current.summary?.['totalErrors'], previous.summary?.['totalErrors']),
        errorRate: numericDelta(current.summary?.['errorRate'], previous.summary?.['errorRate']),
        slowestAverageToolMs: numericDelta(current.summary?.['slowestAverageToolMs'], previous.summary?.['slowestAverageToolMs']),
        authorizationAverageMs: numericDelta(current.phaseTotals?.['authorization']?.averageMs, previous.phaseTotals?.['authorization']?.averageMs),
        handlerAverageMs: numericDelta(current.phaseTotals?.['handler']?.averageMs, previous.phaseTotals?.['handler']?.averageMs),
        resultSizeAverageMs: numericDelta(current.phaseTotals?.['resultSize']?.averageMs, previous.phaseTotals?.['resultSize']?.averageMs),
    };
    return {
        available: true,
        comparedTo: previous.timestamp ?? null,
        deltas,
        interpretation: buildComparisonInterpretation(deltas),
    };
}

/**
 * @param {string | undefined} overridePath
 * @returns {string}
 */
function getLatencyHistoryPath(overridePath) {
    return overridePath ?? path.join(getMcpWorkspaceRoot(), DEFAULT_MCP_LATENCY_HISTORY_RELATIVE_PATH);
}

/**
 * @param {McpLatencyDashboardSnapshot} snapshot
 * @returns {McpLatencyDashboardSnapshot}
 */
function compactSnapshot(snapshot) {
    /** @type {McpLatencyDashboardSnapshot} */
    const compact = {
        timestamp: snapshot.timestamp,
        status: snapshot.status,
        warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings.slice(0, 20) : [],
        critical: Array.isArray(snapshot.critical) ? snapshot.critical.slice(0, 20) : [],
    };
    if (snapshot.sample !== undefined) compact.sample = snapshot.sample;
    if (snapshot.summary !== undefined) compact.summary = snapshot.summary;
    if (snapshot.budgets !== undefined) compact.budgets = snapshot.budgets;
    if (snapshot.phaseTotals !== undefined) compact.phaseTotals = snapshot.phaseTotals;
    return compact;
}

/**
 * @param {string} filePath
 * @param {number} maxSnapshots
 * @returns {Promise<number>}
 */
async function trimLatencyHistoryFile(filePath, maxSnapshots) {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim());
    if (lines.length <= maxSnapshots) return lines.length;
    const retained = lines.slice(-maxSnapshots);
    await writeFileAtomic(filePath, `${retained.join('\n')}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        riskClass: 'low',
        advisoryLimits: { domain: 'mcp-latency-history-trim', maxSnapshots },
    });
    return retained.length;
}

/**
 * @param {string} raw
 * @returns {McpLatencyHistoryEntry[]}
 */
function parseHistoryLines(raw) {
    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => safeParseHistoryEntry(line))
        .filter((entry) => entry !== null);
}

/**
 * @param {string} line
 * @returns {McpLatencyHistoryEntry | null}
 */
function safeParseHistoryEntry(line) {
    try {
        const parsed = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object') return null;
        const record = /** @type {Record<string, unknown>} */ (parsed);
        if (record['schemaVersion'] !== 1) return null;
        const snapshot = record['snapshot'];
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
        return /** @type {McpLatencyHistoryEntry} */ (record);
    } catch {
        return null;
    }
}

/**
 * @param {unknown} current
 * @param {unknown} previous
 * @returns {number | null}
 */
function numericDelta(current, previous) {
    const left = Number(current);
    const right = Number(previous);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    return Math.round((left - right) * 1000) / 1000;
}

/**
 * @param {Record<string, number | null>} deltas
 * @returns {string[]}
 */
function buildComparisonInterpretation(deltas) {
    const notes = [];
    if (typeof deltas['errorRate'] === 'number') {
        if (deltas['errorRate'] > 0) notes.push(`Error rate worsened by ${deltas['errorRate']}.`);
        else if (deltas['errorRate'] < 0) notes.push(`Error rate improved by ${Math.abs(deltas['errorRate'])}.`);
    }
    if (typeof deltas['slowestAverageToolMs'] === 'number') {
        if (deltas['slowestAverageToolMs'] > 100) notes.push(`Slowest average tool latency regressed by ${deltas['slowestAverageToolMs']}ms.`);
        else if (deltas['slowestAverageToolMs'] < -100) notes.push(`Slowest average tool latency improved by ${Math.abs(deltas['slowestAverageToolMs'])}ms.`);
    }
    if (typeof deltas['authorizationAverageMs'] === 'number' && deltas['authorizationAverageMs'] > 50) {
        notes.push(`Authorization average regressed by ${deltas['authorizationAverageMs']}ms.`);
    }
    if (notes.length === 0) notes.push('No material regression was detected against the previous latency snapshot.');
    return notes;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function readMaxSnapshots(value) {
    return readBoundedInteger(value, DEFAULT_MAX_LATENCY_HISTORY_SNAPSHOTS, 1, MAX_LATENCY_HISTORY_SNAPSHOTS);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function readBoundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isNotFoundError(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function sanitizeError(error) {
    if (error instanceof Error) return error.message;
    return String(error);
}
