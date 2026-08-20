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
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Interpreta o resultado semântico de handlers que retornam falhas estruturadas em vez de lançar exceção.
 *
 * Muitas tools locais preservam o contrato `{ success:false, error }` para que a LLM consiga se recuperar. A execução
 * do handler, portanto, pode terminar "normalmente" enquanto a operação real falhou. Métricas e UX devem contar o
 * resultado operacional, não apenas o fato de o callback ter retornado.
 *
 * @param {unknown} result
 * @returns {boolean}
 */
function inferToolHandlerSuccess(result) {
    if (!isRecord(result)) return true;
    if (result['success'] === false || result['ok'] === false) return false;
    if (result['resultType'] === 'error') return false;
    if (typeof result['exitCode'] === 'number' && Number.isFinite(result['exitCode']) && result['exitCode'] !== 0) {
        return false;
    }
    const nested = result['result'];
    if (isRecord(nested)) return inferToolHandlerSuccess(nested);
    return true;
}

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
 * @property {() => Record<
 *     string,
 *     {
 *         name: string;
 *         kind: string;
 *         canonicalName: string;
 *         scopePrefix: string | null;
 *         aliases: string[];
 *         calls: number;
 *         errors: number;
 *         blocked: number;
 *         avgLatencyMs: number;
 *         errorRate: number;
 *         latency: ReturnType<ReturnType<typeof createHistogram>['snapshot']>;
 *         lastCallIso: string | null;
 *         lastBlockedIso: string | null;
 *         lastOk: boolean;
 *     }
 * >} getToolStats
 * @property {() => Record<
 *     string,
 *     {
 *         totalCalls: number;
 *         successCount: number;
 *         errorCount: number;
 *         blockedCount: number;
 *         kind: string;
 *         aliases: string[];
 *         latency: ReturnType<ReturnType<typeof createHistogram>['snapshot']>;
 *     }
 * >} getToolMetricsSummary
 * @property {() => Record<
 *     string,
 *     {
 *         totalCalls: number;
 *         totalErrors: number;
 *         totalBlocked: number;
 *         avgLatencyMs: number;
 *         tools: string[];
 *     }
 * >} getStatsByCategory
 * @property {(tool: import('#copilot/sdk/types').Tool<any>) => import('#copilot/sdk/types').Tool<any>} wrapWithStats
 * @property {() => void} reset
 */

const SPECIAL_OPERATION_SCOPES = new Set(['bridge', 'io', 'channel']);
const LEGACY_TOOL_SCOPES = new Set(['sdk', 'shell']);
const MAX_TOOL_TELEMETRY_ENTRIES = 1000;
const MAX_TOOL_TELEMETRY_ALIASES = 32;

/**
 * @param {Record<string, unknown>} target
 * @param {string} key
 * @param {unknown} value
 * @returns {void}
 */
function setOwnEnumerable(target, key, value) {
    Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
    });
}

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
            while (stats.size > MAX_TOOL_TELEMETRY_ENTRIES) {
                const oldest = stats.keys().next().value;
                if (typeof oldest !== 'string') break;
                stats.delete(oldest);
            }
            return current;
        }
        stats.delete(identity.key);
        stats.set(identity.key, current);
        current.aliases.add(identity.observedName);
        while (current.aliases.size > MAX_TOOL_TELEMETRY_ALIASES) {
            const oldest = current.aliases.values().next().value;
            if (typeof oldest !== 'string') break;
            current.aliases.delete(oldest);
        }
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
            setOwnEnumerable(result, name, {
                name,
                kind: current.kind,
                canonicalName: current.canonicalName,
                scopePrefix: current.scopePrefix,
                aliases: [...current.aliases].sort(),
                calls: current.calls,
                errors: current.errors,
                blocked: current.blocked,
                avgLatencyMs: current.calls > 0 ? Math.round(current.totalMs / current.calls) : 0,
                errorRate: current.calls > 0 ? parseFloat(((current.errors / current.calls) * 100).toFixed(1)) : 0,
                latency: current.histogram.snapshot(),
                lastCallIso: current.lastCallMs > 0 ? new Date(current.lastCallMs).toISOString() : null,
                lastBlockedIso: current.lastBlockedMs > 0 ? new Date(current.lastBlockedMs).toISOString() : null,
                lastOk: current.lastOk,
            });
        }
        return result;
    }

    /** @type {ToolTelemetryStore['getToolMetricsSummary']} */
    function getToolMetricsSummary() {
        /** @type {ReturnType<ToolTelemetryStore['getToolMetricsSummary']>} */
        const summary = {};
        for (const [name, current] of stats) {
            setOwnEnumerable(summary, name, {
                totalCalls: current.calls,
                successCount: current.calls - current.errors,
                errorCount: current.errors,
                blockedCount: current.blocked,
                kind: current.kind,
                aliases: [...current.aliases].sort(),
                latency: current.histogram.snapshot(),
            });
        }
        return summary;
    }

    /** @type {ToolTelemetryStore['getStatsByCategory']} */
    function getStatsByCategory() {
        /**
         * @type {Record<
         *     string,
         *     { totalCalls: number; totalErrors: number; totalBlocked: number; totalMs: number; tools: string[] }
         * >}
         */
        const categories = {};
        for (const [name, current] of stats) {
            const category = current.kind || 'tool';
            let aggregate = categories[category];
            if (!aggregate) {
                aggregate = {
                    totalCalls: 0,
                    totalErrors: 0,
                    totalBlocked: 0,
                    totalMs: 0,
                    tools: [],
                };
                setOwnEnumerable(categories, category, aggregate);
            }
            aggregate.totalCalls += current.calls;
            aggregate.totalErrors += current.errors;
            aggregate.totalBlocked += current.blocked;
            aggregate.totalMs += current.totalMs;
            if (!aggregate.tools.includes(name)) {
                aggregate.tools.push(name);
            }
        }

        /** @type {ReturnType<ToolTelemetryStore['getStatsByCategory']>} */
        const result = {};
        for (const [category, aggregate] of Object.entries(categories)) {
            setOwnEnumerable(result, category, {
                totalCalls: aggregate.totalCalls,
                totalErrors: aggregate.totalErrors,
                totalBlocked: aggregate.totalBlocked,
                avgLatencyMs: aggregate.totalCalls > 0 ? Math.round(aggregate.totalMs / aggregate.totalCalls) : 0,
                tools: aggregate.tools.sort(),
            });
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
                    recordToolCall(tool.name, Date.now() - t0, inferToolHandlerSuccess(result));
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

/**
 * Preserve the executable-tool contract when instrumentation wraps a tool with a required handler. Declaration-only SDK
 * tools still retain the broader optional-handler contract via the second overload.
 *
 * @template [TArgs=unknown] Default is `unknown`
 * @template [TResult=unknown] Default is `unknown`
 * @overload
 * @param {import('#copilot/sdk/types').ExecutableTool<TArgs, TResult>} tool
 * @returns {import('#copilot/sdk/types').ExecutableTool<TArgs, TResult>}
 */
/**
 * @template [TArgs=unknown] Default is `unknown`
 * @overload
 * @param {import('#copilot/sdk/types').Tool<TArgs>} tool
 * @returns {import('#copilot/sdk/types').Tool<TArgs>}
 */
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
