// @ts-check
/**
 * Pure pre-runtime eligibility evaluator.
 *
 * This module combines catalog projections, route options, account overlays, secret presence and policy into a
 * non-runtime decision. It deliberately does not call providers and does not modify canonical catalog records.
 *
 * @module copilot/model-gateway/eligibility/evaluator
 */

import {
    MODEL_GATEWAY_ELIGIBILITY_DISPOSITION,
    MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS,
    MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS,
    createModelEligibilityDecision,
} from './contracts.js';

const DEFAULT_POLICY = Object.freeze({
    unknownAccessPolicy: 'allow_probe',
    treatEnabledModelsAsClosed: true,
    allowRetired: false,
    excludeFailedHealth: true,
    defaultRuntimeProbes: Object.freeze(['chat']),
});

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
    return String(value ?? '').trim().toLowerCase();
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
 * @param {Record<string, any>} routeOption
 * @param {Record<string, any>} projection
 * @returns {string}
 */
function readProviderId(routeOption, projection) {
    return optionalString(routeOption['providerId']) ?? optionalString(projection['providerId']) ?? 'unknown-provider';
}

/**
 * @param {Record<string, any>} routeOption
 * @param {Record<string, any>} projection
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
 * @param {Record<string, any>} routeOption
 * @returns {Record<string, any>}
 */
function routePolicy(routeOption) {
    return isRecord(routeOption['normalizedPolicy']) ? routeOption['normalizedPolicy'] : {};
}

/**
 * @param {Record<string, any>} routeOption
 * @returns {Record<string, any>}
 */
function routeTraits(routeOption) {
    const policy = routePolicy(routeOption);
    return isRecord(policy['routeTraits']) ? policy['routeTraits'] : {};
}

/**
 * @param {Record<string, any>} projection
 * @returns {Record<string, any>}
 */
function lifecycle(projection) {
    return isRecord(projection['lifecycle']) ? projection['lifecycle'] : {};
}

/**
 * @param {Record<string, any>} overlay
 * @param {string} providerId
 * @param {string | null} accountScope
 * @returns {boolean}
 */
function overlayMatches(overlay, providerId, accountScope) {
    if (optionalString(overlay['providerId']) !== providerId) return false;
    if (accountScope && optionalString(overlay['accountScope']) !== accountScope) return false;
    return true;
}

/**
 * @param {Record<string, any>[]} overlays
 * @param {string} providerId
 * @param {string | null} accountScope
 * @returns {Record<string, any>[]}
 */
function matchingOverlays(overlays, providerId, accountScope) {
    return overlays.filter((overlay) => overlayMatches(overlay, providerId, accountScope));
}

/**
 * @param {Record<string, any>[]} overlays
 * @returns {string | null}
 */
function firstSecretRef(overlays) {
    for (const overlay of overlays) {
        const secretRef = optionalString(overlay['secretRef']);
        if (secretRef) return secretRef;
    }
    return null;
}

/**
 * @param {Record<string, any>[]} overlays
 * @returns {Record<string, any>}
 */
function mergedOverlayMetadata(overlays) {
    return Object.assign(
        {},
        ...overlays.map((overlay) => (isRecord(overlay['providerMetadata']) ? overlay['providerMetadata'] : {})),
    );
}

/**
 * @param {Record<string, any>} health
 * @returns {boolean}
 */
function isFatalHealth(health) {
    const status = optionalString(health['lastStatus']);
    const failureContext = optionalString(health['lastErrorContext']) ?? optionalString(health['lastMessage']) ?? '';
    return (
        status === 'failed' &&
        /(?:auth|unauthori[sz]ed|permission|forbidden|not[_ -]?found|quota|billing|rate[_ -]?limit)/iu.test(failureContext)
    );
}

/**
 * @param {object} input
 * @param {Record<string, any>} input.projection
 * @param {Record<string, any>} [input.routeOption]
 * @param {Record<string, any>[]} [input.accountOverlays]
 * @param {{ has(ref: string): boolean }} [input.secretRegistry]
 * @param {Record<string, any>} [input.policy]
 * @param {Record<string, any>} [input.health]
 * @returns {ReturnType<typeof createModelEligibilityDecision>}
 */
export function evaluateModelGatewayEligibility(input) {
    const projection = isRecord(input.projection) ? input.projection : {};
    const routeOption = isRecord(input.routeOption) ? input.routeOption : {};
    const providerId = readProviderId(routeOption, projection);
    const providerModel = readProviderModel(routeOption, projection);
    const policy = /** @type {Record<string, any>} */ ({ ...DEFAULT_POLICY, ...(isRecord(input.policy) ? input.policy : {}) });
    const accountScope = optionalString(policy['accountScope']);
    const overlays = matchingOverlays(
        Array.isArray(input.accountOverlays) ? input.accountOverlays.filter(isRecord) : [],
        providerId,
        accountScope,
    );
    const hard = [];
    const soft = [];
    const reasons = [];
    const routePolicyRecord = routePolicy(routeOption);
    const routeTraitsRecord = routeTraits(routeOption);
    const overlayMetadata = mergedOverlayMetadata(overlays);
    const secretRef = optionalString(policy['secretRef']) ?? optionalString(routePolicyRecord['secretRef']) ?? firstSecretRef(overlays);

    const allowProviders = new Set(stringList(policy['allowProviders']));
    const blockProviders = new Set(stringList(policy['blockProviders']));
    const allowModels = new Set(stringList(policy['allowModels']).map(keyToken));
    const blockModels = new Set(stringList(policy['blockModels']).map(keyToken));

    if (allowProviders.size > 0 && !allowProviders.has(providerId)) hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.PROVIDER_NOT_ALLOWED);
    if (blockProviders.has(providerId)) hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.PROVIDER_BLOCKED);
    if (allowModels.size > 0 && !allowModels.has(keyToken(providerModel))) hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.MODEL_NOT_ALLOWED);
    if (blockModels.has(keyToken(providerModel))) hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.MODEL_BLOCKED);
    if (projection['enabled'] === false) hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.MODEL_DISABLED);

    const lifecycleStatus = optionalString(lifecycle(projection)['status']) ?? optionalString(projection['lifecycle']);
    if (lifecycleStatus === 'retired' && policy['allowRetired'] !== true) hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.MODEL_RETIRED);
    if (lifecycleStatus === 'preview') soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.PREVIEW_MODEL);

    if (secretRef) {
        if (input.secretRegistry && !input.secretRegistry.has(secretRef)) {
            hard.push(`${MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.SECRET_MISSING}:${secretRef}`);
        } else {
            reasons.push(`secret_configured:${secretRef}`);
        }
    } else if (!truthy(routeTraitsRecord['localPrivate'])) {
        soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.ACCOUNT_VISIBILITY_UNKNOWN);
    }

    if (overlays.length === 0) {
        if (policy['requireAccountOverlay'] === true) hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.ACCOUNT_OVERLAY_MISSING);
        else soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.ACCOUNT_OVERLAY_MISSING);
        if (policy['unknownAccessPolicy'] === 'block') hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.ACCOUNT_ACCESS_UNKNOWN);
    } else {
        reasons.push('account_overlay_available');
        const blocked = overlays.some((overlay) => modelListIncludes(providerModel, overlay['blockedModels']));
        if (blocked) hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.ACCOUNT_MODEL_BLOCKED);
        const overlaysWithEnabledModels = overlays.filter((overlay) => stringList(overlay['enabledModels']).length > 0);
        const visible = overlaysWithEnabledModels.some((overlay) => modelListIncludes(providerModel, overlay['enabledModels']));
        if (visible) reasons.push('account_model_visible');
        else if (overlaysWithEnabledModels.length > 0 && policy['treatEnabledModelsAsClosed'] !== false) {
            hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.ACCOUNT_MODEL_NOT_VISIBLE);
        } else {
            soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.ACCOUNT_VISIBILITY_UNKNOWN);
        }
    }

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

    if (policy['excludeFailedHealth'] !== false && isRecord(input.health) && isFatalHealth(input.health)) {
        hard.push(MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS.HEALTH_FATAL);
    }

    const pricing = isRecord(projection['pricing']) ? projection['pricing'] : {};
    if (Object.keys(pricing).length === 0) soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.PRICE_UNKNOWN);
    const confidenceByField = isRecord(projection['confidenceByField']) ? projection['confidenceByField'] : {};
    if (Object.values(confidenceByField).some((value) => value === 'heuristic' || value === 'unknown')) {
        soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.LOW_CONFIDENCE);
    }
    if (routeTraitsRecord['autoSelection'] === true) soft.push(MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS.ROUTE_AUTO_SELECTS_UPSTREAM);

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
        routeProfile: optionalString(routeOption['routeProfile']) ?? optionalString(projection['routeProfile']) ?? undefined,
        selectorKind: optionalString(routeOption['selectorKind']) ?? 'exact_model',
        selectorSyntax: optionalString(routeOption['selectorSyntax']) ?? providerModel,
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
        overlayRefs: overlays.map((overlay) => optionalString(overlay['accountOverlayId'])).filter((id) => id !== null),
        routeOptionRefs: [
            [
                optionalString(routeOption['providerId']) ?? providerId,
                optionalString(routeOption['providerModel']) ?? providerModel,
                optionalString(routeOption['selectorKind']) ?? 'exact_model',
                optionalString(routeOption['selectorSyntax']) ?? providerModel,
            ].join(':'),
        ],
        policyInputs: {
            unknownAccessPolicy: policy['unknownAccessPolicy'],
            treatEnabledModelsAsClosed: policy['treatEnabledModelsAsClosed'],
            allowRetired: policy['allowRetired'],
            excludeFailedHealth: policy['excludeFailedHealth'],
        },
    });
}
