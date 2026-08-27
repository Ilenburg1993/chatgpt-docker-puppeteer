// @ts-check
/**
 * Privacy-bounded per-call audit correlation for the MCP registry.
 *
 * Raw request metadata, source text, commands and workspace paths never cross this boundary. The registry projects only
 * a generated call id, a pseudonymous W3C trace key when the caller already supplied a valid traceparent, immutable
 * runtime-generation identity, and bounded hashes of exact workspace targets known from tool input.
 *
 * @module copilot/mcp/registry/audit-correlation
 */

import { createHash } from 'node:crypto';

const MAX_TARGET_KEYS = 64;
const MAX_PATH_CHARS = 32 * 1024;
const TRACEPARENT_V00_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;
const TRACEPARENT_VERSION_RE = /^([0-9a-f]{2})-/u;
const ZERO_TRACE_ID = '0'.repeat(32);
const ZERO_PARENT_ID = '0'.repeat(16);

/**
 * Build immutable, non-secret metadata attached to every audit event produced by one tool call.
 *
 * @param {{
 *   callId: string;
 *   toolName: string;
 *   args: Record<string, unknown>;
 *   requestMeta?: Readonly<Record<string, unknown>>;
 *   runtimeSourceGeneration?: import('#copilot/mcp/public/runtime/source-generation').McpRuntimeSourceGeneration;
 * }} input
 */
export function buildMcpToolCallAuditCorrelation(input) {
    const trace = readMcpTraceCorrelation(input.requestMeta);
    const targets = readMcpToolTargetCorrelation(input.toolName, input.args);
    const generation = input.runtimeSourceGeneration;
    return Object.freeze({
        callId: boundedToken(input.callId, 128) ?? 'unknown-call',
        traceContextState: trace.state,
        ...(trace.traceKey ? { traceKey: trace.traceKey } : {}),
        targetPrecision: targets.precision,
        ...(targets.keys.length > 0 ? { targetKeys: targets.keys } : {}),
        ...(generation?.runtimeEpochId ? { runtimeEpochId: boundedToken(generation.runtimeEpochId, 128) } : {}),
        ...(generation?.sourceBinding ? { runtimeSourceBinding: generation.sourceBinding } : {}),
        ...(generation?.sourceBarrierFingerprint
            ? { runtimeSourceFingerprint: generation.sourceBarrierFingerprint }
            : {}),
    });
}

/**
 * Bind one process-owned audit capability to a single call without mutating the process capability. Correlation
 * metadata wins over event-supplied fields so a tool cannot accidentally detach a child audit event from its call.
 *
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolCapabilityProjection['audit']} audit
 * @param {Readonly<Record<string, unknown>>} correlation
 */
export function scopeMcpToolAuditCapability(audit, correlation) {
    if (!audit) return undefined;
    return Object.freeze({
        ...audit,
        append: (/** @type {Record<string, unknown>} */ event) => {
            const narrowingRequested = Object.prototype.hasOwnProperty.call(event, 'correlationTargetPaths');
            const { correlationTargetPaths, ...persistableEvent } = event;
            const merged = { ...persistableEvent, ...correlation };
            if (!narrowingRequested) return audit.append(merged);
            const narrowed = narrowAuditEventTargetCorrelation(correlationTargetPaths, correlation);
            delete merged['targetKeys'];
            merged['targetPrecision'] = narrowed.precision;
            if (narrowed.keys.length > 0) merged['targetKeys'] = narrowed.keys;
            return audit.append(merged);
        },
    });
}

/**
 * Allow one child audit event to narrow the invocation target set, never widen it. This is required for partial batch
 * failures: a batch may mention A+B while only A failed, and recovery for B must not be attributed to A. Raw narrowing
 * paths exist only until this scoped boundary hashes them and are removed before the process audit capability sees the
 * event. Invalid/out-of-invocation narrowing fails closed to targetPrecision=none rather than retaining the broader set.
 *
 * @param {unknown} value
 * @param {Readonly<Record<string, unknown>>} correlation
 */
function narrowAuditEventTargetCorrelation(value, correlation) {
    if (!Array.isArray(value)) return { precision: /** @type {const} */ ('none'), keys: [] };
    const allowed = new Set(Array.isArray(correlation['targetKeys']) ? correlation['targetKeys'] : []);
    const keys = [
        ...new Set(
            value
                .slice(0, MAX_TARGET_KEYS)
                .map(normalizeTargetPath)
                .filter((path) => path !== null)
                .map(hashTargetPath),
        ),
    ]
        .filter((key) => allowed.has(key))
        .sort();
    const requestedValidCount = value
        .slice(0, MAX_TARGET_KEYS)
        .map(normalizeTargetPath)
        .filter((path) => path !== null).length;
    if (keys.length === 0 || keys.length !== requestedValidCount) {
        return { precision: /** @type {const} */ ('none'), keys: [] };
    }
    return {
        precision: keys.length === 1 ? /** @type {const} */ ('exact-single') : /** @type {const} */ ('exact-set'),
        keys,
    };
}

/**
 * Read only `_meta.traceparent`. `tracestate` and `baggage` are deliberately ignored and never persisted. For now the
 * implementation accepts W3C version 00 only; future versions remain explicit `unsupported-version` rather than being
 * misparsed under v00 semantics.
 *
 * @param {Readonly<Record<string, unknown>> | undefined} requestMeta
 * @returns {{ state: 'absent' | 'invalid' | 'unsupported-version' | 'valid'; traceKey: string | null }}
 */
export function readMcpTraceCorrelation(requestMeta) {
    if (!requestMeta || !Object.prototype.hasOwnProperty.call(requestMeta, 'traceparent')) {
        return { state: 'absent', traceKey: null };
    }
    const traceparent = requestMeta['traceparent'];
    if (typeof traceparent !== 'string') return { state: 'invalid', traceKey: null };
    const version = TRACEPARENT_VERSION_RE.exec(traceparent)?.[1] ?? null;
    if (version && version !== '00') {
        return { state: version === 'ff' ? 'invalid' : 'unsupported-version', traceKey: null };
    }
    const match = TRACEPARENT_V00_RE.exec(traceparent);
    if (!match) return { state: 'invalid', traceKey: null };
    const traceId = match[1] ?? '';
    const parentId = match[2] ?? '';
    if (traceId === ZERO_TRACE_ID || parentId === ZERO_PARENT_ID) return { state: 'invalid', traceKey: null };
    return { state: 'valid', traceKey: digestKey('w3c-trace-v1', traceId) };
}

/**
 * Derive bounded opaque identities only for exact workspace targets visible in known tool inputs. Search roots and tree
 * scopes are intentionally not promoted to exact target identities.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {{ precision: 'none' | 'exact-single' | 'exact-set'; keys: string[] }}
 */
export function readMcpToolTargetCorrelation(toolName, args) {
    /** @type {unknown[]} */
    let candidates = [];
    if (toolName === 'repo_read_file' && Array.isArray(args['batch'])) {
        candidates = args['batch'].map((item) => readObjectField(item, 'path'));
    } else if (toolName === 'repo_bulk_inspect' && Array.isArray(args['operations'])) {
        candidates = args['operations'].flatMap((item) => {
            if (!isRecord(item) || (item['op'] !== 'read' && item['op'] !== 'stat')) return [];
            return [readObjectField(item['args'], 'path')];
        });
    } else if (
        ['repo_apply_patch_batch', 'repo_patch_batch_plan'].includes(toolName) &&
        Array.isArray(args['targets'])
    ) {
        candidates = args['targets'].map((item) => readObjectField(item, 'path'));
    } else if (toolName === 'repo_diff_files') {
        candidates = [args['pathA'], args['pathB']];
    } else if (toolName === 'repo_move_file') {
        candidates = [args['source'], args['destination']];
    } else if (
        [
            'repo_read_file',
            'repo_read_file_chunks',
            'repo_file_stats',
            'repo_apply_patch',
            'repo_patch_plan',
            'repo_write_file',
            'repo_create_file',
            'repo_quarantine_file',
            'repo_remove_file',
        ].includes(toolName)
    ) {
        candidates = [args['path']];
    }
    const keys = [
        ...new Set(
            candidates
                .map(normalizeTargetPath)
                .filter((value) => value !== null)
                .map(hashTargetPath),
        ),
    ]
        .sort()
        .slice(0, MAX_TARGET_KEYS);
    return {
        precision: keys.length === 0 ? 'none' : keys.length === 1 ? 'exact-single' : 'exact-set',
        keys,
    };
}

/** @param {unknown} value @param {string} field */
function readObjectField(value, field) {
    return isRecord(value) ? value[field] : undefined;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
function normalizeTargetPath(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_CHARS || value.includes('\0'))
        return null;
    let normalized = value.trim().replaceAll('\\', '/');
    while (normalized.startsWith('./')) normalized = normalized.slice(2);
    return normalized || null;
}

/** @param {string} normalizedPath */
function hashTargetPath(normalizedPath) {
    return digestKey('workspace-target-v1', normalizedPath);
}

/** @param {string} namespace @param {string} value */
function digestKey(namespace, value) {
    return createHash('sha256').update(`${namespace}\0${value}`, 'utf8').digest('hex').slice(0, 32);
}

/** @param {unknown} value @param {number} maxLength */
function boundedToken(value, maxLength) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maxLength ? normalized : null;
}
