// @ts-check

import { SqliteModelGatewayCatalogStore } from '../catalog/sqlite-catalog-store.js';
import { assertModelGatewayOperationStorePort, assertModelGatewaySessionRoutePort } from './ports.js';
import {
    createModelGatewaySameSessionRouteSwitchOperationId,
    executeModelGatewaySameSessionRouteSwitch,
} from './same-session-route-switch.js';
import { createSqliteSameSessionRouteSwitchRecorder } from './sqlite-same-session-route-switch-recorder.js';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} left
 * @param {Record<string, unknown>} right
 */
function sameRouteIdentity(left, right) {
    const fields = [
        'providerId',
        'providerModel',
        'selectorSyntax',
        'baseUrl',
        'openAICompatibleBaseUrl',
        'wireApi',
        'providerProfile',
        'routeProfile',
        'selectedRouteKey',
    ];
    return fields.every((field) => String(left[field] ?? '') === String(right[field] ?? ''));
}

/**
 * @param {Record<string, unknown>} operation
 * @param {{ sessionId: string; targetRoute: Record<string, unknown>; forceApplyDeferred?: boolean | undefined }} input
 */
function canReplayRouteSwitchOperation(operation, input) {
    if (typeof operation['operationId'] !== 'string' || typeof operation['idempotencyKey'] !== 'string') return false;
    if (typeof operation['sessionId'] !== 'string' || operation['sessionId'] !== input.sessionId) return false;
    if (typeof operation['state'] !== 'string' || !Array.isArray(operation['transitions'])) return false;
    if (!isRecord(operation['previousRoute']) || !isRecord(operation['targetRoute'])) return false;
    const targetRoute = operation['targetRoute'];
    if (!sameRouteIdentity(targetRoute, input.targetRoute)) return false;
    if (operation['state'] === 'deferred_until_turn_boundary' && input.forceApplyDeferred === true) return false;
    return (
        operation['state'] === 'committed' ||
        operation['state'] === 'rolled_back' ||
        operation['state'] === 'failed' ||
        operation['state'] === 'deferred_until_turn_boundary'
    );
}

/**
 * @template {{ sessionId: string }} TSession
 * @param {object} input
 * @param {string} input.sessionId
 * @param {Record<string, unknown>} input.previousRoute
 * @param {Record<string, unknown>} input.targetRoute
 * @param {string} [input.idempotencyKey]
 * @param {number} [input.timeoutMs]
 * @param {(route: Record<string, unknown>) => Promise<TSession>} input.reattach
 * @param {(session: TSession, route: Record<string, unknown>) => Promise<boolean>} input.verify
 * @param {(session: TSession, route: Record<string, unknown>) => Promise<void>} input.commit
 * @param {SqliteModelGatewayCatalogStore} [input.store]
 * @param {string} [input.source]
 * @param {string} [input.deferReason]
 * @param {Record<string, unknown>} [input.deferDetails]
 * @param {boolean} [input.forceApplyDeferred]
 * @returns {Promise<import('./same-session-route-switch.js').ModelGatewaySameSessionRouteSwitchResult>}
 */
export async function executeModelGatewayRuntimeRouteSwitch(input) {
    const store = /** @type {SqliteModelGatewayCatalogStore} */ (
        assertModelGatewayOperationStorePort(input.store ?? new SqliteModelGatewayCatalogStore())
    );
    const sessionPort = assertModelGatewaySessionRoutePort(input);
    const operationId = input.idempotencyKey
        ? createModelGatewaySameSessionRouteSwitchOperationId(input.idempotencyKey)
        : null;
    if (operationId) {
        const existing = await store.readSdkSessionHandoffRecord(operationId);
        const existingOperation = isRecord(existing?.['operation']) ? existing['operation'] : null;
        if (existingOperation && canReplayRouteSwitchOperation(existingOperation, input)) {
            return /** @type {import('./same-session-route-switch.js').ModelGatewaySameSessionRouteSwitchResult} */ ({
                ...existingOperation,
                replayed: true,
            });
        }
    }
    return executeModelGatewaySameSessionRouteSwitch({
        sessionId: input.sessionId,
        previousRoute: input.previousRoute,
        targetRoute: input.targetRoute,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.deferReason ? { deferReason: input.deferReason } : {}),
        ...(input.deferDetails ? { deferDetails: input.deferDetails } : {}),
        reattach: async (route) => {
            const session = await sessionPort.reattach(route);
            return { sessionId: session.sessionId, session };
        },
        verify: async (session, route) => sessionPort.verify(session, route),
        commit: async (session, route) => sessionPort.commit(session, route),
        record: createSqliteSameSessionRouteSwitchRecorder({
            store,
            sessionId: input.sessionId,
            ...(input.source ? { source: input.source } : {}),
        }),
    });
}
