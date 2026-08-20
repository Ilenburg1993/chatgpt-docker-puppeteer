// @ts-check
/**
 * Runtime-owned promotion of a same-session route switch deferred to the semantic dialog-turn boundary.
 *
 * The LLM cannot make a second tool call "outside" its own active turn. A confirmed route-switch apply therefore arms
 * the persisted operation, and the Agent promotes it after `dialog.turn_end`. This module is presentation-agnostic and
 * deliberately fail-closed: exact session identity, persisted authorization and expiry are revalidated immediately
 * before reattach.
 *
 * @module copilot/model-gateway/control-plane/deferred-route-promotion
 */

import { SqliteModelGatewayCatalogStore } from '../catalog/sqlite-catalog-store.js';
import {
    MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_DEFAULT_MAX_AGE_MS,
    classifyModelGatewayDeferredRouteOperation,
} from './deferred-route-operation.js';

const DEFAULT_LIMIT = 50;
const inFlightOperationIds = new Set();

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @typedef {{
 *     store?: Pick<
 *         SqliteModelGatewayCatalogStore,
 *         'readDeferredSdkSessionHandoffRecords' | 'supersedeDeferredSdkSessionHandoffRecords'
 *     >;
 *     sessionId: string;
 *     runtimeId?: string | null;
 *     limit?: number;
 *     maxAgeMs?: number;
 *     now?: number;
 *     source?: string;
 *     switchRoute: (
 *         route: Record<string, unknown>,
 *         runtimeId: string | null,
 *         options: {
 *             idempotencyKey: string;
 *             source: string;
 *             allowActiveDialogLoopReattach: true;
 *             forceApplyDeferred: true;
 *         },
 *     ) => Promise<Record<string, unknown>>;
 * }} DeferredRoutePromotionInput
 */

/**
 * Promotes at most the newest deferred route intent for one exact SDK session.
 *
 * Older deferred intents are superseded before classification. This prevents a committed newer route from being
 * followed by an old deferred operation on the next turn, which would otherwise revert the provider unexpectedly.
 *
 * @param {DeferredRoutePromotionInput} input
 * @returns {Promise<{
 *     sessionId: string;
 *     scanned: number;
 *     promoted: number;
 *     superseded: number;
 *     skipped: number;
 *     errors: number;
 *     records: Record<string, unknown>[];
 * }>}
 */
export async function promoteModelGatewayDeferredRouteSwitchAtTurnBoundary(input) {
    const sessionId = optionalString(input.sessionId);
    if (!sessionId) throw new Error('MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_SESSION_REQUIRED');
    const store = input.store ?? new SqliteModelGatewayCatalogStore();
    const source = input.source ?? 'agent.dialog_turn_end.model_gateway_route_promotion';
    const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
    const maxAgeMs = Math.max(
        1_000,
        Math.floor(input.maxAgeMs ?? MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_DEFAULT_MAX_AGE_MS),
    );
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? DEFAULT_LIMIT), 500));
    const handoffs = await store.readDeferredSdkSessionHandoffRecords({
        sessionId,
        limit,
        now,
        includeExpired: true,
    });
    if (handoffs.length === 0) {
        return { sessionId, scanned: 0, promoted: 0, superseded: 0, skipped: 0, errors: 0, records: [] };
    }

    const newestHandoff = handoffs[0];
    const newestOperation = isRecord(newestHandoff?.['operation']) ? newestHandoff['operation'] : null;
    const newestOperationId =
        optionalString(newestOperation?.['operationId']) ?? optionalString(newestHandoff?.['handoffId']);
    let superseded = 0;
    if (newestOperationId && handoffs.length > 1) {
        const result = await store.supersedeDeferredSdkSessionHandoffRecords({
            sessionId,
            exceptHandoffId: newestOperationId,
            supersededBy: newestOperationId,
            observedAt: now,
        });
        superseded = result.superseded;
    }

    if (!newestOperation) {
        return {
            sessionId,
            scanned: handoffs.length,
            promoted: 0,
            superseded,
            skipped: 1,
            errors: 0,
            records: [{ operationId: newestOperationId, promoted: false, skippedReason: 'operation_payload_missing' }],
        };
    }

    const classification = classifyModelGatewayDeferredRouteOperation(newestOperation, {
        now,
        maxAgeMs,
        expectedSessionId: sessionId,
    });
    const operationId = classification.operationId ?? newestOperationId;
    if (!classification.promotable || !operationId || !classification.route || !classification.idempotencyKey) {
        return {
            sessionId,
            scanned: handoffs.length,
            promoted: 0,
            superseded,
            skipped: 1,
            errors: 0,
            records: [
                {
                    operationId,
                    promoted: false,
                    classification: classification.classification,
                    skippedReason: classification.reason,
                    promotionPolicy: classification.promotionPolicy,
                    expiresAt: classification.expiresAt,
                    nextActions: classification.nextActions,
                },
            ],
        };
    }
    if (inFlightOperationIds.has(operationId)) {
        return {
            sessionId,
            scanned: handoffs.length,
            promoted: 0,
            superseded,
            skipped: 1,
            errors: 0,
            records: [{ operationId, promoted: false, skippedReason: 'promotion_already_in_flight' }],
        };
    }

    inFlightOperationIds.add(operationId);
    try {
        const projection = await input.switchRoute(classification.route, optionalString(input.runtimeId), {
            idempotencyKey: classification.idempotencyKey,
            source,
            allowActiveDialogLoopReattach: true,
            forceApplyDeferred: true,
        });
        const operation = isRecord(projection['operation']) ? projection['operation'] : projection;
        const committed = operation['state'] === 'committed';
        if (!committed) {
            return {
                sessionId,
                scanned: handoffs.length,
                promoted: 0,
                superseded,
                skipped: 0,
                errors: 1,
                records: [
                    {
                        operationId,
                        promoted: false,
                        state: optionalString(operation['state']) ?? 'unknown',
                        error: optionalString(operation['error']) ?? 'route_switch_not_committed',
                    },
                ],
            };
        }
        return {
            sessionId,
            scanned: handoffs.length,
            promoted: 1,
            superseded,
            skipped: 0,
            errors: 0,
            records: [
                {
                    operationId,
                    promoted: true,
                    state: 'committed',
                    sessionId: optionalString(operation['sessionId']) ?? sessionId,
                },
            ],
        };
    } catch (error) {
        return {
            sessionId,
            scanned: handoffs.length,
            promoted: 0,
            superseded,
            skipped: 0,
            errors: 1,
            records: [
                {
                    operationId,
                    promoted: false,
                    error: error instanceof Error ? error.message : String(error),
                },
            ],
        };
    } finally {
        inFlightOperationIds.delete(operationId);
    }
}
