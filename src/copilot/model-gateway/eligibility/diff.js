// @ts-check
/**
 * Diff helpers for pre-runtime eligibility decisions.
 *
 * Eligibility is derived, scoped state. These helpers compare derived decisions without probing providers and without
 * mutating canonical metadata.
 *
 * @module copilot/model-gateway/eligibility/diff
 */

import { modelEligibilityDecisionKey } from './catalog-snapshot.js';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>[]}
 */
function records(value) {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * @param {string[]} fields
 * @returns {string[]}
 */
function classifyEligibilityChangedFields(fields) {
    const kinds = new Set();
    for (const field of fields) {
        if (field === 'include' || field === 'disposition') kinds.add('disposition_changed');
        else if (field === 'hardExclusions' || field === 'softPenalties' || field === 'reasons') kinds.add('access_gate_changed');
        else if (field === 'policyProfile' || field === 'taskProfile' || field === 'accountScope' || field === 'policyInputs') {
            kinds.add('policy_scope_changed');
        } else if (field === 'selectorKind' || field === 'selectorSyntax' || field === 'routeProfile' || field === 'routeOptionRefs') {
            kinds.add('route_scope_changed');
        } else if (field === 'overlayRefs') kinds.add('account_overlay_changed');
        else if (field === 'evidenceRefs') kinds.add('metadata_evidence_changed');
        else if (field === 'requiredRuntimeProbes') kinds.add('runtime_probe_requirement_changed');
        else if (field === 'secretRef') kinds.add('secret_binding_changed');
        else if (!['observedAt', 'expiresAt', 'redactionStatus', 'schemaVersion'].includes(field)) kinds.add('other_changed');
    }
    return [...kinds].sort();
}

/**
 * @param {Record<string, any>[]} previous
 * @param {Record<string, any>[]} next
 * @returns {{ added: string[]; removed: string[]; changed: Array<{ key: string; changedFields: string[]; changedKinds: string[]; previousDisposition: string | null; nextDisposition: string | null; previousInclude: boolean | null; nextInclude: boolean | null }> }}
 */
export function diffModelGatewayEligibilityDecisions(previous, next) {
    const previousByKey = new Map(records(previous).map((item) => [modelEligibilityDecisionKey(item), item]));
    const nextByKey = new Map(records(next).map((item) => [modelEligibilityDecisionKey(item), item]));
    const added = [...nextByKey.keys()].filter((key) => !previousByKey.has(key)).sort();
    const removed = [...previousByKey.keys()].filter((key) => !nextByKey.has(key)).sort();
    const changed = [];
    for (const [key, nextItem] of nextByKey.entries()) {
        const previousItem = previousByKey.get(key);
        if (!previousItem) continue;
        const changedFields = Object.keys({ ...previousItem, ...nextItem })
            .filter((field) => stableJson(previousItem[field]) !== stableJson(nextItem[field]))
            .sort();
        const semanticFields = changedFields.filter(
            (field) => !['observedAt', 'expiresAt', 'redactionStatus', 'schemaVersion'].includes(field),
        );
        if (semanticFields.length === 0) continue;
        changed.push({
            key,
            changedFields: semanticFields,
            changedKinds: classifyEligibilityChangedFields(semanticFields),
            previousDisposition: typeof previousItem['disposition'] === 'string' ? previousItem['disposition'] : null,
            nextDisposition: typeof nextItem['disposition'] === 'string' ? nextItem['disposition'] : null,
            previousInclude: typeof previousItem['include'] === 'boolean' ? previousItem['include'] : null,
            nextInclude: typeof nextItem['include'] === 'boolean' ? nextItem['include'] : null,
        });
    }
    return { added, removed, changed: changed.sort((a, b) => a.key.localeCompare(b.key)) };
}

/**
 * @param {{ added?: unknown[]; removed?: unknown[]; changed?: Array<{ changedKinds?: unknown[]; previousInclude?: unknown; nextInclude?: unknown }> }} diff
 * @returns {{ addedCount: number; removedCount: number; changedCount: number; changedKinds: string[]; changedKindCounts: Record<string, number>; becameEligibleCount: number; becameExcludedCount: number }}
 */
export function summarizeModelGatewayEligibilityDiff(diff) {
    const changed = Array.isArray(diff.changed) ? diff.changed : [];
    /** @type {Record<string, number>} */
    const changedKindCounts = {};
    /** @type {string[]} */
    const changedKinds = [];
    let becameEligibleCount = 0;
    let becameExcludedCount = 0;
    for (const item of changed) {
        if (item.previousInclude === false && item.nextInclude === true) becameEligibleCount += 1;
        if (item.previousInclude === true && item.nextInclude === false) becameExcludedCount += 1;
        const itemKinds = new Set(Array.isArray(item.changedKinds) ? item.changedKinds.filter((kind) => typeof kind === 'string') : []);
        for (const kind of itemKinds) {
            changedKindCounts[kind] = (changedKindCounts[kind] ?? 0) + 1;
            if (!changedKinds.includes(kind)) changedKinds.push(kind);
        }
    }
    return {
        addedCount: Array.isArray(diff.added) ? diff.added.length : 0,
        removedCount: Array.isArray(diff.removed) ? diff.removed.length : 0,
        changedCount: changed.length,
        changedKinds: changedKinds.sort(),
        changedKindCounts,
        becameEligibleCount,
        becameExcludedCount,
    };
}
