// @ts-check
/**
 * src/copilot/observability/tool-stats.js
 *
 * Backend canônico de telemetria de tools/operações observadas. Expõe uma factory para isolamento por instância
 * (fundamental para testes/DI) e um singleton default para o runtime principal de `src/copilot`.
 *
 * @module copilot/observability/tool-stats
 * @see EventBus
 */

import { normalizeObservedToolName } from '../config/tool-aliases.js';
import { createHistogram } from './metrics-histogram.js';

/**
 * Estatísticas acumuladas de uma operação observada no plano canônico de telemetria.
 *
 * @typedef {object} ToolCallStats
 * @property {string} name
 * @property {string} kind
 * @property {string | null} scopePrefix
 * @property {string} canonicalName
 * @property {Set<string>} aliases
 * @property {number} calls
 * @property {number} errors
 * @property {number} blocked
 * @property {number} totalMs
 * @property {ReturnType<typeof createHistogram>} histogram
 * @property {number} lastCallMs
 * @property {number} lastBlockedMs
 * @property {boolean} lastOk
 */

/**
 * @typedef {object} ToolTelemetryStore
 * @property {(name: string, durationMs: number, success?: boolean) => void} recordToolCall
 * @property {(name: string) => void} recordBlockedToolCall
 * @property {() => Record<string, {
 *     name: string;
 *     kind: string;
 *     canonicalName: string;
 *     scopePrefix: string | null;
 *     aliases: string[];
 *     calls: number;
 *     errors: number;
 *     blocked: number;
 *     avgLatencyMs: number;
 *     errorRate: number;
 *     latency: ReturnType<ReturnType<typeof createHistogram>['snapshot']>;
 *     lastCallIso: string | null;
 *     lastBlockedIso: string | null;
 *     lastOk: boolean;
 * }>} getToolStats
 * @property {() => Record<string, {
 *     totalCalls: number;
 *     successCount: number;
 *     errorCount: number;
 *     blockedCount: number;
 *     kind: string;
 *     aliases: string[];
 *     latency: ReturnType<ReturnType<typeof createHistogram>['snapshot']>;
 * }>} getToolMetricsSummary
 * @property {() => Record<string, {
 *     totalCalls: number;
 *     totalErrors: number;
 *     totalBlocked: number;
 *     avgLatencyMs: number;
 *     tools: string[];
 * }>} getStatsByCategory
 * @property {(tool: import('#copilot/sdk/types').Tool<any>) => import('#copilot/sdk/types').Tool<any>} wrapWithStats
 * @property {() => void} reset
 */

const SPECIAL_OPERATION_SCOPES = new Set(['bridge', 'io', 'channel']);
const LEGACY_TOOL_SCOPES = new Set(['sdk', 'shell']);

/**
 * @param {string} observedName
 * @returns {{ key: string; kind: string; scopePrefix: string | null; canonicalName: string; observedName: string }}
 */
function resolveTelemetryIdentity(observedName) {
    const safeObservedName = String(observedName || 'unknown').trim() || 'unknown';
    const normalized = normalizeObservedToolName(safeObservedName);
    const scopePrefix = normalized.scopePrefix ?? null;
    const canonicalName = normalized.canonicalName || safeObservedName;

    if (scopePrefix && SPECIAL_OPERATION_SCOPES.has(scopePrefix)) {
        return {
            key: `${scopePrefix}.${canonicalName}`,
            kind: scopePrefix,
            scopePrefix,
            canonicalName,
            observedName: safeObservedName,
        };
    }

    if (!scopePrefix || LEGACY_TOOL_SCOPES.has(scopePrefix)) {
        return {
            key: canonicalName,
            kind: 'tool',
            scopePrefix,
            canonicalName,
            observedName: safeObservedName,
        };
    }

    return {
        key: safeObservedName,
        kind: scopePrefix,
        scopePrefix,
        canonicalName,
        observedName: safeObservedName,
    };
}

/**
 * Cria um backend isolado de telemetria de tools/operações.
 *
 * @returns {ToolTelemetryStore}
 */
export function createToolTelemetryStore() {
    /** @type {Map<string, ToolCallStats>} */
    const stats = new Map();

    /** @param {ReturnType<typeof resolveTelemetryIdentity>} identity */
    function getOrCreateStats(identity) {
        let current = stats.get(identity.key);
        if (!current) {
            current = {
                name: identity.key,
                kind: identity.kind,
                scopePrefix: identity.scopePrefix,
                canonicalName: identity.canonicalName,
                aliases: new Set([identity.observedName]),
                calls: 0,
                errors: 0,
                blocked: 0,
                totalMs: 0,
                histogram: createHistogram(500),
                lastCallMs: 0,
                lastBlockedMs: 0,
                lastOk: true,
            };
            stats.set(identity.key, current);
            return current;
        }
        current.aliases.add(identity.observedName);
        return current;
    }

    /** @type {ToolTelemetryStore['recordToolCall']} */
    function recordToolCall(name, durationMs, success = true) {
        const identity = resolveTelemetryIdentity(name);
        const current = getOrCreateStats(identity);
        current.calls++;
        current.totalMs += durationMs;
        current.histogram.record(Math.max(0, Number(durationMs) || 0));
        current.lastCallMs = Date.now();
        current.lastOk = success;
        if (!success) current.errors++;
    }

    /** @type {ToolTelemetryStore['recordBlockedToolCall']} */
    function recordBlockedToolCall(name) {
        const identity = resolveTelemetryIdentity(name);
        const current = getOrCreateStats(identity);
        current.blocked++;
        current.lastBlockedMs = Date.now();
    }

    /** @type {ToolTelemetryStore['getToolStats']} */
    function getToolStats() {
        /** @type {ReturnType<ToolTelemetryStore['getToolStats']>} */
        const result = {};
        for (const [name, current] of stats) {
            result[name] = {
                name,
                kind: current.kind,
                canonicalName: current.canonicalName,
                scopePrefix: current.scopePrefix,
                aliases: [...current.aliases].sort(),
                calls: current.calls,
                errors: current.errors,
                blocked: current.blocked,
                avgLatencyMs: current.calls > 0 ? Math.round(current.totalMs / current.calls) : 0,
                errorRate:
                    current.calls > 0 ? parseFloat(((current.errors / current.calls) * 100).toFixed(1)) : 0,
                latency: current.histogram.snapshot(),
                lastCallIso: current.lastCallMs > 0 ? new Date(current.lastCallMs).toISOString() : null,
                lastBlockedIso: current.lastBlockedMs > 0 ? new Date(current.lastBlockedMs).toISOString() : null,
                lastOk: current.lastOk,
            };
        }
        return result;
    }

    /** @type {ToolTelemetryStore['getToolMetricsSummary']} */
    function getToolMetricsSummary() {
        /** @type {ReturnType<ToolTelemetryStore['getToolMetricsSummary']>} */
        const summary = {};
        for (const [name, current] of stats) {
            summary[name] = {
                totalCalls: current.calls,
                successCount: current.calls - current.errors,
                errorCount: current.errors,
                blockedCount: current.blocked,
                kind: current.kind,
                aliases: [...current.aliases].sort(),
                latency: current.histogram.snapshot(),
            };
        }
        return summary;
    }

    /** @type {ToolTelemetryStore['getStatsByCategory']} */
    function getStatsByCategory() {
        /** @type {Record<string, { totalCalls: number; totalErrors: number; totalBlocked: number; totalMs: number; tools: string[] }>} */
        const categories = {};
        for (const [name, current] of stats) {
            const category = current.kind || 'tool';
            if (!categories[category]) {
                categories[category] = { totalCalls: 0, totalErrors: 0, totalBlocked: 0, totalMs: 0, tools: [] };
            }
            categories[category].totalCalls += current.calls;
            categories[category].totalErrors += current.errors;
            categories[category].totalBlocked += current.blocked;
            categories[category].totalMs += current.totalMs;
            if (!categories[category].tools.includes(name)) {
                categories[category].tools.push(name);
            }
        }

        /** @type {ReturnType<ToolTelemetryStore['getStatsByCategory']>} */
        const result = {};
        for (const [category, aggregate] of Object.entries(categories)) {
            result[category] = {
                totalCalls: aggregate.totalCalls,
                totalErrors: aggregate.totalErrors,
                totalBlocked: aggregate.totalBlocked,
                avgLatencyMs: aggregate.totalCalls > 0 ? Math.round(aggregate.totalMs / aggregate.totalCalls) : 0,
                tools: aggregate.tools.sort(),
            };
        }
        return result;
    }

    /** @type {ToolTelemetryStore['wrapWithStats']} */
    function wrapWithStats(tool) {
        const original = tool.handler;
        if (typeof original !== 'function') return tool;
        return {
            ...tool,
            handler: async (params, invocation) => {
                const t0 = Date.now();
                try {
                    const result = await original(params, invocation);
                    recordToolCall(tool.name, Date.now() - t0, true);
                    return result;
                } catch (error) {
                    recordToolCall(tool.name, Date.now() - t0, false);
                    throw error;
                }
            },
        };
    }

    /** @type {ToolTelemetryStore['reset']} */
    function reset() {
        stats.clear();
    }

    return {
        recordToolCall,
        recordBlockedToolCall,
        getToolStats,
        getToolMetricsSummary,
        getStatsByCategory,
        wrapWithStats,
        reset,
    };
}

/** @type {ToolTelemetryStore} */
export const defaultToolTelemetryStore = createToolTelemetryStore();

/** @param {string} name @param {number} durationMs @param {boolean} [success] */
export function recordToolCall(name, durationMs, success = true) {
    defaultToolTelemetryStore.recordToolCall(name, durationMs, success);
}

/** @param {string} name */
export function recordBlockedToolCall(name) {
    defaultToolTelemetryStore.recordBlockedToolCall(name);
}

export function getToolStats() {
    return defaultToolTelemetryStore.getToolStats();
}

/** @param {import('#copilot/sdk/types').Tool<any>} tool */
export function wrapWithStats(tool) {
    return defaultToolTelemetryStore.wrapWithStats(tool);
}

/** @internal */
export function _resetToolStats() {
    defaultToolTelemetryStore.reset();
}

export function getToolMetricsSummary() {
    return defaultToolTelemetryStore.getToolMetricsSummary();
}

export function getStatsByCategory() {
    return defaultToolTelemetryStore.getStatsByCategory();
}
