// @ts-check
/**
 * Cost-bounded probe planning.
 *
 * The planner chooses which already-recommended probes may enter runtime. It estimates cost from catalog metadata and
 * never calls providers or mutates probe health.
 *
 * @module copilot/model-gateway/probes/planner
 */

const PROBE_TOKEN_ESTIMATES = Object.freeze({
    chat: Object.freeze({ input: 600, output: 80 }),
    streaming: Object.freeze({ input: 600, output: 80 }),
    json: Object.freeze({ input: 800, output: 120 }),
    vision: Object.freeze({ input: 1_000, output: 160 }),
    agent: Object.freeze({ input: 1_200, output: 250 }),
    reasoning: Object.freeze({ input: 900, output: 300 }),
    forced_tool_choice: Object.freeze({ input: 1_200, output: 250 }),
    parallel_tool_calls: Object.freeze({ input: 1_400, output: 300 }),
    embeddings: Object.freeze({ input: 800, output: 0 }),
    audio_transcription: Object.freeze({ input: 1_200, output: 200 }),
    tts: Object.freeze({ input: 400, output: 0 }),
    rerank: Object.freeze({ input: 1_000, output: 20 }),
    image_generation: Object.freeze({ input: 600, output: 0 }),
    gateway_fallback: Object.freeze({ input: 700, output: 120 }),
    provider_native: Object.freeze({ input: 700, output: 120 }),
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
 * @returns {number | null}
 */
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * @param {unknown} value
 * @returns {Set<string>}
 */
function stringSet(value) {
    if (!Array.isArray(value)) return new Set();
    return new Set(value.map(optionalString).filter((item) => item !== null));
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function recommendationKey(row) {
    return [
        optionalString(row['providerId']) ?? 'unknown-provider',
        optionalString(row['providerModel']) ?? optionalString(row['id']) ?? 'unknown-model',
        optionalString(row['routeProfile']) ?? 'default',
    ].join(':');
}

/**
 * @param {Record<string, unknown>} projection
 * @param {string} kind
 * @returns {number | null}
 */
export function estimateProbeCostUsd(projection, kind) {
    const pricing = isRecord(projection['pricing']) ? projection['pricing'] : {};
    const estimate = PROBE_TOKEN_ESTIMATES[/** @type {keyof typeof PROBE_TOKEN_ESTIMATES} */ (kind)] ?? PROBE_TOKEN_ESTIMATES.chat;
    const input = finiteNumber(pricing['inputUsdPerMillion']);
    const output = finiteNumber(pricing['outputUsdPerMillion']);
    const request = finiteNumber(pricing['requestUsd']) ?? 0;
    if (input === null && output === null && request === 0) return null;
    return ((input ?? 0) * estimate.input + (output ?? 0) * estimate.output) / 1_000_000 + request;
}

/**
 * @param {object} input
 * @param {Array<Record<string, unknown>>} input.recommendations
 * @param {Array<Record<string, unknown>>} input.projections
 * @param {number} [input.maxProbeCount]
 * @param {number} [input.maxEstimatedCostUsd]
 * @param {string[]} [input.allowedProbeKinds]
 * @param {string[]} [input.blockedProbeKinds]
 * @param {'allow' | 'skip'} [input.unknownCostPolicy]
 * @returns {{
 *   selected: Array<{ key: string; kind: string; command: string | null; estimatedCostUsd: number | null; reasons: string[] }>;
 *   skipped: Array<{ key: string; kind: string; reason: string }>;
 *   totalEstimatedCostUsd: number;
 *   totalProbeCount: number;
 * }}
 */
export function planCostBoundedCatalogProbes(input) {
    const maxProbeCount = finiteNumber(input.maxProbeCount) ?? Number.POSITIVE_INFINITY;
    const maxEstimatedCostUsd = finiteNumber(input.maxEstimatedCostUsd);
    const unknownCostPolicy = input.unknownCostPolicy ?? (maxEstimatedCostUsd === null ? 'allow' : 'skip');
    const allowedKinds = stringSet(input.allowedProbeKinds);
    const blockedKinds = stringSet(input.blockedProbeKinds);
    const projectionsByKey = new Map((Array.isArray(input.projections) ? input.projections : []).map((projection) => [recommendationKey(projection), projection]));
    const selected = [];
    const skipped = [];
    let totalEstimatedCostUsd = 0;

    for (const recommendation of Array.isArray(input.recommendations) ? input.recommendations.filter(isRecord) : []) {
        const key = optionalString(recommendation['key']) ?? recommendationKey(recommendation);
        const projection = projectionsByKey.get(key) ?? null;
        const kinds = Array.isArray(recommendation['probeKinds'])
            ? recommendation['probeKinds'].map(optionalString).filter((kind) => kind !== null)
            : [];
        const commands = Array.isArray(recommendation['commands']) ? recommendation['commands'] : [];
        for (const kind of kinds) {
            if (allowedKinds.size > 0 && !allowedKinds.has(kind)) {
                skipped.push({ key, kind, reason: 'probe_kind_not_allowed' });
                continue;
            }
            if (blockedKinds.has(kind)) {
                skipped.push({ key, kind, reason: 'probe_kind_blocked' });
                continue;
            }
            if (selected.length >= maxProbeCount) {
                skipped.push({ key, kind, reason: 'probe_count_limit_reached' });
                continue;
            }
            const estimatedCostUsd = projection ? estimateProbeCostUsd(projection, kind) : null;
            if (estimatedCostUsd === null && unknownCostPolicy === 'skip') {
                skipped.push({ key, kind, reason: 'probe_cost_unknown' });
                continue;
            }
            if (maxEstimatedCostUsd !== null && estimatedCostUsd !== null && totalEstimatedCostUsd + estimatedCostUsd > maxEstimatedCostUsd) {
                skipped.push({ key, kind, reason: 'probe_cost_limit_reached' });
                continue;
            }
            if (estimatedCostUsd !== null) totalEstimatedCostUsd += estimatedCostUsd;
            selected.push({
                key,
                kind,
                command: optionalString(commands[kinds.indexOf(kind)]) ?? null,
                estimatedCostUsd,
                reasons: Array.isArray(recommendation['reasons']) ? recommendation['reasons'].map(String) : [],
            });
        }
    }

    return {
        selected,
        skipped,
        totalEstimatedCostUsd,
        totalProbeCount: selected.length,
    };
}
