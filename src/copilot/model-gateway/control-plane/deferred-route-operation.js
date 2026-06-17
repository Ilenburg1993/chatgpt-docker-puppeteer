// @ts-check
/**
 * Pure policy and safety classification for same-session route switches deferred to a safe turn boundary.
 *
 * Automatic promotion is deliberately fail-closed. A deferred operation is promotable only when the original,
 * confirmed mutation persisted an explicit authorization, the operation belongs to the currently live SDK session,
 * and its bounded authorization window remains valid.
 *
 * @module copilot/model-gateway/control-plane/deferred-route-operation
 */

export const MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_POLICY = Object.freeze({
    AUTHORIZED_AFTER_TURN_BOUNDARY: 'authorized_after_turn_boundary',
    MANUAL_REVIEW: 'manual_review',
});

export const MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_DEFAULT_MAX_AGE_MS = 10 * 60_000;

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
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {Record<string, unknown>} operation
 * @returns {Record<string, unknown>}
 */
function promotionAuthorization(operation) {
    const direct = isRecord(operation['promotionAuthorization']) ? operation['promotionAuthorization'] : null;
    if (direct) return direct;
    const deferDetails = isRecord(operation['deferDetails']) ? operation['deferDetails'] : {};
    return isRecord(deferDetails['promotionAuthorization']) ? deferDetails['promotionAuthorization'] : {};
}

/**
 * @param {Record<string, unknown>} operation
 * @param {{ now?: number; maxAgeMs?: number; expectedSessionId?: string | null }} [options]
 * @returns {{
 *   classification: 'promotable' | 'expired' | 'review_required' | 'cancelled' | 'not_deferred' | 'invalid';
 *   promotable: boolean;
 *   expired: boolean;
 *   requiresReview: boolean;
 *   reason: string;
 *   nextActions: string[];
 *   operationId: string | null;
 *   sessionId: string | null;
 *   idempotencyKey: string | null;
 *   route: Record<string, unknown> | null;
 *   promotionPolicy: string;
 *   authorizationSource: string | null;
 *   expiresAt: string | null;
 * }}
 */
export function classifyModelGatewayDeferredRouteOperation(operation, options = {}) {
    const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
    const maxAgeMs =
        typeof options.maxAgeMs === 'number' && Number.isFinite(options.maxAgeMs) && options.maxAgeMs > 0
            ? Math.floor(options.maxAgeMs)
            : MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_DEFAULT_MAX_AGE_MS;
    const operationId = optionalString(operation['operationId']);
    const sessionId = optionalString(operation['sessionId']);
    const idempotencyKey = optionalString(operation['idempotencyKey']);
    const route = isRecord(operation['targetRoute']) ? operation['targetRoute'] : null;
    const authorization = promotionAuthorization(operation);
    const promotionPolicy =
        optionalString(authorization['policy']) ?? MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_POLICY.MANUAL_REVIEW;
    const authorizationSource = optionalString(authorization['source']);
    const explicitExpiresAt = optionalString(authorization['expiresAt']);
    const createdAtMs = dateMs(operation['createdAt']);
    const explicitExpiresAtMs = dateMs(explicitExpiresAt);
    const expiresAtMs = explicitExpiresAtMs ?? (createdAtMs === null ? null : createdAtMs + maxAgeMs);
    const expiresAt = expiresAtMs === null ? null : new Date(expiresAtMs).toISOString();
    const base = {
        operationId,
        sessionId,
        idempotencyKey,
        route,
        promotionPolicy,
        authorizationSource,
        expiresAt,
    };
    const state = optionalString(operation['state']) ?? 'unknown';
    if (['cancelled', 'discarded', 'superseded'].includes(state)) {
        return {
            ...base,
            classification: 'cancelled',
            promotable: false,
            expired: false,
            requiresReview: false,
            reason: `operation_${state}`,
            nextActions: ['inspect_operation_status'],
        };
    }
    if (state !== 'deferred_until_turn_boundary') {
        return {
            ...base,
            classification: 'not_deferred',
            promotable: false,
            expired: false,
            requiresReview: false,
            reason: 'not_deferred_until_turn_boundary',
            nextActions: ['inspect_operation_status'],
        };
    }
    if (expiresAtMs !== null && now >= expiresAtMs) {
        return {
            ...base,
            classification: 'expired',
            promotable: false,
            expired: true,
            requiresReview: true,
            reason: 'deferred_operation_expired',
            nextActions: ['review_target_route', 'submit_new_confirmed_route_switch'],
        };
    }
    const expectedSessionId = optionalString(options.expectedSessionId);
    if (expectedSessionId && sessionId !== expectedSessionId) {
        return {
            ...base,
            classification: 'review_required',
            promotable: false,
            expired: false,
            requiresReview: true,
            reason: sessionId ? 'deferred_operation_session_mismatch' : 'deferred_operation_session_missing',
            nextActions: ['inspect_operation_status', 'do_not_promote_across_sessions'],
        };
    }
    if (operation['requiresNewSession'] !== false || operation['retryable'] !== true) {
        return {
            ...base,
            classification: 'invalid',
            promotable: false,
            expired: false,
            requiresReview: true,
            reason: operation['requiresNewSession'] !== false ? 'requires_new_session_not_false' : 'operation_not_retryable',
            nextActions: ['inspect_operation_status', 'review_operation_invariants'],
        };
    }
    if (operation['deferReason'] !== 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED') {
        return {
            ...base,
            classification: 'review_required',
            promotable: false,
            expired: false,
            requiresReview: true,
            reason: 'defer_reason_not_auto_promotable',
            nextActions: ['review_defer_reason', 'apply_route_switch_manually'],
        };
    }
    if (
        promotionPolicy !== MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_POLICY.AUTHORIZED_AFTER_TURN_BOUNDARY ||
        authorization['authorized'] !== true
    ) {
        return {
            ...base,
            classification: 'review_required',
            promotable: false,
            expired: false,
            requiresReview: true,
            reason: 'automatic_promotion_not_authorized',
            nextActions: ['review_target_route', 'apply_route_switch_with_explicit_confirmation'],
        };
    }
    const providerId = optionalString(route?.['providerId']);
    const providerModel = optionalString(route?.['providerModel']) ?? optionalString(route?.['selectorSyntax']);
    if (!operationId || !sessionId || !idempotencyKey || !route || !providerId || !providerModel) {
        return {
            ...base,
            classification: 'invalid',
            promotable: false,
            expired: false,
            requiresReview: true,
            reason: 'deferred_operation_identity_invalid',
            nextActions: ['inspect_operation_status', 'submit_new_confirmed_route_switch'],
        };
    }
    return {
        ...base,
        classification: 'promotable',
        promotable: true,
        expired: false,
        requiresReview: false,
        reason: 'authorized_for_safe_turn_boundary_promotion',
        nextActions: ['promote_same_session_route_switch', 'inspect_operation_status'],
    };
}
