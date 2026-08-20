// @ts-check
/**
 * Promotion of Model Gateway route switches deferred while an SDK tool-turn was active.
 *
 * This module is deliberately terminal-side: it runs after `assistant.turn_end`, when the SDK has already closed the
 * tool-response window that made immediate reattach unsafe. It never creates a new session; it reuses the same
 * idempotency key with `forceApplyDeferred=true`.
 *
 * @module copilot/terminal/byok/deferred-route-promotion
 */

import {
    MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_DEFAULT_MAX_AGE_MS,
    SqliteModelGatewayCatalogStore,
    classifyModelGatewayDeferredRouteOperation,
} from '#copilot/model-gateway';
import { recordTerminalActivity } from '../state/index.js';
import { requestTerminalLiveByokRouteSwitch } from './live-model-switch.js';

const DEFAULT_LIMIT = 20;
const inFlightPromotions = new Set();

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
 * @param {{
 *     store?: Pick<SqliteModelGatewayCatalogStore, 'readDeferredSdkSessionHandoffRecords'>;
 *     sessionId?: string | null;
 *     runtimeId?: string | null;
 *     limit?: number;
 *     maxAgeMs?: number;
 *     now?: number;
 *     source?: string;
 * }} [options]
 * @returns {Promise<{
 *     sessionId: string | null;
 *     scanned: number;
 *     promoted: number;
 *     skipped: number;
 *     errors: number;
 *     records: Record<string, unknown>[];
 * }>}
 */
export async function promoteTerminalDeferredByokRouteSwitchesAtTurnBoundary(options = {}) {
    const sessionId = optionalString(options.sessionId);
    const source = options.source ?? 'terminal.byok_route_deferred_turn_end';
    if (!sessionId) {
        recordTerminalActivity('model', 'Promoção automática de rota não executada', {
            detail: 'sessão SDK viva indisponível; nenhuma operação foi consultada',
            source,
            severity: 'info',
            recordHistory: false,
            updateCurrent: false,
        });
        return {
            sessionId: null,
            scanned: 0,
            promoted: 0,
            skipped: 0,
            errors: 0,
            records: [{ promoted: false, skippedReason: 'live_session_id_required' }],
        };
    }

    const store = options.store ?? new SqliteModelGatewayCatalogStore();
    const limit = Math.max(1, Math.min(Math.floor(options.limit ?? DEFAULT_LIMIT), 100));
    const maxAgeMs = Math.max(
        1_000,
        Math.floor(options.maxAgeMs ?? MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_DEFAULT_MAX_AGE_MS),
    );
    const now = options.now ?? Date.now();
    const handoffs = await store.readDeferredSdkSessionHandoffRecords({
        sessionId,
        limit,
        now,
        includeExpired: true,
    });
    /** @type {Record<string, unknown>[]} */
    const records = [];
    let promoted = 0;
    let skipped = 0;
    let errors = 0;

    for (const handoff of handoffs) {
        const operation = isRecord(handoff['operation']) ? handoff['operation'] : null;
        if (!operation) {
            skipped += 1;
            records.push({ promoted: false, skippedReason: 'operation_payload_missing' });
            continue;
        }
        const classification = classifyModelGatewayDeferredRouteOperation(operation, {
            now,
            maxAgeMs,
            expectedSessionId: sessionId,
        });
        const operationId = classification.operationId ?? optionalString(handoff['handoffId']);
        if (!classification.promotable || !operationId || !classification.route || !classification.idempotencyKey) {
            skipped += 1;
            records.push({
                operationId,
                promoted: false,
                classification: classification.classification,
                skippedReason: classification.reason,
                promotionPolicy: classification.promotionPolicy,
                expiresAt: classification.expiresAt,
                nextActions: classification.nextActions,
            });
            continue;
        }
        if (inFlightPromotions.has(operationId)) {
            skipped += 1;
            records.push({ operationId, promoted: false, skippedReason: 'promotion_already_in_flight' });
            continue;
        }
        inFlightPromotions.add(operationId);
        try {
            const runtimeId = optionalString(options.runtimeId);
            const result = await requestTerminalLiveByokRouteSwitch(classification.route, {
                ...(runtimeId ? { runtimeId } : {}),
                idempotencyKey: classification.idempotencyKey,
                forceApplyDeferred: true,
                source,
                reason: 'promoção automática autorizada no limite seguro do turno',
            });
            promoted += 1;
            records.push({
                operationId,
                promoted: true,
                state: result.operation['state'] ?? 'unknown',
                detail: result.detail,
            });
        } catch (error) {
            errors += 1;
            records.push({
                operationId,
                promoted: false,
                error: error instanceof Error ? error.message : String(error),
            });
            recordTerminalActivity('model', 'Promoção de rota diferida falhou', {
                detail: `operação ${operationId}: ${error instanceof Error ? error.message : String(error)}`,
                source,
                severity: 'warn',
                recordHistory: true,
            });
        } finally {
            inFlightPromotions.delete(operationId);
        }
    }
    if (promoted > 0) {
        recordTerminalActivity('model', 'Rotas diferidas promovidas no fim do turno', {
            detail: `${promoted} operação(ões) promovida(s) na sessão ${sessionId}`,
            source,
            severity: 'info',
            recordHistory: true,
        });
    } else {
        const reasonCounts = new Map();
        for (const record of records) {
            const reason = optionalString(record['skippedReason']) ?? 'no_candidate';
            reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
        }
        recordTerminalActivity('model', 'Nenhuma rota diferida promovível', {
            detail:
                handoffs.length === 0
                    ? `sessão ${sessionId}: nenhuma operação diferida pendente`
                    : `sessão ${sessionId}: ${JSON.stringify(Object.fromEntries(reasonCounts))}`,
            source,
            severity: 'info',
            recordHistory: false,
            updateCurrent: false,
        });
    }
    return { sessionId, scanned: handoffs.length, promoted, skipped, errors, records };
}
