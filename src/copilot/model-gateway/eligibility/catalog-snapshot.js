// @ts-check
/**
 * Batch eligibility evaluation for catalog snapshots.
 *
 * The snapshot evaluator materializes derived decisions from canonical projections, route options and account overlays.
 * It does not refresh metadata and does not execute runtime probes.
 *
 * @module copilot/model-gateway/eligibility/catalog-snapshot
 */

import { createModelEligibilityRun } from './contracts.js';
import { evaluateModelGatewayEligibility } from './evaluator.js';
import { deriveModelGatewayRuntimeAccountOverlaysFromHealth } from '../account-access/index.js';

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
 * @param {Record<string, any>} projection
 * @returns {string}
 */
function projectionRouteKey(projection) {
    return [
        optionalString(projection['providerId']) ?? 'unknown-provider',
        optionalString(projection['providerModel']) ?? 'unknown-model',
        optionalString(projection['routeProfile']) ?? 'default',
    ].join(':');
}

/**
 * @param {Record<string, any>} route
 * @returns {string}
 */
function routeOptionKey(route) {
    return [
        optionalString(route['providerId']) ?? 'unknown-provider',
        optionalString(route['providerModel']) ?? 'unknown-model',
        optionalString(route['routeProfile']) ?? 'default',
    ].join(':');
}

/**
 * @param {Record<string, any>} health
 * @returns {string}
 */
function healthRouteKey(health) {
    return [
        optionalString(health['providerId']) ?? optionalString(health['provider']) ?? 'unknown-provider',
        optionalString(health['providerModel']) ?? optionalString(health['model']) ?? 'unknown-model',
        optionalString(health['routeProfile']) ?? optionalString(health['profile']) ?? 'default',
    ].join(':');
}

/**
 * @param {Record<string, any>} decision
 * @returns {string}
 */
export function modelEligibilityDecisionKey(decision) {
    return [
        optionalString(decision['providerId']) ?? 'unknown-provider',
        optionalString(decision['providerModel']) ?? 'unknown-model',
        optionalString(decision['routeProfile']) ?? 'default',
        optionalString(decision['selectorKind']) ?? 'exact_model',
        optionalString(decision['selectorSyntax']) ?? optionalString(decision['providerModel']) ?? 'unknown-model',
        optionalString(decision['accountScope']) ?? 'default',
        optionalString(decision['policyProfile']) ?? 'default',
        optionalString(decision['taskProfile']) ?? 'default',
    ].join(':');
}

/**
 * @template {Record<string, any>} T
 * @param {T[]} records
 * @param {T[]} additions
 * @param {(record: T) => string} key
 * @returns {T[]}
 */
function upsertMany(records, additions, key) {
    const map = new Map(records.map((record) => [key(record), record]));
    for (const item of additions) map.set(key(item), item);
    return [...map.values()];
}

/**
 * @param {Record<string, any>[]} routeOptions
 * @returns {Map<string, Record<string, any>[]>}
 */
function routeOptionsByProjectionKey(routeOptions) {
    const map = new Map();
    for (const route of routeOptions) {
        if (!isRecord(route)) continue;
        const key = routeOptionKey(route);
        const existing = map.get(key) ?? [];
        existing.push(route);
        map.set(key, existing);
    }
    return map;
}

/**
 * @param {Record<string, any>[]} decisions
 * @returns {{ modelCount: number; eligibleCount: number; unknownCount: number; excludedCount: number }}
 */
function summarizeDecisions(decisions) {
    let eligibleCount = 0;
    let unknownCount = 0;
    let excludedCount = 0;
    for (const decision of decisions) {
        const disposition = optionalString(decision['disposition']) ?? '';
        if (decision['include'] === false) excludedCount += 1;
        else if (disposition.startsWith('unknown')) unknownCount += 1;
        else eligibleCount += 1;
    }
    return {
        modelCount: decisions.length,
        eligibleCount,
        unknownCount,
        excludedCount,
    };
}

/**
 * @param {object} input
 * @param {Record<string, any>} input.snapshot
 * @param {{ has(ref: string): boolean }} [input.secretRegistry]
 * @param {Record<string, any>} [input.policy]
 * @param {Record<string, any>[]} [input.healthRecords]
 * @param {() => Date} [input.now]
 * @returns {{ run: ReturnType<typeof createModelEligibilityRun>; decisions: Record<string, any>[]; summary: ReturnType<typeof summarizeDecisions> }}
 */
export function evaluateModelGatewayCatalogEligibility(input) {
    const now = input.now ?? (() => new Date());
    const startedAt = now();
    const snapshot = isRecord(input.snapshot) ? input.snapshot : {};
    const projections = Array.isArray(snapshot['projections']) ? snapshot['projections'].filter(isRecord) : [];
    const routeOptions = Array.isArray(snapshot['routeOptions']) ? snapshot['routeOptions'].filter(isRecord) : [];
    const snapshotAccountOverlays = Array.isArray(snapshot['accountOverlays']) ? snapshot['accountOverlays'].filter(isRecord) : [];
    const healthRecords = Array.isArray(input.healthRecords) ? input.healthRecords.filter(isRecord) : [];
    const routesByKey = routeOptionsByProjectionKey(routeOptions);
    const policy = isRecord(input.policy) ? input.policy : {};
    const runtimeAccountOverlays = deriveModelGatewayRuntimeAccountOverlaysFromHealth(healthRecords, {
        accountScope: optionalString(policy['accountScope']) ?? 'default',
    });
    const accountOverlays = [...snapshotAccountOverlays, ...runtimeAccountOverlays];
    const healthByKey = new Map(healthRecords.map((record) => [healthRouteKey(record), record]));
    const decisions = projections.flatMap((projection) => {
        const key = projectionRouteKey(projection);
        const matchingRoutes = routesByKey.get(key) ?? [];
        const routes = matchingRoutes.length > 0 ? matchingRoutes : [undefined];
        return routes.map((routeOption) =>
            evaluateModelGatewayEligibility({
                projection,
                routeOption,
                accountOverlays,
                secretRegistry: input.secretRegistry,
                policy,
                health: healthByKey.get(key),
                now: startedAt,
            }),
        );
    });
    const summary = summarizeDecisions(decisions);
    const completedAt = now();
    return {
        run: createModelEligibilityRun({
            runId: `model-gateway:eligibility:${startedAt.toISOString()}`,
            status: 'completed',
            policyProfile: optionalString(policy['policyProfile']) ?? 'default',
            taskProfile: optionalString(policy['taskProfile']) ?? 'default',
            accountScope: optionalString(policy['accountScope']) ?? 'default',
            startedAt,
            completedAt,
            ...summary,
            policyInputs: {
                unknownAccessPolicy: policy['unknownAccessPolicy'] ?? 'allow_probe',
                treatEnabledModelsAsClosed: policy['treatEnabledModelsAsClosed'] ?? true,
                accountOverlayCount: accountOverlays.length,
                runtimeAccountOverlayCount: runtimeAccountOverlays.length,
                healthRecordCount: healthRecords.length,
            },
        }),
        decisions,
        summary,
    };
}

/**
 * @param {Record<string, any>} snapshot
 * @param {Record<string, any>[]} decisions
 * @param {Record<string, any>} run
 * @returns {Record<string, any>}
 */
export function applyModelGatewayEligibilityToSnapshot(snapshot, decisions, run) {
    return {
        ...snapshot,
        source: 'eligibility-refresh',
        modelEligibilityDecisions: upsertMany(
            Array.isArray(snapshot['modelEligibilityDecisions']) ? snapshot['modelEligibilityDecisions'].filter(isRecord) : [],
            decisions,
            modelEligibilityDecisionKey,
        ),
        modelEligibilityRuns: [
            ...(Array.isArray(snapshot['modelEligibilityRuns']) ? snapshot['modelEligibilityRuns'].filter(isRecord) : []),
            run,
        ],
    };
}
