// @ts-check
/**
 * Catalog retention policies for operational history.
 *
 * Retention only prunes derived history arrays. It does not remove canonical projections, evidences, route options,
 * account overlays or eligibility decisions unless a future policy explicitly introduces that behavior.
 *
 * @module copilot/model-gateway/catalog/retention
 */

/**
 * @typedef {object} ModelGatewayCatalogRetentionPolicy
 * @property {number} [maxImportRuns]
 * @property {number} [maxRawPayloadRefs]
 * @property {number} [maxConflicts]
 * @property {number} [maxModelEligibilityRuns]
 */

/**
 * @param {unknown} value
 * @returns {Record<string, any>[]}
 */
function records(value) {
    return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalPositiveInteger(value) {
    return Number.isInteger(value) && /** @type {number} */ (value) > 0 ? /** @type {number} */ (value) : null;
}

/**
 * @param {Record<string, any>} record
 * @returns {number}
 */
function observedTimeMs(record) {
    const candidates = [
        record['completedAt'],
        record['startedAt'],
        record['observedAt'],
        record['createdAt'],
        record['timestamp'],
    ];
    for (const candidate of candidates) {
        if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) return candidate.getTime();
        if (typeof candidate === 'string' && candidate.trim()) {
            const parsed = Date.parse(candidate);
            if (!Number.isNaN(parsed)) return parsed;
        }
    }
    return 0;
}

/**
 * @param {Record<string, any>[]} list
 * @param {number | null} limit
 * @returns {Record<string, any>[]}
 */
function keepNewest(list, limit) {
    if (limit === null || list.length <= limit) return list;
    return [...list].sort((left, right) => observedTimeMs(right) - observedTimeMs(left)).slice(0, limit);
}

/**
 * @param {Record<string, any>[]} before
 * @param {Record<string, any>[]} after
 * @returns {{ before: number; after: number; pruned: number }}
 */
function stats(before, after) {
    return {
        before: before.length,
        after: after.length,
        pruned: Math.max(0, before.length - after.length),
    };
}

/**
 * @param {Record<string, any>} snapshot
 * @param {ModelGatewayCatalogRetentionPolicy} [policy]
 * @returns {{
 *     snapshot: Record<string, any>;
 *     summary: {
 *         enabled: boolean;
 *         importRuns: { before: number; after: number; pruned: number };
 *         rawPayloadRefs: { before: number; after: number; pruned: number };
 *         conflicts: { before: number; after: number; pruned: number };
 *         modelEligibilityRuns: { before: number; after: number; pruned: number };
 *     };
 * }}
 */
export function applyModelGatewayCatalogRetention(snapshot, policy = {}) {
    const importRuns = records(snapshot['importRuns']);
    const rawPayloadRefs = records(snapshot['rawPayloadRefs']);
    const conflicts = records(snapshot['conflicts']);
    const modelEligibilityRuns = records(snapshot['modelEligibilityRuns']);

    const retainedImportRuns = keepNewest(importRuns, optionalPositiveInteger(policy.maxImportRuns));
    const retainedRawPayloadRefs = keepNewest(rawPayloadRefs, optionalPositiveInteger(policy.maxRawPayloadRefs));
    const retainedConflicts = keepNewest(conflicts, optionalPositiveInteger(policy.maxConflicts));
    const retainedModelEligibilityRuns = keepNewest(modelEligibilityRuns, optionalPositiveInteger(policy.maxModelEligibilityRuns));

    const summary = {
        enabled:
            optionalPositiveInteger(policy.maxImportRuns) !== null ||
            optionalPositiveInteger(policy.maxRawPayloadRefs) !== null ||
            optionalPositiveInteger(policy.maxConflicts) !== null ||
            optionalPositiveInteger(policy.maxModelEligibilityRuns) !== null,
        importRuns: stats(importRuns, retainedImportRuns),
        rawPayloadRefs: stats(rawPayloadRefs, retainedRawPayloadRefs),
        conflicts: stats(conflicts, retainedConflicts),
        modelEligibilityRuns: stats(modelEligibilityRuns, retainedModelEligibilityRuns),
    };

    return {
        snapshot: {
            ...snapshot,
            importRuns: retainedImportRuns,
            rawPayloadRefs: retainedRawPayloadRefs,
            conflicts: retainedConflicts,
            modelEligibilityRuns: retainedModelEligibilityRuns,
        },
        summary,
    };
}
