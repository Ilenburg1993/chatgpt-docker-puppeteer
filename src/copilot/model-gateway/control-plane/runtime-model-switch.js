// @ts-check
/**
 * Runtime-facing transactional model-switch application service.
 *
 * It owns idempotent replay and durable recording while callers inject SDK switching and runtime commit ports.
 *
 * @module copilot/model-gateway/control-plane/runtime-model-switch
 */

import { SqliteModelGatewayCatalogStore } from '../catalog/sqlite-catalog-store.js';
import {
    createModelGatewayModelSwitchOperationId,
    executeModelGatewayModelSwitch,
} from './model-switch.js';
import { createSqliteModelGatewayModelSwitchRecorder } from './sqlite-model-switch-recorder.js';
import { assertModelGatewayOperationStorePort } from './ports.js';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {{
 *   targetModel: string;
 *   previousModel: string;
 *   sessionId?: string | null;
 *   idempotencyKey?: string;
 *   source?: string;
 *   timeoutMs?: number;
 *   switchSessionModel?: (model: string) => Promise<{ requestedModel: string; effectiveModel: string | null; verifiedSwitch: boolean; usedRpcFallback: boolean }>;
 *   commit?: () => Promise<void>;
 *   store?: SqliteModelGatewayCatalogStore;
 * }} input
 */
export async function executeModelGatewayRuntimeModelSwitch(input) {
    const operationId = input.idempotencyKey
        ? createModelGatewayModelSwitchOperationId(input.idempotencyKey)
        : undefined;
    if (!input.sessionId || !input.switchSessionModel || !input.commit) {
        return {
            schemaVersion: 'model-gateway.model-switch.v1',
            operationId: operationId ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            previousModel: input.previousModel,
            targetModel: input.targetModel,
            effectiveModel: null,
            state: 'failed',
            verified: false,
            rollback: null,
            error: 'MODEL_SWITCH_SESSION_UNAVAILABLE',
            reconciliationRequired: false,
            transitions: [],
        };
    }
    const store = /** @type {SqliteModelGatewayCatalogStore} */ (
        assertModelGatewayOperationStorePort(input.store ?? new SqliteModelGatewayCatalogStore())
    );
    if (operationId) {
        const existing = await store.readSdkSessionHandoffRecord(operationId);
        const existingOperation = isRecord(existing?.['operation']) ? existing['operation'] : null;
        if (
            existingOperation &&
            (existingOperation['state'] === 'committed' ||
                existingOperation['state'] === 'rolled_back' ||
                existingOperation['state'] === 'failed')
        ) {
            return { ...existingOperation, replayed: true };
        }
    }
    return executeModelGatewayModelSwitch({
        targetModel: input.targetModel,
        previousModel: input.previousModel,
        ...(operationId ? { operationId } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
        switchSessionModel: input.switchSessionModel,
        commit: input.commit,
        record: createSqliteModelGatewayModelSwitchRecorder({
            store,
            sessionId: input.sessionId,
            source: input.source ?? 'model-gateway.runtime-model-switch',
        }),
    });
}
