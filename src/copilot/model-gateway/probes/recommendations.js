// @ts-check
/**
 * Probe recommendations derived from catalog metadata changes.
 *
 * This module never executes probes and never changes the active model. It only converts catalog diffs into explicit
 * operator actions for the later runtime validation phase.
 *
 * @module copilot/model-gateway/probes/recommendations
 */

const DEFAULT_RECOMMENDATION_LIMIT = 8;
const HIGH_VALUE_CONTEXT_TOKENS = 32_000;
const HIGH_VALUE_OUTPUT_TOKENS = 4_096;

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
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
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
 * @param {Record<string, unknown>} decision
 * @returns {string}
 */
function eligibilityKey(decision) {
    return [
        optionalString(decision['providerId']) ?? 'unknown-provider',
        optionalString(decision['providerModel']) ?? 'unknown-model',
        optionalString(decision['routeProfile']) ?? 'default',
    ].join(':');
}

/**
 * @param {Record<string, unknown> | null} decision
 * @returns {'eligible' | 'unknown' | 'excluded' | null}
 */
function eligibilityStatus(decision) {
    if (!decision) return null;
    if (decision['include'] === false) return 'excluded';
    const disposition = optionalString(decision['disposition']) ?? '';
    return disposition.startsWith('unknown') ? 'unknown' : 'eligible';
}

/**
 * @param {'eligible' | 'unknown' | 'excluded' | null} status
 * @param {Record<string, unknown> | null} decision
 * @param {Record<string, unknown>} options
 * @returns {boolean}
 */
function canRecommendProbeForEligibility(status, decision, options) {
    if (status === null) return options['requireEligibilityDecision'] !== true;
    if (status === 'eligible') return true;
    if (status === 'excluded') return false;
    return (
        options['allowUnknownEligibility'] === true ||
        optionalString(decision?.['disposition']) === 'unknown_policy_allows_probe'
    );
}

/**
 * @param {Record<string, unknown>} projection
 * @returns {{
 *     chat: boolean;
 *     streaming: boolean;
 *     json: boolean;
 *     agent: boolean;
 *     vision: boolean;
 *     highValue: boolean;
 *     reasons: string[];
 * }}
 */
function inferProbeSurface(projection) {
    const capabilities = asRecord(projection['capabilities']);
    const limits = asRecord(projection['limits']);
    const modalities = asRecord(projection['modalities']);
    const inputModalities = stringList(modalities['input']);
    const supportedParameters = stringList(projection['supportedParameters']);
    const contextTokens = finiteNumber(limits['contextWindowTokens']) ?? 0;
    const outputTokens = finiteNumber(limits['maxOutputTokens']) ?? 0;
    const streaming = truthy(capabilities['streaming']) || supportedParameters.includes('stream');
    const json =
        truthy(capabilities['jsonMode']) ||
        truthy(capabilities['structuredOutputs']) ||
        supportedParameters.includes('response_format');
    const agent =
        truthy(capabilities['tools']) ||
        truthy(capabilities['toolChoice']) ||
        truthy(capabilities['forcedToolChoice']) ||
        truthy(capabilities['parallelToolCalls']);
    const vision = truthy(capabilities['vision']) || inputModalities.includes('image');
    const reasoning = truthy(capabilities['reasoningEffort']);
    const highValue =
        agent ||
        json ||
        streaming ||
        vision ||
        reasoning ||
        contextTokens >= HIGH_VALUE_CONTEXT_TOKENS ||
        outputTokens >= HIGH_VALUE_OUTPUT_TOKENS;
    return {
        chat: true,
        streaming,
        json,
        agent,
        vision,
        highValue,
        reasons: [
            agent ? 'agentic_capability' : null,
            json ? 'structured_output_capability' : null,
            streaming ? 'streaming_capability' : null,
            vision ? 'vision_capability' : null,
            reasoning ? 'reasoning_capability' : null,
            contextTokens >= HIGH_VALUE_CONTEXT_TOKENS ? 'large_context' : null,
            outputTokens >= HIGH_VALUE_OUTPUT_TOKENS ? 'large_output' : null,
        ].filter((item) => item !== null),
    };
}

/**
 * @param {Record<string, unknown>} projection
 * @param {string} kind
 * @returns {string}
 */
function buildProbeCommand(projection, kind) {
    const providerModel = optionalString(projection['providerModel']) ?? optionalString(projection['id']) ?? 'model';
    const routeProfile = optionalString(projection['routeProfile']);
    const profile = routeProfile && routeProfile !== 'default' ? ` profile:${routeProfile}` : '';
    return `/byok probe ${kind}${profile} model:${providerModel}`;
}

/**
 * @param {object} input
 * @param {{ added?: string[]; changed?: { key?: string; changedKinds?: string[] }[] }} input.diff
 * @param {Record<string, unknown>[]} input.projections
 * @param {Record<string, unknown>[]} [input.eligibilityDecisions]
 * @param {boolean} [input.requireEligibilityDecision]
 * @param {boolean} [input.allowUnknownEligibility]
 * @param {number} [input.limit]
 * @returns {{
 *     key: string;
 *     providerId: string | null;
 *     providerModel: string | null;
 *     routeProfile: string;
 *     eligibilityStatus?: string;
 *     priority: 'high' | 'medium';
 *     probeKinds: string[];
 *     reasons: string[];
 *     commands: string[];
 * }[]}
 */
export function recommendCatalogDiffProbes(input) {
    const limit = finiteNumber(input.limit) ?? DEFAULT_RECOMMENDATION_LIMIT;
    const projectionsByKey = new Map(input.projections.map((projection) => [projectionKey(projection), projection]));
    const eligibilityByKey = new Map(
        (Array.isArray(input.eligibilityDecisions) ? input.eligibilityDecisions : []).map((decision) => [
            eligibilityKey(decision),
            decision,
        ]),
    );
    const eligibilityOptions = {
        requireEligibilityDecision: input.requireEligibilityDecision === true,
        allowUnknownEligibility: input.allowUnknownEligibility === true,
    };
    /** @type {Map<string, string[]>} */
    const changedByKey = new Map();
    for (const item of Array.isArray(input.diff.changed) ? input.diff.changed : []) {
        const key = optionalString(item.key);
        if (key) changedByKey.set(key, stringList(item.changedKinds));
    }
    const candidateKeys = [...new Set([...stringList(input.diff.added), ...changedByKey.keys()])];
    /** @type {{
    key: string;
    providerId: string | null;
    providerModel: string | null;
    routeProfile: string;
    eligibilityStatus?: string;
    priority: 'high' | 'medium';
    probeKinds: string[];
    reasons: string[];
    commands: string[];
}[]} */
    const recommendations = [];
    for (const key of candidateKeys) {
        const projection = projectionsByKey.get(key);
        if (!projection) continue;
        const eligibilityDecision = eligibilityByKey.get(key) ?? null;
        const status = eligibilityStatus(eligibilityDecision);
        if (!canRecommendProbeForEligibility(status, eligibilityDecision, eligibilityOptions)) continue;
        const changedKinds = changedByKey.get(key) ?? [];
        const isAdded = stringList(input.diff.added).includes(key);
        const relevantChange =
            isAdded ||
            changedKinds.includes('capabilities_changed') ||
            changedKinds.includes('limits_changed') ||
            changedKinds.includes('modalities_changed');
        if (!relevantChange) continue;
        const surface = inferProbeSurface(projection);
        if (!surface.highValue && !changedKinds.includes('capabilities_changed')) continue;
        const probeKinds = [
            'chat',
            surface.streaming ? 'streaming' : null,
            surface.json ? 'json' : null,
            surface.agent ? 'agent' : null,
            surface.vision ? 'vision' : null,
        ].filter((item) => item !== null);
        /** @type {'high' | 'medium'} */
        const priority = surface.agent || changedKinds.includes('capabilities_changed') ? 'high' : 'medium';
        recommendations.push({
            key,
            providerId: optionalString(projection['providerId']),
            providerModel: optionalString(projection['providerModel']),
            routeProfile: optionalString(projection['routeProfile']) ?? 'default',
            ...(status ? { eligibilityStatus: status } : {}),
            priority,
            probeKinds,
            reasons: [
                ...new Set(
                    [...surface.reasons, ...changedKinds, isAdded ? 'new_model' : null].filter((item) => item !== null),
                ),
            ],
            commands: probeKinds.map((kind) => buildProbeCommand(projection, kind)),
        });
    }
    return recommendations
        .sort((left, right) => {
            if (left.priority !== right.priority) return left.priority === 'high' ? -1 : 1;
            return left.key.localeCompare(right.key);
        })
        .slice(0, Math.max(0, limit));
}
