// @ts-check
/**
 * Canonical direct-versus-ingress binding strategy for Model Gateway routes.
 *
 * Protocol compatibility and direct same-session rebind reliability are deliberately separate dimensions. The public
 * Copilot SDK documents ProviderConfig support for OpenAI-compatible, Azure and Anthropic providers, but it does not
 * guarantee that changing every provider/config combination during resumeSession is reliable. This resolver therefore
 * consumes explicit/runtime evidence first, falls back to provider traits, and only selects the current Chat
 * Completions ingress when doing so preserves protocol semantics.
 *
 * @module copilot/model-gateway/ingress/binding-strategy
 */

import { resolveProviderGatewayTraits } from '../providers/traits.js';

export const MODEL_GATEWAY_BINDING_STRATEGIES = Object.freeze({
    AUTO: 'auto',
    DIRECT: 'direct',
    INGRESS: 'ingress',
    BLOCKED: 'blocked',
});

export const MODEL_GATEWAY_DIRECT_REBIND_RELIABILITY = Object.freeze({
    PROVEN: 'proven',
    DOCUMENTED: 'documented',
    UNKNOWN: 'unknown',
    UNRELIABLE: 'unreliable',
    UNSUPPORTED: 'unsupported',
});

export const MODEL_GATEWAY_UNKNOWN_REBIND_POLICIES = Object.freeze({
    PREFER_DIRECT: 'prefer_direct_when_unknown',
    PREFER_INGRESS: 'prefer_ingress_when_unknown',
});

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function boolean(value) {
    return typeof value === 'boolean' ? value : null;
}

/**
 * @param {string | null} value
 * @returns {string | null}
 */
function safeConcreteHttpUrl(value) {
    if (!value || /\{[^}]+\}/u.test(value)) return null;
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
        return value.replace(/\/+$/u, '');
    } catch {
        return null;
    }
}

/**
 * @param {unknown} value
 * @returns {'proven' | 'documented' | 'unknown' | 'unreliable' | 'unsupported' | null}
 */
function reliability(value) {
    const normalized =
        text(value)
            ?.toLowerCase()
            .replace(/[\s-]+/gu, '_') ?? null;
    if (!normalized) return null;
    if (['proven', 'verified', 'reliable', 'runtime_proven'].includes(normalized)) return 'proven';
    if (['documented', 'supported', 'supported_unproven', 'sdk_documented'].includes(normalized)) return 'documented';
    if (['unreliable', 'failed', 'degraded', 'not_reliable'].includes(normalized)) return 'unreliable';
    if (['unsupported', 'not_supported', 'impossible'].includes(normalized)) return 'unsupported';
    if (['unknown', 'unproven'].includes(normalized)) return 'unknown';
    return null;
}

/**
 * @param {Record<string, unknown>} route
 * @param {string} providerId
 * @param {Record<string, unknown> | null} traits
 * @returns {'openai' | 'azure' | 'anthropic' | 'unknown'}
 */
function sdkProviderType(route, providerId, traits) {
    const provider = record(route['provider']);
    const explicit = text(route['providerType']) ?? text(provider?.['type']);
    if (explicit === 'anthropic' || providerId === 'anthropic' || providerId === 'claude') return 'anthropic';
    if (explicit === 'azure' || providerId === 'azure' || providerId === 'azure-openai') return 'azure';
    if (explicit === 'openai' || route['openAICompatible'] === true || traits?.['openAICompatible'] === true) {
        return 'openai';
    }
    return 'unknown';
}

/**
 * @param {Record<string, unknown>} route
 * @returns {'completions' | 'responses' | 'messages' | null}
 */
function routeWireProtocol(route) {
    const raw =
        text(route['wireApi']) ??
        text(record(route['routing'])?.['wireApi']) ??
        text(record(route['normalizedPolicy'])?.['wireApi']) ??
        text(route['runtimeKind']);
    const normalized = raw?.toLowerCase().replace(/[\s-]+/gu, '_') ?? null;
    if (!normalized) return null;
    if (['completions', 'chat_completions', 'openai_chat_completions'].includes(normalized)) return 'completions';
    if (['responses', 'openai_responses'].includes(normalized)) return 'responses';
    if (['messages', 'anthropic_messages'].includes(normalized)) return 'messages';
    return null;
}

/**
 * @param {Record<string, unknown>} route
 * @param {Record<string, unknown> | null} traits
 * @returns {string | null}
 */
function routeBaseUrl(route, traits) {
    const routing = record(route['routing']);
    const policy = record(route['normalizedPolicy']);
    const explicit =
        text(route['openAICompatibleBaseUrl']) ??
        text(route['baseUrl']) ??
        text(route['endpoint']) ??
        text(routing?.['openAICompatibleBaseUrl']) ??
        text(routing?.['baseUrl']) ??
        text(policy?.['openAICompatibleBaseUrl']) ??
        text(policy?.['baseUrl']);
    const safeExplicit = safeConcreteHttpUrl(explicit);
    if (safeExplicit) return safeExplicit;
    const traitUrls = Array.isArray(traits?.['baseUrls']) ? traits['baseUrls'] : [];
    for (const candidate of traitUrls) {
        const safe = safeConcreteHttpUrl(text(candidate));
        if (safe) return safe;
    }
    return null;
}

/**
 * @param {Record<string, unknown>} route
 * @returns {Record<string, unknown> | null}
 */
function explicitBindingEvidence(route) {
    return record(route['bindingCapabilities']) ?? record(route['bindingDecision']) ?? null;
}

/**
 * @param {Record<string, unknown>} route
 * @returns {Record<string, unknown> | null}
 */
function runtimeBindingEvidence(route) {
    return record(route['runtimeEvidence']) ?? record(route['bindingRuntimeEvidence']) ?? null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(text).filter((item) => item !== null))];
}

/**
 * @param {unknown} value
 * @returns {'full' | 'lossy' | 'unsupported' | 'unknown' | null}
 */
function configRepresentability(value) {
    const normalized =
        text(value)
            ?.toLowerCase()
            .replace(/[\s-]+/gu, '_') ?? null;
    if (normalized === 'full' || normalized === 'representable') return 'full';
    if (normalized === 'lossy' || normalized === 'partial') return 'lossy';
    if (normalized === 'unsupported' || normalized === 'not_representable') return 'unsupported';
    if (normalized === 'unknown' || normalized === 'unproven') return 'unknown';
    return null;
}

/**
 * @param {Record<string, unknown>} route
 * @param {Record<string, unknown> | null} traits
 */
function resolveDirectConfigRepresentability(route, traits) {
    const binding = explicitBindingEvidence(route);
    const traitBinding = record(traits?.['directBinding']);
    const requiredHeaders = [
        ...stringList(route['requiredDirectHeaders']),
        ...stringList(binding?.['requiredDirectHeaders']),
        ...stringList(binding?.['requiredHeaders']),
        ...stringList(traitBinding?.['requiredHeaders']),
    ];
    const explicit =
        configRepresentability(route['directConfigRepresentability']) ??
        configRepresentability(binding?.['directConfigRepresentability']) ??
        configRepresentability(binding?.['configRepresentability']);
    const traitValue = configRepresentability(traitBinding?.['configRepresentability']);
    const value = explicit ?? (requiredHeaders.length > 0 ? 'lossy' : (traitValue ?? (traits ? 'full' : 'unknown')));
    return {
        value,
        source: explicit
            ? 'route_explicit_config_representability'
            : requiredHeaders.length > 0
              ? 'required_direct_headers'
              : traitValue
                ? 'provider_traits'
                : traits
                  ? 'provider_traits_default'
                  : 'no_config_representability_evidence',
        requiredHeaders: [...new Set(requiredHeaders)],
        reason:
            text(route['directConfigReason']) ??
            text(binding?.['directConfigReason']) ??
            text(traitBinding?.['reason']),
    };
}

/**
 * @param {Record<string, unknown>} route
 * @param {string} providerId
 * @param {'openai' | 'azure' | 'anthropic' | 'unknown'} providerType
 * @returns {{
 *     value: 'proven' | 'documented' | 'unknown' | 'unreliable' | 'unsupported';
 *     source: string;
 *     reasons: string[];
 *     requiresNonStandardHeaders: boolean;
 * }}
 */
function resolveDirectReliability(route, providerId, providerType) {
    const binding = explicitBindingEvidence(route);
    const runtime = runtimeBindingEvidence(route);
    const explicitReliability =
        reliability(route['directRebindReliability']) ??
        reliability(binding?.['directRebindReliability']) ??
        reliability(binding?.['sameSessionReattachReliability']);
    if (explicitReliability) {
        return {
            value: explicitReliability,
            source: 'route_explicit_reliability',
            reasons: [`direct_rebind_reliability_explicit:${explicitReliability}`],
            requiresNonStandardHeaders: false,
        };
    }

    const runtimeOk =
        boolean(runtime?.['sameSessionReattachOk']) ??
        boolean(runtime?.['providerRebindOk']) ??
        boolean(runtime?.['directRebindOk']);
    const runtimeStatus = reliability(
        runtime?.['directRebindReliability'] ?? runtime?.['sameSessionReattachReliability'],
    );
    if (runtimeOk === true || runtimeStatus === 'proven') {
        return {
            value: 'proven',
            source: 'runtime_evidence',
            reasons: ['direct_rebind_runtime_proven'],
            requiresNonStandardHeaders: false,
        };
    }
    if (runtimeOk === false || runtimeStatus === 'unreliable' || runtimeStatus === 'unsupported') {
        return {
            value: runtimeStatus === 'unsupported' ? 'unsupported' : 'unreliable',
            source: 'runtime_evidence',
            reasons: ['direct_rebind_runtime_failed'],
            requiresNonStandardHeaders: false,
        };
    }

    const supported =
        boolean(route['directRebindSupported']) ??
        boolean(binding?.['directRebindSupported']) ??
        boolean(binding?.['sameSessionReattachSupported']);
    const reliable =
        boolean(route['directRebindReliable']) ??
        boolean(binding?.['directRebindReliable']) ??
        boolean(binding?.['sameSessionReattachReliable']);
    if (supported === false) {
        return {
            value: 'unsupported',
            source: 'route_static_capability',
            reasons: ['direct_rebind_statically_unsupported'],
            requiresNonStandardHeaders: false,
        };
    }
    if (reliable === false) {
        return {
            value: 'unreliable',
            source: 'route_static_capability',
            reasons: ['direct_rebind_statically_unreliable'],
            requiresNonStandardHeaders: false,
        };
    }
    if (reliable === true || supported === true) {
        return {
            value: reliable === true ? 'proven' : 'documented',
            source: 'route_static_capability',
            reasons: [reliable === true ? 'direct_rebind_statically_reliable' : 'direct_rebind_statically_supported'],
            requiresNonStandardHeaders: false,
        };
    }

    if (providerId === 'github-copilot-sdk') {
        return {
            value: 'proven',
            source: 'native_sdk_route',
            reasons: ['native_github_copilot_sdk_route'],
            requiresNonStandardHeaders: false,
        };
    }
    if (['openai', 'azure', 'anthropic'].includes(providerType)) {
        return {
            value: 'documented',
            source: 'sdk_provider_config',
            reasons: [`sdk_provider_config_documented:${providerType}`],
            requiresNonStandardHeaders: false,
        };
    }
    return {
        value: 'unknown',
        source: 'no_reliability_evidence',
        reasons: ['direct_rebind_reliability_unknown'],
        requiresNonStandardHeaders: false,
    };
}

/**
 * @param {Record<string, unknown>} route
 * @param {string} providerId
 * @param {'openai' | 'azure' | 'anthropic' | 'unknown'} providerType
 * @param {Record<string, unknown> | null} traits
 * @returns {{ eligible: boolean; protocol: string | null; baseUrl: string | null; reasons: string[] }}
 */
function resolveIngressEligibility(route, providerId, providerType, traits) {
    const protocol = routeWireProtocol(route);
    const baseUrl = routeBaseUrl(route, traits);
    const capabilities = record(traits?.['capabilities']);
    const explicitOpenAICompatible =
        boolean(route['openAICompatible']) ??
        boolean(record(route['routing'])?.['openAICompatible']) ??
        boolean(traits?.['openAICompatible']);
    const chatCompletions =
        protocol === 'completions' ||
        boolean(capabilities?.['chatCompletions']) === true ||
        (protocol === null && explicitOpenAICompatible === true);
    const reasons = [];
    if (providerType !== 'openai') reasons.push(`ingress_sdk_provider_type_unsupported:${providerType}`);
    if (protocol === 'responses') reasons.push('ingress_responses_api_not_implemented');
    if (protocol === 'messages' || providerId === 'anthropic' || providerId === 'claude') {
        reasons.push('ingress_anthropic_messages_not_implemented');
    }
    if (!chatCompletions) reasons.push('ingress_chat_completions_capability_missing');
    if (!baseUrl) reasons.push('ingress_concrete_base_url_missing');
    return {
        eligible:
            providerType === 'openai' &&
            protocol !== 'responses' &&
            protocol !== 'messages' &&
            chatCompletions &&
            baseUrl !== null,
        protocol: chatCompletions ? 'openai_chat_completions' : protocol,
        baseUrl,
        reasons,
    };
}

/**
 * @param {Record<string, unknown>} route
 * @returns {'auto' | 'direct' | 'ingress'}
 */
function requestedStrategy(route) {
    const previousDecision = record(route['bindingDecision']);
    const previousRequested = text(previousDecision?.['requestedStrategy'])?.toLowerCase();
    if (previousRequested === 'auto' || previousRequested === 'direct' || previousRequested === 'ingress') {
        return previousRequested;
    }
    const explicit = text(route['bindingStrategy'])?.toLowerCase();
    if (explicit === 'direct' || explicit === 'ingress') return explicit;
    if (route['useIngress'] === true || route['requiresIngress'] === true || route['modelGatewayIngress'] === true) {
        return 'ingress';
    }
    return 'auto';
}

/**
 * Resolve the canonical SDK binding for one route.
 *
 * @param {Record<string, unknown>} route
 * @param {{
 *     currentRoute?: Record<string, unknown> | null;
 *     sessionId?: string | null;
 *     unknownReliabilityPolicy?: 'prefer_direct_when_unknown' | 'prefer_ingress_when_unknown';
 * }} [options]
 */
export function resolveModelGatewayBindingStrategy(route, options = {}) {
    const providerId = text(route['providerId']);
    const providerModel = text(route['providerModel']) ?? text(route['selectorSyntax']);
    const currentRoute = record(options.currentRoute);
    const requested = requestedStrategy(route);
    const unknownPolicy =
        options.unknownReliabilityPolicy === 'prefer_ingress_when_unknown'
            ? 'prefer_ingress_when_unknown'
            : 'prefer_direct_when_unknown';
    if (!providerId || !providerModel) {
        return {
            schemaVersion: 'model-gateway.binding-strategy-decision.v1',
            strategy: 'blocked',
            requestedStrategy: requested,
            providerId,
            providerModel,
            providerType: null,
            directRebindReliability: 'unknown',
            directBindingViability: 'unknown',
            directRebindEvidenceSource: 'route_validation',
            directConfigRepresentability: 'unknown',
            directConfigEvidenceSource: 'route_validation',
            requiredDirectHeaders: [],
            directConfigReason: null,
            requiresNonStandardHeaders: false,
            ingressEligible: false,
            ingressProtocol: null,
            ingressBaseUrl: null,
            sameSessionRequired: true,
            requiresNewSession: false,
            source: 'route_validation',
            reasons: ['route_provider_identity_incomplete'],
            warnings: [],
            nextActions: ['repair_route_provider_identity'],
        };
    }

    const traits = resolveProviderGatewayTraits(providerId);
    const providerType = sdkProviderType(route, providerId, traits);
    const directReliability = resolveDirectReliability(route, providerId, providerType);
    const directConfig = resolveDirectConfigRepresentability(route, traits);
    const runtimeProven = directReliability.value === 'proven';
    const effectiveDirectValue = runtimeProven
        ? directReliability.value
        : directConfig.value === 'unsupported'
          ? 'unsupported'
          : directConfig.value === 'lossy'
            ? 'unreliable'
            : directReliability.value;
    const direct = {
        ...directReliability,
        value: effectiveDirectValue,
        reliabilityValue: directReliability.value,
        reliabilitySource: directReliability.source,
        source: effectiveDirectValue === directReliability.value ? directReliability.source : directConfig.source,
        reasons: [
            ...directReliability.reasons,
            ...(directConfig.value === 'lossy'
                ? ['direct_config_representation_lossy']
                : directConfig.value === 'unsupported'
                  ? ['direct_config_representation_unsupported']
                  : []),
        ],
        requiresNonStandardHeaders: directConfig.requiredHeaders.length > 0,
    };
    const ingress = resolveIngressEligibility(route, providerId, providerType, traits);
    const currentIngress = text(currentRoute?.['bindingStrategy']) === 'ingress';
    /** @type {'direct' | 'ingress' | 'blocked'} */
    let strategy;
    /** @type {string} */
    let source;
    const reasons = [...direct.reasons];
    const warnings = [];
    const nextActions = [];

    if (requested === 'ingress') {
        if (ingress.eligible) {
            strategy = 'ingress';
            source = 'explicit_ingress';
            reasons.push('explicit_ingress_requested');
        } else {
            strategy = 'blocked';
            source = 'explicit_ingress_invalid';
            reasons.push(...ingress.reasons, 'explicit_ingress_not_eligible');
            nextActions.push('select_direct_compatible_route_or_add_missing_ingress_protocol');
        }
    } else if (requested === 'direct') {
        if (direct.value === 'unsupported') {
            strategy = 'blocked';
            source = 'explicit_direct_unsupported';
            reasons.push('explicit_direct_rebind_unsupported');
            nextActions.push(ingress.eligible ? 'select_ingress_binding' : 'select_compatible_route');
        } else {
            strategy = 'direct';
            source = 'explicit_direct';
            reasons.push('explicit_direct_requested');
            if (direct.value === 'unreliable') warnings.push('explicit_direct_overrides_unreliable_evidence');
        }
    } else if (currentIngress && ingress.eligible) {
        strategy = 'ingress';
        source = 'preserve_existing_ingress';
        reasons.push('preserve_stable_ingress_binding');
    } else if (direct.value === 'unreliable' || direct.value === 'unsupported') {
        if (ingress.eligible) {
            strategy = 'ingress';
            source = 'automatic_ingress_fallback';
            reasons.push(`automatic_ingress_for_direct_${direct.value}`);
        } else {
            strategy = 'blocked';
            source = 'no_reliable_binding_available';
            reasons.push(...ingress.reasons, `direct_rebind_${direct.value}_and_ingress_ineligible`);
            nextActions.push('select_compatible_route_or_add_ingress_protocol_support');
        }
    } else if (direct.value === 'unknown' && unknownPolicy === 'prefer_ingress_when_unknown' && ingress.eligible) {
        strategy = 'ingress';
        source = 'unknown_reliability_policy';
        reasons.push('unknown_direct_reliability_policy_prefers_ingress');
    } else {
        strategy = 'direct';
        source = direct.source;
        if (direct.value === 'unknown') {
            warnings.push('direct_rebind_reliability_unproven');
            nextActions.push('run_same_session_rebind_probe');
        }
    }

    if (strategy === 'direct' && direct.reliabilityValue === 'documented') {
        warnings.push('direct_rebind_documented_but_not_runtime_proven');
        nextActions.push('observe_or_probe_same_session_rebind');
    }
    if (strategy === 'direct' && directConfig.value === 'unknown') {
        warnings.push('direct_config_representability_unknown');
        nextActions.push('inspect_provider_config_requirements');
    }
    if (
        strategy === 'direct' &&
        runtimeProven &&
        (directConfig.value === 'lossy' || directConfig.value === 'unsupported')
    ) {
        warnings.push('runtime_proof_overrides_static_config_representability');
        nextActions.push('monitor_direct_binding_contract_drift');
    }
    if (strategy === 'ingress') nextActions.push('materialize_ingress_route_and_preserve_sdk_route_key');
    if (strategy !== 'blocked') nextActions.push('apply_same_session_route_switch');

    return {
        schemaVersion: 'model-gateway.binding-strategy-decision.v1',
        strategy,
        requestedStrategy: requested,
        providerId,
        providerModel,
        providerType,
        directRebindReliability: direct.reliabilityValue,
        directBindingViability: direct.value,
        directRebindEvidenceSource: direct.reliabilitySource,
        directConfigRepresentability: directConfig.value,
        directConfigEvidenceSource: directConfig.source,
        requiredDirectHeaders: directConfig.requiredHeaders,
        directConfigReason: directConfig.reason,
        requiresNonStandardHeaders: direct.requiresNonStandardHeaders,
        ingressEligible: ingress.eligible,
        ingressProtocol: ingress.protocol,
        ingressBaseUrl: ingress.baseUrl,
        currentBindingStrategy: text(currentRoute?.['bindingStrategy']) ?? null,
        sameSessionRequired: true,
        requiresNewSession: false,
        source,
        reasons: [...new Set(reasons)],
        warnings: [...new Set(warnings)],
        nextActions: [...new Set(nextActions)],
    };
}

/**
 * Attach a redacted canonical binding decision to a route.
 *
 * @template {Record<string, unknown>} T
 * @param {T} route
 * @param {{
 *     currentRoute?: Record<string, unknown> | null;
 *     sessionId?: string | null;
 *     unknownReliabilityPolicy?: 'prefer_direct_when_unknown' | 'prefer_ingress_when_unknown';
 * }} [options]
 * @returns {T & {
 *     bindingStrategy: 'direct' | 'ingress' | 'blocked';
 *     bindingDecision: ReturnType<typeof resolveModelGatewayBindingStrategy>;
 *     requiresIngress: boolean;
 *     useIngress: boolean;
 *     modelGatewayIngress: boolean;
 *     requiresNewSession: false;
 *     sdkRouteKey?: string;
 *     sdkVisibleModel?: string;
 * }}
 */
export function applyModelGatewayBindingStrategy(route, options = {}) {
    const decision = resolveModelGatewayBindingStrategy(route, options);
    const currentRoute = record(options.currentRoute);
    const currentSdkRouteKey = text(currentRoute?.['sdkRouteKey']);
    const routeProfile = text(route['routeProfile']) ?? 'default';
    const sessionId = text(options.sessionId);
    const sdkRouteKey =
        text(route['sdkRouteKey']) ??
        (decision.strategy === 'ingress' && text(currentRoute?.['bindingStrategy']) === 'ingress'
            ? currentSdkRouteKey
            : null) ??
        (decision.strategy === 'ingress' && sessionId ? `${sessionId}:${routeProfile}:model-gateway` : null);
    const sdkVisibleModel =
        text(route['sdkVisibleModel']) ??
        (decision.strategy === 'ingress' && text(currentRoute?.['bindingStrategy']) === 'ingress'
            ? text(currentRoute?.['sdkVisibleModel'])
            : null) ??
        (decision.strategy === 'ingress' ? 'model-gateway-live' : null);
    return {
        ...route,
        bindingStrategy: /** @type {'direct' | 'ingress' | 'blocked'} */ (decision.strategy),
        ...(sdkRouteKey ? { sdkRouteKey } : {}),
        ...(sdkVisibleModel ? { sdkVisibleModel } : {}),
        bindingDecision: decision,
        requiresIngress: decision.strategy === 'ingress',
        useIngress: decision.strategy === 'ingress',
        modelGatewayIngress: decision.strategy === 'ingress',
        requiresNewSession: false,
    };
}
