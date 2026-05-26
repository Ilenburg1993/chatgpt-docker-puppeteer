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
    'OPENCODE_API_KEY',
    'KILO_API_KEY',
    'KILO_CODE_API_KEY',
]);

export const MODEL_GATEWAY_SECRET_SCOPE_PRECEDENCE = Object.freeze(['account', 'workspace', 'global']);

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function scopeToken(value) {
    const text = optionalString(value);
    if (!text) return null;
    const token = text
        .toUpperCase()
        .replace(/[^A-Z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '');
    return token || null;
}

/**
 * @param {{ scope: 'account' | 'workspace'; scopeId: string; ref: string }} input
 * @returns {string}
 */
export function buildScopedSecretEnvKey(input) {
    const scopeId = scopeToken(input.scopeId) ?? 'DEFAULT';
    return `COPILOT_BYOK_${input.scope.toUpperCase()}_${scopeId}__${input.ref}`;
}

export class EnvSecretRegistry {
    /** @type {Record<string, string | undefined>} */
    #env;
    /** @type {Set<string>} */
    #keys;
    /** @type {string | null} */
    #accountId;
    /** @type {string | null} */
    #workspaceId;

    /**
     * @param {{ env?: Record<string, string | undefined>; keys?: readonly string[]; accountId?: string; workspaceId?: string }} [options]
     */
    constructor(options = {}) {
        this.#env = options.env ?? process.env;
        this.#keys = new Set(options.keys ?? DEFAULT_MODEL_GATEWAY_SECRET_ENV_KEYS);
        this.#accountId = optionalString(options.accountId);
        this.#workspaceId = optionalString(options.workspaceId);
    }

    /**
     * @param {string} ref
     * @returns {Array<{ scope: 'account' | 'workspace' | 'global'; envKey: string }>}
     */
    candidateRefs(ref) {
        const key = optionalString(ref);
        if (!key || !this.#keys.has(key)) return [];
        /** @type {Array<{ scope: 'account' | 'workspace' | 'global'; envKey: string }>} */
        const candidates = [];
        if (this.#accountId) candidates.push({ scope: 'account', envKey: buildScopedSecretEnvKey({ scope: 'account', scopeId: this.#accountId, ref: key }) });
        if (this.#workspaceId) {
            candidates.push({ scope: 'workspace', envKey: buildScopedSecretEnvKey({ scope: 'workspace', scopeId: this.#workspaceId, ref: key }) });
        }
        candidates.push({ scope: 'global', envKey: key });
        return candidates;
    }

    /**
     * @param {string} ref
     * @returns {string | undefined}
     */
    get(ref) {
        for (const candidate of this.candidateRefs(ref)) {
            const value = optionalString(this.#env[candidate.envKey]);
            if (value) return value;
        }
        return undefined;
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
     * @returns {{ ref: string; configured: boolean; source: 'env'; scope: 'account' | 'workspace' | 'global' | null; checkedEnvKeys: string[]; safeLabel: string }}
     */
    describe(ref) {
        const key = optionalString(ref) ?? '';
        const candidates = this.candidateRefs(key);
        const configured = candidates.find((candidate) => optionalString(this.#env[candidate.envKey]) !== null) ?? null;
        return {
            ref: key,
            configured: configured !== null,
            source: 'env',
            scope: configured?.scope ?? null,
            checkedEnvKeys: candidates.map((candidate) => candidate.envKey),
            safeLabel: key ? `${key}=<${configured ? `configured:${configured.scope}` : 'missing'}>` : '<invalid-ref>',
        };
    }

    /**
     * @returns {Array<ReturnType<EnvSecretRegistry['describe']>>}
     */
    listConfigured() {
        return [...this.#keys].map((key) => this.describe(key)).filter((entry) => entry.configured);
    }
}

/**
 * @param {{ env?: Record<string, string | undefined>; keys?: readonly string[]; accountId?: string; workspaceId?: string }} [options]
 * @returns {EnvSecretRegistry}
 */
export function createEnvSecretRegistry(options = {}) {
    return new EnvSecretRegistry(options);
}
