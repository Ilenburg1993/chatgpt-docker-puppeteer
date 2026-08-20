// @ts-check
/**
 * Field-wise metadata merge for catalog evidence.
 *
 * Remote catalogs, docs, static seeds, manual overrides and probes can disagree. This merge layer chooses winners per
 * field, keeps provenance/confidence alongside each field and reports conflicts without erasing weaker evidence.
 *
 * @module copilot/model-gateway/catalog/merge
 */

import { createCanonicalModelProjection, createCanonicalProviderProjection } from './contracts.js';

const CONFIDENCE_PRECEDENCE = Object.freeze({
    unknown: 0,
    heuristic: 10,
    static_seed: 20,
    aggregator: 30,
    docs: 40,
    catalog: 50,
    authenticated_catalog: 60,
    probe_failed: 70,
    probe_verified: 80,
    manual: 90,
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} confidence
 * @returns {number}
 */
export function rankCatalogEvidenceConfidence(confidence) {
    if (typeof confidence !== 'string') return CONFIDENCE_PRECEDENCE.unknown;
    return (
        CONFIDENCE_PRECEDENCE[/** @type {keyof typeof CONFIDENCE_PRECEDENCE} */ (confidence)] ??
        CONFIDENCE_PRECEDENCE.unknown
    );
}

/**
 * @param {Record<string, unknown>} left
 * @param {Record<string, unknown>} right
 * @returns {number}
 */
function compareEvidence(left, right) {
    const confidenceDelta =
        rankCatalogEvidenceConfidence(right['confidence']) - rankCatalogEvidenceConfidence(left['confidence']);
    if (confidenceDelta !== 0) return confidenceDelta;
    const rightObservedAt = Date.parse(String(right['observedAt'] ?? ''));
    const leftObservedAt = Date.parse(String(left['observedAt'] ?? ''));
    const observedDelta =
        (Number.isFinite(rightObservedAt) ? rightObservedAt : 0) -
        (Number.isFinite(leftObservedAt) ? leftObservedAt : 0);
    if (observedDelta !== 0) return observedDelta;
    return String(left['evidenceId'] ?? '').localeCompare(String(right['evidenceId'] ?? ''));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableJson(value) {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    return `{${Object.entries(/** @type {Record<string, unknown>} */ (value))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
        .join(',')}}`;
}

/**
 * @param {string} fieldPath
 * @returns {string[]}
 */
function splitSafeFieldPath(fieldPath) {
    const segments = fieldPath
        .split('.')
        .map((segment) => segment.trim())
        .filter(Boolean);
    if (segments.length === 0 || segments.length > 8) {
        throw new Error(`[model-gateway/catalog] invalid fieldPath: ${fieldPath}`);
    }
    if (!segments.every((segment) => /^[a-zA-Z][a-zA-Z0-9_]*$/u.test(segment))) {
        throw new Error(`[model-gateway/catalog] unsafe fieldPath: ${fieldPath}`);
    }
    return segments;
}

/**
 * @param {Record<string, unknown>} target
 * @param {string} fieldPath
 * @param {unknown} value
 * @returns {void}
 */
function setNestedValue(target, fieldPath, value) {
    const segments = splitSafeFieldPath(fieldPath);
    /** @type {Record<string, unknown>} */
    let cursor = target;
    for (const segment of segments.slice(0, -1)) {
        const existing = cursor[segment];
        if (isRecord(existing)) {
            cursor = existing;
            continue;
        }
        /** @type {Record<string, unknown>} */
        const nested = {};
        cursor[segment] = nested;
        cursor = nested;
    }
    cursor[segments.at(-1) ?? fieldPath] = value;
}

/**
 * @param {Record<string, unknown>[]} evidences
 * @returns {Map<string, Record<string, unknown>[]>}
 */
function groupEvidenceByField(evidences) {
    const groups = new Map();
    for (const evidence of evidences) {
        const fieldPath = typeof evidence['fieldPath'] === 'string' ? evidence['fieldPath'] : '';
        if (!fieldPath) continue;
        const group = groups.get(fieldPath) ?? [];
        group.push(evidence);
        groups.set(fieldPath, group);
    }
    return groups;
}

/**
 * @param {Record<string, unknown>[]} evidences
 * @param {{ providerId?: string; providerModel?: string; routeProfile?: string | null; displayName?: string }} [base]
 * @returns {{
 *     projection: ReturnType<typeof createCanonicalModelProjection>;
 *     selectedEvidence: Record<string, Record<string, unknown>>;
 *     conflicts: { fieldPath: string; selectedEvidenceId: string | null; conflictingEvidenceIds: string[] }[];
 * }}
 */
export function mergeModelMetadataEvidence(evidences, base = {}) {
    const first = evidences[0] ?? {};
    const providerId = String(base.providerId ?? first['providerId'] ?? '');
    const providerModel = String(base.providerModel ?? first['providerModel'] ?? '');
    const routeProfile = base.routeProfile ?? first['routeProfile'] ?? null;
    /** @type {Parameters<typeof createCanonicalModelProjection>[0] & Record<string, unknown>} */
    const projectionInput = {
        providerId,
        providerModel,
        ...(typeof routeProfile === 'string' && routeProfile ? { routeProfile } : {}),
        ...(base.displayName ? { displayName: base.displayName } : {}),
        provenanceByField: {},
        confidenceByField: {},
    };
    /** @type {Record<string, Record<string, unknown>>} */
    const selectedEvidence = {};
    /** @type {{ fieldPath: string; selectedEvidenceId: string | null; conflictingEvidenceIds: string[] }[]} */
    const conflicts = [];

    for (const [fieldPath, group] of groupEvidenceByField(evidences).entries()) {
        const sorted = [...group].sort(compareEvidence);
        const selected = sorted[0];
        if (!selected) continue;
        selectedEvidence[fieldPath] = selected;
        setNestedValue(projectionInput, fieldPath, selected['normalizedValue']);
        const provenanceByField = /** @type {Record<string, unknown>} */ (projectionInput['provenanceByField'] ?? {});
        const confidenceByField = /** @type {Record<string, unknown>} */ (projectionInput['confidenceByField'] ?? {});
        provenanceByField[fieldPath] = selected['evidenceId'];
        confidenceByField[fieldPath] = selected['confidence'] ?? 'unknown';
        projectionInput['provenanceByField'] = provenanceByField;
        projectionInput['confidenceByField'] = confidenceByField;

        const selectedJson = stableJson(selected['normalizedValue']);
        const conflictingEvidenceIds = sorted
            .slice(1)
            .filter((item) => stableJson(item['normalizedValue']) !== selectedJson)
            .map((item) => String(item['evidenceId'] ?? 'unknown'));
        if (conflictingEvidenceIds.length > 0) {
            conflicts.push({
                fieldPath,
                selectedEvidenceId: typeof selected['evidenceId'] === 'string' ? selected['evidenceId'] : null,
                conflictingEvidenceIds,
            });
        }
    }

    return {
        projection: createCanonicalModelProjection(projectionInput),
        selectedEvidence,
        conflicts,
    };
}

/**
 * @param {Record<string, unknown>[]} evidences
 * @param {{ providerId?: string; subjectProviderId?: string; displayName?: string }} [base]
 * @returns {{
 *     projection: ReturnType<typeof createCanonicalProviderProjection>;
 *     selectedEvidence: Record<string, Record<string, unknown>>;
 *     conflicts: { fieldPath: string; selectedEvidenceId: string | null; conflictingEvidenceIds: string[] }[];
 * }}
 */
export function mergeProviderMetadataEvidence(evidences, base = {}) {
    const first = evidences[0] ?? {};
    const providerId = String(base.providerId ?? first['providerId'] ?? '');
    const subjectProviderId = String(base.subjectProviderId ?? first['subjectProviderId'] ?? '');
    /** @type {Parameters<typeof createCanonicalProviderProjection>[0] & Record<string, unknown>} */
    const projectionInput = {
        providerId,
        subjectProviderId,
        ...(base.displayName ? { displayName: base.displayName } : {}),
        provenanceByField: {},
        confidenceByField: {},
    };
    /** @type {Record<string, Record<string, unknown>>} */
    const selectedEvidence = {};
    /** @type {{ fieldPath: string; selectedEvidenceId: string | null; conflictingEvidenceIds: string[] }[]} */
    const conflicts = [];

    for (const [fieldPath, group] of groupEvidenceByField(evidences).entries()) {
        const sorted = [...group].sort(compareEvidence);
        const selected = sorted[0];
        if (!selected) continue;
        selectedEvidence[fieldPath] = selected;
        setNestedValue(projectionInput, fieldPath, selected['normalizedValue']);
        const provenanceByField = /** @type {Record<string, unknown>} */ (projectionInput['provenanceByField'] ?? {});
        const confidenceByField = /** @type {Record<string, unknown>} */ (projectionInput['confidenceByField'] ?? {});
        provenanceByField[fieldPath] = selected['evidenceId'];
        confidenceByField[fieldPath] = selected['confidence'] ?? 'unknown';
        projectionInput['provenanceByField'] = provenanceByField;
        projectionInput['confidenceByField'] = confidenceByField;

        const selectedJson = stableJson(selected['normalizedValue']);
        const conflictingEvidenceIds = sorted
            .slice(1)
            .filter((item) => stableJson(item['normalizedValue']) !== selectedJson)
            .map((item) => String(item['evidenceId'] ?? 'unknown'));
        if (conflictingEvidenceIds.length > 0) {
            conflicts.push({
                fieldPath,
                selectedEvidenceId: typeof selected['evidenceId'] === 'string' ? selected['evidenceId'] : null,
                conflictingEvidenceIds,
            });
        }
    }

    return {
        projection: createCanonicalProviderProjection(projectionInput),
        selectedEvidence,
        conflicts,
    };
}
