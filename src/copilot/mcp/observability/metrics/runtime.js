// @ts-check
/**
 * In-memory MCP runtime metrics.
 *
 * @module copilot/mcp/observability/metrics
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const startedAt = Date.now();
const MAX_TOOL_METRICS = 1000;

const HTTP_METRICS = {
    modern2026Requests: 0,
    statefulRequests: 0,
    statelessFallbackRequests: 0,
};
const MAX_PHASE_METRICS_PER_TOOL = 64;
const MAX_INTER_TOOL_GAP_SAMPLES = 256;
const MAX_HTTP_TOOL_TIMING_SAMPLES = 256;
const MAX_HTTP_REQUEST_ACTIVITY_EVENTS = 512;

/**
 * @typedef {{ from: string | null; to: string; gapMs: number; observedAt: number }} ToolGapTransition
 *
 * @typedef {{
 *     activeCalls: number;
 *     burstCount: number;
 *     gapCount: number;
 *     totalGapMs: number;
 *     lastGapMs: number | null;
 *     maxGapMs: number | null;
 *     lastBurstCompletedAt: number | null;
 *     lastToolStartedAt: number | null;
 *     lastToolCompletedAt: number | null;
 *     lastStartedTool: string | null;
 *     lastCompletedTool: string | null;
 *     lastTransition: ToolGapTransition | null;
 *     maxTransition: ToolGapTransition | null;
 *     gapSamples: number[];
 * }} ToolInteractionMetrics
 */

/**
 * Measures quiescent time between tool-call bursts at the MCP origin boundary. A gap starts only when activeCalls
 * reaches zero and ends when the next tool starts, so parallel tool calls are not misclassified as model/orchestrator
 * delay.
 *
 * @type {ToolInteractionMetrics}
 */
const TOOL_INTERACTION_METRICS = {
    activeCalls: 0,
    burstCount: 0,
    gapCount: 0,
    totalGapMs: 0,
    lastGapMs: null,
    maxGapMs: null,
    lastBurstCompletedAt: null,
    lastToolStartedAt: null,
    lastToolCompletedAt: null,
    lastStartedTool: null,
    lastCompletedTool: null,
    lastTransition: null,
    maxTransition: null,
    /** @type {number[]} */
    gapSamples: [],
};

/**
 * @typedef {{
 *     requestId: string;
 *     receivedAt: number;
 *     activated: boolean;
 *     responseFinished: boolean;
 *     toolName: string | null;
 *     toolCallId: string | null;
 *     handlerStartedAt: number | null;
 *     handlerEndedAt: number | null;
 *     edgeColo: string | null;
 *     activityActivated: boolean;
 *     activityFinished: boolean;
 *     httpMethod: string | null;
 *     routeClass: string | null;
 *     rpcMethod: string | null;
 * }} McpHttpToolTimingContext
 *
 * @typedef {{ count: number; totalMs: number; lastMs: number | null; maxMs: number | null; samples: number[] }} DurationSamples
 *
 * @typedef {{
 *     requestId: string;
 *     receivedAt: number;
 *     finishedAt: number;
 *     durationMs: number;
 *     httpMethod: string;
 *     routeClass: string;
 *     rpcMethod: string | null;
 *     statusCode: number | null;
 *     edgeColo: string | null;
 * }} HttpRequestActivityEvent
 *
 * @typedef {{
 *     count: number;
 *     completedCount: number;
 *     activeAtToolArrivalCount: number;
 *     persistentCrossGapCount: number;
 *     streamRequestCount: number;
 *     streamActiveAtToolArrivalCount: number;
 *     coveredMs: number;
 *     silentMs: number;
 *     coverageRatio: number;
 *     firstAuxiliaryDelayMs: number | null;
 *     tailSilentAfterAuxiliaryMs: number;
 *     auxiliarySpanMs: number;
 *     firstDiscreteRoute: string | null;
 *     firstDiscreteRpcMethod: string | null;
 *     lastDiscreteRoute: string | null;
 *     lastDiscreteRpcMethod: string | null;
 *     byRoute: Record<string, number>;
 *     byRpcMethod: Record<string, number>;
 * }} InterveningHttpActivity
 *
 * @typedef {{
 *     from: string | null;
 *     to: string;
 *     gapMs: number;
 *     observedAt: number;
 *     edgeColo: string | null;
 *     previousEdgeColo: string | null;
 *     interveningRequests: InterveningHttpActivity;
 * }} HttpToolGapTransition
 *
 * @typedef {{
 *     activeRequests: number;
 *     requestCount: number;
 *     burstCount: number;
 *     overlapCount: number;
 *     gapCount: number;
 *     totalGapMs: number;
 *     lastGapMs: number | null;
 *     maxGapMs: number | null;
 *     lastResponseBurstFinishedAt: number | null;
 *     lastCompletedTool: string | null;
 *     lastCompletedEdgeColo: string | null;
 *     lastTransition: HttpToolGapTransition | null;
 *     maxTransition: HttpToolGapTransition | null;
 *     gapSamples: number[];
 *     silentGapSamples: number[];
 *     auxiliaryCoverageSamples: number[];
 *     firstAuxiliaryDelaySamples: number[];
 *     tailSilentAfterAuxiliarySamples: number[];
 *     totalSilentGapMs: number;
 *     totalAuxiliaryCoveredMs: number;
 *     edgeColoCounts: Map<string, number>;
 *     edgeGapSamples: Map<string, number[]>;
 *     preHandler: DurationSamples;
 *     postHandler: DurationSamples;
 * }} HttpToolBoundaryMetrics
 */

/** @type {AsyncLocalStorage<McpHttpToolTimingContext>} */
const MCP_HTTP_TOOL_TIMING_CONTEXT = new AsyncLocalStorage();
/** @type {{
    totalRequests: number;
    completedRequests: number;
    active: Map<string, McpHttpToolTimingContext>;
    recent: HttpRequestActivityEvent[];
    byRoute: Map<string, number>;
    byRpcMethod: Map<string, number>;
    byStatusClass: Map<string, number>;
    rateLimitedByRoute: Map<string, number>;
}} */
const HTTP_REQUEST_ACTIVITY_METRICS = {
    totalRequests: 0,
    completedRequests: 0,
    active: new Map(),
    recent: [],
    byRoute: new Map(),
    byRpcMethod: new Map(),
    byStatusClass: new Map(),
    rateLimitedByRoute: new Map(),
};

/** @type {HttpToolBoundaryMetrics} */
const HTTP_TOOL_BOUNDARY_METRICS = {
    activeRequests: 0,
    requestCount: 0,
    burstCount: 0,
    overlapCount: 0,
    gapCount: 0,
    totalGapMs: 0,
    lastGapMs: null,
    maxGapMs: null,
    lastResponseBurstFinishedAt: null,
    lastCompletedTool: null,
    lastCompletedEdgeColo: null,
    lastTransition: null,
    maxTransition: null,
    gapSamples: [],
    silentGapSamples: [],
    auxiliaryCoverageSamples: [],
    firstAuxiliaryDelaySamples: [],
    tailSilentAfterAuxiliarySamples: [],
    totalSilentGapMs: 0,
    totalAuxiliaryCoveredMs: 0,
    edgeColoCounts: new Map(),
    edgeGapSamples: new Map(),
    preHandler: createDurationSamples(),
    postHandler: createDurationSamples(),
};

/**
 * @typedef {object} ToolMetric
 * @property {number} calls
 * @property {number} errors
 * @property {number} totalDurationMs
 * @property {number | null} lastDurationMs
 * @property {number | null} lastCalledAt
 * @property {boolean | null} lastIsError
 * @property {{
 *     hint: number;
 *     stringify: number;
 *     unknown: number;
 *     rejected: number;
 *     totalBytes: number;
 *     lastBytes: number | null;
 *     lastStrategy: string | null;
 * }} resultSize
 * @property {Record<string, { calls: number; totalDurationMs: number; lastDurationMs: number | null }>} phases
 * @property {{
 *     batchCalls: number;
 *     logicalOperations: number;
 *     failedOperations: number;
 *     skippedOperations: number;
 *     lastLogicalOperations: number;
 *     lastMode: string | null;
 * }} execution
 */

/** @type {Map<string, ToolMetric>} */
const TOOL_METRICS = new Map();

/**
 * @param {string} tool
 * @param {{
 *     durationMs: number;
 *     isError: boolean;
 *     phases?: Record<string, number>;
 *     resultSize?: { strategy?: string; bytes?: number | null; rejected?: boolean };
 *     execution?: { logicalOperations?: number; failedOperations?: number; skippedOperations?: number; mode?: string };
 * }} event
 * @returns {void}
 */
/**
 * @param {'modern-2026' | 'stateful' | 'stateless-fallback'} mode
 * @returns {void}
 */
export function recordMcpHttpTransportMode(mode) {
    if (mode === 'modern-2026') HTTP_METRICS.modern2026Requests += 1;
    else if (mode === 'stateful') HTTP_METRICS.statefulRequests += 1;
    else HTTP_METRICS.statelessFallbackRequests += 1;
}

/**
 * Record the start of one guarded MCP tool call and return the quiescent gap since the previous completed tool burst,
 * when one exists.
 *
 * @param {string} tool
 * @param {number} [observedAt]
 * @returns {number | null}
 */
export function recordMcpToolInteractionStart(tool, observedAt = Date.now()) {
    const now = normalizeTimestamp(observedAt);
    let gapMs = null;
    if (TOOL_INTERACTION_METRICS.activeCalls === 0) {
        TOOL_INTERACTION_METRICS.burstCount += 1;
        const previousCompletedAt = TOOL_INTERACTION_METRICS.lastBurstCompletedAt;
        if (previousCompletedAt !== null) {
            gapMs = Math.max(0, now - previousCompletedAt);
            TOOL_INTERACTION_METRICS.gapCount += 1;
            TOOL_INTERACTION_METRICS.totalGapMs += gapMs;
            TOOL_INTERACTION_METRICS.lastGapMs = gapMs;
            const transition = {
                from: TOOL_INTERACTION_METRICS.lastCompletedTool,
                to: tool,
                gapMs,
                observedAt: now,
            };
            TOOL_INTERACTION_METRICS.lastTransition = transition;
            if (TOOL_INTERACTION_METRICS.maxGapMs === null || gapMs >= TOOL_INTERACTION_METRICS.maxGapMs) {
                TOOL_INTERACTION_METRICS.maxGapMs = gapMs;
                TOOL_INTERACTION_METRICS.maxTransition = transition;
            }
            TOOL_INTERACTION_METRICS.gapSamples.push(gapMs);
            if (TOOL_INTERACTION_METRICS.gapSamples.length > MAX_INTER_TOOL_GAP_SAMPLES) {
                TOOL_INTERACTION_METRICS.gapSamples.splice(
                    0,
                    TOOL_INTERACTION_METRICS.gapSamples.length - MAX_INTER_TOOL_GAP_SAMPLES,
                );
            }
        }
    }
    TOOL_INTERACTION_METRICS.activeCalls += 1;
    TOOL_INTERACTION_METRICS.lastToolStartedAt = now;
    TOOL_INTERACTION_METRICS.lastStartedTool = tool;
    return gapMs;
}

/**
 * Record completion of one guarded MCP tool call. A new quiescent interval begins only when the last active call in the
 * current burst completes.
 *
 * @param {string} tool
 * @param {number} [observedAt]
 * @returns {void}
 */
export function recordMcpToolInteractionEnd(tool, observedAt = Date.now()) {
    const now = normalizeTimestamp(observedAt);
    TOOL_INTERACTION_METRICS.activeCalls = Math.max(0, TOOL_INTERACTION_METRICS.activeCalls - 1);
    TOOL_INTERACTION_METRICS.lastToolCompletedAt = now;
    TOOL_INTERACTION_METRICS.lastCompletedTool = tool;
    if (TOOL_INTERACTION_METRICS.activeCalls === 0) TOOL_INTERACTION_METRICS.lastBurstCompletedAt = now;
}

/**
 * Run one HTTP request inside a timing context that survives async SDK dispatch. The caller owns request
 * classification; non-tool MCP requests never activate the tool-boundary counters.
 *
 * @template T
 * @param {{ requestId: string; receivedAt?: number; edgeColo?: string | null }} input
 * @param {() => T} callback
 * @returns {T}
 */
export function runWithMcpHttpToolTimingContext(input, callback) {
    /** @type {McpHttpToolTimingContext} */
    const context = {
        requestId: String(input.requestId),
        receivedAt: normalizeTimestamp(input.receivedAt ?? Date.now()),
        activated: false,
        responseFinished: false,
        toolName: null,
        toolCallId: null,
        handlerStartedAt: null,
        handlerEndedAt: null,
        edgeColo: normalizeEdgeColo(input.edgeColo),
        activityActivated: false,
        activityFinished: false,
        httpMethod: null,
        routeClass: null,
        rpcMethod: null,
    };
    return MCP_HTTP_TOOL_TIMING_CONTEXT.run(context, callback);
}

/**
 * Record one sanitized HTTP request activity envelope. The caller supplies only a fixed route class and HTTP method;
 * raw URLs, query strings, headers and IPs are deliberately not retained.
 *
 * @param {{ httpMethod?: string | null; routeClass?: string | null }} [input]
 * @returns {((statusCode?: number | null, observedAt?: number) => void) | null}
 */
export function activateMcpHttpRequestActivity(input = {}) {
    const context = MCP_HTTP_TOOL_TIMING_CONTEXT.getStore();
    if (!context || context.activityActivated) return null;
    context.activityActivated = true;
    context.httpMethod = normalizeMetricLabel(input.httpMethod, 'UNKNOWN');
    context.routeClass = normalizeMetricLabel(input.routeClass, 'other');
    HTTP_REQUEST_ACTIVITY_METRICS.totalRequests += 1;
    HTTP_REQUEST_ACTIVITY_METRICS.active.set(context.requestId, context);
    incrementMapCount(HTTP_REQUEST_ACTIVITY_METRICS.byRoute, context.routeClass);
    return (statusCode = null, observedAt = Date.now()) =>
        finishMcpHttpRequestActivity(context, statusCode, observedAt);
}

/**
 * Attach a sanitized JSON-RPC method label to the current request activity.
 *
 * @param {string | null | undefined} method
 */
export function recordMcpHttpRequestRpcMethod(method) {
    const context = MCP_HTTP_TOOL_TIMING_CONTEXT.getStore();
    if (!context || !context.activityActivated || context.rpcMethod !== null) return;
    const normalized = normalizeMetricLabel(method, 'unknown');
    context.rpcMethod = normalized;
    incrementMapCount(HTTP_REQUEST_ACTIVITY_METRICS.byRpcMethod, normalized);
}

/**
 * Mark the current HTTP request as a JSON-RPC tools/call request and return a response-finalizer closure bound to this
 * exact async context. The closure is safe to register on both response `finish` and `close`; only its first call
 * mutates metrics.
 *
 * @param {string | null} toolName
 * @returns {((observedAt?: number) => void) | null}
 */
export function activateMcpHttpToolRequestTiming(toolName) {
    const context = MCP_HTTP_TOOL_TIMING_CONTEXT.getStore();
    if (!context || context.activated) return null;
    context.activated = true;
    context.toolName = toolName;
    HTTP_TOOL_BOUNDARY_METRICS.requestCount += 1;
    if (context.edgeColo) {
        HTTP_TOOL_BOUNDARY_METRICS.edgeColoCounts.set(
            context.edgeColo,
            (HTTP_TOOL_BOUNDARY_METRICS.edgeColoCounts.get(context.edgeColo) ?? 0) + 1,
        );
    }
    if (HTTP_TOOL_BOUNDARY_METRICS.activeRequests === 0) {
        HTTP_TOOL_BOUNDARY_METRICS.burstCount += 1;
        const previousFinishedAt = HTTP_TOOL_BOUNDARY_METRICS.lastResponseBurstFinishedAt;
        if (previousFinishedAt !== null) {
            const rawGapMs = context.receivedAt - previousFinishedAt;
            if (rawGapMs >= 0) {
                HTTP_TOOL_BOUNDARY_METRICS.gapCount += 1;
                HTTP_TOOL_BOUNDARY_METRICS.totalGapMs += rawGapMs;
                HTTP_TOOL_BOUNDARY_METRICS.lastGapMs = rawGapMs;
                const interveningRequests = summarizeInterveningHttpActivity(
                    previousFinishedAt,
                    context.receivedAt,
                    context.requestId,
                );
                const transition = {
                    from: HTTP_TOOL_BOUNDARY_METRICS.lastCompletedTool,
                    to: toolName ?? 'unknown-tool',
                    gapMs: rawGapMs,
                    observedAt: context.receivedAt,
                    edgeColo: context.edgeColo,
                    previousEdgeColo: HTTP_TOOL_BOUNDARY_METRICS.lastCompletedEdgeColo,
                    interveningRequests,
                };
                HTTP_TOOL_BOUNDARY_METRICS.totalSilentGapMs += interveningRequests.silentMs;
                HTTP_TOOL_BOUNDARY_METRICS.totalAuxiliaryCoveredMs += interveningRequests.coveredMs;
                pushBoundedSample(
                    HTTP_TOOL_BOUNDARY_METRICS.silentGapSamples,
                    interveningRequests.silentMs,
                    MAX_HTTP_TOOL_TIMING_SAMPLES,
                );
                pushBoundedSample(
                    HTTP_TOOL_BOUNDARY_METRICS.auxiliaryCoverageSamples,
                    interveningRequests.coveredMs,
                    MAX_HTTP_TOOL_TIMING_SAMPLES,
                );
                if (interveningRequests.firstAuxiliaryDelayMs !== null) {
                    pushBoundedSample(
                        HTTP_TOOL_BOUNDARY_METRICS.firstAuxiliaryDelaySamples,
                        interveningRequests.firstAuxiliaryDelayMs,
                        MAX_HTTP_TOOL_TIMING_SAMPLES,
                    );
                    pushBoundedSample(
                        HTTP_TOOL_BOUNDARY_METRICS.tailSilentAfterAuxiliarySamples,
                        interveningRequests.tailSilentAfterAuxiliaryMs,
                        MAX_HTTP_TOOL_TIMING_SAMPLES,
                    );
                }
                HTTP_TOOL_BOUNDARY_METRICS.lastTransition = transition;
                if (HTTP_TOOL_BOUNDARY_METRICS.maxGapMs === null || rawGapMs >= HTTP_TOOL_BOUNDARY_METRICS.maxGapMs) {
                    HTTP_TOOL_BOUNDARY_METRICS.maxGapMs = rawGapMs;
                    HTTP_TOOL_BOUNDARY_METRICS.maxTransition = transition;
                }
                pushBoundedSample(HTTP_TOOL_BOUNDARY_METRICS.gapSamples, rawGapMs, MAX_HTTP_TOOL_TIMING_SAMPLES);
                if (context.edgeColo) {
                    const edgeSamples = HTTP_TOOL_BOUNDARY_METRICS.edgeGapSamples.get(context.edgeColo) ?? [];
                    pushBoundedSample(edgeSamples, rawGapMs, MAX_HTTP_TOOL_TIMING_SAMPLES);
                    HTTP_TOOL_BOUNDARY_METRICS.edgeGapSamples.set(context.edgeColo, edgeSamples);
                }
            } else {
                HTTP_TOOL_BOUNDARY_METRICS.overlapCount += 1;
            }
        }
    }
    HTTP_TOOL_BOUNDARY_METRICS.activeRequests += 1;
    return (observedAt = Date.now()) => finishMcpHttpToolTimingContext(context, observedAt);
}

/**
 * Return only non-sensitive timing metadata for the current HTTP tools/call context. Request IDs, headers, IPs and full
 * Cloudflare Ray IDs are deliberately excluded.
 *
 * @returns {{ requestReceivedAt: number; edgeColo: string | null } | null}
 */
export function readMcpHttpToolTimingMetadata() {
    const context = MCP_HTTP_TOOL_TIMING_CONTEXT.getStore();
    if (!context || !context.activated) return null;
    return { requestReceivedAt: context.receivedAt, edgeColo: context.edgeColo };
}

/** @param {string} toolName @param {string} toolCallId @param {number} [observedAt] */
export function recordMcpHttpToolHandlerStart(toolName, toolCallId, observedAt = Date.now()) {
    const context = MCP_HTTP_TOOL_TIMING_CONTEXT.getStore();
    if (!context || !context.activated) return;
    const now = normalizeTimestamp(observedAt);
    context.toolName = toolName;
    context.toolCallId = toolCallId;
    context.handlerStartedAt = now;
    recordDurationSample(HTTP_TOOL_BOUNDARY_METRICS.preHandler, Math.max(0, now - context.receivedAt));
}

/** @param {number} [observedAt] */
export function recordMcpHttpToolHandlerEnd(observedAt = Date.now()) {
    const context = MCP_HTTP_TOOL_TIMING_CONTEXT.getStore();
    if (!context || !context.activated) return;
    context.handlerEndedAt = normalizeTimestamp(observedAt);
}

/**
 * Mark one bound transport response as finished/closed. Safe to call from both finish and close events; only the first
 * call mutates metrics.
 *
 * @param {McpHttpToolTimingContext} context
 * @param {number} [observedAt]
 */
function finishMcpHttpToolTimingContext(context, observedAt = Date.now()) {
    if (!context.activated || context.responseFinished) return;
    const now = normalizeTimestamp(observedAt);
    context.responseFinished = true;
    if (context.handlerEndedAt !== null) {
        recordDurationSample(HTTP_TOOL_BOUNDARY_METRICS.postHandler, Math.max(0, now - context.handlerEndedAt));
    }
    HTTP_TOOL_BOUNDARY_METRICS.activeRequests = Math.max(0, HTTP_TOOL_BOUNDARY_METRICS.activeRequests - 1);
    if (HTTP_TOOL_BOUNDARY_METRICS.activeRequests === 0) {
        HTTP_TOOL_BOUNDARY_METRICS.lastResponseBurstFinishedAt = now;
        HTTP_TOOL_BOUNDARY_METRICS.lastCompletedTool = context.toolName;
        HTTP_TOOL_BOUNDARY_METRICS.lastCompletedEdgeColo = context.edgeColo;
    }
}

/**
 * Finalize one sanitized HTTP activity record. Raw paths, query strings, headers, IPs and request IDs are never exposed
 * in retained snapshots.
 *
 * @param {McpHttpToolTimingContext} context
 * @param {number | null} statusCode
 * @param {number} [observedAt]
 */
function finishMcpHttpRequestActivity(context, statusCode, observedAt = Date.now()) {
    if (!context.activityActivated || context.activityFinished) return;
    const now = normalizeTimestamp(observedAt);
    context.activityFinished = true;
    HTTP_REQUEST_ACTIVITY_METRICS.active.delete(context.requestId);
    HTTP_REQUEST_ACTIVITY_METRICS.completedRequests += 1;
    const normalizedStatus = Number(statusCode);
    const normalizedStatusCode = Number.isInteger(normalizedStatus) && normalizedStatus > 0 ? normalizedStatus : null;
    if (normalizedStatusCode !== null) {
        incrementMapCount(HTTP_REQUEST_ACTIVITY_METRICS.byStatusClass, classifyHttpStatusClass(normalizedStatusCode));
        if (normalizedStatusCode === 429) {
            incrementMapCount(HTTP_REQUEST_ACTIVITY_METRICS.rateLimitedByRoute, context.routeClass ?? 'other');
        }
    }
    HTTP_REQUEST_ACTIVITY_METRICS.recent.push({
        requestId: context.requestId,
        receivedAt: context.receivedAt,
        finishedAt: now,
        durationMs: Math.max(0, now - context.receivedAt),
        httpMethod: context.httpMethod ?? 'UNKNOWN',
        routeClass: context.routeClass ?? 'other',
        rpcMethod: context.rpcMethod,
        statusCode: normalizedStatusCode,
        edgeColo: context.edgeColo,
    });
    if (HTTP_REQUEST_ACTIVITY_METRICS.recent.length > MAX_HTTP_REQUEST_ACTIVITY_EVENTS) {
        HTTP_REQUEST_ACTIVITY_METRICS.recent.splice(
            0,
            HTTP_REQUEST_ACTIVITY_METRICS.recent.length - MAX_HTTP_REQUEST_ACTIVITY_EVENTS,
        );
    }
}

/**
 * Summarize sanitized requests that overlap the quiet interval before the next tools/call. coveredMs is the union of
 * observed intervals, so concurrency is never double-counted.
 *
 * @param {number} fromAt
 * @param {number} toAt
 * @param {string} currentRequestId
 * @returns {InterveningHttpActivity}
 */
function summarizeInterveningHttpActivity(fromAt, toAt, currentRequestId) {
    /** @type {[number, number][]} */
    const intervals = [];
    /** @type {Record<string, number>} */
    const byRoute = Object.create(null);
    /** @type {Record<string, number>} */
    const byRpcMethod = Object.create(null);
    let completedCount = 0;
    let activeAtToolArrivalCount = 0;
    let persistentCrossGapCount = 0;
    let streamRequestCount = 0;
    let streamActiveAtToolArrivalCount = 0;
    let count = 0;
    /** @type {number | null} */
    let firstAuxiliaryAt = null;
    /** @type {number | null} */
    let lastAuxiliaryAt = null;
    /** @type {string | null} */
    let firstDiscreteRoute = null;
    /** @type {string | null} */
    let firstDiscreteRpcMethod = null;
    /** @type {string | null} */
    let lastDiscreteRoute = null;
    /** @type {string | null} */
    let lastDiscreteRpcMethod = null;
    /** @param {number} receivedAt @param {number} finishedAt @param {string} routeClass @param {string | null} rpcMethod */
    const register = (receivedAt, finishedAt, routeClass, rpcMethod) => {
        const start = Math.max(fromAt, receivedAt);
        const end = Math.min(toAt, finishedAt);
        if (end <= start) return false;
        count += 1;
        byRoute[routeClass] = (byRoute[routeClass] ?? 0) + 1;
        if (rpcMethod) byRpcMethod[rpcMethod] = (byRpcMethod[rpcMethod] ?? 0) + 1;
        if (routeClass === 'mcp-stream') {
            streamRequestCount += 1;
            return true;
        }
        intervals.push([start, end]);
        if (firstAuxiliaryAt === null || start < firstAuxiliaryAt) {
            firstAuxiliaryAt = start;
            firstDiscreteRoute = routeClass;
            firstDiscreteRpcMethod = rpcMethod;
        }
        if (lastAuxiliaryAt === null || end > lastAuxiliaryAt) {
            lastAuxiliaryAt = end;
            lastDiscreteRoute = routeClass;
            lastDiscreteRpcMethod = rpcMethod;
        }
        return true;
    };
    for (const event of HTTP_REQUEST_ACTIVITY_METRICS.recent) {
        if (event.requestId === currentRequestId || event.finishedAt <= fromAt || event.receivedAt >= toAt) continue;
        if (register(event.receivedAt, event.finishedAt, event.routeClass, event.rpcMethod)) completedCount += 1;
    }
    for (const context of HTTP_REQUEST_ACTIVITY_METRICS.active.values()) {
        if (context.requestId === currentRequestId || context.receivedAt >= toAt) continue;
        if (context.receivedAt <= fromAt) {
            persistentCrossGapCount += 1;
            continue;
        }
        const routeClass = context.routeClass ?? 'other';
        if (register(context.receivedAt, toAt, routeClass, context.rpcMethod)) {
            activeAtToolArrivalCount += 1;
            if (routeClass === 'mcp-stream') streamActiveAtToolArrivalCount += 1;
        }
    }
    intervals.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    let coveredMs = 0;
    let mergedStart = null;
    let mergedEnd = null;
    for (const [start, end] of intervals) {
        if (mergedStart === null || mergedEnd === null) {
            mergedStart = start;
            mergedEnd = end;
            continue;
        }
        if (start <= mergedEnd) {
            mergedEnd = Math.max(mergedEnd, end);
            continue;
        }
        coveredMs += mergedEnd - mergedStart;
        mergedStart = start;
        mergedEnd = end;
    }
    if (mergedStart !== null && mergedEnd !== null) coveredMs += mergedEnd - mergedStart;
    const gapMs = Math.max(0, toAt - fromAt);
    const boundedCoveredMs = Math.min(gapMs, Math.max(0, coveredMs));
    const firstAuxiliaryDelayMs = firstAuxiliaryAt === null ? null : Math.max(0, firstAuxiliaryAt - fromAt);
    const tailSilentAfterAuxiliaryMs = lastAuxiliaryAt === null ? gapMs : Math.max(0, toAt - lastAuxiliaryAt);
    const auxiliarySpanMs =
        firstAuxiliaryAt === null || lastAuxiliaryAt === null ? 0 : Math.max(0, lastAuxiliaryAt - firstAuxiliaryAt);
    return {
        count,
        completedCount,
        activeAtToolArrivalCount,
        persistentCrossGapCount,
        streamRequestCount,
        streamActiveAtToolArrivalCount,
        coveredMs: boundedCoveredMs,
        silentMs: Math.max(0, gapMs - boundedCoveredMs),
        coverageRatio: gapMs > 0 ? roundMetricRatio(boundedCoveredMs / gapMs) : 0,
        firstAuxiliaryDelayMs,
        tailSilentAfterAuxiliaryMs,
        auxiliarySpanMs,
        firstDiscreteRoute,
        firstDiscreteRpcMethod,
        lastDiscreteRoute,
        lastDiscreteRpcMethod,
        byRoute: { ...byRoute },
        byRpcMethod: { ...byRpcMethod },
    };
}

/**
 * @param {string} tool
 * @param {{
 *     durationMs: number;
 *     isError: boolean;
 *     phases?: Record<string, number>;
 *     resultSize?: { strategy?: string; bytes?: number | null; rejected?: boolean };
 *     execution?: { logicalOperations?: number; failedOperations?: number; skippedOperations?: number; mode?: string };
 * }} event
 * @returns {void}
 */
export function recordMcpToolMetric(tool, event) {
    const current = TOOL_METRICS.get(tool) ?? {
        calls: 0,
        errors: 0,
        totalDurationMs: 0,
        lastDurationMs: null,
        lastCalledAt: null,
        lastIsError: null,
        resultSize: {
            hint: 0,
            stringify: 0,
            unknown: 0,
            rejected: 0,
            totalBytes: 0,
            lastBytes: null,
            lastStrategy: null,
        },
        phases: Object.create(null),
        execution: {
            batchCalls: 0,
            logicalOperations: 0,
            failedOperations: 0,
            skippedOperations: 0,
            lastLogicalOperations: 1,
            lastMode: null,
        },
    };
    current.calls += 1;
    current.errors += event.isError ? 1 : 0;
    current.totalDurationMs += event.durationMs;
    current.lastDurationMs = event.durationMs;
    current.lastCalledAt = Date.now();
    current.lastIsError = event.isError;
    if (event.execution) {
        const logicalOperations = Math.max(1, Math.floor(Number(event.execution.logicalOperations) || 1));
        const failedOperations = Math.max(
            0,
            Math.min(logicalOperations, Math.floor(Number(event.execution.failedOperations) || 0)),
        );
        const skippedOperations = Math.max(
            0,
            Math.min(logicalOperations - failedOperations, Math.floor(Number(event.execution.skippedOperations) || 0)),
        );
        current.execution.logicalOperations += logicalOperations;
        current.execution.failedOperations += failedOperations;
        current.execution.skippedOperations += skippedOperations;
        current.execution.lastLogicalOperations = logicalOperations;
        current.execution.lastMode =
            typeof event.execution.mode === 'string' && event.execution.mode.trim()
                ? event.execution.mode.trim()
                : null;
        if (logicalOperations > 1) current.execution.batchCalls += 1;
    } else {
        current.execution.logicalOperations += 1;
        current.execution.lastLogicalOperations = 1;
        current.execution.lastMode = null;
    }
    if (event.resultSize) {
        const strategy =
            event.resultSize.strategy === 'stringify' || event.resultSize.strategy === 'hint'
                ? event.resultSize.strategy
                : 'unknown';
        if (strategy === 'hint') current.resultSize.hint += 1;
        else if (strategy === 'stringify') current.resultSize.stringify += 1;
        else current.resultSize.unknown += 1;
        current.resultSize.lastStrategy = strategy;
        const bytes = Number(event.resultSize.bytes);
        if (Number.isFinite(bytes) && bytes >= 0) {
            current.resultSize.totalBytes += bytes;
            current.resultSize.lastBytes = bytes;
        }
        if (event.resultSize.rejected === true) current.resultSize.rejected += 1;
    }
    for (const [phase, durationMs] of Object.entries(event.phases ?? {})) {
        if (!Number.isFinite(durationMs) || durationMs < 0) continue;
        if (!(phase in current.phases) && Object.keys(current.phases).length >= MAX_PHASE_METRICS_PER_TOOL) {
            const oldest = Object.keys(current.phases)[0];
            if (oldest !== undefined) delete current.phases[oldest];
        }
        const phaseMetric = current.phases[phase] ?? { calls: 0, totalDurationMs: 0, lastDurationMs: null };
        phaseMetric.calls += 1;
        phaseMetric.totalDurationMs += durationMs;
        phaseMetric.lastDurationMs = durationMs;
        current.phases[phase] = phaseMetric;
    }
    if (!TOOL_METRICS.has(tool) && TOOL_METRICS.size >= MAX_TOOL_METRICS) {
        const oldest = TOOL_METRICS.keys().next().value;
        if (typeof oldest === 'string') TOOL_METRICS.delete(oldest);
    }
    TOOL_METRICS.set(tool, current);
}

/**
 * @returns {{
 *     startedAt: number;
 *     uptimeMs: number;
 *     totals: { calls: number; errors: number; tools: number };
 *     http: { modern2026Requests: number; statefulRequests: number; statelessFallbackRequests: number };
 *     interaction: {
 *         activeCalls: number;
 *         burstCount: number;
 *         gaps: {
 *             count: number;
 *             totalMs: number;
 *             averageMs: number;
 *             p50Ms: number | null;
 *             p95Ms: number | null;
 *             p99Ms: number | null;
 *             lastMs: number | null;
 *             maxMs: number | null;
 *         };
 *         lastBurstCompletedAt: number | null;
 *         lastToolStartedAt: number | null;
 *         lastToolCompletedAt: number | null;
 *         lastTransition: { from: string | null; to: string; gapMs: number; observedAt: number } | null;
 *         maxTransition: { from: string | null; to: string; gapMs: number; observedAt: number } | null;
 *         originBoundary: {
 *             activeRequests: number;
 *             requestCount: number;
 *             burstCount: number;
 *             overlapCount: number;
 *             externalGaps: {
 *                 count: number;
 *                 totalMs: number;
 *                 averageMs: number;
 *                 p50Ms: number | null;
 *                 p95Ms: number | null;
 *                 p99Ms: number | null;
 *                 lastMs: number | null;
 *                 maxMs: number | null;
 *             };
 *             silentExternalGaps: {
 *                 count: number;
 *                 totalMs: number;
 *                 averageMs: number;
 *                 p50Ms: number | null;
 *                 p95Ms: number | null;
 *                 p99Ms: number | null;
 *                 lastMs: number | null;
 *                 maxMs: number | null;
 *             };
 *             auxiliaryCoverage: {
 *                 count: number;
 *                 totalMs: number;
 *                 averageMs: number;
 *                 p50Ms: number | null;
 *                 p95Ms: number | null;
 *                 lastMs: number | null;
 *                 overallCoverageRatio: number;
 *             };
 *             discreteAuxiliaryTiming: {
 *                 count: number;
 *                 firstDelayP50Ms: number | null;
 *                 firstDelayP95Ms: number | null;
 *                 firstDelayLastMs: number | null;
 *                 tailSilentP50Ms: number | null;
 *                 tailSilentP95Ms: number | null;
 *                 tailSilentLastMs: number | null;
 *                 firstDelayToExternalP50Ratio: number;
 *                 lastFirstDiscreteRpcMethod: string | null;
 *                 lastFirstDiscreteRoute: string | null;
 *             };
 *             preHandler: {
 *                 count: number;
 *                 averageMs: number;
 *                 p50Ms: number | null;
 *                 p95Ms: number | null;
 *                 p99Ms: number | null;
 *                 lastMs: number | null;
 *                 maxMs: number | null;
 *             };
 *             postHandler: {
 *                 count: number;
 *                 averageMs: number;
 *                 p50Ms: number | null;
 *                 p95Ms: number | null;
 *                 p99Ms: number | null;
 *                 lastMs: number | null;
 *                 maxMs: number | null;
 *             };
 *             lastResponseBurstFinishedAt: number | null;
 *             lastCompletedEdgeColo: string | null;
 *             edgeColoCounts: Record<string, number>;
 *             externalGapsByEdgeColo: {
 *                 edgeColo: string;
 *                 calls: number;
 *                 gapSamples: number;
 *                 averageMs: number;
 *                 p50Ms: number | null;
 *                 p95Ms: number | null;
 *                 maxMs: number | null;
 *             }[];
 *             lastTransition: HttpToolGapTransition | null;
 *             maxTransition: HttpToolGapTransition | null;
 *             requestActivity: {
 *                 totalRequests: number;
 *                 completedRequests: number;
 *                 activeRequests: number;
 *                 byRoute: Record<string, number>;
 *                 byRpcMethod: Record<string, number>;
 *                 byStatusClass: Record<string, number>;
 *                 rateLimitedByRoute: Record<string, number>;
 *                 lastCompleted: ReturnType<typeof compactHttpRequestActivityEvent>;
 *             };
 *         };
 *     };
 *     tools: Record<
 *         string,
 *         ToolMetric & {
 *             averageDurationMs: number;
 *             phaseAverages: Record<
 *                 string,
 *                 { calls: number; totalDurationMs: number; lastDurationMs: number | null; averageDurationMs: number }
 *             >;
 *         }
 *     >;
 * }}
 */
export function readMcpMetricsSnapshot() {
    /**
     * @type {Record<
     *     string,
     *     ToolMetric & {
     *         averageDurationMs: number;
     *         phaseAverages: Record<
     *             string,
     *             { calls: number; totalDurationMs: number; lastDurationMs: number | null; averageDurationMs: number }
     *         >;
     *     }
     * >}
     */
    const tools = Object.create(null);
    let calls = 0;
    let errors = 0;
    for (const [name, metric] of TOOL_METRICS.entries()) {
        calls += metric.calls;
        errors += metric.errors;
        tools[name] = {
            ...metric,
            averageDurationMs: metric.calls > 0 ? Math.round(metric.totalDurationMs / metric.calls) : 0,
            phaseAverages: Object.assign(
                Object.create(null),
                Object.fromEntries(
                    Object.entries(metric.phases).map(([phase, phaseMetric]) => [
                        phase,
                        {
                            ...phaseMetric,
                            averageDurationMs:
                                phaseMetric.calls > 0 ? Math.round(phaseMetric.totalDurationMs / phaseMetric.calls) : 0,
                        },
                    ]),
                ),
            ),
        };
    }
    const gapSamples = [...TOOL_INTERACTION_METRICS.gapSamples].sort((left, right) => left - right);
    const httpGapSamples = [...HTTP_TOOL_BOUNDARY_METRICS.gapSamples].sort((left, right) => left - right);
    const silentGapSamples = [...HTTP_TOOL_BOUNDARY_METRICS.silentGapSamples].sort((left, right) => left - right);
    const auxiliaryCoverageSamples = [...HTTP_TOOL_BOUNDARY_METRICS.auxiliaryCoverageSamples].sort(
        (left, right) => left - right,
    );
    const firstAuxiliaryDelaySamples = [...HTTP_TOOL_BOUNDARY_METRICS.firstAuxiliaryDelaySamples].sort(
        (left, right) => left - right,
    );
    const tailSilentAfterAuxiliarySamples = [...HTTP_TOOL_BOUNDARY_METRICS.tailSilentAfterAuxiliarySamples].sort(
        (left, right) => left - right,
    );
    return {
        startedAt,
        uptimeMs: Date.now() - startedAt,
        totals: {
            calls,
            errors,
            tools: TOOL_METRICS.size,
        },
        http: { ...HTTP_METRICS },
        interaction: {
            activeCalls: TOOL_INTERACTION_METRICS.activeCalls,
            burstCount: TOOL_INTERACTION_METRICS.burstCount,
            gaps: {
                count: TOOL_INTERACTION_METRICS.gapCount,
                totalMs: TOOL_INTERACTION_METRICS.totalGapMs,
                averageMs:
                    TOOL_INTERACTION_METRICS.gapCount > 0
                        ? Math.round(TOOL_INTERACTION_METRICS.totalGapMs / TOOL_INTERACTION_METRICS.gapCount)
                        : 0,
                p50Ms: percentile(gapSamples, 0.5),
                p95Ms: percentile(gapSamples, 0.95),
                p99Ms: percentile(gapSamples, 0.99),
                lastMs: TOOL_INTERACTION_METRICS.lastGapMs,
                maxMs: TOOL_INTERACTION_METRICS.maxGapMs,
            },
            lastBurstCompletedAt: TOOL_INTERACTION_METRICS.lastBurstCompletedAt,
            lastToolStartedAt: TOOL_INTERACTION_METRICS.lastToolStartedAt,
            lastToolCompletedAt: TOOL_INTERACTION_METRICS.lastToolCompletedAt,
            lastTransition: TOOL_INTERACTION_METRICS.lastTransition,
            maxTransition: TOOL_INTERACTION_METRICS.maxTransition,
            originBoundary: {
                activeRequests: HTTP_TOOL_BOUNDARY_METRICS.activeRequests,
                requestCount: HTTP_TOOL_BOUNDARY_METRICS.requestCount,
                burstCount: HTTP_TOOL_BOUNDARY_METRICS.burstCount,
                overlapCount: HTTP_TOOL_BOUNDARY_METRICS.overlapCount,
                externalGaps: {
                    count: HTTP_TOOL_BOUNDARY_METRICS.gapCount,
                    totalMs: HTTP_TOOL_BOUNDARY_METRICS.totalGapMs,
                    averageMs:
                        HTTP_TOOL_BOUNDARY_METRICS.gapCount > 0
                            ? Math.round(HTTP_TOOL_BOUNDARY_METRICS.totalGapMs / HTTP_TOOL_BOUNDARY_METRICS.gapCount)
                            : 0,
                    p50Ms: percentile(httpGapSamples, 0.5),
                    p95Ms: percentile(httpGapSamples, 0.95),
                    p99Ms: percentile(httpGapSamples, 0.99),
                    lastMs: HTTP_TOOL_BOUNDARY_METRICS.lastGapMs,
                    maxMs: HTTP_TOOL_BOUNDARY_METRICS.maxGapMs,
                },
                silentExternalGaps: {
                    count: HTTP_TOOL_BOUNDARY_METRICS.gapCount,
                    totalMs: HTTP_TOOL_BOUNDARY_METRICS.totalSilentGapMs,
                    averageMs:
                        HTTP_TOOL_BOUNDARY_METRICS.gapCount > 0
                            ? Math.round(
                                  HTTP_TOOL_BOUNDARY_METRICS.totalSilentGapMs / HTTP_TOOL_BOUNDARY_METRICS.gapCount,
                              )
                            : 0,
                    p50Ms: percentile(silentGapSamples, 0.5),
                    p95Ms: percentile(silentGapSamples, 0.95),
                    p99Ms: percentile(silentGapSamples, 0.99),
                    lastMs: HTTP_TOOL_BOUNDARY_METRICS.lastTransition?.interveningRequests.silentMs ?? null,
                    maxMs: silentGapSamples.at(-1) ?? null,
                },
                auxiliaryCoverage: {
                    count: HTTP_TOOL_BOUNDARY_METRICS.gapCount,
                    totalMs: HTTP_TOOL_BOUNDARY_METRICS.totalAuxiliaryCoveredMs,
                    averageMs:
                        HTTP_TOOL_BOUNDARY_METRICS.gapCount > 0
                            ? Math.round(
                                  HTTP_TOOL_BOUNDARY_METRICS.totalAuxiliaryCoveredMs /
                                      HTTP_TOOL_BOUNDARY_METRICS.gapCount,
                              )
                            : 0,
                    p50Ms: percentile(auxiliaryCoverageSamples, 0.5),
                    p95Ms: percentile(auxiliaryCoverageSamples, 0.95),
                    lastMs: HTTP_TOOL_BOUNDARY_METRICS.lastTransition?.interveningRequests.coveredMs ?? null,
                    overallCoverageRatio:
                        HTTP_TOOL_BOUNDARY_METRICS.totalGapMs > 0
                            ? roundMetricRatio(
                                  HTTP_TOOL_BOUNDARY_METRICS.totalAuxiliaryCoveredMs /
                                      HTTP_TOOL_BOUNDARY_METRICS.totalGapMs,
                              )
                            : 0,
                },
                discreteAuxiliaryTiming: {
                    count: firstAuxiliaryDelaySamples.length,
                    firstDelayP50Ms: percentile(firstAuxiliaryDelaySamples, 0.5),
                    firstDelayP95Ms: percentile(firstAuxiliaryDelaySamples, 0.95),
                    firstDelayLastMs:
                        HTTP_TOOL_BOUNDARY_METRICS.lastTransition?.interveningRequests.firstAuxiliaryDelayMs ?? null,
                    tailSilentP50Ms: percentile(tailSilentAfterAuxiliarySamples, 0.5),
                    tailSilentP95Ms: percentile(tailSilentAfterAuxiliarySamples, 0.95),
                    tailSilentLastMs:
                        HTTP_TOOL_BOUNDARY_METRICS.lastTransition?.interveningRequests.tailSilentAfterAuxiliaryMs ??
                        null,
                    firstDelayToExternalP50Ratio:
                        (percentile(httpGapSamples, 0.5) ?? 0) > 0
                            ? roundMetricRatio(
                                  (percentile(firstAuxiliaryDelaySamples, 0.5) ?? 0) /
                                      (percentile(httpGapSamples, 0.5) ?? 1),
                              )
                            : 0,
                    lastFirstDiscreteRpcMethod:
                        HTTP_TOOL_BOUNDARY_METRICS.lastTransition?.interveningRequests.firstDiscreteRpcMethod ?? null,
                    lastFirstDiscreteRoute:
                        HTTP_TOOL_BOUNDARY_METRICS.lastTransition?.interveningRequests.firstDiscreteRoute ?? null,
                },
                preHandler: summarizeDurationSamples(HTTP_TOOL_BOUNDARY_METRICS.preHandler),
                postHandler: summarizeDurationSamples(HTTP_TOOL_BOUNDARY_METRICS.postHandler),
                lastResponseBurstFinishedAt: HTTP_TOOL_BOUNDARY_METRICS.lastResponseBurstFinishedAt,
                lastCompletedEdgeColo: HTTP_TOOL_BOUNDARY_METRICS.lastCompletedEdgeColo,
                edgeColoCounts: Object.fromEntries(
                    [...HTTP_TOOL_BOUNDARY_METRICS.edgeColoCounts.entries()].sort(([left], [right]) =>
                        left.localeCompare(right),
                    ),
                ),
                externalGapsByEdgeColo: [...HTTP_TOOL_BOUNDARY_METRICS.edgeGapSamples.entries()]
                    .map(([edgeColo, samples]) => {
                        const sorted = [...samples].sort((left, right) => left - right);
                        return {
                            edgeColo,
                            calls: HTTP_TOOL_BOUNDARY_METRICS.edgeColoCounts.get(edgeColo) ?? 0,
                            gapSamples: sorted.length,
                            averageMs: averageSamples(sorted),
                            p50Ms: percentile(sorted, 0.5),
                            p95Ms: percentile(sorted, 0.95),
                            maxMs: sorted.at(-1) ?? null,
                        };
                    })
                    .sort(
                        (left, right) =>
                            right.gapSamples - left.gapSamples || left.edgeColo.localeCompare(right.edgeColo),
                    ),
                lastTransition: HTTP_TOOL_BOUNDARY_METRICS.lastTransition,
                maxTransition: HTTP_TOOL_BOUNDARY_METRICS.maxTransition,
                requestActivity: {
                    totalRequests: HTTP_REQUEST_ACTIVITY_METRICS.totalRequests,
                    completedRequests: HTTP_REQUEST_ACTIVITY_METRICS.completedRequests,
                    activeRequests: HTTP_REQUEST_ACTIVITY_METRICS.active.size,
                    byRoute: mapCountsToRecord(HTTP_REQUEST_ACTIVITY_METRICS.byRoute),
                    byRpcMethod: mapCountsToRecord(HTTP_REQUEST_ACTIVITY_METRICS.byRpcMethod),
                    byStatusClass: mapCountsToRecord(HTTP_REQUEST_ACTIVITY_METRICS.byStatusClass),
                    rateLimitedByRoute: mapCountsToRecord(HTTP_REQUEST_ACTIVITY_METRICS.rateLimitedByRoute),
                    lastCompleted: compactHttpRequestActivityEvent(HTTP_REQUEST_ACTIVITY_METRICS.recent.at(-1) ?? null),
                },
            },
        },
        tools,
    };
}

/**
 * @returns {void}
 */
export function resetMcpMetricsForTests() {
    TOOL_METRICS.clear();
    HTTP_METRICS.modern2026Requests = 0;
    HTTP_METRICS.statefulRequests = 0;
    HTTP_METRICS.statelessFallbackRequests = 0;
    TOOL_INTERACTION_METRICS.activeCalls = 0;
    TOOL_INTERACTION_METRICS.burstCount = 0;
    TOOL_INTERACTION_METRICS.gapCount = 0;
    TOOL_INTERACTION_METRICS.totalGapMs = 0;
    TOOL_INTERACTION_METRICS.lastGapMs = null;
    TOOL_INTERACTION_METRICS.maxGapMs = null;
    TOOL_INTERACTION_METRICS.lastBurstCompletedAt = null;
    TOOL_INTERACTION_METRICS.lastToolStartedAt = null;
    TOOL_INTERACTION_METRICS.lastToolCompletedAt = null;
    TOOL_INTERACTION_METRICS.lastStartedTool = null;
    TOOL_INTERACTION_METRICS.lastCompletedTool = null;
    TOOL_INTERACTION_METRICS.lastTransition = null;
    TOOL_INTERACTION_METRICS.maxTransition = null;
    TOOL_INTERACTION_METRICS.gapSamples.length = 0;
    HTTP_TOOL_BOUNDARY_METRICS.activeRequests = 0;
    HTTP_TOOL_BOUNDARY_METRICS.requestCount = 0;
    HTTP_TOOL_BOUNDARY_METRICS.burstCount = 0;
    HTTP_TOOL_BOUNDARY_METRICS.overlapCount = 0;
    HTTP_TOOL_BOUNDARY_METRICS.gapCount = 0;
    HTTP_TOOL_BOUNDARY_METRICS.totalGapMs = 0;
    HTTP_TOOL_BOUNDARY_METRICS.lastGapMs = null;
    HTTP_TOOL_BOUNDARY_METRICS.maxGapMs = null;
    HTTP_TOOL_BOUNDARY_METRICS.lastResponseBurstFinishedAt = null;
    HTTP_TOOL_BOUNDARY_METRICS.lastCompletedTool = null;
    HTTP_TOOL_BOUNDARY_METRICS.lastCompletedEdgeColo = null;
    HTTP_TOOL_BOUNDARY_METRICS.lastTransition = null;
    HTTP_TOOL_BOUNDARY_METRICS.maxTransition = null;
    HTTP_TOOL_BOUNDARY_METRICS.gapSamples.length = 0;
    HTTP_TOOL_BOUNDARY_METRICS.silentGapSamples.length = 0;
    HTTP_TOOL_BOUNDARY_METRICS.auxiliaryCoverageSamples.length = 0;
    HTTP_TOOL_BOUNDARY_METRICS.firstAuxiliaryDelaySamples.length = 0;
    HTTP_TOOL_BOUNDARY_METRICS.tailSilentAfterAuxiliarySamples.length = 0;
    HTTP_TOOL_BOUNDARY_METRICS.totalSilentGapMs = 0;
    HTTP_TOOL_BOUNDARY_METRICS.totalAuxiliaryCoveredMs = 0;
    HTTP_TOOL_BOUNDARY_METRICS.edgeColoCounts.clear();
    HTTP_TOOL_BOUNDARY_METRICS.edgeGapSamples.clear();
    HTTP_REQUEST_ACTIVITY_METRICS.totalRequests = 0;
    HTTP_REQUEST_ACTIVITY_METRICS.completedRequests = 0;
    HTTP_REQUEST_ACTIVITY_METRICS.active.clear();
    HTTP_REQUEST_ACTIVITY_METRICS.recent.length = 0;
    HTTP_REQUEST_ACTIVITY_METRICS.byRoute.clear();
    HTTP_REQUEST_ACTIVITY_METRICS.byRpcMethod.clear();
    HTTP_REQUEST_ACTIVITY_METRICS.byStatusClass.clear();
    HTTP_REQUEST_ACTIVITY_METRICS.rateLimitedByRoute.clear();
    resetDurationSamples(HTTP_TOOL_BOUNDARY_METRICS.preHandler);
    resetDurationSamples(HTTP_TOOL_BOUNDARY_METRICS.postHandler);
}

/** @returns {DurationSamples} */
function createDurationSamples() {
    return { count: 0, totalMs: 0, lastMs: null, maxMs: null, samples: [] };
}

/** @param {DurationSamples} metric @param {number} durationMs */
function recordDurationSample(metric, durationMs) {
    const value = Math.max(0, Math.round(Number(durationMs) || 0));
    metric.count += 1;
    metric.totalMs += value;
    metric.lastMs = value;
    metric.maxMs = metric.maxMs === null ? value : Math.max(metric.maxMs, value);
    pushBoundedSample(metric.samples, value, MAX_HTTP_TOOL_TIMING_SAMPLES);
}

/** @param {DurationSamples} metric */
function summarizeDurationSamples(metric) {
    const sorted = [...metric.samples].sort((left, right) => left - right);
    return {
        count: metric.count,
        averageMs: metric.count > 0 ? Math.round(metric.totalMs / metric.count) : 0,
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        p99Ms: percentile(sorted, 0.99),
        lastMs: metric.lastMs,
        maxMs: metric.maxMs,
    };
}

/** @param {DurationSamples} metric */
function resetDurationSamples(metric) {
    metric.count = 0;
    metric.totalMs = 0;
    metric.lastMs = null;
    metric.maxMs = null;
    metric.samples.length = 0;
}

/** @param {number[]} samples @param {number} value @param {number} maxSamples */
function pushBoundedSample(samples, value, maxSamples) {
    samples.push(value);
    if (samples.length > maxSamples) samples.splice(0, samples.length - maxSamples);
}

/** @param {number[]} samples @returns {number} */
function averageSamples(samples) {
    return samples.length > 0 ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length) : 0;
}

/** @param {unknown} value @returns {string | null} */
function normalizeEdgeColo(value) {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return /^[A-Z0-9]{3,8}$/u.test(normalized) ? normalized : null;
}

/** @param {Map<string, number>} map @param {string} key */
function incrementMapCount(map, key) {
    map.set(key, (map.get(key) ?? 0) + 1);
}

/** @param {Map<string, number>} map @returns {Record<string, number>} */
function mapCountsToRecord(map) {
    return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

/** @param {HttpRequestActivityEvent | null} event */
function compactHttpRequestActivityEvent(event) {
    if (!event) return null;
    return {
        receivedAt: event.receivedAt,
        finishedAt: event.finishedAt,
        durationMs: event.durationMs,
        httpMethod: event.httpMethod,
        routeClass: event.routeClass,
        rpcMethod: event.rpcMethod,
        statusCode: event.statusCode,
        edgeColo: event.edgeColo,
    };
}

/** @param {number} statusCode */
function classifyHttpStatusClass(statusCode) {
    if (statusCode >= 100 && statusCode < 200) return '1xx';
    if (statusCode >= 200 && statusCode < 300) return '2xx';
    if (statusCode >= 300 && statusCode < 400) return '3xx';
    if (statusCode >= 400 && statusCode < 500) return '4xx';
    if (statusCode >= 500 && statusCode < 600) return '5xx';
    return 'other';
}

/** @param {unknown} value @param {string} fallback */
function normalizeMetricLabel(value, fallback) {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_.:/-]{1,80}$/u.test(normalized) ? normalized : fallback;
}

/** @param {number} value */
function roundMetricRatio(value) {
    return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 1_000_000) / 1_000_000;
}

/** @param {number} value @returns {number} */
function normalizeTimestamp(value) {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : Date.now();
}

/** @param {number[]} sortedValues @param {number} quantile @returns {number | null} */
function percentile(sortedValues, quantile) {
    if (sortedValues.length === 0) return null;
    const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * quantile) - 1));
    return sortedValues[index] ?? null;
}
