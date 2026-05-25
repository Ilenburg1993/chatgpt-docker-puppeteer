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
