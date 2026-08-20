// @ts-check
/**
 * Batch eligibility evaluation for catalog snapshots.
 *
 * The snapshot evaluator materializes derived decisions from canonical projections, route options and account overlays.
 * It does not refresh metadata and does not execute runtime probes.
 *
 * @module copilot/model-gateway/eligibility/catalog-snapshot
 */

import {
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    summarizeModelGatewayRuntimeAccountOverlays,
} from '../account-access/index.js';
import { createModelEligibilityRun } from './contracts.js';
import { evaluateModelGatewayEligibility } from './evaluator.js';

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
 * @param {Record<string, unknown>} projection
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
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
function catalogModelRouteKey(record) {
    return [
        optionalString(record['providerId']) ?? 'unknown-provider',
        optionalString(record['providerModel']) ?? 'unknown-model',
        optionalString(record['routeProfile']) ?? 'default',
    ].join(':');
}

/**
 * @param {Record<string, unknown>} route
 * @returns {string}
 */
function routeOptionKey(route) {
    return catalogModelRouteKey(route);
}

/**
 * @param {Record<string, unknown>} health
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
 * @param {object} decision
 * @returns {string}
 */
export function modelEligibilityDecisionKey(decision) {
    const providerModel = optionalString(Reflect.get(decision, 'providerModel')) ?? 'unknown-model';
    return [
        optionalString(Reflect.get(decision, 'providerId')) ?? 'unknown-provider',
        providerModel,
        optionalString(Reflect.get(decision, 'routeProfile')) ?? 'default',
        optionalString(Reflect.get(decision, 'selectorKind')) ?? 'exact_model',
        optionalString(Reflect.get(decision, 'selectorSyntax')) ?? providerModel,
        optionalString(Reflect.get(decision, 'accountScope')) ?? 'default',
        optionalString(Reflect.get(decision, 'policyProfile')) ?? 'default',
        optionalString(Reflect.get(decision, 'taskProfile')) ?? 'default',
    ].join(':');
}

/**
 * @template {object} TExisting
 * @template {object} TAddition
 * @param {TExisting[]} records
 * @param {TAddition[]} additions
 * @param {(record: TExisting | TAddition) => string} key
 * @returns {(TExisting | TAddition)[]}
 */
function upsertMany(records, additions, key) {
    /** @type {Map<string, TExisting | TAddition>} */
    const map = new Map(records.map((record) => [key(record), record]));
    for (const item of additions) map.set(key(item), item);
    return [...map.values()];
}

/**
 * @param {Record<string, unknown>[]} routeOptions
 * @returns {Map<string, Record<string, unknown>[]>}
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
 * @param {Record<string, unknown>} snapshot
 * @returns {Set<string>}
 */
function currentCatalogRouteKeys(snapshot) {
    const projections = Array.isArray(snapshot['projections']) ? snapshot['projections'].filter(isRecord) : [];
    const routeOptions = Array.isArray(snapshot['routeOptions']) ? snapshot['routeOptions'].filter(isRecord) : [];
    return new Set([...projections, ...routeOptions].map(catalogModelRouteKey));
}

/**
 * @param {Record<string, unknown>[]} decisions
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
 * @param {Record<string, unknown>} input.snapshot
 * @param {{ has(ref: string): boolean } | undefined} [input.secretRegistry]
 * @param {Record<string, unknown> | undefined} [input.policy]
 * @param {Record<string, unknown>[] | undefined} [input.healthRecords]
 * @param {() => Date} [input.now]
 */
export function evaluateModelGatewayCatalogEligibility(input) {
    const now = input.now ?? (() => new Date());
    const startedAt = now();
    const snapshot = isRecord(input.snapshot) ? input.snapshot : {};
    const projections = Array.isArray(snapshot['projections']) ? snapshot['projections'].filter(isRecord) : [];
    const routeOptions = Array.isArray(snapshot['routeOptions']) ? snapshot['routeOptions'].filter(isRecord) : [];
    const snapshotAccountOverlays = Array.isArray(snapshot['accountOverlays'])
        ? snapshot['accountOverlays'].filter(isRecord)
        : [];
    const healthRecords = Array.isArray(input.healthRecords) ? input.healthRecords.filter(isRecord) : [];
    const routesByKey = routeOptionsByProjectionKey(routeOptions);
    const policy = isRecord(input.policy) ? input.policy : {};
    const runtimeAccountOverlays = deriveModelGatewayRuntimeAccountOverlaysFromHealth(healthRecords, {
        accountScope: optionalString(policy['accountScope']) ?? 'default',
        accountWideFailureKinds: Array.isArray(policy['runtimeAccountWideFailureKinds'])
            ? policy['runtimeAccountWideFailureKinds'].map(optionalString).filter((item) => item !== null)
            : [],
    });
    const runtimeAccountOverlaySummary = summarizeModelGatewayRuntimeAccountOverlays(runtimeAccountOverlays, {
        now: startedAt,
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
                runtimeAccountOverlayActiveCount: runtimeAccountOverlaySummary.activeCount,
                runtimeAccountOverlayExpiredCount: runtimeAccountOverlaySummary.expiredCount,
                healthRecordCount: healthRecords.length,
            },
        }),
        decisions,
        summary,
    };
}

/**
 * @template {Record<string, unknown>} TSnapshot
 * @param {TSnapshot} snapshot
 * @param {ReturnType<typeof import('./contracts.js').createModelEligibilityDecision>[]} decisions
 * @param {ReturnType<typeof createModelEligibilityRun>} run
 */
export function applyModelGatewayEligibilityToSnapshot(snapshot, decisions, run) {
    const currentKeys = currentCatalogRouteKeys(snapshot);
    const previousDecisions = Array.isArray(snapshot['modelEligibilityDecisions'])
        ? snapshot['modelEligibilityDecisions'].filter(isRecord)
        : [];
    const retainedDecisions = previousDecisions.filter((decision) => currentKeys.has(catalogModelRouteKey(decision)));
    return {
        ...snapshot,
        source: 'eligibility-refresh',
        modelEligibilityDecisions: upsertMany(retainedDecisions, decisions, modelEligibilityDecisionKey),
        modelEligibilityRuns: [
            ...(Array.isArray(snapshot['modelEligibilityRuns'])
                ? snapshot['modelEligibilityRuns'].filter(isRecord)
                : []),
            run,
        ],
    };
}
