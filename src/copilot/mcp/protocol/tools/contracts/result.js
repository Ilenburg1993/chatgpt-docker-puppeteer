// @ts-check
/**
 * Result helpers for MCP tool responses.
 *
 * @module copilot/mcp/protocol/tools/contracts/result
 */

/**
 * @typedef {import('@modelcontextprotocol/server').CallToolResult} CallToolResult
 *
 * @typedef {CallToolResult & {
 *     content: { type: 'text'; text: string }[];
 *     structuredContent: Record<string, any>;
 * }} StructuredCallToolResult
 *
 *
 * @typedef {{
 *     bytes: number;
 *     strategy: 'exact' | 'conservative-estimate';
 *     source: string;
 * }} ResultSizeHint
 *
 * @typedef {{
 *     logicalOperations: number;
 *     failedOperations?: number;
 *     skippedOperations?: number;
 *     mode?: string;
 *     batchSize?: number;
 *     batchCapacity?: number;
 *     resultBudgetBytes?: number;
 *     truncatedOperations?: number;
 *     continuationAvailable?: boolean;
 *     continuationAvailableOperations?: number;
 *     continuationTransportRequired?: boolean;
 *     continuationTransportRequiredOperations?: number;
 *     continuationRecommended?: boolean;
 *     continuationRecommendedOperations?: number;
 * }} ResultExecutionHint
 */

const RESULT_SIZE_HINT_SYMBOL = Symbol.for('copilot.mcp.resultSizeHint');
const RESULT_EXECUTION_HINT_SYMBOL = Symbol.for('copilot.mcp.resultExecutionHint');

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stringifyForModel(value) {
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
}

/**
 * @param {unknown} structuredContent
 * @param {string} [text]
 * @param {Record<string, unknown>} [meta]
 * @returns {StructuredCallToolResult}
 */
export function okResult(structuredContent, text, meta) {
    const normalizedStructuredContent = asRecord(structuredContent);
    return {
        content: [{ type: 'text', text: text ?? stringifyForModel(normalizedStructuredContent) }],
        structuredContent: normalizedStructuredContent,
        ...(meta ? { _meta: meta } : {}),
    };
}

/**
 * Attach an internal result-size hint used by the registry to avoid expensive full JSON stringification when a tool can
 * already account for its own result size. The symbol property is non-enumerable and is not part of the MCP payload.
 *
 * @template {StructuredCallToolResult} T
 * @param {T} result
 * @param {ResultSizeHint} hint
 * @returns {T}
 */
export function withResultSizeHint(result, hint) {
    if (!Number.isFinite(hint.bytes) || hint.bytes < 0) return result;
    Object.defineProperty(result, RESULT_SIZE_HINT_SYMBOL, {
        value: {
            bytes: Math.ceil(hint.bytes),
            strategy: hint.strategy,
            source: hint.source,
        },
        enumerable: false,
        configurable: true,
    });
    return result;
}

/**
 * Attach internal logical-operation accounting for round-trip compression metrics. The hint is non-enumerable and never
 * becomes part of the MCP wire payload.
 *
 * @template {StructuredCallToolResult} T
 * @param {T} result
 * @param {ResultExecutionHint} hint
 * @returns {T}
 */
export function withResultExecutionHint(result, hint) {
    const logicalOperations = Math.max(1, Math.floor(Number(hint.logicalOperations) || 1));
    const failedOperations = Math.max(0, Math.min(logicalOperations, Math.floor(Number(hint.failedOperations) || 0)));
    const skippedOperations = Math.max(
        0,
        Math.min(logicalOperations - failedOperations, Math.floor(Number(hint.skippedOperations) || 0)),
    );
    const batchSize = positiveIntegerOrUndefined(hint.batchSize);
    const batchCapacityCandidate = positiveIntegerOrUndefined(hint.batchCapacity);
    const batchCapacity =
        batchCapacityCandidate !== undefined && (batchSize === undefined || batchCapacityCandidate >= batchSize)
            ? batchCapacityCandidate
            : undefined;
    const truncatedOperations = Math.max(
        0,
        Math.min(batchSize ?? logicalOperations, Math.floor(Number(hint.truncatedOperations) || 0)),
    );
    const resultBudgetBytes = nonNegativeIntegerOrUndefined(hint.resultBudgetBytes);
    const continuationAvailableOperations = boundedOperationCount(
        hint.continuationAvailableOperations,
        logicalOperations,
    );
    const continuationTransportRequiredOperations = boundedOperationCount(
        hint.continuationTransportRequiredOperations,
        logicalOperations,
    );
    const continuationRecommendedOperations = boundedOperationCount(
        hint.continuationRecommendedOperations,
        logicalOperations,
    );
    const continuationTransportRequired =
        hint.continuationTransportRequired === true || continuationTransportRequiredOperations > 0;
    const continuationAvailable =
        hint.continuationAvailable === true || continuationAvailableOperations > 0 || continuationTransportRequired;
    const continuationRecommended =
        hint.continuationRecommended === true || continuationRecommendedOperations > 0 || continuationTransportRequired;
    Object.defineProperty(result, RESULT_EXECUTION_HINT_SYMBOL, {
        value: {
            logicalOperations,
            failedOperations,
            skippedOperations,
            mode: typeof hint.mode === 'string' && hint.mode.trim() ? hint.mode.trim().slice(0, 80) : undefined,
            ...(batchSize !== undefined ? { batchSize } : {}),
            ...(batchCapacity !== undefined ? { batchCapacity } : {}),
            ...(resultBudgetBytes !== undefined ? { resultBudgetBytes } : {}),
            ...(truncatedOperations > 0 ? { truncatedOperations } : {}),
            ...(continuationAvailable ? { continuationAvailable: true } : {}),
            ...(continuationAvailableOperations > 0 ? { continuationAvailableOperations } : {}),
            ...(continuationTransportRequired ? { continuationTransportRequired: true } : {}),
            ...(continuationTransportRequiredOperations > 0 ? { continuationTransportRequiredOperations } : {}),
            ...(continuationRecommended ? { continuationRecommended: true } : {}),
            ...(continuationRecommendedOperations > 0 ? { continuationRecommendedOperations } : {}),
        },
        enumerable: false,
        configurable: true,
    });
    return result;
}

/**
 * @param {unknown} result
 * @returns {ResultExecutionHint | null}
 */
export function getResultExecutionHint(result) {
    if (!result || typeof result !== 'object') return null;
    const hint = /** @type {Record<PropertyKey, unknown>} */ (result)[RESULT_EXECUTION_HINT_SYMBOL];
    if (!hint || typeof hint !== 'object' || Array.isArray(hint)) return null;
    const record = /** @type {Record<string, unknown>} */ (hint);
    const logicalOperations = Number(record['logicalOperations']);
    if (!Number.isFinite(logicalOperations) || logicalOperations < 1) return null;
    const batchSize = positiveIntegerOrUndefined(record['batchSize']);
    const batchCapacityCandidate = positiveIntegerOrUndefined(record['batchCapacity']);
    const batchCapacity =
        batchCapacityCandidate !== undefined && (batchSize === undefined || batchCapacityCandidate >= batchSize)
            ? batchCapacityCandidate
            : undefined;
    const resultBudgetBytes = nonNegativeIntegerOrUndefined(record['resultBudgetBytes']);
    const truncatedOperations = nonNegativeIntegerOrUndefined(record['truncatedOperations']);
    const continuationAvailableOperations = boundedOperationCount(
        record['continuationAvailableOperations'],
        logicalOperations,
    );
    const continuationTransportRequiredOperations = boundedOperationCount(
        record['continuationTransportRequiredOperations'],
        logicalOperations,
    );
    const continuationRecommendedOperations = boundedOperationCount(
        record['continuationRecommendedOperations'],
        logicalOperations,
    );
    return {
        logicalOperations: Math.floor(logicalOperations),
        failedOperations: Math.max(0, Math.floor(Number(record['failedOperations']) || 0)),
        skippedOperations: Math.max(0, Math.floor(Number(record['skippedOperations']) || 0)),
        ...(typeof record['mode'] === 'string' ? { mode: record['mode'] } : {}),
        ...(batchSize !== undefined ? { batchSize } : {}),
        ...(batchCapacity !== undefined ? { batchCapacity } : {}),
        ...(resultBudgetBytes !== undefined ? { resultBudgetBytes } : {}),
        ...(truncatedOperations !== undefined ? { truncatedOperations } : {}),
        ...(record['continuationAvailable'] === true ? { continuationAvailable: true } : {}),
        ...(continuationAvailableOperations > 0 ? { continuationAvailableOperations } : {}),
        ...(record['continuationTransportRequired'] === true ? { continuationTransportRequired: true } : {}),
        ...(continuationTransportRequiredOperations > 0 ? { continuationTransportRequiredOperations } : {}),
        ...(record['continuationRecommended'] === true ? { continuationRecommended: true } : {}),
        ...(continuationRecommendedOperations > 0 ? { continuationRecommendedOperations } : {}),
    };
}

/** @param {unknown} value @param {number} max */
function boundedOperationCount(value, max) {
    const parsed = nonNegativeIntegerOrUndefined(value) ?? 0;
    return Math.max(0, Math.min(Math.floor(max), parsed));
}

/** @param {unknown} value */
function positiveIntegerOrUndefined(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

/** @param {unknown} value */
function nonNegativeIntegerOrUndefined(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * @param {unknown} result
 * @returns {ResultSizeHint | null}
 */
export function getResultSizeHint(result) {
    if (!result || typeof result !== 'object') return null;
    const hint = /** @type {Record<PropertyKey, unknown>} */ (result)[RESULT_SIZE_HINT_SYMBOL];
    if (!hint || typeof hint !== 'object' || Array.isArray(hint)) return null;
    const record = /** @type {Record<string, unknown>} */ (hint);
    const bytes = Number(record['bytes']);
    const strategy = record['strategy'];
    const source = record['source'];
    if (!Number.isFinite(bytes) || bytes < 0) return null;
    if (strategy !== 'exact' && strategy !== 'conservative-estimate') return null;
    return {
        bytes,
        strategy,
        source: typeof source === 'string' ? source : 'unknown',
    };
}

/**
 * Estimate JSON bytes without materializing the whole result string. This preserves the result-size guard while
 * avoiding the large temporary allocation that `stableJsonStringify(result)` creates for hot read/search/patch tools.
 *
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @returns {number}
 */
function estimateJsonBytes(value, seen = new WeakSet()) {
    if (value === null) return 4;
    if (typeof value === 'string') return Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (typeof value === 'number')
        return Buffer.byteLength(JSON.stringify(Number.isFinite(value) ? value : null), 'utf8');
    if (typeof value === 'boolean') return value ? 4 : 5;
    if (typeof value === 'bigint') return Buffer.byteLength(JSON.stringify(String(value)), 'utf8');
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return 0;
    if (typeof value !== 'object') return Buffer.byteLength(JSON.stringify(String(value)), 'utf8');
    if (seen.has(value)) return 6;
    seen.add(value);
    if (Array.isArray(value)) {
        let total = 2;
        for (let index = 0; index < value.length; index += 1) {
            if (index > 0) total += 1;
            const item = value[index];
            total +=
                item === undefined || typeof item === 'function' || typeof item === 'symbol'
                    ? 4
                    : estimateJsonBytes(item, seen);
        }
        return total;
    }
    let total = 2;
    let count = 0;
    for (const [key, item] of Object.entries(value)) {
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
        if (count > 0) total += 1;
        total += Buffer.byteLength(JSON.stringify(key), 'utf8') + 1 + estimateJsonBytes(item, seen);
        count += 1;
    }
    return total;
}

/**
 * @param {unknown} structuredContent
 * @param {string | undefined} text
 * @returns {number}
 */
export function estimateStructuredTextResultBytes(structuredContent, text) {
    const structured = asRecord(structuredContent);
    const contentText = text ?? stringifyForModel(structured);
    return estimateJsonBytes({ content: [{ type: 'text', text: contentText }], structuredContent: structured }) + 512;
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @param {Record<string, unknown>} [meta]
 * @returns {StructuredCallToolResult}
 */
export function errorResult(message, details, meta) {
    const code =
        details && typeof details['code'] === 'string' && details['code'].trim() ? details['code'].trim() : undefined;
    const hint =
        details && typeof details['hint'] === 'string' && details['hint'].trim() ? details['hint'].trim() : undefined;
    return {
        isError: true,
        content: [{ type: 'text', text: message }],
        structuredContent: {
            success: false,
            ...(code ? { code } : {}),
            error: message,
            ...(hint ? { hint } : {}),
            ...(details ? { details } : {}),
        },
        ...(meta ? { _meta: meta } : {}),
    };
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
export function asRecord(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return /** @type {Record<string, unknown>} */ (value);
    }
    return { value };
}
