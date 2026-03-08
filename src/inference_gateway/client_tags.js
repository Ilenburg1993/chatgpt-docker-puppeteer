// @ts-check

/** @typedef {(typeof INFERENCE_CLIENT_TAGS)[keyof typeof INFERENCE_CLIENT_TAGS]} InferenceClientTag */
/**
 * @typedef {object} NormalizeInferenceClientTagOptions
 * @property {InferenceClientTag | null} [fallback]
 * @property {boolean} [allowFallbackGeneric]
 */
/** @typedef {Error & { code?: string; statusCode?: number }} InferenceClientTagError */

/**
 * Tags canônicas de consumidores de inferência. A separação por tag evita mistura de políticas entre Audit Agent, RAG e
 * ferramentas MCP.
 */
export const INFERENCE_CLIENT_TAGS = Object.freeze({
    AUDIT_AGENT_TRIAGE: 'audit_agent_triage',
    AUDIT_AGENT_PATCH: 'audit_agent_patch',
    AUDIT_AGENT_REVIEW: 'audit_agent_review',
    RAG_EMBED: 'rag_embed',
    MCP_OLLAMA_GENERATE: 'mcp_ollama_generate',
    MCP_OLLAMA_EMBED: 'mcp_ollama_embed',
    DIAGNOSTICS_PROBE: 'diagnostics_probe',
    FALLBACK_GENERIC: 'fallback_generic',
});

/** @type {ReadonlySet<string>} */
const CLIENT_TAG_SET = new Set(Object.values(INFERENCE_CLIENT_TAGS));

/**
 * @param {unknown} value
 * @returns {value is InferenceClientTag}
 */
export function isInferenceClientTag(value) {
    return typeof value === 'string' && CLIENT_TAG_SET.has(value);
}

/**
 * Normaliza e valida uma tag de cliente de inferência.
 *
 * @param {unknown} value
 * @param {NormalizeInferenceClientTagOptions} [options]
 * @returns {InferenceClientTag}
 */
export function normalizeInferenceClientTag(value, options = {}) {
    const { fallback = null, allowFallbackGeneric = true } = options;
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (isInferenceClientTag(normalized)) {
        return normalized;
    }

    if (fallback && isInferenceClientTag(fallback)) {
        return fallback;
    }

    if (allowFallbackGeneric) {
        return INFERENCE_CLIENT_TAGS.FALLBACK_GENERIC;
    }

    const err = new Error('inference clientTag inválido');
    const typedErr = /** @type {InferenceClientTagError} */ (err);
    typedErr.code = 'INFERENCE_CLIENT_TAG_INVALID';
    typedErr.statusCode = 422;
    throw err;
}

/**
 * Exige tag explícita e canônica (sem fallback implícito).
 *
 * @param {unknown} value
 * @returns {InferenceClientTag}
 */
export function requireInferenceClientTag(value) {
    return normalizeInferenceClientTag(value, { allowFallbackGeneric: false });
}

/**
 * @returns {InferenceClientTag[]}
 */
export function listInferenceClientTags() {
    return Object.values(INFERENCE_CLIENT_TAGS);
}
