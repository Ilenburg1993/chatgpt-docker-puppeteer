// @ts-check
/**
 * Persistent latency dashboard history for MCP runtime observability.
 *
 * The history intentionally stores compact dashboard summaries, not request payloads or tokens.
 *
 * @module copilot/mcp/diagnostics/latency/dashboard/history
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { MCP_WORKSPACE_ROOT, toMcpWorkspaceRelativePath } from '#copilot/mcp/public/workspace';
import path from 'node:path';
import { createBoundConfiguredJsonlStore } from '../persistence/index.js';

export const DEFAULT_MCP_LATENCY_HISTORY_RELATIVE_PATH = 'src/copilot/.ai/mcp/latency-dashboard.jsonl';
const DEFAULT_MAX_LATENCY_HISTORY_SNAPSHOTS = 500;
const MAX_LATENCY_HISTORY_SNAPSHOTS = 10_000;
const MAX_LATENCY_HISTORY_READ_BYTES = 2 * 1024 * 1024;
const MCP_LATENCY_HISTORY_PATH = path.resolve(MCP_WORKSPACE_ROOT, DEFAULT_MCP_LATENCY_HISTORY_RELATIVE_PATH);
const MCP_LATENCY_HISTORY_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'mcp.diagnostics.latency.dashboard-history',
        exactPaths: [MCP_LATENCY_HISTORY_PATH],
        operations: ['append', 'read', 'write'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);

/** @typedef {ReturnType<typeof createConfiguredFsIo>} ConfiguredFsIo */

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
 *
 * @typedef {{
 *     schemaVersion: 1;
 *     capturedAt: string;
 *     snapshot: McpLatencyDashboardSnapshot;
 * }} McpLatencyHistoryEntry
 */

/**
 * Build one latency-history runtime around already-authorized IO. The factory cannot mint or widen filesystem authority;
 * it exists for isolated white-box tests and future explicit composition roots.
 *
 * @param {{ filePath:string; io:ConfiguredFsIo }} binding
 */
export function createMcpLatencyHistoryRuntime(binding) {
    if (!path.isAbsolute(binding.filePath)) {
        throw new TypeError('MCP latency history requires an already-resolved absolute filePath binding.');
    }
    const filePath = path.normalize(binding.filePath);
    const store = createBoundConfiguredJsonlStore({
        filePath,
        io: binding.io,
        maxReadBytes: MAX_LATENCY_HISTORY_READ_BYTES,
    });

    /** @param {McpLatencyDashboardSnapshot} snapshot @param {{maxSnapshots?:number}} [options] */
    async function appendSnapshot(snapshot, options = {}) {
        const maxSnapshots = readMaxSnapshots(options.maxSnapshots);
        const entry = {
            schemaVersion: 1,
            capturedAt: new Date().toISOString(),
            snapshot: compactSnapshot(snapshot),
        };
        try {
            const { retainedEntries } = await store.appendRecord(entry, { maxEntries: maxSnapshots });
            return {
                persisted: /** @type {const} */ (true),
                path: toMcpWorkspaceRelativePath(filePath),
                maxSnapshots,
                retainedSnapshots: retainedEntries,
            };
        } catch (error) {
            return {
                persisted: /** @type {const} */ (false),
                error: sanitizeError(error),
                path: toMcpWorkspaceRelativePath(filePath),
            };
        }
    }

    /** @param {{limit?:number}} [options] */
    async function readHistory(options = {}) {
        const limit = readBoundedInteger(options.limit, 20, 1, 500);
        try {
            const tail = await store.readTail({
                maxLines: Math.min(10_000, Math.max(limit, limit * 10)),
                maxBytes: MAX_LATENCY_HISTORY_READ_BYTES,
            });
            const entries = tail.records
                .map(normalizeHistoryEntry)
                .filter((entry) => entry !== null)
                .slice(-limit);
            return {
                ok: /** @type {const} */ (true),
                path: toMcpWorkspaceRelativePath(filePath),
                entries: /** @type {McpLatencyHistoryEntry[]} */ (entries),
            };
        } catch (error) {
            if (isNotFoundError(error)) {
                return { ok: /** @type {const} */ (true), path: toMcpWorkspaceRelativePath(filePath), entries: [] };
            }
            return {
                ok: /** @type {const} */ (false),
                path: toMcpWorkspaceRelativePath(filePath),
                error: sanitizeError(error),
                entries: /** @type {[]} */ ([]),
            };
        }
    }

    return Object.freeze({ appendSnapshot, readHistory });
}

const MCP_LATENCY_HISTORY_RUNTIME = createMcpLatencyHistoryRuntime({
    filePath: MCP_LATENCY_HISTORY_PATH,
    io: MCP_LATENCY_HISTORY_IO,
});

/**
 * @param {McpLatencyDashboardSnapshot} snapshot
 * @param {{ maxSnapshots?: number }} [options]
 */
export async function appendMcpLatencyDashboardSnapshot(snapshot, options = {}) {
    return MCP_LATENCY_HISTORY_RUNTIME.appendSnapshot(snapshot, options);
}

/** @param {{ limit?: number }} [options] */
export async function readMcpLatencyDashboardHistory(options = {}) {
    return MCP_LATENCY_HISTORY_RUNTIME.readHistory(options);
}

/**
 * @param {McpLatencyDashboardSnapshot} current
 * @param {McpLatencyDashboardSnapshot | null | undefined} previous
 * @returns {{
 *     available: boolean;
 *     comparedTo: string | null;
 *     deltas: Record<string, number | null>;
 *     interpretation: string[];
 * }}
 */
export function compareMcpLatencyDashboardSnapshots(current, previous) {
    if (!previous)
        return {
            available: false,
            comparedTo: null,
            deltas: {},
            interpretation: ['No previous latency snapshot is available.'],
        };
    const deltas = {
        totalCalls: numericDelta(current.summary?.['totalCalls'], previous.summary?.['totalCalls']),
        totalErrors: numericDelta(current.summary?.['totalErrors'], previous.summary?.['totalErrors']),
        errorRate: numericDelta(current.summary?.['errorRate'], previous.summary?.['errorRate']),
        slowestAverageToolMs: numericDelta(
            current.summary?.['slowestAverageToolMs'],
            previous.summary?.['slowestAverageToolMs'],
        ),
        authorizationAverageMs: numericDelta(
            current.phaseTotals?.['authorization']?.averageMs,
            previous.phaseTotals?.['authorization']?.averageMs,
        ),
        handlerAverageMs: numericDelta(
            current.phaseTotals?.['handler']?.averageMs,
            previous.phaseTotals?.['handler']?.averageMs,
        ),
        resultSizeAverageMs: numericDelta(
            current.phaseTotals?.['resultSize']?.averageMs,
            previous.phaseTotals?.['resultSize']?.averageMs,
        ),
    };
    return {
        available: true,
        comparedTo: previous.timestamp ?? null,
        deltas,
        interpretation: buildComparisonInterpretation(deltas),
    };
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
 * @param {unknown} value
 * @returns {McpLatencyHistoryEntry | null}
 */
function normalizeHistoryEntry(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = /** @type {Record<string, unknown>} */ (value);
    if (record['schemaVersion'] !== 1) return null;
    const snapshot = record['snapshot'];
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    return /** @type {McpLatencyHistoryEntry} */ (record);
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
        if (deltas['slowestAverageToolMs'] > 100)
            notes.push(`Slowest average tool latency regressed by ${deltas['slowestAverageToolMs']}ms.`);
        else if (deltas['slowestAverageToolMs'] < -100)
            notes.push(`Slowest average tool latency improved by ${Math.abs(deltas['slowestAverageToolMs'])}ms.`);
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
