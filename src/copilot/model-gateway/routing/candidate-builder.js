// @ts-check
/**
 * Canonical route candidate builder.
 *
 * Runtime selection should compare route options, not only model projections. A provider model can have multiple
 * selectors (direct provider, gateway fallback, auto selector, local daemon). This builder turns normalized metadata
 * into auditable candidates without executing probes.
 *
 * @module copilot/model-gateway/routing/candidate-builder
 */

const DEFAULT_ROUTE_PROFILE = 'default';

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
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function providerId(row) {
    return optionalString(row['providerId']) ?? 'unknown-provider';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function providerModel(row) {
    return optionalString(row['providerModel']) ?? optionalString(row['id']) ?? 'unknown-model';
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function routeProfile(row) {
    return optionalString(row['routeProfile']) ?? DEFAULT_ROUTE_PROFILE;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function projectionKey(row) {
    return [providerId(row), providerModel(row), routeProfile(row)].join(':');
}

/**
 * @param {Record<string, unknown>} route
 * @returns {string}
 */
function routeOptionRef(route) {
    return [
        providerId(route),
        providerModel(route),
        routeProfile(route),
        optionalString(route['selectorKind']) ?? 'exact_model',
        optionalString(route['selectorSyntax']) ?? providerModel(route),
    ].join(':');
}

/**
 * @param {Record<string, unknown>} route
 * @returns {Record<string, unknown>}
 */
function routePolicy(route) {
    return isRecord(route['normalizedPolicy']) ? route['normalizedPolicy'] : {};
}

/**
 * @param {Record<string, unknown>} route
 * @returns {Record<string, unknown>}
 */
function routeTraits(route) {
    const policy = routePolicy(route);
    return isRecord(policy['routeTraits']) ? policy['routeTraits'] : {};
}

/**
 * @param {Record<string, unknown>} route
 * @returns {Record<string, unknown>}
 */
function routeProviderSpecific(route) {
    return isRecord(route['providerSpecific']) ? route['providerSpecific'] : {};
}

/**
 * @param {Record<string, unknown>} projection
 * @param {Record<string, unknown> | null} route
 */
function buildCandidate(projection, route) {
    const provider = route ? providerId(route) : providerId(projection);
    const model = route ? providerModel(route) : providerModel(projection);
    const profile = route ? routeProfile(route) : routeProfile(projection);
    const selectorKind = route ? (optionalString(route['selectorKind']) ?? 'exact_model') : 'exact_model';
    const selectorSyntax = route ? (optionalString(route['selectorSyntax']) ?? model) : model;
    const policy = route ? routePolicy(route) : {};
    const traits = route ? routeTraits(route) : {};
    const providerSpecific = route ? routeProviderSpecific(route) : {};
    const routeRef = route ? routeOptionRef(route) : [provider, model, profile, selectorKind, selectorSyntax].join(':');
    const canonicalModelId = optionalString(projection['id']) ?? [provider, model].join(':');
    const routeCandidateId = route
        ? [provider, model, profile, selectorKind, selectorSyntax].join(':')
        : canonicalModelId;
    const projectionRouting = isRecord(projection['routing']) ? projection['routing'] : {};
    return {
        ...projection,
        id: routeCandidateId,
        canonicalModelId,
        routeCandidateId,
        providerId: provider,
        providerModel: model,
        routeProfile: profile,
        selectorKind,
        selectorSyntax,
        routeProviderSpecific: providerSpecific,
        routeOptionRef: routeRef,
        routeOptionRefs: [
            ...new Set([
                ...(Array.isArray(projection['routeOptionRefs']) ? projection['routeOptionRefs'] : []),
                routeRef,
            ]),
        ],
        normalizedPolicy: policy,
        routeTraits: traits,
        routing: {
            ...projectionRouting,
            routeLayer: optionalString(policy['routeLayer']) ?? optionalString(projectionRouting['routeLayer']),
            wireApi: optionalString(policy['wireApi']) ?? optionalString(projectionRouting['wireApi']),
            selectorKind,
            selectorSyntax,
            upstreamProvider:
                optionalString(providerSpecific['upstreamProvider']) ??
                optionalString(providerSpecific['huggingFaceProvider']) ??
                optionalString(providerSpecific['topProvider']) ??
                optionalString(policy['upstreamProvider']),
            autoSelection: traits['autoSelection'] === true || policy['autoSelection'] === true,
            supportsFallback: traits['supportsFallback'] === true || policy['supportsFallback'] === true,
        },
        provenance: {
            ...(isRecord(projection['provenance']) ? projection['provenance'] : {}),
            candidateSource: route ? 'route_option' : 'projection',
            routeOptionRef: routeRef,
        },
    };
}

/**
 * @param {object} input
 * @param {Record<string, unknown>[]} [input.projections]
 * @param {Record<string, unknown>[]} [input.routeOptions]
 * @param {boolean} [input.includeProjectionOnly]
 */
export function buildModelGatewayRouteCandidates(input = {}) {
    const projections = Array.isArray(input.projections) ? input.projections.filter(isRecord) : [];
    const routeOptions = Array.isArray(input.routeOptions) ? input.routeOptions.filter(isRecord) : [];
    const projectionsByKey = new Map(projections.map((projection) => [projectionKey(projection), projection]));
    const candidates = [];
    const coveredProjectionKeys = new Set();

    for (const route of routeOptions) {
        const key = projectionKey(route);
        const projection = projectionsByKey.get(key);
        if (!projection) continue;
        candidates.push(buildCandidate(projection, route));
        coveredProjectionKeys.add(key);
    }

    if (input.includeProjectionOnly !== false) {
        for (const projection of projections) {
            const key = projectionKey(projection);
            if (!coveredProjectionKeys.has(key)) candidates.push(buildCandidate(projection, null));
        }
    }

    return candidates;
}
