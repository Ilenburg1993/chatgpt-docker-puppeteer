// @ts-check
/**
 * Process-local MCP descriptor-observation evidence.
 *
 * The server owns descriptor truth while the HTTP adapter can observe client tools/list requests. Keeping this state in
 * the protocol catalog avoids a server -> registry -> tools -> server dependency cycle and makes origin descriptor observation explicit
 * without assuming that a server restart forces a client-side schema refresh or changes ChatGPT administrative state.
 *
 * @module copilot/mcp/protocol/catalog/descriptor-observation
 */

import { randomUUID } from 'node:crypto';

export const MCP_DESCRIPTOR_OBSERVATION_VERSION = 2;

/** @typedef {'uninitialized'
    | 'not-listed-this-generation'
    | 'listed-this-generation'
    | 'descriptor-changed-unlisted'
    | 'notification-sent-unlisted'} McpDescriptorObservationStatus */

const runtimeEpoch = randomUUID();

const state = {
    descriptorRevision: 0,
    descriptorObservations: 0,
    currentDescriptorFingerprint: /** @type {string | null} */ (null),
    previousDescriptorFingerprint: /** @type {string | null} */ (null),
    descriptorSinceAtMs: /** @type {number | null} */ (null),
    lastDescriptorObservedAtMs: /** @type {number | null} */ (null),
    currentToolCount: 0,
    listChangedAdvertised: false,
    toolsListObservedCount: 0,
    lastToolsListObservedAtMs: /** @type {number | null} */ (null),
    lastToolsListProtocolVersion: /** @type {string | null} */ (null),
    listChangedAttemptCount: 0,
    lastNotificationAttemptRevision: 0,
    listChangedSentCount: 0,
    lastListChangedSentAtMs: /** @type {number | null} */ (null),
    listChangedErrorCount: 0,
    lastListChangedError: /** @type {string | null} */ (null),
};

/**
 * @param {{ fingerprint: string; toolCount: number; listChangedAdvertised: boolean; observedAtMs?: number }} input
 */
export function recordMcpDescriptorObservation(input) {
    const fingerprint = String(input.fingerprint ?? '').trim();
    if (!fingerprint) return readMcpDescriptorObservationState();
    const observedAtMs = normalizeObservedAt(input.observedAtMs);
    const changed = state.currentDescriptorFingerprint !== fingerprint;
    state.descriptorObservations += 1;
    state.lastDescriptorObservedAtMs = observedAtMs;
    state.currentToolCount = normalizeNonNegativeInteger(input.toolCount);
    state.listChangedAdvertised = input.listChangedAdvertised === true;
    if (changed) {
        state.previousDescriptorFingerprint = state.currentDescriptorFingerprint;
        state.currentDescriptorFingerprint = fingerprint;
        state.descriptorRevision += 1;
        state.descriptorSinceAtMs = observedAtMs;
    }
    return readMcpDescriptorObservationState();
}

/**
 * @param {{ protocolVersion?: string | null; observedAtMs?: number }} [input]
 */
export function recordMcpToolsListObserved(input = {}) {
    const observedAtMs = normalizeObservedAt(input.observedAtMs);
    state.toolsListObservedCount += 1;
    state.lastToolsListObservedAtMs = observedAtMs;
    state.lastToolsListProtocolVersion = normalizeProtocolVersion(input.protocolVersion);
    return readMcpDescriptorObservationState();
}

/**
 * Reserve evidence for the controlled list-changed rollout. Calling this function does not itself send a notification.
 *
 * @param {{ sent: boolean; error?: unknown; observedAtMs?: number }} input
 */
export function recordMcpToolsListChangedNotification(input) {
    const observedAtMs = normalizeObservedAt(input.observedAtMs);
    state.listChangedAttemptCount += 1;
    state.lastNotificationAttemptRevision = state.descriptorRevision;
    if (input.sent) {
        state.listChangedSentCount += 1;
        state.lastListChangedSentAtMs = observedAtMs;
        state.lastListChangedError = null;
    } else if (input.error !== undefined && input.error !== null) {
        state.listChangedErrorCount += 1;
        state.lastListChangedError = String(input.error).slice(0, 240);
    }
    return readMcpDescriptorObservationState();
}

/** Return true only once per descriptor revision while the current list remains unverified by an observed tools/list. */
export function shouldSendMcpToolsListChangedNotification() {
    if (!state.listChangedAdvertised || state.descriptorRevision <= 0 || state.descriptorSinceAtMs === null)
        return false;
    if (state.lastToolsListObservedAtMs !== null && state.lastToolsListObservedAtMs >= state.descriptorSinceAtMs) {
        return false;
    }
    return state.lastNotificationAttemptRevision !== state.descriptorRevision;
}

/**
 * Send a single non-blocking schema-refresh nudge for the current descriptor revision. The caller should invoke this
 * only after MCP initialize completed; all errors are captured as evidence.
 *
 * @param {unknown} server
 * @returns {Promise<{ attempted: boolean; sent: boolean; reason: string; error?: string }>}
 */
export async function maybeSendMcpToolsListChangedNotification(server) {
    if (!shouldSendMcpToolsListChangedNotification()) {
        return { attempted: false, sent: false, reason: 'not-needed' };
    }

    // Reserve this revision before awaiting so simultaneous initializes cannot fan out duplicate notifications.
    state.lastNotificationAttemptRevision = state.descriptorRevision;
    state.listChangedAttemptCount += 1;
    const candidate =
        server && typeof server === 'object'
            ? /** @type {Record<string, unknown>} */ (server)['sendToolListChanged']
            : null;
    if (typeof candidate !== 'function') {
        const error = 'MCP server does not expose sendToolListChanged().';
        state.listChangedErrorCount += 1;
        state.lastListChangedError = error;
        return { attempted: true, sent: false, reason: 'sdk-method-unavailable', error };
    }

    try {
        await candidate.call(server);
        state.listChangedSentCount += 1;
        state.lastListChangedSentAtMs = Date.now();
        state.lastListChangedError = null;
        return { attempted: true, sent: true, reason: 'sent' };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.listChangedErrorCount += 1;
        state.lastListChangedError = message.slice(0, 240);
        return { attempted: true, sent: false, reason: 'send-failed', error: state.lastListChangedError };
    }
}

/**
 * @returns {{
 *     schemaVersion: number;
 *     scope: 'origin-mcp-descriptor-observation';
 *     chatgptActionSnapshot: { observableFromOrigin: false; status: 'external-admin-state'; refreshBoundary: string; inferenceBoundary: string };
 *     runtimeEpoch: string;
 *     status: McpDescriptorObservationStatus;
 *     descriptorRevision: number;
 *     descriptorObservations: number;
 *     currentDescriptorFingerprint: string | null;
 *     previousDescriptorFingerprint: string | null;
 *     descriptorSinceAt: string | null;
 *     lastDescriptorObservedAt: string | null;
 *     currentToolCount: number;
 *     listChangedAdvertised: boolean;
 *     toolsListObservedCount: number;
 *     lastToolsListObservedAt: string | null;
 *     lastToolsListProtocolVersion: string | null;
 *     listChangedAttemptCount: number;
 *     lastNotificationAttemptRevision: number;
 *     listChangedSentCount: number;
 *     lastListChangedSentAt: string | null;
 *     listChangedErrorCount: number;
 *     lastListChangedError: string | null;
 * }}
 */
export function readMcpDescriptorObservationState() {
    return {
        schemaVersion: MCP_DESCRIPTOR_OBSERVATION_VERSION,
        scope: /** @type {const} */ ('origin-mcp-descriptor-observation'),
        chatgptActionSnapshot: {
            observableFromOrigin: /** @type {const} */ (false),
            status: /** @type {const} */ ('external-admin-state'),
            refreshBoundary:
                'ChatGPT action/tool changes are governed by the host administrative Refresh/review lifecycle, not by origin tools/list observation alone.',
            inferenceBoundary:
                'A tools/list observation proves only MCP descriptor retrieval by a client request reaching this origin; it does not prove the approved ChatGPT action snapshot changed.',
        },
        runtimeEpoch,
        status: classifyMcpDescriptorObservationStatus(),
        descriptorRevision: state.descriptorRevision,
        descriptorObservations: state.descriptorObservations,
        currentDescriptorFingerprint: state.currentDescriptorFingerprint,
        previousDescriptorFingerprint: state.previousDescriptorFingerprint,
        descriptorSinceAt: toIso(state.descriptorSinceAtMs),
        lastDescriptorObservedAt: toIso(state.lastDescriptorObservedAtMs),
        currentToolCount: state.currentToolCount,
        listChangedAdvertised: state.listChangedAdvertised,
        toolsListObservedCount: state.toolsListObservedCount,
        lastToolsListObservedAt: toIso(state.lastToolsListObservedAtMs),
        lastToolsListProtocolVersion: state.lastToolsListProtocolVersion,
        listChangedAttemptCount: state.listChangedAttemptCount,
        lastNotificationAttemptRevision: state.lastNotificationAttemptRevision,
        listChangedSentCount: state.listChangedSentCount,
        lastListChangedSentAt: toIso(state.lastListChangedSentAtMs),
        listChangedErrorCount: state.listChangedErrorCount,
        lastListChangedError: state.lastListChangedError,
    };
}

/** Test-only reset; runtimeEpoch intentionally remains process-stable. */
export function resetMcpDescriptorObservationStateForTests() {
    state.descriptorRevision = 0;
    state.descriptorObservations = 0;
    state.currentDescriptorFingerprint = null;
    state.previousDescriptorFingerprint = null;
    state.descriptorSinceAtMs = null;
    state.lastDescriptorObservedAtMs = null;
    state.currentToolCount = 0;
    state.listChangedAdvertised = false;
    state.toolsListObservedCount = 0;
    state.lastToolsListObservedAtMs = null;
    state.lastToolsListProtocolVersion = null;
    state.listChangedAttemptCount = 0;
    state.lastNotificationAttemptRevision = 0;
    state.listChangedSentCount = 0;
    state.lastListChangedSentAtMs = null;
    state.listChangedErrorCount = 0;
    state.lastListChangedError = null;
}

/** @returns {McpDescriptorObservationStatus} */
function classifyMcpDescriptorObservationStatus() {
    if (!state.currentDescriptorFingerprint || state.descriptorSinceAtMs === null) return 'uninitialized';
    if (state.lastToolsListObservedAtMs !== null && state.lastToolsListObservedAtMs >= state.descriptorSinceAtMs) {
        return 'listed-this-generation';
    }
    if (state.lastListChangedSentAtMs !== null && state.lastListChangedSentAtMs >= state.descriptorSinceAtMs) {
        return 'notification-sent-unlisted';
    }
    return state.descriptorRevision > 1 ? 'descriptor-changed-unlisted' : 'not-listed-this-generation';
}

/** @param {unknown} value */
function normalizeNonNegativeInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** @param {unknown} value */
function normalizeObservedAt(value) {
    const parsed = Number(value ?? Date.now());
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : Date.now();
}

/** @param {unknown} value */
function normalizeProtocolVersion(value) {
    const normalized = String(value ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/u.test(normalized) ? normalized : null;
}

/** @param {number | null} value */
function toIso(value) {
    return value === null ? null : new Date(value).toISOString();
}
