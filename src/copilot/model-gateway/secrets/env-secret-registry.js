// @ts-check
/**
 * Environment-backed secret registry.
 *
 * The registry describes and resolves secrets for adapters without allowing registry/provider/model records to contain
 * the secret values themselves.
 *
 * @module copilot/model-gateway/secrets/env-secret-registry
 */

export const DEFAULT_MODEL_GATEWAY_SECRET_ENV_KEYS = Object.freeze([
    'COPILOT_BYOK_API_KEY',
    'COPILOT_BYOK_BEARER_TOKEN',
    'OPENAI_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
    'OPENROUTER_API_KEY',
    'OPEN_ROUTER_KEY',
    'GROQ_API_KEY',
    'GROQ_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'GOOGLE_AI_STUDIO_API_KEY',
    'GOOGLE_CLOUD_GEMINI_KEY',
    'GEMINI_KEY',
    'MISTRAL_API_KEY',
    'MISTRAL_KEY',
    'HUGGING_FACE_API_KEY',
    'HUGGING_FACE_KEY',
    'HF_TOKEN',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_KEY',
    'NVIDIA_API_KEY',
    'NVIDIA_KEY',
    'CEREBRAS_API_KEY',
    'CEREBRAS_KEY',
    'CHUTES_API_KEY',
    'CHUTES_AI',
    'ZAI_API_KEY',
    'Z_AI_KEY',
    'OLLAMA_API_KEY',
    'OLLAMA_CLOUD_API_KEY',
    'KILO_API_KEY',
    'KILO_CODE_API_KEY',
]);

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export class EnvSecretRegistry {
    /** @type {Record<string, string | undefined>} */
    #env;
    /** @type {Set<string>} */
    #keys;

    /**
     * @param {{ env?: Record<string, string | undefined>; keys?: readonly string[] }} [options]
     */
    constructor(options = {}) {
        this.#env = options.env ?? process.env;
        this.#keys = new Set(options.keys ?? DEFAULT_MODEL_GATEWAY_SECRET_ENV_KEYS);
    }

    /**
     * @param {string} ref
     * @returns {string | undefined}
     */
    get(ref) {
        const key = optionalString(ref);
        if (!key || !this.#keys.has(key)) return undefined;
        return optionalString(this.#env[key]) ?? undefined;
    }

    /**
     * @param {string} ref
     * @returns {boolean}
     */
    has(ref) {
        return this.get(ref) !== undefined;
    }

    /**
     * @param {string} ref
     * @returns {{ ref: string; configured: boolean; source: 'env'; safeLabel: string }}
     */
    describe(ref) {
        const key = optionalString(ref) ?? '';
        return {
            ref: key,
            configured: this.has(key),
            source: 'env',
            safeLabel: key ? `${key}=<${this.has(key) ? 'configured' : 'missing'}>` : '<invalid-ref>',
        };
    }

    /**
     * @returns {Array<{ ref: string; configured: boolean; source: 'env'; safeLabel: string }>}
     */
    listConfigured() {
        return [...this.#keys].map((key) => this.describe(key)).filter((entry) => entry.configured);
    }
}

/**
 * @param {{ env?: Record<string, string | undefined>; keys?: readonly string[] }} [options]
 * @returns {EnvSecretRegistry}
 */
export function createEnvSecretRegistry(options = {}) {
    return new EnvSecretRegistry(options);
}

