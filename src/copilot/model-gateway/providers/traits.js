// @ts-check
/**
 * Normalized provider/gateway traits.
 *
 * These records summarize endpoint inventory and provider-family specs as pre-runtime metadata. They do not prove
 * account access, model health, or runtime capability; they give the selector a stable first-pass vocabulary.
 *
 * @module copilot/model-gateway/providers/traits
 */

import { MODEL_GATEWAY_PROVIDER_ENDPOINT_INVENTORY, resolveProviderEndpointInventory } from './endpoints/index.js';
import { OPENAI_PROVIDER_FAMILY_SPECS } from './specs/index.js';

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
 * @param {string | null | undefined} value
 * @returns {string[]}
 */
function splitTags(value) {
    if (!value) return [];
    return value
        .split(/[_\s,|/+-]+/u)
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * @param {readonly string[]} values
 * @returns {string[]}
 */
function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

/**
 * @param {string} kind
 * @returns {boolean}
 */
function isAuthenticatedCatalogKind(kind) {
    return /(?:authenticated|account|local_daemon)/iu.test(kind);
}

/**
 * @param {string} kind
 * @returns {boolean}
 */
function isPublicCatalogKind(kind) {
    return /(?:public|docs|openapi)/iu.test(kind) && !isAuthenticatedCatalogKind(kind);
}

/**
 * @param {string} locator
 * @returns {boolean}
 */
function hasParameterizedLocator(locator) {
    return /\{[a-z0-9_.-]+\}/iu.test(locator);
}

/**
 * @param {Record<string, any>} inventory
 * @param {Record<string, any> | null} spec
 * @returns {Record<string, unknown>}
 */
export function createProviderGatewayTraits(inventory, spec = null) {
    const providerId = optionalString(inventory['providerId']) ?? optionalString(spec?.['id']) ?? 'unknown-provider';
    const adapterId = optionalString(inventory['adapterId']) ?? providerId;
    const providerKind = optionalString(inventory['providerKind']) ?? 'unknown';
    const catalogSources = Array.isArray(inventory['modelCatalogSources']) ? inventory['modelCatalogSources'] : [];
    const runtimeEndpoints = Array.isArray(inventory['runtimeEndpoints']) ? inventory['runtimeEndpoints'] : [];
    const routeSelectors = stringList(inventory['routeSelectors']);
    const baseUrls = stringList(inventory['baseUrls']);
    const specProviderIds = stringList(spec?.['providerIds']);
    const specGateway = spec?.['gateway'] && typeof spec['gateway'] === 'object' ? /** @type {Record<string, unknown>} */ (spec['gateway']) : {};
    const catalogKinds = uniqueSorted(catalogSources.map((source) => optionalString(source?.['kind'])).filter((item) => item !== null));
    const runtimeKinds = uniqueSorted(runtimeEndpoints.map((endpoint) => optionalString(endpoint?.['kind'])).filter((item) => item !== null));
    const richnessTags = uniqueSorted(
        catalogSources.flatMap((source) => splitTags(optionalString(source?.['richness']))),
    );
    const publicCatalogSourceCount = catalogSources.filter((source) => isPublicCatalogKind(optionalString(source?.['kind']) ?? '')).length;
    const authenticatedCatalogSourceCount = catalogSources.filter((source) =>
        isAuthenticatedCatalogKind(optionalString(source?.['kind']) ?? ''),
    ).length;
    const parameterizedCatalogSourceCount = catalogSources.filter((source) =>
        hasParameterizedLocator(optionalString(source?.['url']) ?? optionalString(source?.['path']) ?? ''),
    ).length;
    const isGateway = providerKind === 'gateway' || routeSelectors.some((selector) => /gateway/iu.test(selector));
    const isAggregator = providerKind === 'aggregator' || routeSelectors.some((selector) => /aggregator|provider_order|fallback/iu.test(selector));
    const isLocal = providerKind === 'local' || runtimeKinds.some((kind) => /local/iu.test(kind)) || baseUrls.some((url) => /localhost|127\.0\.0\.1/iu.test(url));
    const openAICompatibleRuntime = runtimeKinds.some((kind) => /chat_completions|responses|fim_completions|embeddings/iu.test(kind));
    return {
        providerId,
        adapterId,
        providerKind,
        topology: isLocal ? 'local_daemon' : isGateway ? 'gateway' : isAggregator ? 'aggregator' : 'direct_provider',
        openAICompatible: openAICompatibleRuntime || Boolean(spec?.['defaultBaseUrl']),
        localPrivate: isLocal,
        gatewayManaged: isGateway,
        aggregatorManaged: isAggregator,
        directProvider: !isGateway && !isAggregator && !isLocal,
        baseUrlCount: baseUrls.length,
        catalogSourceCount: catalogSources.length,
        runtimeEndpointCount: runtimeEndpoints.length,
        publicCatalogSourceCount,
        authenticatedCatalogSourceCount,
        parameterizedCatalogSourceCount,
        routeSelectorCount: routeSelectors.length,
        baseUrls,
        specProviderIds,
        catalogKinds,
        runtimeKinds,
        routeSelectors,
        richnessTags,
        capabilities: {
            chatCompletions: runtimeKinds.includes('chat_completions'),
            responses: runtimeKinds.includes('responses'),
            messages: runtimeKinds.includes('messages'),
            embeddings: runtimeKinds.includes('embeddings'),
            rerank: runtimeKinds.includes('rerank'),
            fim: runtimeKinds.includes('fim_completions'),
            batch: runtimeKinds.includes('batch'),
            management: runtimeKinds.some((kind) => /management/iu.test(kind)),
            openAICompatibleRuntime,
        },
        routing: {
            supportsAutoSelection: routeSelectors.some((selector) => /auto|fastest|cheapest|preferred/iu.test(selector)),
            supportsFallback: routeSelectors.some((selector) => /fallback/iu.test(selector)),
            supportsProviderOrder: routeSelectors.some((selector) => /provider_order/iu.test(selector)),
            supportsGatewayByok: routeSelectors.some((selector) => /byok/iu.test(selector)),
            supportsOrganizationOverlay: routeSelectors.some((selector) => /organization_overlay/iu.test(selector)),
            supportsCache: routeSelectors.some((selector) => /cache/iu.test(selector)),
            supportsRetry: routeSelectors.some((selector) => /retry/iu.test(selector)),
            selectorSyntax: optionalString(specGateway['selectorSyntax']),
        },
        metadata: {
            hasPricingMetadata: richnessTags.includes('pricing'),
            hasContextMetadata: richnessTags.includes('context'),
            hasFeatureMetadata: richnessTags.includes('features') || richnessTags.includes('capabilities'),
            hasProviderMetadata: richnessTags.includes('provider') || richnessTags.includes('upstream'),
            hasAccountVisibilityMetadata: catalogKinds.some((kind) => /account|authenticated/iu.test(kind)),
        },
    };
}

/**
 * @param {{ inventories?: readonly Record<string, any>[]; specs?: readonly Record<string, any>[] }} [options]
 * @returns {Record<string, unknown>[]}
 */
export function listProviderGatewayTraits(options = {}) {
    const specs = Array.isArray(options.specs) ? options.specs : OPENAI_PROVIDER_FAMILY_SPECS;
    const inventories = Array.isArray(options.inventories) ? options.inventories : MODEL_GATEWAY_PROVIDER_ENDPOINT_INVENTORY;
    return inventories.map((inventory) => {
        const providerId = optionalString(inventory['providerId']);
        const spec =
            specs.find((candidate) => {
                const ids = [optionalString(candidate['id']), ...stringList(candidate['providerIds'])].filter((item) => item !== null);
                return providerId ? ids.includes(providerId) : false;
            }) ?? null;
        return createProviderGatewayTraits(inventory, spec);
    });
}

/**
 * @param {string | null | undefined} providerId
 * @returns {Record<string, unknown> | null}
 */
export function resolveProviderGatewayTraits(providerId) {
    const inventory = resolveProviderEndpointInventory(providerId);
    if (!inventory) return null;
    return listProviderGatewayTraits({ inventories: [inventory] })[0] ?? null;
}
