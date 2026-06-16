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

import { SqliteModelGatewayCatalogStore } from '#copilot/model-gateway';
import { recordTerminalActivity } from '../state/index.js';
import { requestTerminalLiveByokRouteSwitch } from './live-model-switch.js';

const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_AGE_MS = 10 * 60_000;
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
 * @param {unknown} value
 * @returns {number | null}
 */
function dateMs(value) {
    const text = optionalString(value);
    if (!text) return null;
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {Record<string, unknown>} operation
 * @param {number} now
 * @param {number} maxAgeMs
 * @returns {{ ok: boolean; reason: string; route: Record<string, unknown> | null; idempotencyKey: string | null }}
 */
function classifyDeferredRoutePromotionCandidate(operation, now, maxAgeMs) {
    if (operation['state'] !== 'deferred_until_turn_boundary') {
        return { ok: false, reason: 'not_deferred_until_turn_boundary', route: null, idempotencyKey: null };
    }
    if (operation['requiresNewSession'] !== false) {
        return { ok: false, reason: 'requires_new_session_not_false', route: null, idempotencyKey: null };
    }
    if (operation['retryable'] !== true) {
        return { ok: false, reason: 'not_retryable', route: null, idempotencyKey: null };
    }
    if (operation['deferReason'] !== 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED') {
        return { ok: false, reason: 'defer_reason_not_auto_promotable', route: null, idempotencyKey: null };
    }
    const createdAtMs = dateMs(operation['createdAt']);
    if (createdAtMs !== null && now - createdAtMs > maxAgeMs) {
        return { ok: false, reason: 'deferred_operation_too_old', route: null, idempotencyKey: null };
    }
    const route = isRecord(operation['targetRoute']) ? operation['targetRoute'] : null;
    const providerId = optionalString(route?.['providerId']);
    const providerModel = optionalString(route?.['providerModel']) ?? optionalString(route?.['selectorSyntax']);
    if (!route || !providerId || !providerModel) {
        return { ok: false, reason: 'target_route_invalid', route: null, idempotencyKey: null };
    }
    const idempotencyKey = optionalString(operation['idempotencyKey']);
    if (!idempotencyKey) {
        return { ok: false, reason: 'idempotency_key_missing', route: null, idempotencyKey: null };
    }
    return { ok: true, reason: 'auto_promotable', route, idempotencyKey };
}

/**
 * @param {{
 *     store?: Pick<SqliteModelGatewayCatalogStore, 'readSdkSessionHandoffRecords'>;
 *     limit?: number;
 *     maxAgeMs?: number;
 *     now?: number;
 *     source?: string;
 * }} [options]
 * @returns {Promise<{ scanned: number; promoted: number; skipped: number; errors: number; records: Record<string, unknown>[] }>}
 */
export async function promoteTerminalDeferredByokRouteSwitchesAtTurnBoundary(options = {}) {
    const store = options.store ?? new SqliteModelGatewayCatalogStore();
    const limit = Math.max(1, Math.min(Math.floor(options.limit ?? DEFAULT_LIMIT), 100));
    const maxAgeMs = Math.max(1_000, Math.floor(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS));
    const now = options.now ?? Date.now();
    const source = options.source ?? 'terminal.byok_route_deferred_turn_end';
    const handoffs = await store.readSdkSessionHandoffRecords({ limit });
    /** @type {Record<string, unknown>[]} */
    const records = [];
    let promoted = 0;
    let skipped = 0;
    let errors = 0;

    for (const handoff of handoffs) {
        const operation = isRecord(handoff['operation']) ? handoff['operation'] : null;
        if (!operation) {
            skipped += 1;
            continue;
        }
        const operationId = optionalString(operation['operationId']) ?? optionalString(handoff['handoffId']);
        const candidate = classifyDeferredRoutePromotionCandidate(operation, now, maxAgeMs);
        if (!candidate.ok || !operationId || !candidate.route || !candidate.idempotencyKey) {
            skipped += 1;
            records.push({
                operationId,
                promoted: false,
                skippedReason: candidate.reason,
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
            const result = await requestTerminalLiveByokRouteSwitch(candidate.route, {
                idempotencyKey: candidate.idempotencyKey,
                forceApplyDeferred: true,
                source,
                reason: 'promoção automática no limite seguro do turno',
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
            detail: `${promoted} operação(ões) promovida(s) preservando a sessão`,
            source,
            severity: 'info',
            recordHistory: true,
        });
    }
    return { scanned: handoffs.length, promoted, skipped, errors, records };
}
