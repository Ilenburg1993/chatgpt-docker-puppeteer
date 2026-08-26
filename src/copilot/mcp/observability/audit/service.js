// @ts-check
/**
 * MCP audit helpers. Stdout is intentionally never used because stdio transport reserves stdout for JSON-RPC frames.
 *
 * @module copilot/mcp/observability/audit
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { createJsonlBatchQueue } from '#copilot/infra/public/persistence/jsonl/queue';
import { MCP_AUDIT_PROCESS_CONFIG_KIND } from './config.js';

const MAX_AUDIT_QUEUE_LINES = 10_000;
const DEFAULT_AUDIT_HISTORY_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_AUDIT_HISTORY_TAIL_BYTES = 16 * 1024 * 1024;
const DEFAULT_AUDIT_HISTORY_EVENTS = 25_000;
const MAX_AUDIT_HISTORY_EVENTS = 100_000;
const MCP_COMPATIBILITY_OBSERVATION_EVENT = 'mcp_compat_observation';
const MCP_COMPATIBILITY_OBSERVATION_SCHEMA_VERSION = 2;
const MCP_COMPATIBILITY_OBSERVATION_READABLE_SCHEMA_VERSIONS = Object.freeze([1, 2]);
const COMPATIBILITY_PROTOCOL_ERAS = Object.freeze(['2025', '2026']);
const COMPATIBILITY_TRANSPORT_MODES = Object.freeze(['modern-2026', 'stateful', 'stateless-fallback']);
const COMPATIBILITY_RPC_CLASSES = Object.freeze([
    'server-discover',
    'subscriptions-listen',
    'initialize',
    'tools-list',
    'tools-call',
    'other',
    'none',
]);
const COMPATIBILITY_CLIENT_SOURCES = Object.freeze(['cimd', 'dcr', 'unknown']);
const COMPATIBILITY_HOST_CLASSES = Object.freeze(['chatgpt', 'claude', 'unknown']);
const COMPATIBILITY_CLIENT_RESOLUTIONS = Object.freeze([
    'metadata-document',
    'trusted-fallback',
    'dynamic-registration',
]);
const COMPATIBILITY_GRANT_TYPES = Object.freeze(['authorization_code', 'refresh_token']);
const COMPATIBILITY_OUTCOMES = Object.freeze(['attempted', 'succeeded', 'rejected']);
const COMPATIBILITY_ACTOR_CLASSES = Object.freeze(['consumer', 'diagnostic', 'unknown']);
const COMPATIBILITY_CONTINUITY_SIGNALS = Object.freeze([
    'none',
    'legacy-stream-open',
    'legacy-stream-resume',
    'modern-subscription-open',
]);

/** @param {import('./config.js').McpAuditProcessConfig} config */
function createMcpAuditRuntime(config) {
    const auditFs = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'mcp.observability.audit',
            exactPaths: [config.filePath],
            operations: ['append', 'read'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory', 'none'],
        }),
    );
    const writer = createJsonlBatchQueue({
        persistBatch: async (data) => {
            await auditFs.appendText(config.filePath, data, { mode: 0o600, durability: 'none' });
        },
        maxQueueLines: MAX_AUDIT_QUEUE_LINES,
        softQueueLines: MAX_AUDIT_QUEUE_LINES - 1,
        onError: (error) => {
            logMcp('WARN', 'Failed to append MCP audit event batch.', {
                error: error instanceof Error ? error.message : String(error),
            });
        },
    });
    return Object.freeze({ config, auditFs, writer });
}
/** @typedef {ReturnType<typeof createMcpAuditRuntime>} McpAuditRuntime */

/**
 * Create one audit capability bound to one immutable process-config generation. Queue, filesystem authority and writer
 * lifecycle are private to this capability; process composition owns the capability and flushes it during teardown.
 *
 * @param {import('./config.js').McpAuditProcessConfig} config
 */
export function createMcpAuditCapability(config) {
    if (!config || config.kind !== MCP_AUDIT_PROCESS_CONFIG_KIND) {
        throw new TypeError('MCP audit capability requires a normalized process configuration.');
    }
    const runtime = createMcpAuditRuntime(config);
    return Object.freeze({
        config,
        filePath: config.filePath,
        append: (/** @type {Record<string, unknown>} */ event) => appendMcpAuditEvent(runtime, event),
        recordCompatibility: (/** @type {Record<string, unknown>} */ observation) =>
            appendMcpCompatibilityObservation(runtime, observation),
        readCompatibilitySummary: (/** @type {{ tailBytes?: number; maxEvents?: number }} */ options = {}) =>
            readMcpCompatibilitySummary(runtime, options),
        readTail: (/** @type {{ tailBytes?: number; maxEvents?: number }} */ options = {}) =>
            readMcpAuditEventTail(runtime, options),
        readSlice: (/** @type {{ offset?: number; maxBytes?: number; maxEvents?: number }} */ options = {}) =>
            readMcpAuditEventSlice(runtime, options),
        flush: () => flushMcpAuditEvents(runtime),
    });
}

/**
 * @param {'DEBUG' | 'INFO' | 'WARN' | 'ERROR'} level
 * @param {string} message
 * @param {Record<string, unknown>} [fields]
 * @returns {void}
 */
export function logMcp(level, message, fields) {
    const payload = {
        ts: new Date().toISOString(),
        level,
        component: 'copilot-mcp',
        message,
        ...(fields ? { fields } : {}),
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
}

/**
 * @param {McpAuditRuntime} runtime
 * @param {Record<string, unknown>} event
 * @returns {Promise<void>}
 */
async function appendMcpAuditEvent(runtime, event) {
    if (runtime.config.disabled) return;
    const payload = {
        ts: new Date().toISOString(),
        component: 'copilot-mcp',
        ...event,
    };
    const line = `${JSON.stringify(payload)}\n`;
    runtime.writer.enqueueLine(line);
    if (runtime.config.sync) await runtime.writer.flush();
}

/**
 * Read a bounded tail of persisted MCP audit events for longitudinal diagnostics. This never exposes credentials and
 * never accepts a caller-controlled path.
 *
 * @param {McpAuditRuntime} runtime
 * @param {{ tailBytes?: number; maxEvents?: number }} [options]
 * @returns {Promise<{
 *     ok: boolean;
 *     fileBytes: number;
 *     tailBytesRead: number;
 *     truncatedByBytes: boolean;
 *     parsedEvents: number;
 *     invalidLines: number;
 *     events: Record<string, unknown>[];
 *     error: string | null;
 * }>}
 */
async function readMcpAuditEventTail(runtime, options = {}) {
    const tailBytes = boundedInteger(
        options.tailBytes,
        DEFAULT_AUDIT_HISTORY_TAIL_BYTES,
        64 * 1024,
        MAX_AUDIT_HISTORY_TAIL_BYTES,
    );
    const maxEvents = boundedInteger(options.maxEvents, DEFAULT_AUDIT_HISTORY_EVENTS, 100, MAX_AUDIT_HISTORY_EVENTS);
    const auditFile = runtime.config.filePath;
    try {
        await runtime.writer.flush();
        const snapshot = await runtime.auditFs.readBytesRangeFresh(auditFile, {
            maxBytes: tailBytes,
            fromEnd: true,
            rejectSymlink: true,
        });
        const fileBytes = snapshot.sizeBytes;
        const bytesToRead = snapshot.bytesRead;
        if (bytesToRead <= 0) {
            return {
                ok: true,
                fileBytes,
                tailBytesRead: 0,
                truncatedByBytes: false,
                parsedEvents: 0,
                invalidLines: 0,
                events: [],
                error: null,
            };
        }
        let text = snapshot.content.toString('utf8');
        const truncatedByBytes = snapshot.truncatedBefore;
        if (truncatedByBytes) {
            const firstNewline = text.indexOf('\n');
            text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
        }
        /** @type {Record<string, unknown>[]} */
        const parsed = [];
        let invalidLines = 0;
        for (const line of text.split(/\r?\n/u)) {
            if (!line.trim()) continue;
            try {
                const value = JSON.parse(line);
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    parsed.push(/** @type {Record<string, unknown>} */ (value));
                } else invalidLines += 1;
            } catch {
                invalidLines += 1;
            }
        }
        const events = parsed.slice(-maxEvents);
        return {
            ok: true,
            fileBytes,
            tailBytesRead: bytesToRead,
            truncatedByBytes,
            parsedEvents: events.length,
            invalidLines,
            events,
            error: null,
        };
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (code === 'ENOENT') {
            return {
                ok: true,
                fileBytes: 0,
                tailBytesRead: 0,
                truncatedByBytes: false,
                parsedEvents: 0,
                invalidLines: 0,
                events: [],
                error: null,
            };
        }
        return {
            ok: false,
            fileBytes: 0,
            tailBytesRead: 0,
            truncatedByBytes: false,
            parsedEvents: 0,
            invalidLines: 0,
            events: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Read a bounded, newline-aligned audit slice beginning at an exact byte offset. The returned nextOffset always points
 * immediately after the last complete newline, so callers can checkpoint it without reparsing or skipping a partial
 * JSON line. The file identity lets derived indexes detect rotation/replacement.
 *
 * @param {McpAuditRuntime} runtime
 * @param {{ offset?: number; maxBytes?: number; maxEvents?: number }} [options]
 */
async function readMcpAuditEventSlice(runtime, options = {}) {
    const requestedOffset = Math.max(0, Math.floor(Number(options.offset ?? 0) || 0));
    const maxBytes = boundedInteger(options.maxBytes, 4 * 1024 * 1024, 64 * 1024, 16 * 1024 * 1024);
    const maxEvents = boundedInteger(options.maxEvents, 50_000, 100, 200_000);
    const auditFile = runtime.config.filePath;
    try {
        await runtime.writer.flush();
        let snapshot = await runtime.auditFs.readBytesRangeFresh(auditFile, {
            start: requestedOffset,
            maxBytes,
            rejectSymlink: true,
        });
        const resetRequired = requestedOffset > snapshot.sizeBytes;
        if (resetRequired) {
            snapshot = await runtime.auditFs.readBytesRangeFresh(auditFile, {
                start: 0,
                maxBytes,
                rejectSymlink: true,
            });
        }
        const fileBytes = snapshot.sizeBytes;
        const fileIdentity = `${String(snapshot.dev)}:${String(snapshot.ino)}`;
        const startOffset = resetRequired ? 0 : requestedOffset;
        const bytesToRead = snapshot.bytesRead;
        if (bytesToRead <= 0) {
            return {
                ok: true,
                fileIdentity,
                fileBytes,
                requestedOffset,
                startOffset,
                nextOffset: startOffset,
                bytesRead: 0,
                complete: startOffset >= fileBytes,
                resetRequired,
                parsedEvents: 0,
                invalidLines: 0,
                events: [],
                error: null,
            };
        }

        const buffer = snapshot.content;
        let completeBytes = bytesToRead;
        const reachedEof = !snapshot.truncatedAfter;
        if (!reachedEof) {
            const lastNewline = buffer.lastIndexOf(0x0a);
            completeBytes = lastNewline >= 0 ? lastNewline + 1 : 0;
        }
        const text = completeBytes > 0 ? buffer.subarray(0, completeBytes).toString('utf8') : '';
        /** @type {Record<string, unknown>[]} */
        const events = [];
        /** @type {{ sourceOffset: number; event: Record<string, unknown> }[]} */
        const entries = [];
        let invalidLines = 0;
        let lineOffset = startOffset;
        for (const rawLine of text.split('\n')) {
            const lineBytes = Buffer.byteLength(rawLine, 'utf8') + 1;
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
            if (line.trim()) {
                try {
                    const value = JSON.parse(line);
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        if (events.length < maxEvents) {
                            const event = /** @type {Record<string, unknown>} */ (value);
                            events.push(event);
                            entries.push({ sourceOffset: lineOffset, event });
                        }
                    } else invalidLines += 1;
                } catch {
                    invalidLines += 1;
                }
            }
            lineOffset += lineBytes;
        }
        const nextOffset = startOffset + completeBytes;
        return {
            ok: true,
            fileIdentity,
            fileBytes,
            requestedOffset,
            startOffset,
            nextOffset,
            bytesRead: completeBytes,
            complete: nextOffset >= fileBytes,
            resetRequired,
            parsedEvents: events.length,
            invalidLines,
            events,
            entries,
            error: null,
        };
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (code === 'ENOENT') {
            return {
                ok: true,
                fileIdentity: null,
                fileBytes: 0,
                requestedOffset,
                startOffset: 0,
                nextOffset: 0,
                bytesRead: 0,
                complete: true,
                resetRequired: requestedOffset > 0,
                parsedEvents: 0,
                invalidLines: 0,
                events: [],
                error: null,
            };
        }
        return {
            ok: false,
            fileIdentity: null,
            fileBytes: 0,
            requestedOffset,
            startOffset: 0,
            nextOffset: 0,
            bytesRead: 0,
            complete: false,
            resetRequired: false,
            parsedEvents: 0,
            invalidLines: 0,
            events: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Persist one privacy-bounded compatibility observation. The caller may pass an object with additional properties, but
 * only the fixed enum projection below is serialized. Client identifiers, redirect URIs, subjects, IPs, raw headers,
 * user agents, tokens and free-form errors therefore cannot cross this API by accident.
 *
 * @param {McpAuditRuntime} runtime
 * @param {Record<string, unknown>} observation
 * @returns {Promise<void>}
 */
async function appendMcpCompatibilityObservation(runtime, observation) {
    await appendMcpAuditEvent(runtime, normalizeMcpCompatibilityObservation(observation));
}

/**
 * @param {Record<string, unknown>} observation
 * @returns {Record<string, unknown>}
 */
function normalizeMcpCompatibilityObservation(observation) {
    const kind = String(observation['kind'] ?? '');
    if (kind === 'protocol-request') {
        return {
            event: MCP_COMPATIBILITY_OBSERVATION_EVENT,
            schemaVersion: MCP_COMPATIBILITY_OBSERVATION_SCHEMA_VERSION,
            kind,
            protocolEra: requireCompatibilityEnum(
                observation['protocolEra'],
                COMPATIBILITY_PROTOCOL_ERAS,
                'protocolEra',
            ),
            transportMode: requireCompatibilityEnum(
                observation['transportMode'],
                COMPATIBILITY_TRANSPORT_MODES,
                'transportMode',
            ),
            rpcClass: requireCompatibilityEnum(observation['rpcClass'], COMPATIBILITY_RPC_CLASSES, 'rpcClass'),
            continuity: requireCompatibilityEnum(
                observation['continuity'],
                COMPATIBILITY_CONTINUITY_SIGNALS,
                'continuity',
            ),
        };
    }
    if (kind === 'oauth-client') {
        return {
            event: MCP_COMPATIBILITY_OBSERVATION_EVENT,
            schemaVersion: MCP_COMPATIBILITY_OBSERVATION_SCHEMA_VERSION,
            kind,
            clientSource: requireCompatibilityEnum(
                observation['clientSource'],
                COMPATIBILITY_CLIENT_SOURCES,
                'clientSource',
            ),
            hostClass: requireCompatibilityEnum(observation['hostClass'], COMPATIBILITY_HOST_CLASSES, 'hostClass'),
            actorClass: requireCompatibilityEnum(observation['actorClass'], COMPATIBILITY_ACTOR_CLASSES, 'actorClass'),
            resolution: requireCompatibilityEnum(
                observation['resolution'],
                COMPATIBILITY_CLIENT_RESOLUTIONS,
                'resolution',
            ),
            outcome: requireCompatibilityEnum(observation['outcome'], COMPATIBILITY_OUTCOMES, 'outcome'),
        };
    }
    if (kind === 'oauth-grant') {
        return {
            event: MCP_COMPATIBILITY_OBSERVATION_EVENT,
            schemaVersion: MCP_COMPATIBILITY_OBSERVATION_SCHEMA_VERSION,
            kind,
            grantType: requireCompatibilityEnum(observation['grantType'], COMPATIBILITY_GRANT_TYPES, 'grantType'),
            clientSource: requireCompatibilityEnum(
                observation['clientSource'],
                COMPATIBILITY_CLIENT_SOURCES,
                'clientSource',
            ),
            hostClass: requireCompatibilityEnum(observation['hostClass'], COMPATIBILITY_HOST_CLASSES, 'hostClass'),
            actorClass: requireCompatibilityEnum(observation['actorClass'], COMPATIBILITY_ACTOR_CLASSES, 'actorClass'),
            outcome: requireCompatibilityEnum(observation['outcome'], COMPATIBILITY_OUTCOMES, 'outcome'),
        };
    }
    throw new TypeError(`Unsupported MCP compatibility observation kind: ${kind || '<empty>'}.`);
}

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 * @param {string} field
 * @returns {string}
 */
function requireCompatibilityEnum(value, allowed, field) {
    const normalized = String(value ?? '');
    if (!allowed.includes(normalized))
        throw new TypeError(`Invalid MCP compatibility ${field}: ${normalized || '<empty>'}.`);
    return normalized;
}

/**
 * Build a bounded aggregate suitable for compatibility-retirement decisions without returning raw compatibility rows.
 * The observation window describes only persisted compatibility events present in the selected audit tail.
 *
 * @param {McpAuditRuntime} runtime
 * @param {{ tailBytes?: number; maxEvents?: number }} [options]
 */
async function readMcpCompatibilitySummary(runtime, options = {}) {
    const tail = await readMcpAuditEventTail(runtime, options);
    const summary = {
        schemaVersion: MCP_COMPATIBILITY_OBSERVATION_SCHEMA_VERSION,
        event: MCP_COMPATIBILITY_OBSERVATION_EVENT,
        source: {
            ok: tail.ok,
            fileBytes: tail.fileBytes,
            tailBytesRead: tail.tailBytesRead,
            truncatedByBytes: tail.truncatedByBytes,
            scannedAuditEvents: tail.parsedEvents,
            invalidLines: tail.invalidLines,
            error: tail.error,
        },
        observations: 0,
        window: /** @type {{ firstObservedAt: string | null; lastObservedAt: string | null; durationMs: number }} */ ({
            firstObservedAt: null,
            lastObservedAt: null,
            durationMs: 0,
        }),
        protocol: {
            totalRequests: 0,
            byEra: { 2025: 0, 2026: 0 },
            byTransportMode: { 'modern-2026': 0, stateful: 0, 'stateless-fallback': 0 },
            byRpcClass: Object.fromEntries([...COMPATIBILITY_RPC_CLASSES].map((key) => [key, 0])),
            byContinuity: Object.fromEntries([...COMPATIBILITY_CONTINUITY_SIGNALS].map((key) => [key, 0])),
        },
        oauth: {
            clientActivity: {
                total: 0,
                bySource: { cimd: 0, dcr: 0, unknown: 0 },
                byHostClass: { chatgpt: 0, claude: 0, unknown: 0 },
                byActorClass: { consumer: 0, diagnostic: 0, unknown: 0 },
                bySourceAndActorClass: buildCompatibilitySourceActorCounters(),
                successfulByHostClass: { chatgpt: 0, claude: 0, unknown: 0 },
                byResolution: Object.fromEntries([...COMPATIBILITY_CLIENT_RESOLUTIONS].map((key) => [key, 0])),
                byOutcome: { attempted: 0, succeeded: 0, rejected: 0 },
            },
            grants: {
                total: 0,
                byGrantType: { authorization_code: 0, refresh_token: 0 },
                byClientSource: { cimd: 0, dcr: 0, unknown: 0 },
                byHostClass: { chatgpt: 0, claude: 0, unknown: 0 },
                byActorClass: { consumer: 0, diagnostic: 0, unknown: 0 },
                bySourceAndActorClass: buildCompatibilitySourceActorCounters(),
                byOutcome: { attempted: 0, succeeded: 0, rejected: 0 },
            },
        },
    };
    /** @type {number[]} */
    const observedTimes = [];
    for (const event of tail.events) {
        if (
            event['event'] !== MCP_COMPATIBILITY_OBSERVATION_EVENT ||
            !MCP_COMPATIBILITY_OBSERVATION_READABLE_SCHEMA_VERSIONS.includes(Number(event['schemaVersion']))
        ) {
            continue;
        }
        const compatibilityEvent = normalizeReadableCompatibilityEvent(event);
        summary.observations += 1;
        const observedAt = Date.parse(String(event['ts'] ?? ''));
        if (Number.isFinite(observedAt)) observedTimes.push(observedAt);
        if (compatibilityEvent['kind'] === 'protocol-request') {
            summary.protocol.totalRequests += 1;
            incrementSummaryCounter(summary.protocol.byEra, compatibilityEvent['protocolEra']);
            incrementSummaryCounter(summary.protocol.byTransportMode, compatibilityEvent['transportMode']);
            incrementSummaryCounter(summary.protocol.byRpcClass, compatibilityEvent['rpcClass']);
            incrementSummaryCounter(summary.protocol.byContinuity, compatibilityEvent['continuity']);
        } else if (compatibilityEvent['kind'] === 'oauth-client') {
            summary.oauth.clientActivity.total += 1;
            incrementSummaryCounter(summary.oauth.clientActivity.bySource, compatibilityEvent['clientSource']);
            incrementSummaryCounter(summary.oauth.clientActivity.byHostClass, compatibilityEvent['hostClass']);
            incrementSummaryCounter(summary.oauth.clientActivity.byActorClass, compatibilityEvent['actorClass']);
            incrementSourceActorCounter(summary.oauth.clientActivity.bySourceAndActorClass, compatibilityEvent);
            if (compatibilityEvent['outcome'] === 'succeeded') {
                incrementSummaryCounter(
                    summary.oauth.clientActivity.successfulByHostClass,
                    compatibilityEvent['hostClass'],
                );
            }
            incrementSummaryCounter(summary.oauth.clientActivity.byResolution, compatibilityEvent['resolution']);
            incrementSummaryCounter(summary.oauth.clientActivity.byOutcome, compatibilityEvent['outcome']);
        } else if (compatibilityEvent['kind'] === 'oauth-grant') {
            summary.oauth.grants.total += 1;
            incrementSummaryCounter(summary.oauth.grants.byGrantType, compatibilityEvent['grantType']);
            incrementSummaryCounter(summary.oauth.grants.byClientSource, compatibilityEvent['clientSource']);
            incrementSummaryCounter(summary.oauth.grants.byHostClass, compatibilityEvent['hostClass']);
            incrementSummaryCounter(summary.oauth.grants.byActorClass, compatibilityEvent['actorClass']);
            incrementSourceActorCounter(summary.oauth.grants.bySourceAndActorClass, compatibilityEvent);
            incrementSummaryCounter(summary.oauth.grants.byOutcome, compatibilityEvent['outcome']);
        }
    }
    if (observedTimes.length > 0) {
        const firstObservedAt = Math.min(...observedTimes);
        const lastObservedAt = Math.max(...observedTimes);
        summary.window.firstObservedAt = new Date(firstObservedAt).toISOString();
        summary.window.lastObservedAt = new Date(lastObservedAt).toISOString();
        summary.window.durationMs = Math.max(0, lastObservedAt - firstObservedAt);
    }
    return summary;
}

/** Build the fixed client-source × actor-class aggregate shape without retaining client identity. */
function buildCompatibilitySourceActorCounters() {
    return Object.fromEntries(
        COMPATIBILITY_CLIENT_SOURCES.map((source) => [
            source,
            Object.fromEntries(COMPATIBILITY_ACTOR_CLASSES.map((actorClass) => [actorClass, 0])),
        ]),
    );
}

/** @param {Record<string, Record<string, number>>} counters @param {Record<string, unknown>} event */
function incrementSourceActorCounter(counters, event) {
    const source = String(event['clientSource'] ?? 'unknown');
    const actorClass = String(event['actorClass'] ?? 'unknown');
    const row = counters[source];
    if (row && Object.hasOwn(row, actorClass)) row[actorClass] = (row[actorClass] ?? 0) + 1;
}

/**
 * Normalize historical schema-v1 continuity into the era-specific v2 vocabulary. V1 OAuth observations have no
 * actor classification, so they remain `unknown` rather than being retroactively guessed.
 *
 * @param {Record<string, unknown>} event
 */
function normalizeReadableCompatibilityEvent(event) {
    if (Number(event['schemaVersion']) === MCP_COMPATIBILITY_OBSERVATION_SCHEMA_VERSION) return event;
    if (event['kind'] === 'protocol-request') {
        const protocolEra = String(event['protocolEra'] ?? '');
        const rpcClass = String(event['rpcClass'] ?? '');
        const oldContinuity = String(event['continuity'] ?? 'none');
        let continuity = 'none';
        if (protocolEra === '2026' && rpcClass === 'subscriptions-listen' && oldContinuity === 'stream-open') {
            continuity = 'modern-subscription-open';
        } else if (protocolEra === '2025' && oldContinuity === 'stream-open') {
            continuity = 'legacy-stream-open';
        } else if (protocolEra === '2025' && oldContinuity === 'stream-resume') {
            continuity = 'legacy-stream-resume';
        }
        return { ...event, continuity };
    }
    if (event['kind'] === 'oauth-client' || event['kind'] === 'oauth-grant') {
        return { ...event, actorClass: 'unknown' };
    }
    return event;
}

/**
 * @param {Record<string, number>} counters
 * @param {unknown} key
 */
function incrementSummaryCounter(counters, key) {
    const normalized = String(key ?? '');
    if (Object.hasOwn(counters, normalized)) counters[normalized] = (counters[normalized] ?? 0) + 1;
}

/**
 * Flush all queued MCP audit events and wait for prior persistence.
 *
 * @param {McpAuditRuntime} runtime
 * @returns {Promise<void>}
 */
async function flushMcpAuditEvents(runtime) {
    await runtime.writer.flush();
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}
