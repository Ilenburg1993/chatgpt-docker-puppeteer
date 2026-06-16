// @ts-check
/**
 * Transactional route/provider rebind that preserves the current SDK session identity.
 *
 * The SDK adapter may disconnect and resume the session internally, but returning a different sessionId is always a
 * failed operation. New-session creation is deliberately outside this service.
 *
 * @module copilot/model-gateway/control-plane/same-session-route-switch
 */

import { createHash, randomUUID } from 'node:crypto';

export const MODEL_GATEWAY_SAME_SESSION_ROUTE_SWITCH_DEFAULT_TIMEOUT_MS = 45_000;

/**
 * @param {string} idempotencyKey
 */
export function createModelGatewaySameSessionRouteSwitchOperationId(idempotencyKey) {
    return `same-session-route-switch:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
}

/**
 * @param {unknown} error
 */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/**
 * @template T
 * @param {Promise<T>} task
 * @param {number} timeoutMs
 * @param {string} phase
 */
function withTimeout(task, timeoutMs, phase) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`SAME_SESSION_ROUTE_SWITCH_TIMEOUT: phase=${phase} timeoutMs=${timeoutMs}`)),
            timeoutMs,
        );
        task.then(resolve, reject).finally(() => clearTimeout(timer));
    });
}

/**
 * @param {object} input
 * @param {string} input.sessionId
 * @param {Record<string, unknown>} input.previousRoute
 * @param {Record<string, unknown>} input.targetRoute
 * @param {string} [input.idempotencyKey]
 * @param {number} [input.timeoutMs]
 * @param {(route: Record<string, unknown>, sessionId: string) => Promise<{ sessionId: string; session: unknown }>} input.reattach
 * @param {(session: unknown, route: Record<string, unknown>) => Promise<boolean>} input.verify
 * @param {(session: unknown, route: Record<string, unknown>) => Promise<void>} input.commit
 * @param {(operation: Record<string, unknown>) => Promise<void>} [input.record]
 * @param {() => number} [input.now]
 * @param {string} [input.deferReason]
 * @param {Record<string, unknown>} [input.deferDetails]
 */
export async function executeModelGatewaySameSessionRouteSwitch(input) {
    const now = input.now ?? Date.now;
    const timeoutMs =
        typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
            ? Math.floor(input.timeoutMs)
            : MODEL_GATEWAY_SAME_SESSION_ROUTE_SWITCH_DEFAULT_TIMEOUT_MS;
    const operationId = input.idempotencyKey
        ? createModelGatewaySameSessionRouteSwitchOperationId(input.idempotencyKey)
        : `same-session-route-switch:${randomUUID()}`;
    const record = input.record ?? (async () => undefined);
    /** @type {Array<Record<string, unknown>>} */
    const transitions = [];
    /** @type {Record<string, unknown>} */
    const operation = {
        schemaVersion: 'model-gateway.same-session-route-switch.v1',
        operationId,
        idempotencyKey: input.idempotencyKey ?? operationId,
        sessionId: input.sessionId,
        previousRoute: input.previousRoute,
        targetRoute: input.targetRoute,
        state: 'planned',
        verified: false,
        rollback: null,
        error: null,
        requiresNewSession: false,
        reconciliationRequired: false,
        timeoutMs,
        transitions,
        createdAt: new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
    };
    let targetReattachStarted = false;
    /**
     * @param {string} state
     * @param {Record<string, unknown>} [details]
     */
    const transition = async (state, details = {}) => {
        const timestamp = new Date(now()).toISOString();
        operation['state'] = state;
        operation['updatedAt'] = timestamp;
        Object.assign(operation, details);
        transitions.push({ state, timestamp, ...details });
        await record({ ...operation, transitions: [...transitions] });
    };
    try {
        await transition('planned');
        if (input.deferReason) {
            await transition('deferred_until_turn_boundary', {
                deferred: true,
                deferReason: input.deferReason,
                deferDetails: input.deferDetails ?? {},
                retryable: true,
                rollback: {
                    attempted: false,
                    reason: 'target_route_not_applied',
                },
                reconciliationRequired: false,
            });
            return { ...operation, transitions: [...transitions] };
        }
        await transition('reattach_requested');
        targetReattachStarted = true;
        const target = await withTimeout(input.reattach(input.targetRoute, input.sessionId), timeoutMs, 'reattach_target');
        if (target.sessionId !== input.sessionId) {
            throw new Error(
                `SAME_SESSION_IDENTITY_CHANGED: expected='${input.sessionId}' actual='${target.sessionId}'`,
            );
        }
        await transition('reattached');
        const verified = await withTimeout(input.verify(target.session, input.targetRoute), timeoutMs, 'verify_target');
        if (!verified) throw new Error('SAME_SESSION_ROUTE_SWITCH_NOT_VERIFIED');
        await transition('verified', { verified: true });
        await input.commit(target.session, input.targetRoute);
        await transition('committed');
        return { ...operation, transitions: [...transitions] };
    } catch (error) {
        const failure = errorMessage(error);
        operation['error'] = failure;
        if (!targetReattachStarted) {
            operation['rollback'] = {
                attempted: false,
                reason: 'target_route_not_applied',
            };
            await transition('failed', {
                verified: false,
                error: failure,
                rollback: operation['rollback'],
                reconciliationRequired: false,
            });
            return { ...operation, transitions: [...transitions] };
        }
        const targetOutcomeUnknown = failure.startsWith(
            'SAME_SESSION_ROUTE_SWITCH_TIMEOUT: phase=reattach_target ',
        );
        operation['reconciliationRequired'] = targetOutcomeUnknown;
        if (targetOutcomeUnknown) {
            operation['rollback'] = {
                attempted: false,
                reason: 'target_reattach_outcome_unknown',
            };
            await transition('failed', {
                verified: false,
                error: failure,
                rollback: operation['rollback'],
                reconciliationRequired: true,
            });
            return { ...operation, transitions: [...transitions] };
        }
        try {
            const previous = await withTimeout(
                input.reattach(input.previousRoute, input.sessionId),
                timeoutMs,
                'reattach_previous',
            );
            const rollbackVerified =
                previous.sessionId === input.sessionId &&
                (await withTimeout(input.verify(previous.session, input.previousRoute), timeoutMs, 'verify_previous'));
            operation['rollback'] = { sessionId: previous.sessionId, verified: rollbackVerified };
            if (rollbackVerified) {
                await input.commit(previous.session, input.previousRoute);
                await transition('rolled_back', { verified: false, reconciliationRequired: false });
                return { ...operation, transitions: [...transitions] };
            }
        } catch (rollbackError) {
            operation['rollback'] = { verified: false, error: errorMessage(rollbackError) };
        }
        await transition('failed', { verified: false, error: failure, rollback: operation['rollback'] });
        return { ...operation, transitions: [...transitions] };
    }
}
