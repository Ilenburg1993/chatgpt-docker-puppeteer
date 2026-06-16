// @ts-check
/**
 * Durable recorder for transactional model switches.
 *
 * @module copilot/model-gateway/control-plane/sqlite-model-switch-recorder
 */

import { SqliteModelGatewayCatalogStore } from '../catalog/sqlite-catalog-store.js';

/**
 * @param {{ store?: SqliteModelGatewayCatalogStore; sessionId?: string | null; source?: string }} [options]
 */
export function createSqliteModelGatewayModelSwitchRecorder(options = {}) {
    const store = options.store ?? new SqliteModelGatewayCatalogStore();
    const source = options.source ?? 'model-gateway.control-plane';
    /**
     * @param {Record<string, unknown>} operation
     * @returns {Promise<void>}
     */
    return async (operation) => {
        const operationId = String(operation['operationId'] ?? '');
        const state = String(operation['state'] ?? 'unknown');
        const targetModel = String(operation['targetModel'] ?? 'unknown');
        const previousModel = String(operation['previousModel'] ?? 'unknown');
        const updatedAt = String(operation['updatedAt'] ?? new Date().toISOString());
        await store.writeSdkSessionHandoffRecords([
            {
                handoffId: operationId,
                decisionId: operationId,
                status: state,
                sessionId: options.sessionId ?? null,
                targetModel,
                requestedAt: operation['createdAt'],
                confirmedAt: state === 'committed' || state === 'rolled_back' ? updatedAt : null,
                source,
                operation,
            },
        ]);
        if (state === 'verified' || state === 'rolled_back' || state === 'failed') {
            const rollback =
                operation['rollback'] && typeof operation['rollback'] === 'object'
                    ? /** @type {Record<string, unknown>} */ (operation['rollback'])
                    : null;
            await store.writeSdkSessionConfirmationRecords([
                {
                    confirmationId: `${operationId}:${state}`,
                    handoffId: operationId,
                    decisionId: operationId,
                    sessionId: options.sessionId ?? null,
                    previousModel,
                    confirmedModel:
                        state === 'rolled_back'
                            ? String(rollback?.['effectiveModel'] ?? previousModel)
                            : String(operation['effectiveModel'] ?? targetModel),
                    status:
                        state === 'verified'
                            ? 'model_confirmed'
                            : state === 'rolled_back'
                              ? 'rollback_confirmed'
                              : 'model_switch_failed',
                    observedAt: updatedAt,
                    source,
                },
            ]);
        }
    };
}
