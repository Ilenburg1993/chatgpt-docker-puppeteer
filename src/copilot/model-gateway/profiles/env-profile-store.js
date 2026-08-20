// @ts-check
/**
 * Profile store for operator-authored BYOK profiles.
 *
 * The store owns profile identity, redacted diagnostics, and explicit SDK-facing env materialization. It never returns
 * inline secret values or resolved env values through inventory/diagnostic reads.
 *
 * @module copilot/model-gateway/profiles/env-profile-store
 */

import { resolveProviderEndpointInventory } from '../providers/endpoints/index.js';
import { resolveModelGatewayProviderSecretRefs } from '../secrets/requirements.js';

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {Record<string, unknown>} profile
 * @param {string[]} keys
 * @returns {string | null}
 */
function firstText(profile, keys) {
    for (const key of keys) {
        const value = text(profile[key]);
        if (value) return value;
    }
    return null;
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {string | null}
 */
function providerId(profile) {
    return firstText(profile, ['providerId', 'provider', 'preset', 'providerPreset', 'COPILOT_BYOK_PROVIDER_PRESET']);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function booleanText(value) {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return text(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function numberText(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
    return text(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function scalarText(value) {
    if (typeof value === 'string') return text(value);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return null;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function truthyProfileFlag(value) {
    if (value === true) return true;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0;
    if (typeof value !== 'string') return false;
    return /^(1|true|yes|sim|on|free|included)$/iu.test(value.trim());
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
function textSuggestsFreeProfile(value) {
    return typeof value === 'string' && /\b(free|gratis|included|allowance|quota|grant)\b/iu.test(value);
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} profile
 * @returns {{ profileFreeTier: boolean | null; profileCostSource: string | null; profileCostDetail: string | null }}
 */
function profileCostHint(name, profile) {
    const metadata = record(profile['metadata']);
    const candidates = [
        ['metadata.freeTier', metadata['freeTier']],
        ['metadata.free', metadata['free']],
        ['metadata.included', metadata['included']],
        ['metadata.freeFirst', metadata['freeFirst']],
        ['metadata.freeLimit', metadata['freeLimit']],
        ['metadata.free_limits', metadata['free_limits']],
        ['metadata.costPolicy', metadata['costPolicy']],
        ['metadata.cost_policy', metadata['cost_policy']],
        ['profile.freeTier', profile['freeTier']],
        ['profile.free', profile['free']],
        ['profile.freeFirst', profile['freeFirst']],
    ];
    for (const [source, value] of candidates) {
        const scalar = scalarText(value);
        if (
            truthyProfileFlag(value) ||
            textSuggestsFreeProfile(scalar) ||
            (scalar !== null && String(source).toLowerCase().includes('freelimit'))
        ) {
            return {
                profileFreeTier: true,
                profileCostSource: String(source),
                profileCostDetail: scalar,
            };
        }
    }
    if (/\bfree\b/iu.test(name)) {
        return {
            profileFreeTier: true,
            profileCostSource: 'profile.name',
            profileCostDetail: name,
        };
    }
    return { profileFreeTier: null, profileCostSource: null, profileCostDetail: null };
}

/**
 * @param {Record<string, unknown>} profile
 * @param {string} canonicalKey
 * @param {string[]} aliases
 * @returns {string | null}
 */
function firstProfileSecretRef(profile, canonicalKey, aliases) {
    return firstText(profile, [`${canonicalKey}Env`, ...aliases]);
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {{ apiKeyRef: string | null; bearerTokenRef: string | null; refs: string[] }}
 */
function profileSecretRefs(profile) {
    const apiKeyRef = firstProfileSecretRef(profile, 'apiKey', ['apiKeyRef', 'COPILOT_BYOK_API_KEY_ENV', 'keyEnv']);
    const bearerTokenRef = firstProfileSecretRef(profile, 'bearerToken', [
        'bearerTokenRef',
        'COPILOT_BYOK_BEARER_TOKEN_ENV',
        'tokenEnv',
    ]);
    return {
        apiKeyRef,
        bearerTokenRef,
        refs: [apiKeyRef, bearerTokenRef].filter((item) => item !== null),
    };
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} profile
 */
function assertProfileSecretRefsAllowed(name, profile) {
    const secretRefs = profileSecretRefs(profile).refs;
    if (secretRefs.length === 0) return;
    const profileProviderId = providerId(profile);
    const allowedRefs = new Set(resolveModelGatewayProviderSecretRefs(profileProviderId).allowedRefs);
    const rejected = secretRefs.find((ref) => !allowedRefs.has(ref));
    if (!rejected) return;
    const providerText = profileProviderId ?? 'generic';
    throw new Error(
        `MODEL_GATEWAY_PROFILE_SECRET_REF_NOT_ALLOWED: profile=${name} provider=${providerText} ref=${rejected}`,
    );
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string | null} ref
 * @returns {string | null}
 */
function envSecret(env, ref) {
    return ref ? text(env[ref]) : null;
}

/**
 * @param {string | null} providerIdValue
 * @returns {'openai' | 'azure' | 'anthropic' | null}
 */
function providerTypeForProviderId(providerIdValue) {
    if (providerIdValue === 'anthropic' || providerIdValue === 'claude') return 'anthropic';
    if (providerIdValue === 'azure' || providerIdValue === 'azure-openai') return 'azure';
    return providerIdValue ? 'openai' : null;
}

/**
 * @param {string | null} providerIdValue
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
function defaultBaseUrl(providerIdValue, env) {
    if (!providerIdValue) return null;
    if (providerIdValue === 'ollama-local' || providerIdValue === 'ollama') {
        const configured = text(env['OLLAMA_LOCAL_BASE_URL']) ?? text(env['OLLAMA_BASE_URL']);
        return configured
            ? `${configured.replace(/\/+$/u, '').replace(/\/api$/u, '')}/v1`
            : 'http://localhost:11434/v1';
    }
    if (providerIdValue === 'ollama-cloud') {
        const configured = text(env['OLLAMA_CLOUD_BASE_URL']);
        return configured ? `${configured.replace(/\/+$/u, '').replace(/\/api$/u, '')}/v1` : 'https://ollama.com/v1';
    }
    if (providerIdValue === 'cloudflare-workers-ai') {
        const accountId = text(env['CLOUDFLARE_ACCOUNT_ID']);
        if (accountId) return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
    }
    const inventory = resolveProviderEndpointInventory(providerIdValue);
    return inventory?.baseUrls.find((url) => !url.includes('{')) ?? null;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} key
 * @param {string | null | undefined} value
 * @param {{ preserveExisting?: boolean }} [options]
 */
function setMaterializedEnvValue(env, key, value, options = {}) {
    if (!value) return;
    if (options.preserveExisting && text(env[key])) return;
    env[key] = value;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ apiKeyConfigured: boolean; bearerTokenConfigured: boolean; headersConfigured: boolean }}
 */
function materializedAuthSummary(env) {
    return {
        apiKeyConfigured: text(env['COPILOT_BYOK_API_KEY']) !== null,
        bearerTokenConfigured: text(env['COPILOT_BYOK_BEARER_TOKEN']) !== null,
        headersConfigured: text(env['COPILOT_BYOK_HEADERS_JSON']) !== null,
    };
}

/**
 * @param {ReturnType<typeof profileDescriptor>} descriptor
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function profileSummaryErrors(descriptor, env) {
    /** @type {string[]} */
    const errors = [];
    const auth = materializedAuthSummary(env);
    if (!descriptor.providerId) errors.push('providerId ausente');
    if (!text(env['COPILOT_BYOK_PROVIDER_TYPE'])) errors.push('providerType ausente');
    if (!text(env['COPILOT_BYOK_BASE_URL'])) errors.push('baseUrl ausente');
    if (!text(env['COPILOT_BYOK_MODEL'])) errors.push('model ausente');
    if (!auth.apiKeyConfigured && !auth.bearerTokenConfigured && !auth.headersConfigured) {
        errors.push('credencial ausente');
    }
    return errors;
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} profile
 */
function profileDescriptor(name, profile) {
    const secretRefs = profileSecretRefs(profile);
    const headers = record(profile['headers']);
    const headersJson = text(profile['headersJson'] ?? profile['headersJSON'] ?? profile['COPILOT_BYOK_HEADERS_JSON']);
    return {
        schemaVersion: 'model-gateway.provider-profile.v1',
        name,
        providerId: providerId(profile),
        providerType: firstText(profile, ['providerType', 'type', 'COPILOT_BYOK_PROVIDER_TYPE']),
        baseUrl: firstText(profile, ['baseUrl', 'baseURL', 'url', 'COPILOT_BYOK_BASE_URL']),
        model: firstText(profile, ['model', 'modelId', 'id', 'COPILOT_BYOK_MODEL']),
        wireApi: firstText(profile, ['wireApi', 'COPILOT_BYOK_WIRE_API']),
        secretRefs: secretRefs.refs,
        inlineSecretConfigured: Boolean(
            text(profile['apiKey'] ?? profile['COPILOT_BYOK_API_KEY']) ||
            text(profile['bearerToken'] ?? profile['COPILOT_BYOK_BEARER_TOKEN']),
        ),
        headersConfigured: Object.keys(headers).length > 0 || headersJson !== null,
        metadataKeys: Object.keys(record(profile['metadata'])).sort(),
        costHint: profileCostHint(name, profile),
    };
}

/**
 * @param {Record<string, unknown>} profiles
 * @returns {string}
 */
function serializeProfiles(profiles) {
    return `${JSON.stringify(profiles, null, 2)}\n`;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function plainObject(value) {
    return record(value);
}

export class ModelGatewayEnvProfileStore {
    /** @type {Record<string, string | undefined>} */
    #env;

    /**
     * @param {{ env?: Record<string, string | undefined> }} [options]
     */
    constructor(options = {}) {
        this.#env = options.env ?? process.env;
    }

    /**
     * @returns {ReturnType<typeof profileDescriptor>[]}
     */
    list() {
        const raw = this.#env['COPILOT_BYOK_PROFILES_JSON'];
        if (!raw || !raw.trim()) return [];
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`MODEL_GATEWAY_PROFILE_STORE_INVALID_JSON: ${message}`, { cause: error });
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('MODEL_GATEWAY_PROFILE_STORE_INVALID_ROOT: expected object keyed by profile name');
        }
        return Object.entries(/** @type {Record<string, unknown>} */ (parsed))
            .filter(([name]) => name.trim())
            .map(([name, value]) => profileDescriptor(name.trim(), record(value)))
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    /**
     * @returns {Record<string, Record<string, unknown>>}
     */
    #readProfileMap() {
        const raw = this.#env['COPILOT_BYOK_PROFILES_JSON'];
        if (!raw || !raw.trim()) return {};
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`MODEL_GATEWAY_PROFILE_STORE_INVALID_JSON: ${message}`, { cause: error });
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('MODEL_GATEWAY_PROFILE_STORE_INVALID_ROOT: expected object keyed by profile name');
        }
        return /** @type {Record<string, Record<string, unknown>>} */ (
            Object.fromEntries(
                Object.entries(parsed)
                    .filter(([name]) => text(name) !== null)
                    .map(([name, value]) => [text(name) ?? name, plainObject(value)]),
            )
        );
    }

    /**
     * @param {Record<string, Record<string, unknown>>} profiles
     * @returns {void}
     */
    #writeProfileMap(profiles) {
        this.#env['COPILOT_BYOK_PROFILES_JSON'] = serializeProfiles(
            Object.fromEntries(Object.entries(profiles).sort(([left], [right]) => left.localeCompare(right))),
        );
    }

    /**
     * @param {string} name
     * @returns {ReturnType<typeof profileDescriptor> | null}
     */
    get(name) {
        const normalized = text(name);
        if (!normalized) return null;
        return this.list().find((profile) => profile.name === normalized) ?? null;
    }

    /**
     * @param {string} name
     * @param {Record<string, unknown>} profile
     * @returns {{ name: string; profile: Record<string, unknown>; descriptor: ReturnType<typeof profileDescriptor> }}
     */
    upsert(name, profile) {
        const normalized = text(name);
        if (!normalized) throw new Error('MODEL_GATEWAY_PROFILE_NAME_REQUIRED');
        const profileRecord = plainObject(profile);
        assertProfileSecretRefsAllowed(normalized, profileRecord);
        const current = this.#readProfileMap();
        current[normalized] = profileRecord;
        this.#writeProfileMap(current);
        return {
            name: normalized,
            profile: profileRecord,
            descriptor: profileDescriptor(normalized, profileRecord),
        };
    }

    /**
     * @param {string} name
     * @returns {boolean}
     */
    remove(name) {
        const normalized = text(name);
        if (!normalized) return false;
        const current = this.#readProfileMap();
        if (!Object.hasOwn(current, normalized)) return false;
        delete current[normalized];
        this.#writeProfileMap(current);
        return true;
    }

    /**
     * @returns {ReturnType<typeof profileDescriptor> | null}
     */
    getActive() {
        const activeName = text(this.#env['COPILOT_BYOK_PROFILE']);
        return activeName ? this.get(activeName) : null;
    }

    /**
     * @returns {{
     *     name: string;
     *     preset: string | null;
     *     providerId: string | null;
     *     providerType: string | null;
     *     baseUrl: string | null;
     *     model: string | null;
     *     ready: boolean;
     *     auth: { apiKeyConfigured: boolean; bearerTokenConfigured: boolean; headersConfigured: boolean };
     *     metadataKeys: string[];
     *     profileFreeTier: boolean | null;
     *     profileCostSource: string | null;
     *     profileCostDetail: string | null;
     *     warnings: string[];
     *     errors: string[];
     * }[]}
     */
    listTerminalSummaries() {
        return this.list().map((descriptor) => {
            const materialized = createModelGatewayEnvProfileStore({
                env: { ...this.#env, COPILOT_BYOK_PROFILE: descriptor.name },
            }).materializeActiveEnv({ preserveGatewayRoute: false });
            const errors = profileSummaryErrors(descriptor, materialized.env);
            return {
                name: descriptor.name,
                preset: descriptor.providerId,
                providerId: descriptor.providerId,
                providerType: text(materialized.env['COPILOT_BYOK_PROVIDER_TYPE']),
                baseUrl: text(materialized.env['COPILOT_BYOK_BASE_URL']),
                model: text(materialized.env['COPILOT_BYOK_MODEL']),
                ready: errors.length === 0,
                auth: materializedAuthSummary(materialized.env),
                metadataKeys: [...descriptor.metadataKeys],
                profileFreeTier: descriptor.costHint.profileFreeTier,
                profileCostSource: descriptor.costHint.profileCostSource,
                profileCostDetail: descriptor.costHint.profileCostDetail,
                warnings: [],
                errors,
            };
        });
    }

    /**
     * Ativa um perfil no env mutável do processo sem retornar segredos.
     *
     * @param {string} name
     * @returns {{
     *     profile: ReturnType<typeof profileDescriptor>;
     *     summary: ReturnType<ModelGatewayEnvProfileStore['listTerminalSummaries']>[number];
     * }}
     */
    activateProfile(name) {
        const normalized = text(name);
        if (!normalized) throw new Error('MODEL_GATEWAY_PROFILE_NAME_REQUIRED');
        const profile = this.get(normalized);
        if (!profile) throw new Error(`MODEL_GATEWAY_PROFILE_NOT_FOUND: profile=${normalized}`);
        this.#env['COPILOT_BYOK_ENABLED'] = 'true';
        this.#env['COPILOT_BYOK_PROFILE'] = normalized;
        delete this.#env['COPILOT_BYOK_MODEL'];
        delete this.#env['COPILOT_BYOK_PROVIDER_PRESET'];
        delete this.#env['COPILOT_BYOK_BASE_URL'];
        delete this.#env['COPILOT_MODEL_GATEWAY_BINDING_SOURCE'];
        delete this.#env['COPILOT_MODEL_GATEWAY_PROVIDER_ID'];
        delete this.#env['COPILOT_MODEL_GATEWAY_PROVIDER_PROFILE'];
        const summary = this.listTerminalSummaries().find((candidate) => candidate.name === normalized);
        if (!summary) throw new Error(`MODEL_GATEWAY_PROFILE_NOT_FOUND: profile=${normalized}`);
        return { profile, summary };
    }

    /**
     * Materializa o perfil ativo em env explícito para a borda SDK.
     *
     * `COPILOT_BYOK_PROFILE` é removido de propósito: depois desta etapa, o parser SDK não deve reabrir e reinterpretar
     * o JSON de perfis. Quando uma rota do gateway já definiu provider/model, o perfil só preenche campos auxiliares
     * ainda ausentes, como headers e refs genéricas.
     *
     * @param {{ preserveGatewayRoute?: boolean }} [options]
     * @returns {{
     *     materialized: boolean;
     *     profile: ReturnType<typeof profileDescriptor> | null;
     *     env: Record<string, string | undefined>;
     * }}
     */
    materializeActiveEnv(options = {}) {
        const activeName = text(this.#env['COPILOT_BYOK_PROFILE']);
        if (!activeName) return { materialized: false, profile: null, env: { ...this.#env } };
        const rawProfiles = this.#readRawProfiles();
        const rawProfile = record(rawProfiles[activeName]);
        if (Object.keys(rawProfile).length === 0) {
            throw new Error(`MODEL_GATEWAY_PROFILE_NOT_FOUND: profile=${activeName}`);
        }
        const descriptor = profileDescriptor(activeName, rawProfile);
        const env = { ...this.#env };
        const preserveGatewayRoute =
            options.preserveGatewayRoute !== false && text(env['COPILOT_MODEL_GATEWAY_PROVIDER_ID']) !== null;
        const selectedProviderId = descriptor.providerId;
        const routeProviderId = text(env['COPILOT_MODEL_GATEWAY_PROVIDER_ID']);
        const effectiveProviderId = preserveGatewayRoute ? routeProviderId : selectedProviderId;
        const profileMatchesRoute =
            !preserveGatewayRoute || !selectedProviderId || selectedProviderId === effectiveProviderId;
        delete env['COPILOT_BYOK_PROFILE'];
        env['COPILOT_BYOK_ENABLED'] = 'true';
        env['COPILOT_MODEL_GATEWAY_PROVIDER_PROFILE'] = activeName;
        env['COPILOT_MODEL_GATEWAY_BINDING_SOURCE'] = preserveGatewayRoute ? 'gateway_route' : 'gateway_profile';
        setMaterializedEnvValue(env, 'COPILOT_MODEL_GATEWAY_PROVIDER_ID', effectiveProviderId, {
            preserveExisting: preserveGatewayRoute,
        });
        setMaterializedEnvValue(env, 'COPILOT_BYOK_PROVIDER_PRESET', 'custom', {
            preserveExisting: preserveGatewayRoute,
        });
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_PROVIDER_TYPE',
            profileMatchesRoute
                ? (descriptor.providerType ?? providerTypeForProviderId(effectiveProviderId))
                : providerTypeForProviderId(effectiveProviderId),
            { preserveExisting: preserveGatewayRoute },
        );
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_BASE_URL',
            profileMatchesRoute
                ? (descriptor.baseUrl ?? defaultBaseUrl(effectiveProviderId, env))
                : defaultBaseUrl(effectiveProviderId, env),
            { preserveExisting: preserveGatewayRoute },
        );
        setMaterializedEnvValue(env, 'COPILOT_BYOK_MODEL', profileMatchesRoute ? descriptor.model : null, {
            preserveExisting: preserveGatewayRoute,
        });
        setMaterializedEnvValue(env, 'COPILOT_BYOK_WIRE_API', profileMatchesRoute ? descriptor.wireApi : null, {
            preserveExisting: preserveGatewayRoute,
        });
        setMaterializedEnvValue(env, 'COPILOT_BYOK_MODELS', firstText(rawProfile, ['models', 'COPILOT_BYOK_MODELS']));
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_MODELS_ENDPOINT',
            firstText(rawProfile, [
                'modelsEndpoint',
                'modelEndpoint',
                'modelsUrl',
                'modelsURL',
                'COPILOT_BYOK_MODELS_ENDPOINT',
            ]),
        );
        const modelsJson =
            rawProfile['modelsJson'] ?? rawProfile['modelsJSON'] ?? rawProfile['COPILOT_BYOK_MODELS_JSON'];
        if (Array.isArray(modelsJson) || (modelsJson && typeof modelsJson === 'object')) {
            env['COPILOT_BYOK_MODELS_JSON'] = JSON.stringify(modelsJson);
        } else {
            setMaterializedEnvValue(env, 'COPILOT_BYOK_MODELS_JSON', text(modelsJson));
        }
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_MODEL_DISCOVERY_ENABLED',
            booleanText(
                rawProfile['modelDiscoveryEnabled'] ??
                    rawProfile['discoverModels'] ??
                    rawProfile['COPILOT_BYOK_MODEL_DISCOVERY_ENABLED'],
            ),
        );
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_MODEL_DISCOVERY_TIMEOUT_MS',
            numberText(rawProfile['modelDiscoveryTimeoutMs'] ?? rawProfile['COPILOT_BYOK_MODEL_DISCOVERY_TIMEOUT_MS']),
        );
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_MODEL_DISCOVERY_TTL_MS',
            numberText(rawProfile['modelDiscoveryTtlMs'] ?? rawProfile['COPILOT_BYOK_MODEL_DISCOVERY_TTL_MS']),
        );
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_CONTEXT_WINDOW_TOKENS',
            numberText(
                rawProfile['contextWindowTokens'] ??
                    rawProfile['contextWindow'] ??
                    rawProfile['COPILOT_BYOK_CONTEXT_WINDOW_TOKENS'],
            ),
        );
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_MAX_REQUEST_TOKENS',
            numberText(
                rawProfile['maxRequestTokens'] ??
                    rawProfile['maxInputTokens'] ??
                    rawProfile['COPILOT_BYOK_MAX_REQUEST_TOKENS'],
            ),
        );
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_TOKENS_PER_MINUTE',
            numberText(
                rawProfile['tokensPerMinute'] ?? rawProfile['tpm'] ?? rawProfile['COPILOT_BYOK_TOKENS_PER_MINUTE'],
            ),
        );
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_REQUESTS_PER_MINUTE',
            numberText(
                rawProfile['requestsPerMinute'] ?? rawProfile['rpm'] ?? rawProfile['COPILOT_BYOK_REQUESTS_PER_MINUTE'],
            ),
        );
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_DAILY_REQUESTS',
            numberText(
                rawProfile['dailyRequests'] ??
                    rawProfile['requestsPerDay'] ??
                    rawProfile['rpd'] ??
                    rawProfile['COPILOT_BYOK_DAILY_REQUESTS'],
            ),
        );
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_SUPPORTS_REASONING',
            booleanText(
                rawProfile['supportsReasoning'] ??
                    rawProfile['reasoning'] ??
                    rawProfile['COPILOT_BYOK_SUPPORTS_REASONING'],
            ),
        );
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_SUPPORTS_VISION',
            booleanText(
                rawProfile['supportsVision'] ?? rawProfile['vision'] ?? rawProfile['COPILOT_BYOK_SUPPORTS_VISION'],
            ),
        );
        const secretRefs = profileSecretRefs(rawProfile);
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_API_KEY',
            envSecret(this.#env, secretRefs.apiKeyRef) ??
                text(rawProfile['apiKey'] ?? rawProfile['key'] ?? rawProfile['COPILOT_BYOK_API_KEY']),
            { preserveExisting: true },
        );
        setMaterializedEnvValue(
            env,
            'COPILOT_BYOK_BEARER_TOKEN',
            envSecret(this.#env, secretRefs.bearerTokenRef) ??
                text(rawProfile['bearerToken'] ?? rawProfile['token'] ?? rawProfile['COPILOT_BYOK_BEARER_TOKEN']),
            { preserveExisting: true },
        );
        const headers = record(rawProfile['headers']);
        const headersJson =
            Object.keys(headers).length > 0
                ? JSON.stringify(headers)
                : text(
                      rawProfile['headersJson'] ?? rawProfile['headersJSON'] ?? rawProfile['COPILOT_BYOK_HEADERS_JSON'],
                  );
        setMaterializedEnvValue(env, 'COPILOT_BYOK_HEADERS_JSON', headersJson, { preserveExisting: true });
        return { materialized: true, profile: descriptor, env };
    }

    /**
     * @returns {Record<string, unknown>}
     */
    #readRawProfiles() {
        const raw = this.#env['COPILOT_BYOK_PROFILES_JSON'];
        if (!raw || !raw.trim()) return {};
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`MODEL_GATEWAY_PROFILE_STORE_INVALID_JSON: ${message}`, { cause: error });
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('MODEL_GATEWAY_PROFILE_STORE_INVALID_ROOT: expected object keyed by profile name');
        }
        return /** @type {Record<string, unknown>} */ (parsed);
    }
}

/**
 * @param {{ env?: Record<string, string | undefined> }} [options]
 */
export function createModelGatewayEnvProfileStore(options = {}) {
    return new ModelGatewayEnvProfileStore(options);
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function materializeModelGatewayActiveByokProfileEnv(env = process.env) {
    return createModelGatewayEnvProfileStore({ env }).materializeActiveEnv();
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function readModelGatewayByokProfileSummaries(env = process.env) {
    return createModelGatewayEnvProfileStore({ env }).listTerminalSummaries();
}

/**
 * @param {string} name
 * @param {Record<string, string | undefined>} [env]
 */
export function activateModelGatewayByokProfileEnv(name, env = process.env) {
    return createModelGatewayEnvProfileStore({ env }).activateProfile(name);
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} profile
 * @param {Record<string, string | undefined>} [env]
 */
export function upsertModelGatewayByokProfileEnv(name, profile, env = process.env) {
    return createModelGatewayEnvProfileStore({ env }).upsert(name, profile);
}

/**
 * @param {string} name
 * @param {Record<string, string | undefined>} [env]
 */
export function removeModelGatewayByokProfileEnv(name, env = process.env) {
    return createModelGatewayEnvProfileStore({ env }).remove(name);
}

/**
 * @param {string | null | undefined} profileName
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ profileFreeTier: boolean | null; profileCostSource: string | null; profileCostDetail: string | null }}
 */
export function readModelGatewayByokProfileCostHint(profileName, env = process.env) {
    const normalized = text(profileName);
    if (!normalized) return { profileFreeTier: null, profileCostSource: null, profileCostDetail: null };
    const profile = createModelGatewayEnvProfileStore({ env }).get(normalized);
    return profile?.costHint ?? { profileFreeTier: null, profileCostSource: null, profileCostDetail: null };
}
