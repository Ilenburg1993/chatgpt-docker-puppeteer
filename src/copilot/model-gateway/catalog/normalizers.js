// @ts-check
/**
 * Catalog metadata normalizers.
 *
 * These helpers normalize provider/aggregator vocabulary into the OpenAI-compatible gateway vocabulary. They produce
 * catalog evidence candidates only; runtime promotion still depends on probes.
 *
 * @module copilot/model-gateway/catalog/normalizers
 */

const MODALITY_ALIASES = Object.freeze({
    text: 'text',
    txt: 'text',
    prompt: 'text',
    image: 'image',
    images: 'image',
    vision: 'image',
    image_url: 'image',
    image_input: 'image',
    audio: 'audio',
    speech: 'audio',
    video: 'video',
    pdf: 'pdf',
    document: 'pdf',
    file: 'pdf',
    embedding: 'embedding',
    embeddings: 'embedding',
    rerank: 'rerank',
    reranker: 'rerank',
    asr: 'asr',
    transcription: 'asr',
    stt: 'asr',
    tts: 'tts',
    image_generation: 'image-generation',
    'image-generation': 'image-generation',
});

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function scalarString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumber(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArray(value) {
    if (!Array.isArray(value)) return [];
    return [
        ...new Set(
            value
                .map((item) => scalarString(item))
                .filter((item) => item !== null),
        ),
    ];
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function booleanValue(value) {
    if (typeof value === 'boolean') return value;
    const text = scalarString(value)?.toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
    return null;
}

/**
 * @param {unknown} values
 * @returns {string[]}
 */
export function normalizeCatalogModalities(values) {
    const input = Array.isArray(values) ? values : scalarString(values)?.split(/[,+/ ]/u) ?? [];
    const normalized = input
        .map((value) => scalarString(value)?.toLowerCase().replace(/\s+/gu, '_') ?? null)
        .map((value) => (value ? MODALITY_ALIASES[/** @type {keyof typeof MODALITY_ALIASES} */ (value)] ?? value : null))
        .filter((value) => value !== null);
    return [...new Set(normalized)];
}

/**
 * @param {unknown} expression
 * @returns {{ input: string[]; output: string[] }}
 */
export function parseModelModalityExpression(expression) {
    const value = scalarString(expression);
    if (!value || !value.includes('->')) return { input: [], output: [] };
    const [input, output] = value.split('->', 2);
    return {
        input: normalizeCatalogModalities(input),
        output: normalizeCatalogModalities(output),
    };
}

/**
 * @param {object} [input]
 * @param {unknown} [input.input]
 * @param {unknown} [input.output]
 * @param {unknown} [input.expression]
 * @returns {{ input: string[]; output: string[] }}
 */
export function normalizeModelModalities(input = {}) {
    const expression = parseModelModalityExpression(input.expression);
    const inputModalities = normalizeCatalogModalities(input.input);
    const outputModalities = normalizeCatalogModalities(input.output);
    return {
        input: inputModalities.length > 0 ? inputModalities : expression.input.length > 0 ? expression.input : ['text'],
        output: outputModalities.length > 0 ? outputModalities : expression.output.length > 0 ? expression.output : ['text'],
    };
}

/**
 * @param {object} [input]
 * @param {unknown} [input.supportedParameters]
 * @param {unknown} [input.inputModalities]
 * @param {unknown} [input.outputModalities]
 * @returns {Record<string, boolean>}
 */
export function normalizeOpenAICompatibleModelCapabilities(input = {}) {
    const parameters = new Set(normalizeCatalogModalities(input.supportedParameters).map((value) => value.replace(/-/gu, '_')));
    const rawParameters = new Set(
        (Array.isArray(input.supportedParameters) ? input.supportedParameters : [])
            .map((value) => scalarString(value)?.toLowerCase() ?? null)
            .filter((value) => value !== null),
    );
    const inputModalities = normalizeCatalogModalities(input.inputModalities);
    const outputModalities = normalizeCatalogModalities(input.outputModalities);
    /** @type {Record<string, boolean>} */
    const capabilities = {};
    if (rawParameters.has('tools')) capabilities['tools'] = true;
    if (rawParameters.has('tool_choice')) capabilities['forcedToolChoice'] = true;
    if (rawParameters.has('parallel_tool_calls')) capabilities['parallelToolCalls'] = true;
    if (rawParameters.has('response_format')) capabilities['jsonMode'] = true;
    if (rawParameters.has('structured_outputs') || rawParameters.has('json_schema')) capabilities['structuredOutputs'] = true;
    if (rawParameters.has('reasoning') || rawParameters.has('reasoning_effort') || rawParameters.has('include_reasoning')) {
        capabilities['reasoningEffort'] = true;
    }
    if (rawParameters.has('stream') || rawParameters.has('streaming')) capabilities['streaming'] = true;
    if (inputModalities.includes('image')) capabilities['vision'] = true;
    if (inputModalities.includes('audio') || outputModalities.includes('audio')) capabilities['audio'] = true;
    if (inputModalities.includes('video') || outputModalities.includes('video')) capabilities['video'] = true;
    if (parameters.has('code_execution')) capabilities['codeExecution'] = true;
    if (parameters.has('web_search') || parameters.has('search')) capabilities['webSearch'] = true;
    return capabilities;
}

/**
 * @param {object} [input]
 * @param {unknown} [input.contextWindowTokens]
 * @param {unknown} [input.maxOutputTokens]
 * @param {unknown} [input.maxRequestTokens]
 * @param {unknown} [input.tokensPerMinute]
 * @param {unknown} [input.requestsPerMinute]
 * @param {unknown} [input.dailyRequests]
 * @returns {Record<string, number>}
 */
export function normalizeModelTokenLimits(input = {}) {
    const fields = {
        contextWindowTokens: finiteNumber(input.contextWindowTokens),
        maxOutputTokens: finiteNumber(input.maxOutputTokens),
        maxRequestTokens: finiteNumber(input.maxRequestTokens),
        tokensPerMinute: finiteNumber(input.tokensPerMinute),
        requestsPerMinute: finiteNumber(input.requestsPerMinute),
        dailyRequests: finiteNumber(input.dailyRequests),
    };
    return Object.fromEntries(
        Object.entries(fields)
            .filter(([, value]) => value !== null && value >= 0)
            .map(([key, value]) => [key, /** @type {number} */ (value)]),
    );
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function usdPerMillionTokens(value) {
    const number = finiteNumber(value);
    return number === null ? null : Math.round(number * 1_000_000 * 1_000_000) / 1_000_000;
}

/**
 * @param {object} [input]
 * @param {unknown} [input.inputPerTokenUsd]
 * @param {unknown} [input.outputPerTokenUsd]
 * @param {unknown} [input.cacheReadPerTokenUsd]
 * @param {unknown} [input.cacheWritePerTokenUsd]
 * @param {unknown} [input.requestUsd]
 * @param {unknown} [input.webSearchUsdPerRequest]
 * @returns {Record<string, string | number>}
 */
export function normalizeUsdPricing(input = {}) {
    const fields = {
        inputUsdPerMillion: usdPerMillionTokens(input.inputPerTokenUsd),
        outputUsdPerMillion: usdPerMillionTokens(input.outputPerTokenUsd),
        cacheReadUsdPerMillion: usdPerMillionTokens(input.cacheReadPerTokenUsd),
        cacheWriteUsdPerMillion: usdPerMillionTokens(input.cacheWritePerTokenUsd),
        requestUsd: finiteNumber(input.requestUsd),
        webSearchUsdPerRequest: finiteNumber(input.webSearchUsdPerRequest),
    };
    const pricing = Object.fromEntries(
        Object.entries(fields)
            .filter(([, value]) => value !== null && value >= 0)
            .map(([key, value]) => [key, /** @type {number} */ (value)]),
    );
    return Object.keys(pricing).length > 0
        ? {
              currency: 'USD',
              tokenUnit: 'per_million_tokens',
              requestUnit: 'per_request',
              ...pricing,
          }
        : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function isoDate(value) {
    const number = finiteNumber(value);
    const date = number !== null ? new Date(number > 10_000_000_000 ? number : number * 1000) : new Date(String(value ?? ''));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function compactDateVersion(value) {
    const text = scalarString(value);
    if (!text) return null;
    const dashed = text.match(/(?:^|[-_/])(\d{4})-(\d{2})-(\d{2})(?:$|[-_/])/u);
    if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
    const compact = text.match(/(?:^|[-_/])(\d{4})(\d{2})(\d{2})(?:$|[-_/])/u);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    return null;
}

/**
 * @param {object} [input]
 * @param {unknown} [input.providerModel]
 * @param {unknown} [input.canonicalSlug]
 * @param {unknown} [input.huggingFaceId]
 * @returns {Record<string, string | boolean>}
 */
export function normalizeModelAliases(input = {}) {
    const providerModel = scalarString(input.providerModel);
    const canonicalSlug = scalarString(input.canonicalSlug);
    const huggingFaceId = scalarString(input.huggingFaceId);
    const version = compactDateVersion(canonicalSlug) ?? compactDateVersion(providerModel);
    /** @type {Record<string, string | boolean>} */
    const aliases = {};
    if (providerModel) aliases['providerModel'] = providerModel;
    if (canonicalSlug) aliases['canonicalSlug'] = canonicalSlug;
    if (huggingFaceId) aliases['huggingFaceId'] = huggingFaceId;
    if (version) aliases['version'] = version;
    if (providerModel && /(?:^|[-_/])latest(?:$|[-_/])/iu.test(providerModel)) aliases['isLatestAlias'] = true;
    return aliases;
}

/**
 * @param {object} [input]
 * @param {unknown} [input.created]
 * @param {unknown} [input.expiresAt]
 * @param {unknown} [input.knowledgeCutoff]
 * @param {unknown} [input.providerModel]
 * @param {unknown} [input.lifecycle]
 * @param {number} [input.nowMs]
 * @returns {Record<string, string | boolean>}
 */
export function normalizeModelLifecycle(input = {}) {
    const createdAt = isoDate(input.created);
    const expiresAt = isoDate(input.expiresAt);
    const knowledgeCutoff = isoDate(input.knowledgeCutoff) ?? scalarString(input.knowledgeCutoff);
    const providerLifecycle = scalarString(input.lifecycle);
    const providerModel = scalarString(input.providerModel) ?? '';
    const nowMs = typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
    /** @type {Record<string, string | boolean>} */
    const lifecycle = {};
    if (createdAt) lifecycle['createdAt'] = createdAt;
    if (expiresAt) lifecycle['expiresAt'] = expiresAt;
    if (knowledgeCutoff) lifecycle['knowledgeCutoff'] = knowledgeCutoff;
    if (providerLifecycle) lifecycle['providerStatus'] = providerLifecycle;
    if (providerModel && /(?:preview|beta|experimental|exp)(?:$|[-_/])/iu.test(providerModel)) lifecycle['channel'] = 'preview';
    if (expiresAt && Date.parse(expiresAt) <= nowMs) lifecycle['status'] = 'retired';
    else if (expiresAt) lifecycle['status'] = 'scheduled_retirement';
    else lifecycle['status'] = 'active';
    return lifecycle;
}

/**
 * @param {Record<string, unknown>} fields
 * @returns {Record<string, number>}
 */
function nonNegativeNumberRecord(fields) {
    /** @type {Record<string, number>} */
    const record = {};
    for (const [key, value] of Object.entries(fields)) {
        const number = finiteNumber(value);
        if (number !== null && number >= 0) record[key] = number;
    }
    return record;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizedIdentityToken(value) {
    const text = scalarString(value);
    return text ? text.toLowerCase().replace(/[_\s]+/gu, '-').replace(/-+/gu, '-') : null;
}

/**
 * @param {unknown[]} values
 * @returns {string}
 */
function identitySearchText(values) {
    return values
        .map((value) => scalarString(value))
        .filter((value) => value !== null)
        .join(' ')
        .toLowerCase()
        .replace(/[_:/@]+/gu, '-')
        .replace(/\s+/gu, '-');
}

/** @type {readonly (readonly [string, RegExp])[]} */
const MODEL_FAMILY_PATTERNS = Object.freeze([
    ['gpt-oss', /(?:^|-)gpt-?oss(?:-|$)/u],
    ['gpt', /(?:^|-)gpt(?:-|$)/u],
    ['o', /(?:^|-)o\d+(?:-|$)/u],
    ['claude', /(?:^|-)claude(?:-|$)/u],
    ['gemini', /(?:^|-)gemini(?:-|$)/u],
    ['llama', /(?:^|-)llama(?:-|$)/u],
    ['qwen', /(?:^|-)qwen(?:\d|2\.5|3)?(?:-|$)/u],
    ['deepseek', /(?:^|-)deepseek(?:-|$)/u],
    ['mistral', /(?:^|-)mistral(?:-|$)/u],
    ['mixtral', /(?:^|-)mixtral(?:-|$)/u],
    ['codestral', /(?:^|-)codestral(?:-|$)/u],
    ['kimi', /(?:^|-)kimi(?:-|$)/u],
    ['glm', /(?:^|-)glm(?:-|$)/u],
    ['grok', /(?:^|-)grok(?:-|$)/u],
    ['command', /(?:^|-)command(?:-|$)/u],
    ['nemotron', /(?:^|-)nemotron(?:-|$)/u],
    ['whisper', /(?:^|-)whisper(?:-|$)/u],
    ['tts', /(?:^|-)tts(?:-|$)/u],
    ['embedding', /(?:^|-)(?:embed|embedding|embeddings)(?:-|$)/u],
]);

const MODEL_TIER_TOKENS = Object.freeze([
    'opus',
    'sonnet',
    'haiku',
    'mini',
    'nano',
    'micro',
    'flash',
    'pro',
    'ultra',
    'turbo',
    'max',
    'lite',
    'codex',
    'versatile',
    'instant',
]);

/**
 * @param {string} text
 * @returns {string | null}
 */
function inferModelFamily(text) {
    for (const [family, pattern] of MODEL_FAMILY_PATTERNS) {
        if (pattern.test(text)) return family;
    }
    return null;
}

/**
 * @param {string} text
 * @param {string | null} family
 * @returns {string | null}
 */
function inferModelGeneration(text, family) {
    const familyPatterns =
        family === 'claude'
            ? [/(?:^|-)claude-(?:opus|sonnet|haiku)-(\d+(?:\.\d+)?)(?:-|$)/u, /(?:^|-)claude-(\d+(?:\.\d+)?)(?:-|$)/u]
            : family === 'gpt'
              ? [/(?:^|-)gpt-(\d+(?:\.\d+)?)(?:-|$)/u]
              : family === 'o'
                ? [/(?:^|-)o(\d+(?:\.\d+)?)(?:-|$)/u]
                : family === 'llama'
                  ? [/(?:^|-)llama-(\d+(?:\.\d+)?)(?:-|$)/u]
                  : family === 'qwen'
                    ? [/(?:^|-)qwen-?(\d+(?:\.\d+)?)(?:-|$)/u]
                    : family === 'gemini'
                      ? [/(?:^|-)gemini-(\d+(?:\.\d+)?)(?:-|$)/u]
                      : family === 'glm'
                        ? [/(?:^|-)glm-(\d+(?:\.\d+)?[v]?)(?:-|$)/u]
                        : family === 'grok'
                          ? [/(?:^|-)grok-(\d+(?:\.\d+)?)(?:-|$)/u]
                          : [];
    for (const pattern of familyPatterns) {
        const match = text.match(pattern);
        if (match?.[1]) return match[1];
    }
    return null;
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function inferModelTier(text) {
    for (const tier of MODEL_TIER_TOKENS) {
        if (new RegExp(`(?:^|-)${tier}(?:-|$)`, 'u').test(text)) return tier;
    }
    return null;
}

/**
 * @param {string} text
 * @param {string | null} family
 * @param {string | null} generation
 * @returns {string | null}
 */
function inferModelSeries(text, family, generation) {
    const special = text.match(/(?:^|-)(gpt-oss|qwen\d+(?:\.\d+)?|llama-\d+(?:\.\d+)?|gemini-\d+(?:\.\d+)?|glm-\d+(?:\.\d+)?v?|grok-\d+(?:\.\d+)?)(?:-|$)/u);
    if (special?.[1]) return special[1];
    return family && generation ? `${family}-${generation}` : family;
}

/**
 * @param {unknown} value
 * @returns {{ label: string | null; parameterCountBillions: number | null; expertCount: number | null; expertParameterCountBillions: number | null; activeParameterCountBillions: number | null }}
 */
function parseParameterScale(value) {
    const text = scalarString(value)?.toLowerCase().replace(/[_\s]+/gu, '-') ?? '';
    /** @type {{ label: string | null; parameterCountBillions: number | null; expertCount: number | null; expertParameterCountBillions: number | null; activeParameterCountBillions: number | null }} */
    const result = {
        label: null,
        parameterCountBillions: null,
        expertCount: null,
        expertParameterCountBillions: null,
        activeParameterCountBillions: null,
    };
    const expert = text.match(/(?:^|-)(\d+)x(\d+(?:\.\d+)?)b(?:-|$)/u);
    if (expert?.[1] && expert[2]) {
        result.expertCount = Number(expert[1]);
        result.expertParameterCountBillions = Number(expert[2]);
        result.parameterCountBillions = Math.round(result.expertCount * result.expertParameterCountBillions * 1000) / 1000;
        result.label = `${expert[1]}x${expert[2]}b`;
    }
    const active = text.match(/(?:^|-)a(\d+(?:\.\d+)?)b(?:-|$)/u);
    if (active?.[1]) result.activeParameterCountBillions = Number(active[1]);
    const size = text.match(/(?:^|-)(\d+(?:\.\d+)?)([bm])(?:-|$)/u);
    if (size?.[1] && size[2]) {
        const amount = Number(size[1]);
        result.label = result.label ?? `${size[1]}${size[2]}`;
        result.parameterCountBillions =
            result.parameterCountBillions ?? (size[2] === 'm' ? Math.round((amount / 1000) * 1000) / 1000 : amount);
    }
    return result;
}

/**
 * @param {string} text
 * @param {unknown} explicit
 * @returns {string | null}
 */
function inferQuantization(text, explicit) {
    const explicitValue = normalizedIdentityToken(explicit);
    if (explicitValue) return explicitValue;
    const match = text.match(/(?:^|-)(fp8|fp16|bf16|int8|int4|q[2-8](?:-[a-z0-9]+)*|awq|gptq)(?:-|$)/u);
    return match?.[1] ?? null;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function inferModalityHints(text) {
    /** @type {string[]} */
    const hints = [];
    if (/(?:^|-)(?:vision|vl|llava|image-to-text|multimodal)(?:-|$)/u.test(text)) hints.push('vision');
    if (/(?:^|-)(?:whisper|asr|stt|transcription)(?:-|$)/u.test(text)) hints.push('asr');
    if (/(?:^|-)(?:tts|speech|playai|orpheus)(?:-|$)/u.test(text)) hints.push('tts');
    if (/(?:^|-)(?:embed|embedding|embeddings)(?:-|$)/u.test(text)) hints.push('embedding');
    if (/(?:^|-)(?:rerank|reranker)(?:-|$)/u.test(text)) hints.push('rerank');
    if (/(?:^|-)(?:text-to-image|image-generation)(?:-|$)/u.test(text)) hints.push('image-generation');
    return [...new Set(hints)];
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function inferArchitectureHints(text) {
    /** @type {string[]} */
    const hints = [];
    if (/(?:^|-)(?:r1|reasoning|thinking)(?:-|$)/u.test(text)) hints.push('reasoning_family');
    if (/(?:^|-)(?:instruct|chat)(?:-|$)/u.test(text)) hints.push('instruction_tuned');
    if (/(?:^|-)(?:distill|distilled)(?:-|$)/u.test(text)) hints.push('distilled');
    if (/(?:^|-)(?:moe)(?:-|$)/u.test(text) || /(?:^|-)\d+x\d+(?:\.\d+)?b(?:-|$)/u.test(text)) hints.push('mixture_of_experts');
    if (/(?:^|-)(?:tee|confidential-compute)(?:-|$)/u.test(text)) hints.push('confidential_compute');
    return [...new Set(hints)];
}

/**
 * @param {object} [input]
 * @param {unknown} [input.providerModel]
 * @param {unknown} [input.displayName]
 * @param {unknown} [input.canonicalSlug]
 * @param {unknown} [input.huggingFaceId]
 * @param {unknown} [input.family]
 * @param {unknown} [input.series]
 * @param {unknown} [input.generation]
 * @param {unknown} [input.tier]
 * @param {unknown} [input.parameterSize]
 * @param {unknown} [input.parameterCountBillions]
 * @param {unknown} [input.activeParameterCountBillions]
 * @param {unknown} [input.quantization]
 * @returns {Record<string, string | number | string[]>}
 */
export function normalizeModelIdentityTraits(input = {}) {
    const text = identitySearchText([
        input.providerModel,
        input.displayName,
        input.canonicalSlug,
        input.huggingFaceId,
        input.family,
        input.series,
        input.parameterSize,
        input.quantization,
    ]);
    const explicitFamily = normalizedIdentityToken(input.family);
    const family = explicitFamily ?? inferModelFamily(text);
    const generation = normalizedIdentityToken(input.generation) ?? inferModelGeneration(text, family);
    const tier = normalizedIdentityToken(input.tier) ?? inferModelTier(text);
    const series = normalizedIdentityToken(input.series) ?? inferModelSeries(text, family, generation);
    const scaleFromExplicit = parseParameterScale(input.parameterSize);
    const scaleFromText = parseParameterScale(text);
    const parameterCountBillions = finiteNumber(input.parameterCountBillions) ?? scaleFromExplicit.parameterCountBillions ?? scaleFromText.parameterCountBillions;
    const activeParameterCountBillions =
        finiteNumber(input.activeParameterCountBillions) ??
        scaleFromExplicit.activeParameterCountBillions ??
        scaleFromText.activeParameterCountBillions;
    const quantization = inferQuantization(text, input.quantization);
    const modalityHints = inferModalityHints(text);
    const architectureHints = inferArchitectureHints(text);
    const sizeLabel = scaleFromExplicit.label ?? scaleFromText.label;
    const expertCount = scaleFromExplicit.expertCount ?? scaleFromText.expertCount;
    const expertParameterCountBillions =
        scaleFromExplicit.expertParameterCountBillions ?? scaleFromText.expertParameterCountBillions;
    /** @type {Record<string, string | number | string[]>} */
    const traits = {};
    if (family) traits['family'] = family;
    if (series) traits['series'] = series;
    if (generation) traits['generation'] = generation;
    if (tier) traits['tier'] = tier;
    if (sizeLabel) traits['sizeLabel'] = sizeLabel;
    if (parameterCountBillions !== null && parameterCountBillions >= 0) traits['parameterCountBillions'] = parameterCountBillions;
    if (activeParameterCountBillions !== null && activeParameterCountBillions >= 0) {
        traits['activeParameterCountBillions'] = activeParameterCountBillions;
    }
    if (expertCount !== null && expertCount >= 0) traits['expertCount'] = expertCount;
    if (expertParameterCountBillions !== null && expertParameterCountBillions >= 0) {
        traits['expertParameterCountBillions'] = expertParameterCountBillions;
    }
    if (quantization) traits['quantization'] = quantization;
    if (modalityHints.length > 0) traits['modalityHints'] = modalityHints;
    if (architectureHints.length > 0) traits['architectureHints'] = architectureHints;
    return traits;
}

/**
 * @param {object} [input]
 * @param {unknown} [input.selectorKind]
 * @param {unknown} [input.normalizedPolicy]
 * @param {unknown} [input.providerSpecific]
 * @returns {Record<string, string | boolean | string[]>}
 */
export function normalizeModelRoutePolicyTraits(input = {}) {
    const selectorKind = normalizedIdentityToken(input.selectorKind) ?? 'exact-model';
    const policy = isRecord(input.normalizedPolicy) ? input.normalizedPolicy : {};
    const providerSpecific = isRecord(input.providerSpecific) ? input.providerSpecific : {};
    const routeLayer = normalizedIdentityToken(policy['routeLayer']);
    const wireApi = normalizedIdentityToken(policy['wireApi'] ?? policy['directWireApi']);
    const selectionMode =
        selectorKind === 'gateway-auto'
            ? 'gateway_auto'
            : selectorKind === 'gateway-fallback'
              ? 'gateway_fallback'
              : selectorKind === 'aggregator-auto'
                ? 'aggregator_auto'
                : selectorKind === 'provider-explicit'
                  ? 'provider_explicit'
                  : selectorKind === 'provider-model'
                    ? 'provider_model'
                    : ['fastest', 'cheapest', 'preferred'].includes(selectorKind)
                      ? 'provider_policy'
                      : policy['autoSelection'] === true
                        ? 'auto'
                        : 'exact';
    const endpointKind =
        routeLayer === 'gateway'
            ? 'gateway'
            : routeLayer?.includes('aggregator')
              ? 'aggregator'
              : routeLayer === 'local-daemon' || policy['localPrivate'] === true
                ? 'local_daemon'
                : routeLayer?.includes('openai-compatible')
                  ? 'openai_compatible'
                  : routeLayer === 'direct-provider'
                    ? 'direct_provider'
                    : null;
    /** @type {string[]} */
    const policyHints = [];
    if (policy['supportsFallback'] === true || policy['supportsFallbackChain'] === true) policyHints.push('fallback');
    if (policy['supportsRetry'] === true) policyHints.push('retry');
    if (policy['supportsCache'] === true) policyHints.push('cache');
    if (policy['supportsProviderOrder'] === true) policyHints.push('provider_order');
    if (policy['supportsOrganizationOverlay'] === true) policyHints.push('organization_overlay');
    if (policy['supportsTaskId'] === true) policyHints.push('task_id');
    if (providerSpecific['supportsInternalByok'] === true) policyHints.push('internal_byok');
    if (providerSpecific['huggingFaceProvider']) policyHints.push('explicit_upstream_provider');
    if (providerSpecific['upstreamProvider']) policyHints.push('upstream_provider');
    if (providerSpecific['topProvider']) policyHints.push('aggregator_top_provider');
    if (Array.isArray(providerSpecific['acceptedHeaders']) && providerSpecific['acceptedHeaders'].length > 0) {
        policyHints.push('custom_headers');
    }
    /** @type {Record<string, string | boolean | string[]>} */
    const traits = {
        selectorKind,
        selectionMode,
    };
    if (routeLayer) traits['routeLayer'] = routeLayer;
    if (endpointKind) traits['endpointKind'] = endpointKind;
    if (wireApi) traits['wireApi'] = wireApi;
    if (policy['openAICompatibleBaseUrl'] || endpointKind === 'openai_compatible' || routeLayer === 'openai-compatible-aggregator') {
        traits['openAICompatible'] = true;
    }
    if (policy['autoSelection'] === true || selectionMode !== 'exact') traits['autoSelection'] = true;
    if (policy['localPrivate'] === true) traits['localPrivate'] = true;
    if (policyHints.length > 0) traits['policyHints'] = [...new Set(policyHints)];
    return traits;
}

/**
 * @param {object} [input]
 * @param {unknown} [input.capabilities]
 * @param {unknown} [input.supportedParameters]
 * @param {unknown} [input.modalities]
 * @param {unknown} [input.routeTraits]
 * @returns {Record<string, boolean | string | string[]>}
 */
export function normalizeRuntimeAgenticCapabilityTaxonomy(input = {}) {
    const capabilities = isRecord(input.capabilities) ? input.capabilities : {};
    const modalities = isRecord(input.modalities) ? input.modalities : {};
    const routeTraits = isRecord(input.routeTraits) ? input.routeTraits : {};
    const supportedParameters = new Set(
        stringArray(input.supportedParameters).map((value) => value.toLowerCase().replace(/[-\s]+/gu, '_')),
    );
    const inputModalities = normalizeCatalogModalities(modalities['input']);
    const outputModalities = normalizeCatalogModalities(modalities['output']);
    /**
     * @param {string[]} fieldNames
     * @returns {boolean}
     */
    const bool = (fieldNames) =>
        fieldNames.some((fieldName) => capabilities[fieldName] === true || routeTraits[fieldName] === true || supportedParameters.has(fieldName));
    const taxonomy = {
        tools: bool(['tools', 'tool_use', 'function_calling']),
        forcedToolChoice: bool(['forcedToolChoice', 'forced_tool_choice', 'tool_choice']),
        parallelToolCalls: bool(['parallelToolCalls', 'parallel_tool_calls']),
        jsonMode: bool(['jsonMode', 'json_mode', 'response_format']),
        structuredOutputs: bool(['structuredOutputs', 'structured_outputs', 'json_schema']),
        reasoning: bool(['reasoning', 'reasoningEffort', 'reasoning_effort', 'include_reasoning']),
        streaming: bool(['streaming', 'stream']),
        webSearch: bool(['webSearch', 'web_search', 'search']),
        codeExecution: bool(['codeExecution', 'code_execution']),
        vision: capabilities['vision'] === true || inputModalities.includes('image'),
        audio: capabilities['audio'] === true || inputModalities.includes('audio') || outputModalities.includes('audio'),
    };
    const agenticLevel = taxonomy.parallelToolCalls
        ? 'parallel_tools'
        : taxonomy.forcedToolChoice
          ? 'controlled_tools'
          : taxonomy.tools
            ? 'basic_tools'
            : taxonomy.reasoning
              ? 'reasoning_only'
              : 'none';
    const families = [];
    if (taxonomy.tools) families.push('tools');
    if (taxonomy.reasoning) families.push('reasoning');
    if (taxonomy.structuredOutputs || taxonomy.jsonMode) families.push('structured_outputs');
    if (taxonomy.webSearch) families.push('web_search');
    if (taxonomy.codeExecution) families.push('code_execution');
    if (taxonomy.vision) families.push('vision');
    if (taxonomy.audio) families.push('audio');
    return {
        ...taxonomy,
        agenticLevel,
        capabilityFamilies: families,
    };
}

/**
 * @param {unknown} perToken
 * @param {unknown} perMillion
 * @returns {number | null}
 */
function moneyPerMillion(perToken, perMillion) {
    const explicitPerMillion = finiteNumber(perMillion);
    if (explicitPerMillion !== null) return explicitPerMillion;
    const token = finiteNumber(perToken);
    return token === null ? null : Math.round(token * 1_000_000 * 1_000_000) / 1_000_000;
}

/**
 * @param {object} [input]
 * @param {unknown} [input.currency]
 * @param {unknown} [input.inputPerToken]
 * @param {unknown} [input.outputPerToken]
 * @param {unknown} [input.cacheReadPerToken]
 * @param {unknown} [input.cacheWritePerToken]
 * @param {unknown} [input.inputPerMillion]
 * @param {unknown} [input.outputPerMillion]
 * @param {unknown} [input.cacheReadPerMillion]
 * @param {unknown} [input.cacheWritePerMillion]
 * @param {unknown} [input.inputUsdPerMillion]
 * @param {unknown} [input.outputUsdPerMillion]
 * @param {unknown} [input.cacheReadUsdPerMillion]
 * @param {unknown} [input.cacheWriteUsdPerMillion]
 * @param {unknown} [input.request]
 * @param {unknown} [input.requestUsd]
 * @param {unknown} [input.webSearchPerRequest]
 * @param {unknown} [input.webSearchUsdPerRequest]
 * @param {unknown} [input.exchangeRateToUsd]
 * @returns {Record<string, unknown>}
 */
export function normalizeModelPricingTaxonomy(input = {}) {
    const currency = scalarString(input.currency)?.toUpperCase() ?? 'USD';
    const fields = {
        inputPerMillion: moneyPerMillion(input.inputPerToken, input.inputPerMillion ?? input.inputUsdPerMillion),
        outputPerMillion: moneyPerMillion(input.outputPerToken, input.outputPerMillion ?? input.outputUsdPerMillion),
        cacheReadPerMillion: moneyPerMillion(input.cacheReadPerToken, input.cacheReadPerMillion ?? input.cacheReadUsdPerMillion),
        cacheWritePerMillion: moneyPerMillion(input.cacheWritePerToken, input.cacheWritePerMillion ?? input.cacheWriteUsdPerMillion),
        request: finiteNumber(input.request ?? input.requestUsd),
        webSearchPerRequest: finiteNumber(input.webSearchPerRequest ?? input.webSearchUsdPerRequest),
    };
    const money = Object.fromEntries(
        Object.entries(fields)
            .filter(([, value]) => value !== null && value >= 0)
            .map(([key, value]) => [key, /** @type {number} */ (value)]),
    );
    const exchangeRateToUsd = finiteNumber(input.exchangeRateToUsd);
    const usd =
        currency === 'USD'
            ? Object.fromEntries(
                  Object.entries({
                      inputUsdPerMillion: money['inputPerMillion'],
                      outputUsdPerMillion: money['outputPerMillion'],
                      cacheReadUsdPerMillion: money['cacheReadPerMillion'],
                      cacheWriteUsdPerMillion: money['cacheWritePerMillion'],
                      requestUsd: money['request'],
                      webSearchUsdPerRequest: money['webSearchPerRequest'],
                  }).filter(([, value]) => typeof value === 'number'),
              )
            : exchangeRateToUsd !== null
              ? Object.fromEntries(
                    Object.entries(money)
                        .filter(([, value]) => typeof value === 'number')
                        .map(([key, value]) => [`${key}Usd`, Math.round(Number(value) * exchangeRateToUsd * 1_000_000) / 1_000_000]),
                )
              : {};
    return {
        ...(Object.keys(money).length > 0 ? { currency, tokenUnit: 'per_million_tokens', requestUnit: 'per_request', ...money } : {}),
        ...(exchangeRateToUsd !== null ? { exchangeRateToUsd } : {}),
        ...(Object.keys(usd).length > 0 ? { usd } : {}),
    };
}

/**
 * @param {Record<string, unknown>} [input]
 * @returns {Record<string, unknown>}
 */
export function normalizeRateLimitTaxonomy(input = {}) {
    const requests = nonNegativeNumberRecord({
        perSecond: input['requestsPerSecond'],
        perMinute: input['requestsPerMinute'],
        perHour: input['requestsPerHour'],
        perDay: input['requestsPerDay'] ?? input['dailyRequests'],
        burst: input['requestBurst'],
    });
    const tokens = nonNegativeNumberRecord({
        perSecond: input['tokensPerSecond'],
        perMinute: input['tokensPerMinute'],
        perHour: input['tokensPerHour'],
        perDay: input['tokensPerDay'] ?? input['dailyTokens'],
        burst: input['tokenBurst'],
    });
    const concurrency = nonNegativeNumberRecord({
        maxConcurrentRequests: input['maxConcurrentRequests'] ?? input['concurrentRequests'],
        maxConcurrentStreams: input['maxConcurrentStreams'],
    });
    const retry = nonNegativeNumberRecord({
        retryAfterSeconds: input['retryAfterSeconds'],
        cooldownSeconds: input['cooldownSeconds'],
    });
    const providerPolicy = scalarString(input['providerPolicy']);
    return {
        ...(Object.keys(requests).length > 0 ? { requests } : {}),
        ...(Object.keys(tokens).length > 0 ? { tokens } : {}),
        ...(Object.keys(concurrency).length > 0 ? { concurrency } : {}),
        ...(Object.keys(retry).length > 0 ? { retry } : {}),
        ...(providerPolicy ? { providerPolicy } : {}),
    };
}

/**
 * @param {Record<string, unknown>} [input]
 * @returns {Record<string, unknown>}
 */
export function normalizeDataPolicyTaxonomy(input = {}) {
    const policy = {
        retainsPrompts: booleanValue(input['retainsPrompts'] ?? input['retention']),
        trainsOnPrompts: booleanValue(input['trainsOnPrompts'] ?? input['training']),
        zeroDataRetention: booleanValue(input['zeroDataRetention'] ?? input['zdr']),
        privateDeployment: booleanValue(input['privateDeployment'] ?? input['private']),
        confidentialCompute: booleanValue(input['confidentialCompute'] ?? input['tee']),
        byokRequired: booleanValue(input['byokRequired']),
    };
    return {
        ...Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== null)),
        ...(scalarString(input['dataResidency']) ? { dataResidency: scalarString(input['dataResidency']) } : {}),
        ...(scalarString(input['region']) ? { region: scalarString(input['region']) } : {}),
        ...(scalarString(input['retentionPeriod']) ? { retentionPeriod: scalarString(input['retentionPeriod']) } : {}),
        ...(stringArray(input['compliance']).length > 0 ? { compliance: stringArray(input['compliance']) } : {}),
    };
}

/**
 * @param {Record<string, unknown>} [input]
 * @returns {Record<string, unknown>}
 */
export function resolveModelDeprecationAlias(input = {}) {
    const aliases = isRecord(input['aliases']) ? input['aliases'] : {};
    const lifecycle = isRecord(input['lifecycle']) ? input['lifecycle'] : {};
    const providerModel = scalarString(input['providerModel']);
    const canonicalSlug = scalarString(aliases['canonicalSlug'] ?? input['canonicalSlug']);
    const aliasTarget = scalarString(aliases['aliasTarget'] ?? aliases['target'] ?? input['aliasTarget']);
    const replacementModel = scalarString(lifecycle['replacementModel'] ?? input['replacementModel']);
    const expiresAt = isoDate(lifecycle['expiresAt'] ?? input['expiresAt']);
    const providerStatus = scalarString(lifecycle['providerStatus'] ?? lifecycle['status'] ?? input['status']);
    const explicitDeprecated = booleanValue(input['deprecated']);
    const explicitRetired = booleanValue(input['retired']);
    const inferredDeprecated = /(?:deprecated|deprecat)/iu.test(providerStatus ?? '') || (expiresAt ? Date.parse(expiresAt) > Date.now() : false);
    const inferredRetired = providerStatus === 'retired' || providerStatus === 'removed' || (expiresAt ? Date.parse(expiresAt) <= Date.now() : false);
    const deprecated = explicitDeprecated ?? inferredDeprecated;
    const retired = explicitRetired ?? inferredRetired;
    return {
        providerModel,
        canonicalModel: aliasTarget ?? canonicalSlug ?? providerModel ?? null,
        isAlias: Boolean(aliasTarget && aliasTarget !== providerModel),
        aliasTarget: aliasTarget ?? null,
        replacementModel: replacementModel ?? null,
        deprecated,
        retired,
        expiresAt,
        providerStatus: providerStatus ?? null,
    };
}

/**
 * @param {object} [input]
 * @param {unknown} [input.enabledModels]
 * @param {unknown} [input.blockedModels]
 * @param {unknown} [input.byokProviderKeys]
 * @param {unknown} [input.dailyRequests]
 * @param {unknown} [input.dailyTokens]
 * @param {unknown} [input.monthlyBudgetUsd]
 * @param {unknown} [input.remainingCreditsUsd]
 * @param {unknown} [input.maxConcurrentRequests]
 * @param {unknown} [input.requestsPerMinute]
 * @param {unknown} [input.tokensPerMinute]
 * @param {unknown} [input.requestsPerDay]
 * @param {unknown} [input.tokensPerDay]
 * @param {unknown} [input.concurrentRequests]
 * @param {unknown} [input.hardLimitUsd]
 * @param {unknown} [input.softLimitUsd]
 * @param {unknown} [input.remainingUsd]
 * @param {unknown} [input.currency]
 * @param {unknown} [input.billingStatus]
 * @param {unknown} [input.plan]
 * @param {unknown} [input.freeTier]
 * @param {unknown} [input.providerMetadata]
 * @returns {{
 *   enabledModels?: string[];
 *   blockedModels?: string[];
 *   byokProviderKeys?: string[];
 *   quota: Record<string, number>;
 *   rateLimits: Record<string, number>;
 *   spendingLimits: Record<string, string | number>;
 *   providerMetadata: Record<string, unknown>;
 * }}
 */
export function normalizeAccountOverlayControls(input = {}) {
    const enabledModels = stringArray(input.enabledModels);
    const blockedModels = stringArray(input.blockedModels);
    const byokProviderKeys = stringArray(input.byokProviderKeys);
    const quota = nonNegativeNumberRecord({
        dailyRequests: input.dailyRequests,
        dailyTokens: input.dailyTokens,
        monthlyBudgetUsd: input.monthlyBudgetUsd,
        remainingCreditsUsd: input.remainingCreditsUsd,
        maxConcurrentRequests: input.maxConcurrentRequests,
    });
    const rateLimits = nonNegativeNumberRecord({
        requestsPerMinute: input.requestsPerMinute,
        tokensPerMinute: input.tokensPerMinute,
        requestsPerDay: input.requestsPerDay,
        tokensPerDay: input.tokensPerDay,
        concurrentRequests: input.concurrentRequests,
    });
    const spending = nonNegativeNumberRecord({
        hardLimitUsd: input.hardLimitUsd,
        softLimitUsd: input.softLimitUsd,
        remainingUsd: input.remainingUsd,
    });
    const currency = scalarString(input.currency)?.toUpperCase();
    /** @type {Record<string, string | number>} */
    const spendingLimits = {
        ...(Object.keys(spending).length > 0 ? { currency: currency ?? 'USD' } : {}),
        ...spending,
    };
    /** @type {Record<string, unknown>} */
    const providerMetadata = {
        ...(isRecord(input.providerMetadata) ? input.providerMetadata : {}),
    };
    const billingStatus = scalarString(input.billingStatus);
    const plan = scalarString(input.plan);
    const freeTier = booleanValue(input.freeTier);
    if (billingStatus) providerMetadata['billingStatus'] = billingStatus;
    if (plan) providerMetadata['plan'] = plan;
    if (freeTier !== null) providerMetadata['freeTier'] = freeTier;
    return {
        ...(enabledModels.length > 0 ? { enabledModels } : {}),
        ...(blockedModels.length > 0 ? { blockedModels } : {}),
        ...(byokProviderKeys.length > 0 ? { byokProviderKeys } : {}),
        quota,
        rateLimits,
        spendingLimits,
        providerMetadata,
    };
}
