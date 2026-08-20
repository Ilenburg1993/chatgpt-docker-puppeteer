// @ts-check
/**
 * Metadata-only catalog search.
 *
 * Search is intentionally pre-runtime: it ranks catalog projections using normalized metadata, route options, overlays
 * and eligibility decisions without probing providers.
 *
 * @module copilot/model-gateway/catalog/search
 */

import { normalizeStoredCatalogSnapshot } from './json-catalog-store.js';
import { normalizeRuntimeAgenticCapabilityTaxonomy } from './normalizers.js';

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
 * @returns {string[]}
 */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(optionalString).filter((item) => item !== null))];
}

/**
 * @param {Record<string, unknown>} projection
 * @returns {string}
 */
function projectionKey(projection) {
    return [
        optionalString(projection['providerId']) ?? 'unknown-provider',
        optionalString(projection['providerModel']) ?? 'unknown-model',
        optionalString(projection['routeProfile']) ?? 'default',
    ].join(':');
}

/**
 * @param {Record<string, unknown>} projection
 * @returns {string[]}
 */
function projectionTextFields(projection) {
    const capabilities = isRecord(projection['capabilities']) ? projection['capabilities'] : {};
    const modalities = isRecord(projection['modalities']) ? projection['modalities'] : {};
    return [
        projectionKey(projection),
        optionalString(projection['providerId']),
        optionalString(projection['providerModel']),
        optionalString(projection['displayName']),
        optionalString(projection['family']),
        optionalString(projection['license']),
        ...stringList(projection['aliases']),
        ...stringList(projection['supportedParameters']),
        ...Object.entries(capabilities)
            .filter(([, value]) => value === true)
            .map(([key]) => key),
        ...stringList(modalities['input']),
        ...stringList(modalities['output']),
    ].filter((item) => item !== null);
}

/**
 * @param {Record<string, unknown>} projection
 * @param {Record<string, unknown>[]} rows
 * @returns {number}
 */
function countSameModelRows(projection, rows) {
    return rows.filter(
        (row) =>
            optionalString(row['providerId']) === optionalString(projection['providerId']) &&
            optionalString(row['providerModel']) === optionalString(projection['providerModel']) &&
            (optionalString(row['routeProfile']) ?? 'default') ===
                (optionalString(projection['routeProfile']) ?? 'default'),
    ).length;
}

/**
 * @param {Record<string, unknown>} projection
 * @param {Record<string, unknown>[]} decisions
 * @returns {Record<string, unknown> | null}
 */
function findEligibility(projection, decisions) {
    return (
        decisions.find(
            (decision) =>
                optionalString(decision['providerId']) === optionalString(projection['providerId']) &&
                optionalString(decision['providerModel']) === optionalString(projection['providerModel']) &&
                (optionalString(decision['routeProfile']) ?? 'default') ===
                    (optionalString(projection['routeProfile']) ?? 'default'),
        ) ?? null
    );
}

/**
 * @param {Record<string, unknown>} projection
 * @param {string[]} terms
 * @returns {{ matched: boolean; score: number; matchedFields: string[] }}
 */
function scoreProjectionText(projection, terms) {
    if (terms.length === 0) return { matched: true, score: 0, matchedFields: [] };
    const fields = projectionTextFields(projection);
    let score = 0;
    /** @type {string[]} */
    const matchedFields = [];
    for (const term of terms) {
        const exact = fields.find((field) => field.toLowerCase() === term);
        const partial = exact ?? fields.find((field) => field.toLowerCase().includes(term));
        if (!partial) return { matched: false, score: 0, matchedFields: [] };
        matchedFields.push(partial);
        score += exact ? 20 : 6;
    }
    return { matched: true, score, matchedFields: [...new Set(matchedFields)] };
}

/**
 * @param {unknown} snapshot
 * @param {object} [options]
 * @param {string} [options.query]
 * @param {string} [options.providerId]
 * @param {boolean} [options.onlyEligible]
 * @param {boolean} [options.requireTools]
 * @param {boolean} [options.requireStreaming]
 * @param {boolean} [options.requireReasoning]
 * @param {number} [options.limit]
 * @returns {{
 *     key: string;
 *     providerId: string;
 *     providerModel: string;
 *     displayName: string;
 *     score: number;
 *     matchedFields: string[];
 *     routeOptionCount: number;
 *     accountOverlayCount: number;
 *     eligibilityStatus: string;
 *     projection: Record<string, unknown>;
 * }[]}
 */
export function searchModelGatewayCatalogEntries(snapshot, options = {}) {
    const catalog = normalizeStoredCatalogSnapshot(snapshot);
    const terms = (optionalString(options.query) ?? '').toLowerCase().split(/\s+/u).filter(Boolean);
    const providerFilter = optionalString(options.providerId)?.toLowerCase() ?? null;
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 20), 1), 200);
    const decisions = catalog.modelEligibilityDecisions.filter(isRecord);
    const routeOptions = catalog.routeOptions.filter(isRecord);
    const accountOverlays = catalog.accountOverlays.filter(isRecord);
    return catalog.projections
        .filter(isRecord)
        .map((projection) => {
            const textScore = scoreProjectionText(projection, terms);
            const capabilities = isRecord(projection['capabilities']) ? projection['capabilities'] : {};
            const runtimeAgentic = normalizeRuntimeAgenticCapabilityTaxonomy({
                capabilities,
                supportedParameters: projection['supportedParameters'],
                modalities: projection['modalities'],
            });
            const eligibility = findEligibility(projection, decisions);
            const eligibilityStatus =
                eligibility?.['include'] === true
                    ? 'eligible'
                    : eligibility
                      ? (optionalString(eligibility['disposition']) ?? 'excluded')
                      : 'unknown';
            const routeOptionCount = countSameModelRows(projection, routeOptions);
            const accountOverlayCount = accountOverlays.filter(
                (overlay) => optionalString(overlay['providerId']) === optionalString(projection['providerId']),
            ).length;
            const score =
                textScore.score +
                routeOptionCount * 3 +
                accountOverlayCount * 2 +
                (eligibilityStatus === 'eligible' ? 10 : eligibilityStatus === 'unknown' ? 0 : -20);
            return {
                key: projectionKey(projection),
                providerId: optionalString(projection['providerId']) ?? 'unknown-provider',
                providerModel: optionalString(projection['providerModel']) ?? 'unknown-model',
                displayName:
                    optionalString(projection['displayName']) ??
                    optionalString(projection['providerModel']) ??
                    'unknown',
                score,
                matched: textScore.matched,
                matchedFields: textScore.matchedFields,
                routeOptionCount,
                accountOverlayCount,
                eligibilityStatus,
                capabilities,
                runtimeAgentic,
                projection,
            };
        })
        .filter((item) => item.matched)
        .filter((item) => !providerFilter || item.providerId.toLowerCase() === providerFilter)
        .filter((item) => !options.onlyEligible || item.eligibilityStatus === 'eligible')
        .filter((item) => !options.requireTools || item.runtimeAgentic['tools'] === true)
        .filter((item) => !options.requireStreaming || item.runtimeAgentic['streaming'] === true)
        .filter((item) => !options.requireReasoning || item.runtimeAgentic['reasoning'] === true)
        .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
        .slice(0, limit)
        .map(({ matched, capabilities, runtimeAgentic, ...item }) => item);
}
