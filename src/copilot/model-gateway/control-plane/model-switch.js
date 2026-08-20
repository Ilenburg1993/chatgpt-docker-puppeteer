// @ts-check
/**
 * Transactional model switch orchestration.
 *
 * This module owns the state machine, while the SDK call, durable recorder and runtime commit are injected ports.
 *
 * @module copilot/model-gateway/control-plane/model-switch
 */

import { createHash, randomUUID } from 'node:crypto';

export const MODEL_GATEWAY_MODEL_SWITCH_STATES = Object.freeze([
    'planned',
    'requested',
    'sdk_acknowledged',
    'verified',
    'committed',
    'failed',
    'rolled_back',
]);

export const MODEL_GATEWAY_MODEL_SWITCH_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * @param {string} idempotencyKey
 * @returns {string}
 */
export function createModelGatewayModelSwitchOperationId(idempotencyKey) {
    return `model-switch:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/**
 * @template T
 * @param {Promise<T>} task
 * @param {number} timeoutMs
 * @param {string} phase
 * @returns {Promise<T>}
 */
function withTimeout(task, timeoutMs, phase) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`MODEL_SWITCH_TIMEOUT: phase=${phase} timeoutMs=${timeoutMs}`));
        }, timeoutMs);
        task.then(resolve, reject).finally(() => clearTimeout(timer));
    });
}

/**
 * @param {object} input
 * @param {string} input.targetModel
 * @param {string} input.previousModel
 * @param {string} [input.operationId]
 * @param {string} [input.idempotencyKey]
 * @param {(
 *     model: string,
 * ) => Promise<{
 *     requestedModel: string;
 *     effectiveModel: string | null;
 *     verifiedSwitch: boolean;
 *     usedRpcFallback: boolean;
 * }>} input.switchSessionModel
 * @param {() => Promise<void>} input.commit
 * @param {(operation: Record<string, unknown>) => Promise<void>} input.record
 * @param {() => number} [input.now]
 * @param {number} [input.timeoutMs]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function executeModelGatewayModelSwitch(input) {
    const now = input.now ?? Date.now;
    const timeoutMs =
        typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
            ? Math.floor(input.timeoutMs)
            : MODEL_GATEWAY_MODEL_SWITCH_DEFAULT_TIMEOUT_MS;
    const operationId =
        input.operationId ??
        (input.idempotencyKey
            ? createModelGatewayModelSwitchOperationId(input.idempotencyKey)
            : `model-switch:${randomUUID()}`);
    const idempotencyKey = input.idempotencyKey ?? operationId;
    /** @type {Record<string, unknown>[]} */
    const transitions = [];
    /** @type {Record<string, unknown>} */
    const operation = {
        schemaVersion: 'model-gateway.model-switch.v1',
        operationId,
        idempotencyKey,
        previousModel: input.previousModel,
        targetModel: input.targetModel,
        effectiveModel: null,
        state: 'planned',
        verified: false,
        rollback: null,
        error: null,
        timeoutMs,
        reconciliationRequired: false,
        transitions,
        createdAt: new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
    };

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
        await input.record({ ...operation, transitions: [...transitions] });
    };

    try {
        await transition('planned');
        await transition('requested');
        const verification = await withTimeout(input.switchSessionModel(input.targetModel), timeoutMs, 'switch_target');
        await transition('sdk_acknowledged', {
            effectiveModel: verification.effectiveModel,
            usedRpcFallback: verification.usedRpcFallback,
        });
        if (!verification.verifiedSwitch) {
            throw new Error(
                `MODEL_SWITCH_NOT_VERIFIED: requested='${input.targetModel}' effective='${verification.effectiveModel ?? 'unknown'}'`,
            );
        }
        await transition('verified', {
            verified: true,
            effectiveModel: verification.effectiveModel,
        });
        await input.commit();
        await transition('committed');
        return { ...operation, transitions: [...transitions] };
    } catch (error) {
        const failure = errorMessage(error);
        operation['error'] = failure;
        operation['reconciliationRequired'] = failure.startsWith('MODEL_SWITCH_TIMEOUT:');
        if (input.previousModel && input.previousModel !== input.targetModel) {
            try {
                const rollbackVerification = await withTimeout(
                    input.switchSessionModel(input.previousModel),
                    timeoutMs,
                    'rollback_previous',
                );
                const rollback = {
                    requestedModel: input.previousModel,
                    effectiveModel: rollbackVerification.effectiveModel,
                    verified: rollbackVerification.verifiedSwitch,
                    usedRpcFallback: rollbackVerification.usedRpcFallback,
                };
                operation['rollback'] = rollback;
                if (rollbackVerification.verifiedSwitch) {
                    await transition('rolled_back', {
                        verified: false,
                        rollback,
                        reconciliationRequired: false,
                    });
                    return { ...operation, transitions: [...transitions] };
                }
            } catch (rollbackError) {
                operation['rollback'] = {
                    requestedModel: input.previousModel,
                    effectiveModel: null,
                    verified: false,
                    error: errorMessage(rollbackError),
                };
            }
        }
        await transition('failed', {
            verified: false,
            error: failure,
            rollback: operation['rollback'],
        });
        return { ...operation, transitions: [...transitions] };
    }
}
