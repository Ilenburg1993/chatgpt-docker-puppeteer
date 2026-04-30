// @ts-check
/**
 * Helpers canônicos para a shadow persistida de `ask_user`.
 *
 * O SDK não persiste `onUserInputRequest`; toda shadow é uma convenção interna de recovery/observabilidade. O objetivo
 * aqui é manter TTL, expiração e restore semantics em uma única SSOT.
 */

import {
    PENDING_QUESTION_SHADOW_EXPIRING_SOON_MIN_MS,
    PENDING_QUESTION_SHADOW_FRESH_MS,
    PENDING_QUESTION_SHADOW_TTL_MS,
    PENDING_QUESTION_SHADOW_TTL_QUESTION_MS,
    PENDING_QUESTION_SHADOW_TTL_READY_MS,
} from '../../../config/agent.js';

/**
 * @typedef {'fresh' | 'active' | 'expiring_soon' | 'expired'} PendingQuestionShadowState
 */

/**
 * @param {import('../../types.js').PendingQuestionKind} [kind]
 * @returns {number}
 */
export function getPendingQuestionShadowTtlMs(kind = 'question') {
    switch (kind) {
        case 'ready':
            return PENDING_QUESTION_SHADOW_TTL_READY_MS;
        case 'question':
            return PENDING_QUESTION_SHADOW_TTL_QUESTION_MS;
        default:
            return PENDING_QUESTION_SHADOW_TTL_MS;
    }
}

/**
 * @param {import('../../types.js').PendingQuestionShadow} shadow
 * @param {number} [ttlMs]
 * @returns {number}
 */
export function getPendingQuestionShadowExpiresAt(shadow, ttlMs = PENDING_QUESTION_SHADOW_TTL_MS) {
    const resolvedTtlMs =
        ttlMs === PENDING_QUESTION_SHADOW_TTL_MS ? getPendingQuestionShadowTtlMs(shadow.meta.kind) : ttlMs;
    if (Number.isFinite(shadow.expiresAt) && shadow.expiresAt > 0) {
        return shadow.expiresAt;
    }
    const askedAt = Number.isFinite(shadow.meta.askedAt) && shadow.meta.askedAt > 0 ? shadow.meta.askedAt : Date.now();
    return askedAt + resolvedTtlMs;
}

/**
 * @param {import('../../types.js').PendingQuestionShadow} shadow
 * @param {number} [now]
 * @returns {number}
 */
export function getPendingQuestionShadowAgeMs(shadow, now = Date.now()) {
    return Math.max(0, now - shadow.meta.askedAt);
}

/**
 * @param {import('../../types.js').PendingQuestionShadow} shadow
 * @param {number} [now]
 * @returns {number}
 */
export function getPendingQuestionShadowRemainingMs(shadow, now = Date.now()) {
    return Math.max(0, getPendingQuestionShadowExpiresAt(shadow) - now);
}

/**
 * @param {import('../../types.js').PendingQuestionKind} [kind]
 * @returns {number}
 */
export function getPendingQuestionShadowExpiringSoonThresholdMs(kind = 'question') {
    return Math.max(
        PENDING_QUESTION_SHADOW_EXPIRING_SOON_MIN_MS,
        Math.round(getPendingQuestionShadowTtlMs(kind) * 0.2),
    );
}

/**
 * @param {import('../../types.js').PendingQuestionShadow} shadow
 * @param {{ now?: number; ttlMs?: number }} [opts]
 * @returns {boolean}
 */
export function isPendingQuestionShadowExpired(shadow, opts = {}) {
    const now = opts.now ?? Date.now();
    const ttlMs = opts.ttlMs ?? getPendingQuestionShadowTtlMs(shadow.meta.kind);
    return now >= getPendingQuestionShadowExpiresAt(shadow, ttlMs);
}

/**
 * @param {import('../../types.js').PendingQuestionShadow} shadow
 * @param {{ now?: number }} [opts]
 * @returns {PendingQuestionShadowState}
 */
export function getPendingQuestionShadowState(shadow, opts = {}) {
    const now = opts.now ?? Date.now();
    if (isPendingQuestionShadowExpired(shadow, { now })) {
        return 'expired';
    }
    if (now - shadow.restoredAt <= PENDING_QUESTION_SHADOW_FRESH_MS) {
        return 'fresh';
    }
    if (
        getPendingQuestionShadowRemainingMs(shadow, now) <=
        getPendingQuestionShadowExpiringSoonThresholdMs(shadow.meta.kind)
    ) {
        return 'expiring_soon';
    }
    return 'active';
}

/**
 * @param {string} question
 * @param {import('../../types.js').PendingQuestionMeta} meta
 * @param {{ now?: number; ttlMs?: number }} [opts]
 * @returns {import('../../types.js').PendingQuestionShadow}
 */
export function createPendingQuestionShadow(question, meta, opts = {}) {
    const now = opts.now ?? Date.now();
    const ttlMs = opts.ttlMs ?? getPendingQuestionShadowTtlMs(meta.kind);
    const askedAt = Number.isFinite(meta.askedAt) && meta.askedAt > 0 ? meta.askedAt : now;
    return {
        question,
        meta: { ...meta, askedAt },
        restoredAt: now,
        expiresAt: askedAt + ttlMs,
    };
}
