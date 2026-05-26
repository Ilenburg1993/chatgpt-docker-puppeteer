// @ts-check
/**
 * Provider environment requirements.
 *
 * This module describes which environment keys unlock account-scoped catalog metadata and runtime access. It never
 * reads or returns secret values; it only reports configured/missing key names.
 *
 * @module copilot/model-gateway/secrets/requirements
 */

export const MODEL_GATEWAY_PROVIDER_ENV_REQUIREMENTS = Object.freeze([
    Object.freeze({ providerId: 'openai', groups: Object.freeze([anySecret('api_key', ['OPENAI_API_KEY', 'COPILOT_OPENAI_API_KEY'])]) }),
    Object.freeze({
        providerId: 'anthropic',
        groups: Object.freeze([anySecret('api_key', ['ANTHROPIC_API_KEY', 'ANTHROPIC_KEY', 'CLAUDE_API_KEY'])]),
    }),
    Object.freeze({
        providerId: 'gemini',
        groups: Object.freeze([
            anySecret('api_key', ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_STUDIO_API_KEY']),
        ]),
    }),
    Object.freeze({ providerId: 'mistral', groups: Object.freeze([anySecret('api_key', ['MISTRAL_API_KEY', 'MISTRAL_KEY'])]) }),
    Object.freeze({ providerId: 'groq', groups: Object.freeze([anySecret('api_key', ['GROQ_API_KEY', 'GROQ_KEY'])]) }),
    Object.freeze({
        providerId: 'openrouter',
        groups: Object.freeze([anySecret('api_key', ['OPENROUTER_API_KEY', 'OPEN_ROUTER_KEY'])]),
    }),
    Object.freeze({ providerId: 'kilo', groups: Object.freeze([anySecret('api_key', ['KILO_API_KEY', 'KILO_CODE_API_KEY'])]) }),
    Object.freeze({
        providerId: 'huggingface',
        groups: Object.freeze([anySecret('api_key', ['HF_TOKEN', 'HUGGINGFACE_API_TOKEN', 'HUGGING_FACE_API_KEY', 'HUGGING_FACE_KEY'])]),
    }),
    Object.freeze({
        providerId: 'cloudflare-workers-ai',
        groups: Object.freeze([
            anySecret('api_token', ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_KEY']),
            allConfig('account_id', ['CLOUDFLARE_ACCOUNT_ID']),
            allConfig('gateway_id', ['CLOUDFLARE_AI_GATEWAY_ID'], { required: false }),
        ]),
    }),
    Object.freeze({ providerId: 'nvidia-nim', groups: Object.freeze([anySecret('api_key', ['NVIDIA_API_KEY', 'NVIDIA_KEY'])]) }),
    Object.freeze({ providerId: 'cerebras', groups: Object.freeze([anySecret('api_key', ['CEREBRAS_API_KEY', 'CEREBRAS_KEY'])]) }),
    Object.freeze({ providerId: 'chutes', groups: Object.freeze([anySecret('api_key', ['CHUTES_API_KEY', 'CHUTES_AI'])]) }),
    Object.freeze({ providerId: 'zai', groups: Object.freeze([anySecret('api_key', ['ZAI_API_KEY', 'Z_AI_KEY'])]) }),
    Object.freeze({ providerId: 'opencode', groups: Object.freeze([anySecret('api_key', ['OPENCODE_API_KEY'])]) }),
    Object.freeze({
        providerId: 'ollama-local',
        providerAliases: Object.freeze(['ollama']),
        groups: Object.freeze([allConfig('local_base_url', ['OLLAMA_BASE_URL', 'OLLAMA_HOST', 'COPILOT_OLLAMA_BASE_URL'], { mode: 'any' })]),
    }),
    Object.freeze({ providerId: 'ollama-cloud', groups: Object.freeze([anySecret('api_key', ['OLLAMA_CLOUD_API_KEY'])]) }),
]);

/**
 * @param {string} id
 * @param {readonly string[]} keys
 * @param {{ required?: boolean }} [options]
 * @returns {{ id: string; kind: 'secret'; mode: 'any'; keys: readonly string[]; required: boolean }}
 */
function anySecret(id, keys, options = {}) {
    return { id, kind: 'secret', mode: 'any', keys, required: options.required ?? true };
}

/**
 * @param {string} id
 * @param {readonly string[]} keys
 * @param {{ required?: boolean; mode?: 'any' | 'all' }} [options]
 * @returns {{ id: string; kind: 'config'; mode: 'any' | 'all'; keys: readonly string[]; required: boolean }}
 */
function allConfig(id, keys, options = {}) {
    return { id, kind: 'config', mode: options.mode ?? 'all', keys, required: options.required ?? true };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {object} entry
 * @returns {string[]}
 */
function providerAliases(entry) {
    const aliases = /** @type {{ providerAliases?: unknown }} */ (entry).providerAliases;
    return Array.isArray(aliases) ? aliases.map(optionalString).filter((item) => item !== null) : [];
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} keys
 * @returns {string[]}
 */
function configuredKeys(env, keys) {
    return keys.filter((key) => optionalString(env[key]) !== null);
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ id: string; kind: string; mode: string; keys: readonly string[]; required: boolean }} group
 * @returns {{ id: string; kind: string; mode: string; required: boolean; keys: string[]; configuredKeys: string[]; missingKeys: string[]; satisfied: boolean }}
 */
function evaluateGroup(env, group) {
    const configured = configuredKeys(env, group.keys);
    const satisfied = group.mode === 'all' ? configured.length === group.keys.length : configured.length > 0;
    return {
        id: group.id,
        kind: group.kind,
        mode: group.mode,
        required: group.required,
        keys: [...group.keys],
        configuredKeys: configured,
        missingKeys: group.keys.filter((key) => !configured.includes(key)),
        satisfied,
    };
}

/**
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {readonly { providerId: string; providerAliases?: readonly string[]; groups: readonly { id: string; kind: string; mode: string; keys: readonly string[]; required: boolean }[] }[]} [options.requirements]
 * @param {string} [options.providerId]
 * @returns {Array<{
 *   providerId: string;
 *   status: 'ready' | 'missing' | 'partial';
 *   requiredGroupCount: number;
 *   satisfiedRequiredGroupCount: number;
 *   recommendedGroupCount: number;
 *   satisfiedRecommendedGroupCount: number;
 *   configuredKeys: string[];
 *   missingRequiredKeys: string[];
 *   missingRecommendedKeys: string[];
 *   groups: Array<ReturnType<typeof evaluateGroup>>;
 * }>}
 */
export function evaluateModelGatewayProviderEnvRequirements(options = {}) {
    const env = options.env ?? process.env;
    const providerFilter = optionalString(options.providerId)?.toLowerCase() ?? null;
    const requirements = options.requirements ?? MODEL_GATEWAY_PROVIDER_ENV_REQUIREMENTS;
    return requirements
        .filter((entry) => {
            if (!providerFilter) return true;
            const ids = [entry.providerId, ...providerAliases(entry)].map((item) => item.toLowerCase());
            return ids.includes(providerFilter);
        })
        .map((entry) => {
            const groups = entry.groups.map((group) => evaluateGroup(env, group));
            const requiredGroups = groups.filter((group) => group.required);
            const recommendedGroups = groups.filter((group) => !group.required);
            const satisfiedRequiredGroupCount = requiredGroups.filter((group) => group.satisfied).length;
            const satisfiedRecommendedGroupCount = recommendedGroups.filter((group) => group.satisfied).length;
            const configured = [...new Set(groups.flatMap((group) => group.configuredKeys))].sort();
            const missingRequired = [...new Set(requiredGroups.filter((group) => !group.satisfied).flatMap((group) => group.keys))].sort();
            const missingRecommended = [...new Set(recommendedGroups.filter((group) => !group.satisfied).flatMap((group) => group.keys))].sort();
            const status = satisfiedRequiredGroupCount === requiredGroups.length ? 'ready' : satisfiedRequiredGroupCount > 0 ? 'partial' : 'missing';
            return {
                providerId: entry.providerId,
                providerAliases: providerAliases(entry),
                status,
                requiredGroupCount: requiredGroups.length,
                satisfiedRequiredGroupCount,
                recommendedGroupCount: recommendedGroups.length,
                satisfiedRecommendedGroupCount,
                configuredKeys: configured,
                missingRequiredKeys: missingRequired,
                missingRecommendedKeys: missingRecommended,
                groups,
            };
        });
}

/**
 * @param {readonly ReturnType<typeof evaluateModelGatewayProviderEnvRequirements>[number][]} rows
 * @returns {{ providerCount: number; readyCount: number; partialCount: number; missingCount: number; missingRequiredKeyCounts: Record<string, number>; missingRecommendedKeyCounts: Record<string, number> }}
 */
export function summarizeModelGatewayProviderEnvRequirements(rows) {
    /** @type {Record<string, number>} */
    const missingRequiredKeyCounts = {};
    /** @type {Record<string, number>} */
    const missingRecommendedKeyCounts = {};
    for (const row of rows) {
        for (const key of row.missingRequiredKeys) missingRequiredKeyCounts[key] = (missingRequiredKeyCounts[key] ?? 0) + 1;
        for (const key of row.missingRecommendedKeys) missingRecommendedKeyCounts[key] = (missingRecommendedKeyCounts[key] ?? 0) + 1;
    }
    return {
        providerCount: rows.length,
        readyCount: rows.filter((row) => row.status === 'ready').length,
        partialCount: rows.filter((row) => row.status === 'partial').length,
        missingCount: rows.filter((row) => row.status === 'missing').length,
        missingRequiredKeyCounts,
        missingRecommendedKeyCounts,
    };
}
