// @ts-check

import { SqliteModelGatewayCatalogStore } from '../catalog/sqlite-catalog-store.js';

/**
 * @param {{ store?: SqliteModelGatewayCatalogStore; sessionId: string; source?: string }} options
 */
export function createSqliteSameSessionRouteSwitchRecorder(options) {
    const store = options.store ?? new SqliteModelGatewayCatalogStore();
    const source = options.source ?? 'model-gateway.same-session-route-switch';
    /**
     * @param {Record<string, unknown>} operation
     */
    return async (operation) => {
        const operationId = String(operation['operationId'] ?? '');
        const state = String(operation['state'] ?? 'unknown');
        const targetRoute =
            operation['targetRoute'] && typeof operation['targetRoute'] === 'object'
                ? /** @type {Record<string, unknown>} */ (operation['targetRoute'])
                : {};
        const previousRoute =
            operation['previousRoute'] && typeof operation['previousRoute'] === 'object'
                ? /** @type {Record<string, unknown>} */ (operation['previousRoute'])
                : {};
        const targetProviderId = String(targetRoute['providerId'] ?? 'unknown');
        const previousProviderId = String(previousRoute['providerId'] ?? 'unknown');
        const targetModel = String(targetRoute['providerModel'] ?? targetRoute['selectorSyntax'] ?? 'unknown');
        const previousModel = String(previousRoute['providerModel'] ?? previousRoute['selectorSyntax'] ?? 'unknown');
        const bindingStrategy = String(targetRoute['bindingStrategy'] ?? 'direct');
        const wireApi = typeof targetRoute['wireApi'] === 'string' ? targetRoute['wireApi'] : null;
        const selectedRouteKey =
            typeof targetRoute['selectedRouteKey'] === 'string' ? targetRoute['selectedRouteKey'] : null;
        const updatedAt = String(operation['updatedAt'] ?? new Date().toISOString());
        await store.writeSdkSessionHandoffRecords([
            {
                handoffId: operationId,
                decisionId: operationId,
                routeProfile: targetRoute['routeProfile'] ?? null,
                selectedRouteKey: targetRoute['selectedRouteKey'] ?? null,
                status: state,
                sessionId: options.sessionId,
                targetModel,
                requestedAt: operation['createdAt'],
                confirmedAt: state === 'committed' || state === 'rolled_back' ? updatedAt : null,
                source,
                operation,
            },
        ]);
        if (state === 'verified' || state === 'rolled_back' || state === 'failed') {
            await store.writeSdkSessionConfirmationRecords([
                {
                    confirmationId: `${operationId}:${state}`,
                    handoffId: operationId,
                    decisionId: operationId,
                    sessionId: options.sessionId,
                    previousProviderId,
                    providerId: targetProviderId,
                    targetProviderId,
                    confirmedProviderId: state === 'rolled_back' ? previousProviderId : targetProviderId,
                    previousModel,
                    confirmedModel: state === 'rolled_back' ? previousModel : targetModel,
                    bindingStrategy,
                    wireApi,
                    selectedRouteKey,
                    operationState: state,
                    error: operation['error'] ?? null,
                    status:
                        state === 'verified'
                            ? 'route_confirmed_same_session'
                            : state === 'rolled_back'
                              ? 'route_rollback_confirmed_same_session'
                              : 'route_switch_failed_same_session',
                    observedAt: updatedAt,
                    source,
                },
            ]);
        }
    };
}
