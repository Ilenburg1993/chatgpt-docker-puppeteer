// @ts-check
/**
 * Pure pre-runtime eligibility evaluator.
 *
 * This module combines catalog projections, route options, account overlays, secret presence and policy into a
 * non-runtime decision. It deliberately does not call providers and does not modify canonical catalog records.
 *
 * @module copilot/model-gateway/eligibility/evaluator
 */

import { resolveModelGatewayAccountAccess } from '../account-access/index.js';
import {
    MODEL_GATEWAY_MODEL_LIFECYCLE_STATUS,
    evaluateModelGatewayModelLifecycle,
} from '../contracts/model-lifecycle.js';
import {
    MODEL_GATEWAY_ELIGIBILITY_DISPOSITION,
    MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS,
    MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS,
    createModelEligibilityDecision,
} from './contracts.js';
import { resolveModelGatewayEligibilityPolicy } from './policy-presets.js';

const BUDGET_PRICE_FIELDS = Object.freeze([
    Object.freeze({
        field: 'inputUsdPerMillion',
        pricingKeys: Object.freeze(['inputUsdPerMillion', 'promptUsdPerMillion', 'input_usd_per_million']),
        maxPolicyKey: 'maxInputUsdPerMillion',
        preferredPolicyKey: 'preferredInputUsdPerMillion',
    }),
    Object.freeze({
        field: 'outputUsdPerMillion',
        pricingKeys: Object.freeze(['outputUsdPerMillion', 'completionUsdPerMillion', 'output_usd_per_million']),
        maxPolicyKey: 'maxOutputUsdPerMillion',
        preferredPolicyKey: 'preferredOutputUsdPerMillion',
    }),
    Object.freeze({
        field: 'cacheReadUsdPerMillion',
        pricingKeys: Object.freeze(['cacheReadUsdPerMillion', 'cache_read_usd_per_million']),
        maxPolicyKey: 'maxCacheReadUsdPerMillion',
        preferredPolicyKey: 'preferredCacheReadUsdPerMillion',
    }),
    Object.freeze({
        field: 'cacheWriteUsdPerMillion',
        pricingKeys: Object.freeze(['cacheWriteUsdPerMillion', 'cache_write_usd_per_million']),
        maxPolicyKey: 'maxCacheWriteUsdPerMillion',
        preferredPolicyKey: 'preferredCacheWriteUsdPerMillion',
    }),
    Object.freeze({
        field: 'requestUsd',
        pricingKeys: Object.freeze(['requestUsd', 'request_usd']),
        maxPolicyKey: 'maxRequestUsd',
        preferredPolicyKey: 'preferredRequestUsd',
    }),
    Object.freeze({
        field: 'webSearchUsdPerRequest',
        pricingKeys: Object.freeze(['webSearchUsdPerRequest', 'web_search_usd_per_request']),
        maxPolicyKey: 'maxWebSearchUsdPerRequest',
        preferredPolicyKey: 'preferredWebSearchUsdPerRequest',
    }),
]);

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
function optionalNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function dateMs(value) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
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
 * @param {unknown} value
 * @returns {boolean}
 */
function truthy(value) {
    return value === true;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function keyToken(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase();
}

/**
 * @param {Record<string, unknown>} pricing
 * @param {readonly string[]} keys
 * @returns {number | null}
 */
function pricingNumber(pricing, keys) {
    for (const key of keys) {
        const value = optionalNumber(pricing[key]);
        if (value !== null) return value;
    }
    return null;
}

/**
 * @param {Record<string, unknown>} policy
 * @returns {Record<string, number | boolean>}
 */
function budgetPolicyInputs(policy) {
    const entries = BUDGET_PRICE_FIELDS.flatMap((spec) => [
        [spec.maxPolicyKey, optionalNumber(policy[spec.maxPolicyKey])],
        [spec.preferredPolicyKey, optionalNumber(policy[spec.preferredPolicyKey])],
    ]).filter(([, value]) => value !== null);
    return {
        requireKnownPricing: policy['requireKnownPricing'] === true,
        ...Object.fromEntries(entries),
    };
}

/**
 * @param {Record<string, unknown>} pricing
 * @param {Record<string, unknown>} policy
 * @returns {{ hard: string[]; soft: string[]; reasons: string[]; observed: Record<string, number> }}
 */
function evaluateBudgetPolicy(pricing, policy) {
    const hard = [];
    const soft = [];
    const reasons = [];
    /** @type {Record<string, number>} */
    const observed = {};
    let checkedHardLimit = false;
    let checkedPreference = false;
    let missingRequiredPrice = false;

    for (const spec of BUDGET_PRICE_FIELDS) {
        const price = pricingNumber(pricing, spec.pricingKeys);
        const max = optionalNumber(policy[spec.maxPolicyKey]);
        const preferred = optionalNumber(policy[spec.preferredPolicyKey]);
        if (price !== null) observed[spec.field] = price;
        if (max !== null) checkedHardLimit = true;
        if (preferred !== null) checkedPreference = true;

        if (price === null) {
            if (policy['requireKnownPricing'] === true && (max !== null || preferred !== null))
                missingRequiredPrice = true;
            continue;
        }
        if (max !== null && price > max)
            hard.push(`${MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.BUDGET_EXCEEDED}:${spec.field}`);
        if (preferred !== null && price > preferred) {
            soft.push(`${MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.PRICE_ABOVE_PREFERENCE}:${spec.field}`);
        }
    }

    if (policy['requireKnownPricing'] === true && (Object.keys(pricing).length === 0 || missingRequiredPrice)) {
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.PRICE_UNKNOWN);
    }
    if (
        checkedHardLimit &&
        hard.every((reason) => !reason.startsWith(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.BUDGET_EXCEEDED))
    ) {
        reasons.push('budget_within_hard_limits');
    }
    if (
        checkedPreference &&
        soft.every((reason) => !reason.startsWith(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.PRICE_ABOVE_PREFERENCE))
    ) {
        reasons.push('budget_within_preferences');
    }
    return { hard, soft, reasons, observed };
}

/**
 * @param {string} providerModel
 * @param {unknown} models
 * @returns {boolean}
 */
function modelListIncludes(providerModel, models) {
    const target = keyToken(providerModel);
    return stringList(models).some((model) => keyToken(model) === target);
}

/**
 * @param {Record<string, unknown>} routeOption
 * @param {Record<string, unknown>} projection
 * @returns {string}
 */
function readProviderId(routeOption, projection) {
    return optionalString(routeOption['providerId']) ?? optionalString(projection['providerId']) ?? 'unknown-provider';
}

/**
 * @param {Record<string, unknown>} routeOption
 * @param {Record<string, unknown>} projection
 * @returns {string}
 */
function readProviderModel(routeOption, projection) {
    return (
        optionalString(routeOption['providerModel']) ??
        optionalString(projection['providerModel']) ??
        optionalString(projection['id']) ??
        'unknown-model'
    );
}

/**
 * @param {Record<string, unknown>} routeOption
 * @returns {Record<string, unknown>}
 */
function routePolicy(routeOption) {
    return isRecord(routeOption['normalizedPolicy']) ? routeOption['normalizedPolicy'] : {};
}

/**
 * @param {Record<string, unknown>} routeOption
 * @returns {Record<string, unknown>}
 */
function routeProviderSpecific(routeOption) {
    return isRecord(routeOption['providerSpecific']) ? routeOption['providerSpecific'] : {};
}

/**
 * @param {Record<string, unknown>} routeOption
 * @returns {Record<string, unknown>}
 */
function routeTraits(routeOption) {
    const policy = routePolicy(routeOption);
    return isRecord(policy['routeTraits']) ? policy['routeTraits'] : {};
}

/**
 * @param {Record<string, unknown>} routeOption
 * @param {Record<string, unknown>} routePolicyRecord
 * @returns {{ routeLayer: string | null; wireApi: string | null; upstreamProvider: string | null }}
 */
function routeEligibilityContext(routeOption, routePolicyRecord) {
    const providerSpecific = routeProviderSpecific(routeOption);
    const traits = routeTraits(routeOption);
    return {
        routeLayer:
            optionalString(routePolicyRecord['routeLayer']) ??
            optionalString(routePolicyRecord['directRouteLayer']) ??
            optionalString(traits['routeLayer']),
        wireApi:
            optionalString(routePolicyRecord['wireApi']) ??
            optionalString(routePolicyRecord['directWireApi']) ??
            optionalString(traits['wireApi']),
        upstreamProvider:
            optionalString(providerSpecific['upstreamProvider']) ??
            optionalString(routePolicyRecord['upstreamProvider']) ??
            optionalString(traits['upstreamProvider']),
    };
}

/**
 * @param {Set<string>} allowSet
 * @param {string | null} value
 * @returns {boolean}
 */
function allowedByOptionalSet(allowSet, value) {
    return allowSet.size === 0 || (value !== null && allowSet.has(keyToken(value)));
}

/**
 * @param {Set<string>} blockSet
 * @param {string | null} value
 * @returns {boolean}
 */
function blockedBySet(blockSet, value) {
    return value !== null && blockSet.has(keyToken(value));
}

/**
 * @param {Record<string, unknown>} projection
 * @returns {Record<string, unknown>}
 */
function lifecycle(projection) {
    return isRecord(projection['lifecycle']) ? projection['lifecycle'] : {};
}

/**
 * @param {Record<string, unknown>[]} overlays
 * @returns {Record<string, unknown>}
 */
function mergedOverlayMetadata(overlays) {
    return Object.assign(
        {},
        ...overlays.map((overlay) => (isRecord(overlay['providerMetadata']) ? overlay['providerMetadata'] : {})),
    );
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function errorContextText(value) {
    const text = optionalString(value);
    if (text) return text;
    if (Array.isArray(value)) return value.map(errorContextText).filter(Boolean).join(' ');
    if (isRecord(value)) return Object.values(value).map(errorContextText).filter(Boolean).join(' ');
    return '';
}

/**
 * @param {Record<string, unknown>} health
 * @param {number} nowMs
 * @returns {boolean}
 */
function isFatalHealth(health, nowMs) {
    const status = optionalString(health['lastStatus']);
    const failureContext = [errorContextText(health['lastErrorContext']), errorContextText(health['lastMessage'])]
        .filter(Boolean)
        .join(' ');
    if (status !== 'failed') return false;
    if (
        !/(?:auth|unauthori[sz]ed|permission|forbidden|not[_ -]?found|quota|billing|rate[_ -]?limit)/iu.test(
            failureContext,
        )
    ) {
        return false;
    }
    const resetAtMs = dateMs(health['lastResetAt']);
    if (resetAtMs !== null && resetAtMs <= nowMs) return false;
    const retryAfterSeconds = optionalNumber(health['lastRetryAfterSeconds']);
    const lastFailureAtMs = dateMs(health['lastFailureAt']);
    if (
        retryAfterSeconds !== null &&
        retryAfterSeconds > 0 &&
        lastFailureAtMs !== null &&
        lastFailureAtMs + retryAfterSeconds * 1000 <= nowMs
    ) {
        return false;
    }
    return true;
}

/**
 * @param {object} input
 * @param {Record<string, unknown>} input.projection
 * @param {Record<string, unknown> | undefined} [input.routeOption]
 * @param {Record<string, unknown>[]} [input.accountOverlays]
 * @param {{ has(ref: string): boolean } | undefined} [input.secretRegistry]
 * @param {Record<string, unknown>} [input.policy]
 * @param {Record<string, unknown> | undefined} [input.health]
 * @param {string | number | Date | undefined} [input.now]
 */
export function evaluateModelGatewayEligibility(input) {
    const projection = isRecord(input.projection) ? input.projection : {};
    const routeOption = isRecord(input.routeOption) ? input.routeOption : {};
    const nowMs = dateMs(input.now) ?? Date.now();
    const providerId = readProviderId(routeOption, projection);
    const providerModel = readProviderModel(routeOption, projection);
    const selectorSyntax =
        optionalString(routeOption['selectorSyntax']) ?? optionalString(projection['selectorSyntax']) ?? providerModel;
    const policy = /** @type {Record<string, unknown>} */ (resolveModelGatewayEligibilityPolicy(input.policy));
    const accountScope = optionalString(policy['accountScope']);
    const hard = [];
    const soft = [];
    const reasons = [];
    const routePolicyRecord = routePolicy(routeOption);
    const routeTraitsRecord = routeTraits(routeOption);
    const access = resolveModelGatewayAccountAccess({
        providerId,
        providerModel,
        providerModelAliases: [selectorSyntax],
        accountScope,
        accountOverlays: Array.isArray(input.accountOverlays) ? input.accountOverlays.filter(isRecord) : [],
        secretRegistry: input.secretRegistry,
        secretRef: optionalString(policy['secretRef']) ?? optionalString(routePolicyRecord['secretRef']),
        requireAccountOverlay: policy['requireAccountOverlay'] === true,
        requireFreshAccountOverlay: policy['requireFreshAccountOverlay'] === true,
        allowExpiredAccountOverlay: policy['allowExpiredAccountOverlay'] === true,
        ...(optionalString(policy['unknownAccessPolicy']) !== null
            ? { unknownAccessPolicy: optionalString(policy['unknownAccessPolicy']) ?? 'allow_probe' }
            : {}),
        ...(typeof policy['treatEnabledModelsAsClosed'] === 'boolean'
            ? { treatEnabledModelsAsClosed: policy['treatEnabledModelsAsClosed'] }
            : {}),
        localPrivate: truthy(routeTraitsRecord['localPrivate']),
        now: input.now,
    });
    const overlays = access.overlays;
    const overlayMetadata = mergedOverlayMetadata(overlays);
    const secretRef = access.secretRef;

    const allowProviders = new Set(stringList(policy['allowProviders']));
    const blockProviders = new Set(stringList(policy['blockProviders']));
    const allowModels = new Set(stringList(policy['allowModels']).map(keyToken));
    const blockModels = new Set(stringList(policy['blockModels']).map(keyToken));
    const allowUpstreamProviders = new Set(stringList(policy['allowUpstreamProviders']).map(keyToken));
    const blockUpstreamProviders = new Set(stringList(policy['blockUpstreamProviders']).map(keyToken));
    const allowRouteLayers = new Set(stringList(policy['allowRouteLayers']).map(keyToken));
    const blockRouteLayers = new Set(stringList(policy['blockRouteLayers']).map(keyToken));
    const allowWireApis = new Set(stringList(policy['allowWireApis']).map(keyToken));
    const blockWireApis = new Set(stringList(policy['blockWireApis']).map(keyToken));
    const routeContext = routeEligibilityContext(routeOption, routePolicyRecord);

    if (allowProviders.size > 0 && !allowProviders.has(providerId))
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.PROVIDER_NOT_ALLOWED);
    if (blockProviders.has(providerId)) hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.PROVIDER_BLOCKED);
    if (!allowedByOptionalSet(allowUpstreamProviders, routeContext.upstreamProvider)) {
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.UPSTREAM_PROVIDER_NOT_ALLOWED);
    }
    if (blockedBySet(blockUpstreamProviders, routeContext.upstreamProvider)) {
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.UPSTREAM_PROVIDER_BLOCKED);
    }
    if (!allowedByOptionalSet(allowRouteLayers, routeContext.routeLayer)) {
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.ROUTE_LAYER_NOT_ALLOWED);
    }
    if (blockedBySet(blockRouteLayers, routeContext.routeLayer)) {
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.ROUTE_LAYER_BLOCKED);
    }
    if (!allowedByOptionalSet(allowWireApis, routeContext.wireApi)) {
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.WIRE_API_NOT_ALLOWED);
    }
    if (blockedBySet(blockWireApis, routeContext.wireApi))
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.WIRE_API_BLOCKED);
    const routeIdentityTokens = [providerModel, selectorSyntax].map(keyToken);
    if (allowModels.size > 0 && routeIdentityTokens.every((token) => !allowModels.has(token))) {
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.MODEL_NOT_ALLOWED);
    }
    if (routeIdentityTokens.some((token) => blockModels.has(token)))
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.MODEL_BLOCKED);
    if (projection['enabled'] === false) hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.MODEL_DISABLED);

    const lifecycleRecord = lifecycle(projection);
    const lifecycleStatus = optionalString(lifecycleRecord['status']) ?? optionalString(projection['lifecycle']);
    const canonicalLifecycle = evaluateModelGatewayModelLifecycle(
        lifecycleStatus ? { ...projection, lifecycle: { ...lifecycleRecord, status: lifecycleStatus } } : projection,
        { now: nowMs },
    );
    if (canonicalLifecycle.status === MODEL_GATEWAY_MODEL_LIFECYCLE_STATUS.RETIRED && policy['allowRetired'] !== true) {
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.MODEL_RETIRED);
    }
    if (canonicalLifecycle.status === MODEL_GATEWAY_MODEL_LIFECYCLE_STATUS.EXPIRED) {
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.MODEL_EXPIRED);
    }
    if (canonicalLifecycle.status === MODEL_GATEWAY_MODEL_LIFECYCLE_STATUS.DEPRECATED) {
        soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.DEPRECATED_MODEL);
    }
    if (lifecycleStatus === 'preview') soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.PREVIEW_MODEL);

    hard.push(...access.hardReasons);
    soft.push(...access.softReasons);
    reasons.push(...access.reasons);

    if (providerId === 'cloudflare-workers-ai') {
        const wireApi = optionalString(routePolicyRecord['wireApi']);
        if (wireApi === 'workers_ai_run' && overlayMetadata['accountIdConfigured'] === false) {
            hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.CLOUDFLARE_ACCOUNT_ID_MISSING);
        }
        if (wireApi === 'cloudflare_ai_gateway_universal') {
            if (overlayMetadata['accountIdConfigured'] === false) {
                hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.CLOUDFLARE_ACCOUNT_ID_MISSING);
            }
            if (overlayMetadata['gatewayIdConfigured'] === false) {
                hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.CLOUDFLARE_GATEWAY_ID_MISSING);
            }
        }
    }

    if (truthy(routeTraitsRecord['localPrivate']) && overlays.length > 0) {
        const installed = overlays.some((overlay) => modelListIncludes(providerModel, overlay['enabledModels']));
        if (!installed) hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.OLLAMA_LOCAL_MODEL_NOT_INSTALLED);
    }

    if (policy['excludeFailedHealth'] !== false && isRecord(input.health) && isFatalHealth(input.health, nowMs)) {
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.HEALTH_FATAL);
    }

    const pricing = isRecord(projection['pricing']) ? projection['pricing'] : {};
    if (Object.keys(pricing).length === 0) soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.PRICE_UNKNOWN);
    const budgetDecision = evaluateBudgetPolicy(pricing, policy);
    hard.push(...budgetDecision.hard);
    soft.push(...budgetDecision.soft);
    reasons.push(...budgetDecision.reasons);
    const confidenceByField = isRecord(projection['confidenceByField']) ? projection['confidenceByField'] : {};
    if (Object.values(confidenceByField).some((value) => value === 'heuristic' || value === 'unknown')) {
        soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.LOW_CONFIDENCE);
    }
    if (routeTraitsRecord['autoSelection'] === true)
        soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.ROUTE_AUTO_SELECTS_UPSTREAM);

    const uniqueHard = [...new Set(hard)];
    const uniqueSoft = [...new Set(soft)];
    const include = uniqueHard.length === 0;
    const accessUnknown = uniqueHard.includes(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.ACCOUNT_ACCESS_UNKNOWN);
    const disposition = include
        ? uniqueSoft.includes(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.ACCOUNT_VISIBILITY_UNKNOWN)
            ? MODEL_GATEWAY_ELIGIBILITY_DISPOSITION.UNKNOWN_ALLOWED
            : MODEL_GATEWAY_ELIGIBILITY_DISPOSITION.ELIGIBLE
        : accessUnknown
          ? MODEL_GATEWAY_ELIGIBILITY_DISPOSITION.UNKNOWN_BLOCKED
          : uniqueHard.some((reason) => reason.startsWith(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.SECRET_MISSING))
            ? MODEL_GATEWAY_ELIGIBILITY_DISPOSITION.DEFERRED_MISSING_SECRET
            : uniqueHard.includes(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.ACCOUNT_OVERLAY_MISSING)
              ? MODEL_GATEWAY_ELIGIBILITY_DISPOSITION.DEFERRED_MISSING_OVERLAY
              : MODEL_GATEWAY_ELIGIBILITY_DISPOSITION.EXCLUDED;

    return createModelEligibilityDecision({
        providerId,
        providerModel,
        routeProfile:
            optionalString(routeOption['routeProfile']) ?? optionalString(projection['routeProfile']) ?? undefined,
        selectorKind: optionalString(routeOption['selectorKind']) ?? 'exact_model',
        selectorSyntax,
        accountScope: accountScope ?? 'default',
        secretRef: secretRef ?? undefined,
        policyProfile: optionalString(policy['policyProfile']) ?? 'default',
        taskProfile: optionalString(policy['taskProfile']) ?? 'default',
        include,
        disposition,
        hardExclusions: uniqueHard,
        softPenalties: uniqueSoft,
        reasons,
        requiredRuntimeProbes: stringList(policy['defaultRuntimeProbes']),
        overlayRefs: access.overlayRefs,
        routeOptionRefs: [
            [
                optionalString(routeOption['providerId']) ?? providerId,
                optionalString(routeOption['providerModel']) ?? providerModel,
                optionalString(routeOption['selectorKind']) ?? 'exact_model',
                selectorSyntax,
            ].join(':'),
        ],
        policyInputs: {
            unknownAccessPolicy: policy['unknownAccessPolicy'],
            treatEnabledModelsAsClosed: policy['treatEnabledModelsAsClosed'],
            allowRetired: policy['allowRetired'],
            excludeFailedHealth: policy['excludeFailedHealth'],
            policyPreset: policy['policyPreset'],
            routeContext,
            accountAccess: {
                status: access.status,
                canAttempt: access.canAttempt,
                secretConfigured: access.secretConfigured,
                modelVisible: access.modelVisible,
                modelIdentifiers: access.modelIdentifiers,
                accessConfidence: access.accessConfidence,
                failureClass: access.failureClass,
                resetWindows: access.resetWindows,
            },
            budget: {
                ...budgetPolicyInputs(policy),
                observedPricing: budgetDecision.observed,
            },
        },
    });
}
