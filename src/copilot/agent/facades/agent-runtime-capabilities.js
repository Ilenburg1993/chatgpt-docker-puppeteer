// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-capabilities
 * @file Façade canônica de leitura das capabilities públicas do runtime do agent.
 *
 *   Esta fachada fica no domínio do runtime e não conhece HTTP, terminal ou layout de UI. Bordas devem consumir a
 *   projection em `presentation/`, mas a leitura semântica do que o agent sabe fazer nasce aqui.
 */

import { readAgentRuntimeHealthSnapshot, readAgentRuntimeStatusSnapshot } from './agent-runtime-status.js';

/**
 * @typedef {import('../types.js').IAlwaysAliveAgent & {
 *     listWebhooks?: () => unknown[];
 *     getHandoffManager?: () => unknown;
 * }} CapabilityAgent
 */

/**
 * @typedef {'ready' | 'degraded' | 'unavailable' | 'unknown'} AgentRuntimeCapabilityState
 */

/**
 * @typedef {{
 *     id: string;
 *     title: string;
 *     layer: 'runtime' | 'sdk' | 'dialog' | 'integration' | 'governance' | 'observability' | 'recovery';
 *     available: boolean;
 *     state: AgentRuntimeCapabilityState;
 *     degraded: boolean;
 *     reason?: string;
 *     details?: Record<string, unknown>;
 * }} AgentRuntimeCapability
 */

/**
 * @typedef {{
 *     capabilityCount: number;
 *     readyCount: number;
 *     degradedCount: number;
 *     unavailableCount: number;
 *     capabilities: Record<string, AgentRuntimeCapability>;
 *     list: AgentRuntimeCapability[];
 * }} AgentRuntimeCapabilitiesSnapshot
 */

/**
 * @typedef {{
 *     healthSnapshot?: import('../types.js').AgentHealthSnapshot | Record<string, unknown> | null;
 * }} AgentRuntimeCapabilitiesOptions
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asRecord(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {Record<string, unknown> | null} root
 * @param {string[]} path
 * @returns {unknown}
 */
function readPath(root, path) {
    /** @type {unknown} */
    let current = root;
    for (const segment of path) {
        const record = asRecord(current);
        if (!record || !(segment in record)) return undefined;
        current = record[segment];
    }
    return current;
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function readBoolean(value) {
    return typeof value === 'boolean' ? value : null;
}

/**
 * @param {string} id
 * @param {AgentRuntimeCapability['title']} title
 * @param {AgentRuntimeCapability['layer']} layer
 * @param {boolean} available
 * @param {AgentRuntimeCapabilityState} state
 * @param {{ reason?: string; details?: Record<string, unknown> }} [options]
 * @returns {AgentRuntimeCapability}
 */
function capability(id, title, layer, available, state, options = {}) {
    return {
        id,
        title,
        layer,
        available,
        state,
        degraded: state === 'degraded',
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.details ? { details: options.details } : {}),
    };
}

/**
 * @param {boolean | null} ok
 * @param {boolean} available
 * @returns {AgentRuntimeCapabilityState}
 */
function stateFromCheck(ok, available) {
    if (!available) return 'unavailable';
    if (ok === false) return 'degraded';
    if (ok === true) return 'ready';
    return 'unknown';
}

/**
 * @param {CapabilityAgent} agent
 * @param {AgentRuntimeCapabilitiesOptions} [options]
 * @returns {AgentRuntimeCapabilitiesSnapshot}
 */
export function readAgentRuntimeCapabilities(agent, options = {}) {
    const snap = readAgentRuntimeStatusSnapshot(agent);
    const health = asRecord(options.healthSnapshot ?? readAgentRuntimeHealthSnapshot(agent));
    const checks = asRecord(health?.['checks']);
    const sdkSnapshot = typeof agent.getSdkResourceSnapshot === 'function' ? agent.getSdkResourceSnapshot() : null;
    const sdkResources = asRecord(sdkSnapshot);
    const sdkResourceFlags = asRecord(sdkResources?.['resources']);
    const missingResources = Array.isArray(sdkResources?.['missingResources'])
        ? /** @type {unknown[]} */ (sdkResources['missingResources']).filter((item) => typeof item === 'string')
        : [];
    const permissionMode =
        typeof agent.getPermissionMode === 'function'
            ? agent.getPermissionMode()
            : typeof snap['permissionMode'] === 'string'
              ? snap['permissionMode']
              : 'approve_all';
    const webhookCount = typeof agent.listWebhooks === 'function' ? agent.listWebhooks().length : null;
    const hasHandoffManager = typeof agent.getHandoffManager === 'function';

    const runtimeOk = readBoolean(readPath(checks, ['runtime', 'ok']));
    const sessionOk = readBoolean(readPath(checks, ['session', 'ok']));
    const clientOk = readBoolean(readPath(checks, ['client', 'ok']));
    const dialogOk = readBoolean(readPath(checks, ['dialog', 'ok']));
    const queueOk = readBoolean(readPath(checks, ['queue', 'ok']));
    const ioOk = readBoolean(readPath(checks, ['io', 'ok']));
    const bootOk = readBoolean(readPath(checks, ['boot', 'ok']));
    const sdkOk = readBoolean(readPath(checks, ['sdkResources', 'ok']));
    const quotaOk = readBoolean(readPath(checks, ['quota', 'ok']));

    /** @type {AgentRuntimeCapability[]} */
    const list = [
        capability('runtime.lifecycle', 'Runtime lifecycle', 'runtime', true, stateFromCheck(runtimeOk, true), {
            details: {
                status: snap['status'] ?? health?.['agentStatus'] ?? 'unknown',
                startedAt: snap['startedAt'] ?? null,
            },
        }),
        capability('runtime.queue', 'Execution queue', 'runtime', true, stateFromCheck(queueOk, true), {
            details: {
                queueSize: snap['queueSize'] ?? 0,
                oldestTaskWaitMs: snap['oldestTaskWaitMs'] ?? 0,
                starvationAlert: Boolean(snap['starvationAlert']),
            },
        }),
        capability('sdk.client', 'SDK client', 'sdk', true, stateFromCheck(clientOk, true), {
            details: {
                missingResources,
                allCoreResourcesAvailable: sdkResources?.['allCoreResourcesAvailable'] ?? null,
            },
        }),
        capability('sdk.session', 'SDK session', 'sdk', true, stateFromCheck(sessionOk, true), {
            details: {
                sessionId: snap['sessionId'] ?? null,
                isResumed: Boolean(snap['isResumed']),
                resumeCount: Number(snap['resumeCount'] ?? 0),
            },
        }),
        capability(
            'sdk.resources',
            'SDK resource coverage',
            'sdk',
            sdkResources !== null,
            stateFromCheck(sdkOk, sdkResources !== null),
            {
                details: {
                    missingResources,
                    allRuntimeResourcesAvailable: sdkResources?.['allRuntimeResourcesAvailable'] ?? null,
                    resources: sdkResourceFlags ?? null,
                },
            },
        ),
        capability(
            'dialog.loop',
            'Dialog loop',
            'dialog',
            typeof agent.startDialogLoop === 'function',
            stateFromCheck(dialogOk, typeof agent.startDialogLoop === 'function'),
            {
                details: {
                    active: Boolean(agent.dialogLoopActive),
                    paused: Boolean(agent.dialogPaused),
                    pendingQuestion: Boolean(health?.['pendingQuestion']),
                    pendingQuestionKind: health?.['pendingQuestionKind'] ?? null,
                },
            },
        ),
        capability('io.pending-question', 'Pending question IO', 'dialog', true, stateFromCheck(ioOk, true), {
            details: {
                pendingQuestionShadow: Boolean(health?.['pendingQuestionShadow']),
                pendingQuestionShadowState: health?.['pendingQuestionShadowState'] ?? null,
                pendingQuestionShadowExpired: Boolean(health?.['pendingQuestionShadowExpired']),
            },
        }),
        capability(
            'governance.permissions',
            'Permission policy',
            'governance',
            typeof agent.getPermissionMode === 'function',
            typeof agent.getPermissionMode === 'function' ? 'ready' : 'unknown',
            {
                details: { mode: permissionMode },
            },
        ),
        capability(
            'integration.webhooks',
            'Outbound webhooks',
            'integration',
            typeof agent.listWebhooks === 'function',
            typeof agent.listWebhooks === 'function' ? 'ready' : 'unknown',
            {
                details: { registered: webhookCount },
            },
        ),
        capability(
            'integration.handoff',
            'Runtime handoff',
            'integration',
            hasHandoffManager,
            hasHandoffManager ? 'ready' : 'unknown',
        ),
        capability(
            'observability.health',
            'Runtime health',
            'observability',
            true,
            health?.['ok'] === false ? 'degraded' : 'ready',
            {
                details: {
                    status: health?.['status'] ?? 'unknown',
                    riskFlags: Array.isArray(health?.['riskFlags']) ? health?.['riskFlags'] : [],
                    recommendedAction: health?.['recommendedAction'] ?? 'none',
                },
            },
        ),
        capability('observability.quota', 'Quota monitor', 'observability', true, stateFromCheck(quotaOk, true), {
            details: {
                running: readPath(checks, ['quota', 'running']) ?? null,
                configured: readPath(checks, ['quota', 'configured']) ?? null,
            },
        }),
        capability('recovery.boot', 'Boot recovery report', 'recovery', true, stateFromCheck(bootOk, true), {
            details: {
                reportAvailable: readPath(checks, ['boot', 'reportAvailable']) ?? null,
                failedSteps: readPath(checks, ['boot', 'failedSteps']) ?? null,
                degradedSteps: readPath(checks, ['boot', 'degradedSteps']) ?? null,
            },
        }),
    ];

    /** @type {Record<string, AgentRuntimeCapability>} */
    const capabilities = {};
    for (const item of list) {
        capabilities[item.id] = item;
    }

    return {
        capabilityCount: list.length,
        readyCount: list.filter((item) => item.state === 'ready').length,
        degradedCount: list.filter((item) => item.state === 'degraded').length,
        unavailableCount: list.filter((item) => item.state === 'unavailable').length,
        capabilities,
        list,
    };
}
