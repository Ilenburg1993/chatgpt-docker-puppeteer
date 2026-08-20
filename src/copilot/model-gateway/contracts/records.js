// @ts-check
/**
 * Canonical records for the Copilot model gateway.
 *
 * The gateway stores provider/model facts without provider secrets. Runtime bridges may later resolve a selected record
 * into SDK `ProviderConfig`, but records themselves stay serializable, auditable and safe to expose.
 *
 * @module copilot/model-gateway/contracts/records
 */

export const MODEL_GATEWAY_SCHEMA_VERSION = 1;

export const MODEL_GATEWAY_VERIFICATION_CONFIDENCE = Object.freeze({
    UNKNOWN: 'unknown',
    STATIC_SEED: 'static_seed',
    CATALOG: 'catalog',
    MANUAL: 'manual',
    PROBE_VERIFIED: 'probe_verified',
    PROBE_FAILED: 'probe_failed',
});

const DEFAULT_MODALITIES = Object.freeze({
    input: Object.freeze(['text']),
    output: Object.freeze(['text']),
});

/** @type {Readonly<Record<string, boolean>>} */
const DEFAULT_CAPABILITIES = Object.freeze({
    text: true,
    streaming: true,
    tools: false,
    forcedToolChoice: false,
    parallelToolCalls: false,
    structuredOutputs: false,
    jsonMode: false,
    jsonSchema: false,
    vision: false,
    reasoningEffort: false,
    reasoningBudgetTokens: false,
    logprobs: false,
    seed: false,
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
export function optionalString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function optionalPositiveInteger(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value);
}

/**
 * @param {string} input
 * @returns {string}
 */
export function normalizeGatewayIdPart(input) {
    return input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._@/-]+/gu, '-')
        .replace(/^-+|-+$/gu, '');
}

/**
 * @param {string} providerId
 * @param {string} providerModel
 * @returns {string}
 */
export function buildProviderModelId(providerId, providerModel) {
    const normalizedProvider = normalizeGatewayIdPart(providerId || 'unknown-provider') || 'unknown-provider';
    const normalizedModel = String(providerModel || 'unknown-model').trim();
    return `${normalizedProvider}:${normalizedModel}`;
}

/**
 * @param {Record<string, unknown>} [input]
 * @returns {Readonly<Record<string, boolean>>}
 */
export function normalizeCapabilityProfile(input = {}) {
    return Object.freeze(
        Object.fromEntries(
            Object.entries(DEFAULT_CAPABILITIES).map(([key, fallback]) => [key, Boolean(input[key] ?? fallback)]),
        ),
    );
}

/**
 * @param {{ input?: string[]; output?: string[] }} [input]
 * @returns {{ input: string[]; output: string[] }}
 */
export function normalizeModalities(input = {}) {
    const inputModalities = Array.isArray(input.input)
        ? input.input.filter((item) => typeof item === 'string')
        : DEFAULT_MODALITIES.input;
    const outputModalities = Array.isArray(input.output)
        ? input.output.filter((item) => typeof item === 'string')
        : DEFAULT_MODALITIES.output;
    return {
        input: [...new Set(inputModalities.length > 0 ? inputModalities : DEFAULT_MODALITIES.input)],
        output: [...new Set(outputModalities.length > 0 ? outputModalities : DEFAULT_MODALITIES.output)],
    };
}

/**
 * @param {object} [input]
 * @param {string} [input.confidence]
 * @param {string[]} [input.sources]
 * @param {string} [input.updatedAt]
 * @returns {{ confidence: string; sources: string[]; updatedAt: string }}
 */
export function normalizeVerification(input = {}) {
    const confidence = optionalString(input.confidence) ?? MODEL_GATEWAY_VERIFICATION_CONFIDENCE.UNKNOWN;
    const sources = Array.isArray(input.sources)
        ? [...new Set(input.sources.map(optionalString).filter((item) => item !== null))]
        : [];
    return {
        confidence,
        sources,
        updatedAt: optionalString(input.updatedAt) ?? new Date().toISOString(),
    };
}

/**
 * @param {object} input
 * @param {string} input.id
 * @param {string | undefined} [input.displayName]
 * @param {string | undefined} [input.providerType]
 * @param {string | undefined} [input.baseUrl]
 * @param {string | undefined} [input.wireApi]
 * @param {boolean} [input.enabled]
 * @param {boolean} [input.configured]
 * @param {string[]} [input.secretRefs]
 * @param {Record<string, string>} [input.headers]
 * @param {Record<string, unknown>} [input.auth]
 * @param {object} [input.provenance]
 */
export function createProviderRecord(input) {
    const id = normalizeGatewayIdPart(input.id);
    if (!id) throw new Error('[model-gateway] provider id is required');
    const now = new Date().toISOString();
    return {
        schemaVersion: MODEL_GATEWAY_SCHEMA_VERSION,
        id,
        displayName: optionalString(input.displayName) ?? id,
        providerType: optionalString(input.providerType) ?? 'openai',
        baseUrl: optionalString(input.baseUrl),
        wireApi: optionalString(input.wireApi),
        enabled: input.enabled !== false,
        configured: input.configured === true,
        secretRefs: Array.isArray(input.secretRefs)
            ? [...new Set(input.secretRefs.map(optionalString).filter((item) => item !== null))]
            : [],
        auth: isRecord(input.auth) ? { ...input.auth } : {},
        headers: isRecord(input.headers)
            ? Object.fromEntries(Object.keys(input.headers).map((key) => [key, '[redacted]']))
            : {},
        createdAt: now,
        updatedAt: now,
        provenance: isRecord(input.provenance) ? { ...input.provenance } : { source: 'unknown' },
    };
}

/**
 * @param {object} input
 * @param {string} input.providerId
 * @param {string} input.providerModel
 * @param {string} [input.id]
 * @param {string | undefined} [input.displayName]
 * @param {boolean} [input.enabled]
 * @param {{ input?: string[]; output?: string[] }} [input.modalities]
 * @param {Record<string, unknown>} [input.capabilities]
 * @param {string[]} [input.supportedParameters]
 * @param {Record<string, number | null | undefined>} [input.limits]
 * @param {Record<string, number | null | undefined>} [input.pricing]
 * @param {object} [input.routing]
 * @param {object} [input.verification]
 * @param {object} [input.provenance]
 */
export function createModelRecord(input) {
    const providerId = normalizeGatewayIdPart(input.providerId);
    const providerModel = optionalString(input.providerModel);
    if (!providerId) throw new Error('[model-gateway] model providerId is required');
    if (!providerModel) throw new Error('[model-gateway] providerModel is required');
    const now = new Date().toISOString();
    const capabilities = normalizeCapabilityProfile(input.capabilities);
    const modalityInput = capabilities['vision']
        ? [...new Set([...(input.modalities?.input ?? DEFAULT_MODALITIES.input), 'image'])]
        : input.modalities?.input;
    const modalities = normalizeModalities({
        ...(input.modalities?.output ? { output: input.modalities.output } : {}),
        ...(modalityInput ? { input: modalityInput } : {}),
    });
    return {
        schemaVersion: MODEL_GATEWAY_SCHEMA_VERSION,
        id: optionalString(input.id) ?? buildProviderModelId(providerId, providerModel),
        providerId,
        providerModel,
        displayName: optionalString(input.displayName) ?? providerModel,
        enabled: input.enabled !== false,
        modalities,
        capabilities,
        supportedParameters: Array.isArray(input.supportedParameters)
            ? [...new Set(input.supportedParameters.map(optionalString).filter((item) => item !== null))]
            : [],
        limits: Object.fromEntries(
            Object.entries(input.limits ?? {})
                .map(([key, value]) => [key, optionalPositiveInteger(value)])
                .filter(([, value]) => value !== null),
        ),
        pricing: Object.fromEntries(
            Object.entries(input.pricing ?? {}).filter(
                ([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
            ),
        ),
        routing: isRecord(input.routing)
            ? {
                  ...input.routing,
                  tier: optionalString(input.routing['tier']) ?? 'balanced',
                  useCases: Array.isArray(input.routing['useCases']) ? input.routing['useCases'] : [],
              }
            : { tier: 'balanced', useCases: [] },
        verification: normalizeVerification(input.verification),
        createdAt: now,
        updatedAt: now,
        provenance: isRecord(input.provenance) ? { ...input.provenance } : { source: 'unknown' },
    };
}
