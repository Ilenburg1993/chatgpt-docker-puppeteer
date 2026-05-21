// @ts-check
/**
 * src/copilot/terminal/commands/byok.js
 *
 * Diagnostico seguro da configuracao BYOK do SDK Copilot. Este comando nunca imprime segredos; ele mostra apenas
 * presenca de credenciais, provider/modelo efetivos e erros acionaveis.
 *
 * @module copilot/terminal/commands/byok
 */

import fs from 'node:fs/promises';

import { config as loadDotenv } from 'dotenv';

import { discoverConfiguredByokModelsFromEnv } from '#copilot/config';
import { readTerminalByokProjection, readTerminalRuntimeState } from '../frontend/index.js';

const DEFAULT_BYOK_MODELS_DISPLAY_LIMIT = 24;
const DEFAULT_BYOK_RECOMMEND_DISPLAY_LIMIT = 8;
const BYOK_LOW_REQUEST_TOKEN_LIMIT = 8_000;
const BYOK_COMFORTABLE_REQUEST_TOKEN_LIMIT = 32_000;
const BYOK_RECOMMEND_RESPONSE_RESERVE_TOKENS = 1_024;
const BYOK_RUNTIME_SELECTOR_ENV_KEYS = Object.freeze([
    'COPILOT_BYOK_PROFILE',
    'COPILOT_BYOK_PROVIDER_PRESET',
    'COPILOT_BYOK_PROVIDER_TYPE',
    'COPILOT_BYOK_BASE_URL',
    'COPILOT_BYOK_WIRE_API',
    'COPILOT_BYOK_AZURE_API_VERSION',
    'COPILOT_BYOK_HEADERS_JSON',
    'COPILOT_BYOK_MODEL',
    'COPILOT_BYOK_MODELS',
    'COPILOT_BYOK_MODELS_JSON',
    'COPILOT_BYOK_MODELS_ENDPOINT',
    'COPILOT_BYOK_CONTEXT_WINDOW_TOKENS',
    'COPILOT_BYOK_MAX_REQUEST_TOKENS',
    'COPILOT_BYOK_TOKENS_PER_MINUTE',
    'COPILOT_BYOK_REQUESTS_PER_MINUTE',
    'COPILOT_BYOK_DAILY_REQUESTS',
    'COPILOT_BYOK_SUPPORTS_REASONING',
    'COPILOT_BYOK_SUPPORTS_VISION',
]);

/**
 * @typedef {object} ByokCommandContext
 * @property {(text: string) => void} println
 */

/**
 * @param {boolean} value
 * @returns {string}
 */
function yesNo(value) {
    return value ? '\x1b[32msim\x1b[0m' : '\x1b[90mnao\x1b[0m';
}

/**
 * @param {string | null} value
 * @returns {string}
 */
function valueOrDash(value) {
    return value && value.length > 0 ? value : '-';
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @returns {{
 *   freeTier?: boolean | null;
 *   pricing?: { prompt?: number | null; completion?: number | null; request?: number | null };
 *   rateLimits?: { maxRequestTokens?: number | null; tokensPerMinute?: number | null; requestsPerMinute?: number | null; dailyRequests?: number | null };
 *   provider?: string | null;
 *   profile?: string | null;
 *   source?: string;
 *   inputModalities?: string[];
 *   outputModalities?: string[];
 *   supportsReasoning?: boolean;
 * } | undefined}
 */
function getByokModelMetadata(model) {
    return /** @type {{ byok?: { freeTier?: boolean | null; pricing?: { prompt?: number | null; completion?: number | null; request?: number | null }; rateLimits?: { maxRequestTokens?: number | null; tokensPerMinute?: number | null; requestsPerMinute?: number | null; dailyRequests?: number | null }; provider?: string | null; profile?: string | null; source?: string; inputModalities?: string[]; outputModalities?: string[]; supportsReasoning?: boolean } }} */ (model).byok;
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @returns {boolean}
 */
function supportsByokReasoning(model) {
    const meta = getByokModelMetadata(model);
    return meta?.supportsReasoning ?? Boolean(model.capabilities?.supports?.reasoningEffort);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function compactNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '?';
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finitePositiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * @param {ReturnType<typeof readTerminalRuntimeState> | null} runtimeState
 * @returns {{ estimatedRequestTokens: number; contextTokens: number; tokenLimit: number | null; utilization: number | null } | null}
 */
function estimateCurrentByokRequestBudget(runtimeState) {
    const contextState = runtimeState?.contextWindow ?? null;
    if (!contextState) return null;
    const tokenLimit = finitePositiveNumber(/** @type {{ tokenLimit?: unknown }} */ (contextState).tokenLimit);
    const directTokens = finitePositiveNumber(/** @type {{ tokens?: unknown }} */ (contextState).tokens);
    const utilization = finitePositiveNumber(/** @type {{ utilization?: unknown }} */ (contextState).utilization);
    const contextTokens =
        directTokens ?? (tokenLimit !== null && utilization !== null ? Math.ceil(tokenLimit * utilization) : null);
    if (contextTokens === null) return null;
    return {
        estimatedRequestTokens: Math.max(0, contextTokens + BYOK_RECOMMEND_RESPONSE_RESERVE_TOKENS),
        contextTokens,
        tokenLimit,
        utilization,
    };
}

/**
 * @returns {ReturnType<typeof estimateCurrentByokRequestBudget>}
 */
function readCurrentByokRequestBudget() {
    try {
        return estimateCurrentByokRequestBudget(readTerminalRuntimeState());
    } catch {
        return null;
    }
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @returns {number}
 */
function scoreByokModel(model) {
    const meta = getByokModelMetadata(model);
    const ctxTokens = model.capabilities?.limits?.max_context_window_tokens ?? 0;
    let score = 0;
    if (meta?.freeTier === true) score += 1_000_000_000;
    if (supportsByokReasoning(model)) score += 100_000_000;
    if (model.capabilities?.supports?.vision) score += 10_000_000;
    score += Math.min(Number(ctxTokens) || 0, 2_000_000);
    if (meta?.freeTier === false) score -= 10_000;
    return score;
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo[]} models
 * @returns {import('#copilot/sdk/types').ModelInfo[]}
 */
function rankByokModels(models) {
    return models
        .map((model, index) => ({ model, index }))
        .sort((a, b) => scoreByokModel(b.model) - scoreByokModel(a.model) || a.index - b.index)
        .map((item) => item.model);
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @param {ReturnType<typeof estimateCurrentByokRequestBudget>} [runtimeBudget]
 * @returns {{ level: 'ok' | 'caution' | 'blocked'; label: string }}
 */
function classifyByokModelBudget(model, runtimeBudget = null) {
    const meta = getByokModelMetadata(model);
    const limit = meta?.rateLimits?.maxRequestTokens ?? meta?.rateLimits?.tokensPerMinute ?? null;
    if (limit !== null && runtimeBudget !== null && runtimeBudget.estimatedRequestTokens > limit) {
        return {
            level: 'blocked',
            label: `bloqueado para contexto atual (${runtimeBudget.estimatedRequestTokens}/${limit} tokens); use /compact, sessão fresca ou provider maior`,
        };
    }
    if (limit !== null && limit < BYOK_LOW_REQUEST_TOKEN_LIMIT) {
        return {
            level: 'blocked',
            label: `baixo para turno real (${limit} tokens); use sessão fresca, prompt mínimo ou outro provider`,
        };
    }
    if (limit !== null && limit < BYOK_COMFORTABLE_REQUEST_TOKEN_LIMIT) {
        return {
            level: 'caution',
            label: `apertado para sessão longa (${limit} tokens); recomendado para probes ou contexto compacto`,
        };
    }
    const context = model.capabilities?.limits?.max_context_window_tokens ?? null;
    if (typeof context === 'number' && context > 0 && context < BYOK_COMFORTABLE_REQUEST_TOKEN_LIMIT) {
        return {
            level: 'caution',
            label: `contexto pequeno (${context}); evitar turnos com histórico grande`,
        };
    }
    return { level: 'ok', label: 'ok para uso geral, sujeito ao plano real do provider' };
}

/**
 * @param {string[]} rest
 * @returns {{ limit: number; freeOnly: boolean; meteredOnly: boolean; unknownCostOnly: boolean; provider: string | null; vision: boolean; reasoning: boolean; minContext: number | null; minRequest: number | null; avoidLowLimit: boolean; forceRefresh: boolean; allProviders: boolean; grouped: boolean }}
 */
function parseRecommendArgs(rest) {
    const state = {
        limit: DEFAULT_BYOK_RECOMMEND_DISPLAY_LIMIT,
        freeOnly: false,
        meteredOnly: false,
        unknownCostOnly: false,
        provider: /** @type {string | null} */ (null),
        vision: false,
        reasoning: false,
        minContext: /** @type {number | null} */ (null),
        minRequest: /** @type {number | null} */ (null),
        avoidLowLimit: false,
        forceRefresh: false,
        allProviders: false,
        grouped: false,
    };
    for (const rawItem of rest) {
        const item = rawItem.toLowerCase();
        const numeric = Number.parseInt(item, 10);
        if (Number.isFinite(numeric) && numeric > 0) {
            state.limit = numeric;
        } else if (['refresh', 'force', '--refresh', '--force'].includes(item)) {
            state.forceRefresh = true;
        } else if (['all-providers', 'providers', '--all-providers'].includes(item)) {
            state.allProviders = true;
        } else if (['group', 'grouped', '--group', '--grouped'].includes(item)) {
            state.grouped = true;
        } else if (['free', '--free'].includes(item)) {
            state.freeOnly = true;
        } else if (['paid', 'metered', '--paid', '--metered'].includes(item)) {
            state.meteredOnly = true;
        } else if (['cost?', 'unknown-cost', '--cost?', '--unknown-cost'].includes(item)) {
            state.unknownCostOnly = true;
        } else if (['vision', '--vision'].includes(item)) {
            state.vision = true;
        } else if (['reasoning', '--reasoning'].includes(item)) {
            state.reasoning = true;
        } else if (['safe', 'no-low-limit', '--safe', '--no-low-limit'].includes(item)) {
            state.avoidLowLimit = true;
        } else if (item.startsWith('provider:')) {
            state.provider = item.slice(9) || null;
        } else if (item.startsWith('provider=')) {
            state.provider = item.slice(9) || null;
        } else if (item.startsWith('ctx>=')) {
            state.minContext = Number.parseInt(item.slice(5), 10) || null;
        } else if (item.startsWith('ctx>')) {
            state.minContext = Number.parseInt(item.slice(4), 10) || null;
        } else if (item.startsWith('maxreq>=')) {
            state.minRequest = Number.parseInt(item.slice(8), 10) || null;
        } else if (item.startsWith('maxreq>')) {
            state.minRequest = Number.parseInt(item.slice(7), 10) || null;
        }
    }
    return state;
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @param {ReturnType<typeof parseRecommendArgs>} filters
 * @param {ReturnType<typeof estimateCurrentByokRequestBudget>} [runtimeBudget]
 * @returns {boolean}
 */
function matchesRecommendFilters(model, filters, runtimeBudget = null) {
    const meta = getByokModelMetadata(model);
    const context = model.capabilities?.limits?.max_context_window_tokens ?? 0;
    const maxRequest = meta?.rateLimits?.maxRequestTokens ?? meta?.rateLimits?.tokensPerMinute ?? null;
    if (filters.freeOnly && meta?.freeTier !== true) return false;
    if (filters.meteredOnly && meta?.freeTier !== false) return false;
    if (filters.unknownCostOnly && meta?.freeTier !== null) return false;
    if (filters.provider) {
        const haystack = [meta?.provider, meta?.profile, meta?.source, model.id].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(filters.provider)) return false;
    }
    if (filters.vision && !model.capabilities?.supports?.vision) return false;
    if (filters.reasoning && !supportsByokReasoning(model)) return false;
    if (filters.minContext !== null && context < filters.minContext) return false;
    if (filters.minRequest !== null && (maxRequest === null || maxRequest < filters.minRequest)) return false;
    if (filters.avoidLowLimit && classifyByokModelBudget(model, runtimeBudget).level === 'blocked') return false;
    return true;
}

/**
 * @param {ReturnType<typeof parseRecommendArgs>} filters
 * @returns {string}
 */
function renderByokFilterLabel(filters) {
    return [
        filters.allProviders ? 'all-providers' : null,
        filters.grouped ? 'grouped' : null,
        filters.provider ? `provider:${filters.provider}` : null,
        filters.freeOnly ? 'free' : null,
        filters.meteredOnly ? 'metered' : null,
        filters.unknownCostOnly ? 'cost?' : null,
        filters.reasoning ? 'reasoning' : null,
        filters.vision ? 'vision' : null,
        filters.avoidLowLimit ? 'safe' : null,
        filters.minContext !== null ? `ctx>${filters.minContext}` : null,
        filters.minRequest !== null ? `maxReq>${filters.minRequest}` : null,
    ]
        .filter(Boolean)
        .join(',');
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @returns {string}
 */
function renderByokVariantLabel(model) {
    const meta = getByokModelMetadata(model);
    const profile = meta?.profile ?? null;
    const provider = meta?.provider ?? null;
    if (profile && provider) return `${profile}/${provider}`;
    return profile ?? provider ?? 'provider?';
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo[]} models
 * @returns {{ model: import('#copilot/sdk/types').ModelInfo; variants: string[] }[]}
 */
function groupByokModelVariants(models) {
    const groups = new Map();
    for (const model of models) {
        const id = String(model.id);
        const existing = groups.get(id);
        const variant = renderByokVariantLabel(model);
        if (existing) {
            if (!existing.variants.includes(variant)) existing.variants.push(variant);
            continue;
        }
        groups.set(id, { model, variants: [variant] });
    }
    return [...groups.values()];
}

/**
 * @param {string[]} variants
 * @returns {string}
 */
function renderByokVariantSummary(variants) {
    const visible = variants.slice(0, 4);
    const overflow = variants.length > visible.length ? `,+${variants.length - visible.length}` : '';
    return `${visible.join('|')}${overflow}`;
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @param {{ profileName?: string | null; preset?: string | null; providerType?: string | null }} source
 * @returns {import('#copilot/sdk/types').ModelInfo}
 */
function withByokCatalogSource(model, source) {
    const meta = getByokModelMetadata(model) ?? {};
    return /** @type {import('#copilot/sdk/types').ModelInfo} */ ({
        ...model,
        byok: {
            ...meta,
            provider: meta.provider ?? source.preset ?? source.providerType ?? source.profileName ?? null,
            profile: source.profileName ?? null,
            source: meta.source ?? source.preset ?? source.providerType ?? source.profileName ?? undefined,
        },
    });
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @param {ReturnType<typeof parseRecommendArgs>} filters
 * @returns {Array<ReturnType<typeof readTerminalByokProjection>['profiles'][number]>}
 */
function selectProfilesForDiscovery(projection, filters) {
    const providerNeedle = filters.provider?.toLowerCase() ?? null;
    if (!providerNeedle) return projection.profiles;
    return projection.profiles.filter((profile) =>
        [profile.name, profile.preset, profile.providerType, profile.model]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(providerNeedle),
    );
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @param {ReturnType<typeof parseRecommendArgs>} filters
 * @returns {Promise<{ models: import('#copilot/sdk/types').ModelInfo[]; sourceLabel: string; endpoint: string | null; errors: string[]; profileCount: number }>}
 */
async function discoverByokCatalogForCommand(projection, filters) {
    if (!filters.allProviders) {
        const discovered = await discoverConfiguredByokModelsFromEnv(process.env, { forceRefresh: filters.forceRefresh });
        const sourceLabel =
            discovered.source === 'remote'
                ? 'provider'
                : discovered.source === 'remote-cache'
                  ? 'provider-cache'
                  : discovered.source === 'static-fallback'
                    ? 'static-fallback'
                    : 'static';
        return {
            models: (discovered.models.length > 0 ? discovered.models : projection.models).map((model) =>
                withByokCatalogSource(model, {
                    profileName: projection.summary.profile,
                    preset: projection.summary.preset,
                    providerType: projection.summary.providerType,
                }),
            ),
            sourceLabel,
            endpoint: discovered.endpoint,
            errors: discovered.error ? [discovered.error] : [],
            profileCount: projection.summary.profile ? 1 : 0,
        };
    }

    const profiles = selectProfilesForDiscovery(projection, filters);
    const models = [];
    const errors = [];
    const sourceCounts = new Map();
    /** @type {string | null} */
    let endpoint = null;
    for (const profile of profiles) {
        const env = {
            ...process.env,
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROFILE: profile.name,
        };
        const discovered = await discoverConfiguredByokModelsFromEnv(env, { forceRefresh: filters.forceRefresh });
        sourceCounts.set(discovered.source, (sourceCounts.get(discovered.source) ?? 0) + 1);
        if (!endpoint && discovered.endpoint) endpoint = discovered.endpoint;
        if (discovered.error) errors.push(`${profile.name}: ${discovered.error}`);
        const profileModels = discovered.models.length > 0 ? discovered.models : [];
        for (const model of profileModels) {
            models.push(
                withByokCatalogSource(model, {
                    profileName: profile.name,
                    preset: profile.preset,
                    providerType: profile.providerType,
                }),
            );
        }
    }
    const sourceLabel =
        [...sourceCounts.entries()]
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
            .map(([source, count]) => `${source}=${count}`)
            .join(' · ') || 'profiles-empty';
    return {
        models,
        sourceLabel,
        endpoint,
        errors,
        profileCount: profiles.length,
    };
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @returns {string}
 */
function renderModelTags(model) {
    const meta = getByokModelMetadata(model);
    const tags = [];
    tags.push(meta?.freeTier === true ? 'free' : meta?.freeTier === false ? 'metered' : 'cost?');
    tags.push(supportsByokReasoning(model) ? 'reasoning' : 'no-reasoning');
    if (supportsByokReasoning(model) && !model.capabilities?.supports?.reasoningEffort) {
        tags.push('sdk-reasoning=off');
    }
    tags.push(model.capabilities?.supports?.vision ? 'vision' : 'no-vision');
    tags.push(`ctx=${model.capabilities?.limits?.max_context_window_tokens ?? 'n/a'}`);
    if (meta?.pricing && (meta.pricing.prompt !== null || meta.pricing.completion !== null || meta.pricing.request !== null)) {
        tags.push(`price=${compactNumber(meta.pricing.prompt)}/${compactNumber(meta.pricing.completion)}`);
    }
    if (meta?.rateLimits?.maxRequestTokens) tags.push(`maxReq=${meta.rateLimits.maxRequestTokens}`);
    if (meta?.rateLimits?.tokensPerMinute) tags.push(`TPM=${meta.rateLimits.tokensPerMinute}`);
    if (meta?.rateLimits?.requestsPerMinute) tags.push(`RPM=${meta.rateLimits.requestsPerMinute}`);
    if (meta?.rateLimits?.dailyRequests) tags.push(`RPD=${meta.rateLimits.dailyRequests}`);
    if (meta?.provider) tags.push(`provider=${meta.provider}`);
    if (meta?.profile) tags.push(`profile=${meta.profile}`);
    const inputs = meta?.inputModalities?.length ? meta.inputModalities.join('+') : '';
    if (inputs && inputs !== 'text') tags.push(`in=${inputs}`);
    return tags.join(' · ');
}

/**
 * @param {{ auth: { bearerTokenConfigured: boolean; apiKeyConfigured: boolean; headersConfigured: boolean } }} profile
 * @returns {string}
 */
function renderProfileAuth(profile) {
    return profile.auth.bearerTokenConfigured
        ? 'bearer'
        : profile.auth.apiKeyConfigured
          ? 'apiKey'
          : profile.auth.headersConfigured
            ? 'headers'
            : 'none';
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderStatus(projection, println) {
    const { summary } = projection;
    println('\n  \x1b[36mBYOK status\x1b[0m');
    println(`    enabled:       ${yesNo(summary.enabled)}`);
    println(`    ready:         ${yesNo(summary.ready)}`);
    println(`    profile:       \x1b[33m${valueOrDash(summary.profile)}\x1b[0m`);
    println(`    preset:        \x1b[33m${valueOrDash(summary.preset)}\x1b[0m`);
    println(`    provider:      \x1b[33m${valueOrDash(summary.providerType)}\x1b[0m`);
    println(`    baseUrl:       \x1b[33m${valueOrDash(summary.baseUrl)}\x1b[0m`);
    println(`    model:         \x1b[33m${valueOrDash(summary.model)}\x1b[0m`);
    println(`    wireApi:       \x1b[33m${valueOrDash(summary.wireApi)}\x1b[0m`);
    println(`    azureVersion:  \x1b[33m${valueOrDash(summary.azureApiVersion)}\x1b[0m`);
    println(
        `    auth:          apiKey=${yesNo(summary.auth.apiKeyConfigured)} · bearer=${yesNo(summary.auth.bearerTokenConfigured)} · headers=${yesNo(summary.auth.headersConfigured)}`,
    );
    println(
        `    capabilities:  reasoning=${yesNo(summary.capabilities.reasoningEffort)} · sdkReasoning=${yesNo(summary.capabilities.sdkReasoningEffort ?? summary.capabilities.reasoningEffort)} · vision=${yesNo(summary.capabilities.vision)} · ctx=${summary.capabilities.contextWindowTokens}`,
    );
    const limitParts = [
        summary.limits?.maxRequestTokens ? `maxReq=${summary.limits.maxRequestTokens}` : null,
        summary.limits?.tokensPerMinute ? `TPM=${summary.limits.tokensPerMinute}` : null,
        summary.limits?.requestsPerMinute ? `RPM=${summary.limits.requestsPerMinute}` : null,
        summary.limits?.dailyRequests ? `RPD=${summary.limits.dailyRequests}` : null,
    ].filter(Boolean);
    if (limitParts.length > 0) {
        println(`    limits:        \x1b[33m${limitParts.join(' · ')}\x1b[0m`);
    }
    println(`    modelList:     ${summary.modelList.count} modelo(s)`);
    for (const warning of summary.warnings) {
        println(`  \x1b[33m  aviso: ${warning}\x1b[0m`);
    }
    for (const error of summary.errors) {
        println(`  \x1b[31m  erro: ${error}\x1b[0m`);
    }
    println('  \x1b[90mArquivo unico de BYOK: .env.local. Mudancas via comando valem para o processo atual; use /restart para nova sessao SDK.\x1b[0m');
    println('  \x1b[90mUso: /byok | /byok reload | /byok providers | /byok profiles | /byok models [all-providers|grouped|refresh|all|n] [free|metered|cost?] [provider:<nome>] [reasoning] [vision] [safe] [ctx>N] [maxReq>N] | /byok recommend [all-providers] [grouped] [filtros] [n] | /byok use <perfil|sdk> | /byok model <id> | /byok provider <preset> [model] [baseUrl] | /byok persist <sdk|profile|model|provider> | /byok env\x1b[0m\n');
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeArg(value) {
    return value.trim();
}

/**
 * Remove apenas seletores efêmeros de runtime. Segredos e perfis permanecem no ambiente e/ou .env.local.
 *
 * @param {Iterable<string>} [except]
 * @returns {void}
 */
function clearRuntimeSelectors(except = []) {
    const keep = new Set(except);
    for (const key of BYOK_RUNTIME_SELECTOR_ENV_KEYS) {
        if (!keep.has(key)) delete process.env[key];
    }
}

/**
 * @param {string} value
 * @returns {string}
 */
function assertSafeEnvValue(value) {
    const normalized = normalizeArg(value);
    if (!normalized) throw new Error('valor vazio');
    if (/[\r\n]/u.test(normalized) || normalized.includes('\0')) throw new Error('valor contém quebra de linha ou NUL');
    return normalized;
}

/**
 * @param {string} text
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
function setEnvLine(text, key, value) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
    if (re.test(text)) return text.replace(re, line);
    return `${text.replace(/\s*$/u, '')}\n${line}\n`;
}

/**
 * @param {string} text
 * @param {string} key
 * @returns {string}
 */
function deleteEnvLine(text, key) {
    const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*(?:\r?\n|$)`, 'm');
    return text.replace(re, '');
}

/**
 * @param {(text: string) => string} mutate
 * @returns {Promise<void>}
 */
async function mutateEnvLocal(mutate) {
    const path = '.env.local';
    let text = '';
    try {
        text = await fs.readFile(path, 'utf8');
    } catch (error) {
        if (/** @type {{ code?: string }} */ (error).code !== 'ENOENT') throw error;
    }
    const next = mutate(text);
    const normalized = next.endsWith('\n') ? next : `${next}\n`;
    const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temp, normalized, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, path);
    await Promise.resolve(fs.chmod(path, 0o600)).catch(() => undefined);
}

/**
 * @param {string[]} rest
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @returns {Promise<string>}
 */
async function persistByokSelection(rest, projection) {
    const [kindRaw = '', ...values] = rest;
    const kind = kindRaw.toLowerCase();
    if (!kind || kind === 'help') {
        return 'Uso: /byok persist <sdk|profile <nome>|model <id>|provider <preset> [model] [baseUrl]>';
    }
    if (kind === 'sdk' || kind === 'off' || kind === 'copilot') {
        await mutateEnvLocal((text) => {
            let next = setEnvLine(text, 'COPILOT_BYOK_ENABLED', 'false');
            next = deleteEnvLine(next, 'COPILOT_BYOK_PROFILE');
            next = deleteEnvLine(next, 'COPILOT_BYOK_MODEL');
            next = deleteEnvLine(next, 'COPILOT_BYOK_PROVIDER_PRESET');
            next = deleteEnvLine(next, 'COPILOT_BYOK_BASE_URL');
            return next;
        });
        process.env['COPILOT_BYOK_ENABLED'] = 'false';
        clearRuntimeSelectors();
        return 'BYOK persistido como desativado; SDK Copilot governará o próximo boot.';
    }

    if (kind === 'profile' || kind === 'use') {
        const profileName = assertSafeEnvValue(values.join(' '));
        if (!projection.profiles.some((profile) => profile.name === profileName)) {
            return `Perfil BYOK não encontrado: ${profileName}. Veja /byok profiles.`;
        }
        await mutateEnvLocal((text) => {
            let next = setEnvLine(text, 'COPILOT_BYOK_ENABLED', 'true');
            next = setEnvLine(next, 'COPILOT_BYOK_PROFILE', profileName);
            next = deleteEnvLine(next, 'COPILOT_BYOK_MODEL');
            next = deleteEnvLine(next, 'COPILOT_BYOK_PROVIDER_PRESET');
            next = deleteEnvLine(next, 'COPILOT_BYOK_BASE_URL');
            return next;
        });
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        clearRuntimeSelectors();
        process.env['COPILOT_BYOK_PROFILE'] = profileName;
        return `Perfil BYOK persistido: ${profileName}.`;
    }

    if (kind === 'model') {
        const model = assertSafeEnvValue(values.join(' '));
        await mutateEnvLocal((text) => {
            let next = setEnvLine(text, 'COPILOT_BYOK_ENABLED', 'true');
            next = setEnvLine(next, 'COPILOT_BYOK_MODEL', model);
            return next;
        });
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        clearRuntimeSelectors(['COPILOT_BYOK_PROFILE']);
        process.env['COPILOT_BYOK_MODEL'] = model;
        return `Modelo BYOK persistido: ${model}.`;
    }

    if (kind === 'provider') {
        const [presetRaw, modelRaw, baseUrlRaw] = values;
        const preset = assertSafeEnvValue(presetRaw ?? '');
        const model = modelRaw ? assertSafeEnvValue(modelRaw) : null;
        const baseUrl = baseUrlRaw ? assertSafeEnvValue(baseUrlRaw) : null;
        await mutateEnvLocal((text) => {
            let next = setEnvLine(text, 'COPILOT_BYOK_ENABLED', 'true');
            next = deleteEnvLine(next, 'COPILOT_BYOK_PROFILE');
            next = setEnvLine(next, 'COPILOT_BYOK_PROVIDER_PRESET', preset);
            next = model ? setEnvLine(next, 'COPILOT_BYOK_MODEL', model) : deleteEnvLine(next, 'COPILOT_BYOK_MODEL');
            next = baseUrl ? setEnvLine(next, 'COPILOT_BYOK_BASE_URL', baseUrl) : deleteEnvLine(next, 'COPILOT_BYOK_BASE_URL');
            return next;
        });
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        clearRuntimeSelectors();
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = preset;
        if (model) process.env['COPILOT_BYOK_MODEL'] = model;
        if (baseUrl) process.env['COPILOT_BYOK_BASE_URL'] = baseUrl;
        return `Provider BYOK persistido: ${preset}${model ? ` · model=${model}` : ''}.`;
    }

    return `Subcomando persist desconhecido: ${kind}. Use /byok persist help.`;
}

/**
 * @param {ByokCommandContext} ctx
 * @param {string | undefined} arg
 * @returns {Promise<void>}
 */
export async function cmdByok({ println }, arg) {
    const raw = (arg ?? '').trim();
    const [rawSub = 'status', ...rest] = raw.split(/\s+/u);
    const sub = rawSub.toLowerCase();
    const projection = readTerminalByokProjection();
    const { envKeys, models, profiles, summary } = projection;

    if (sub === 'env') {
        println('\n  \x1b[36mBYOK env canonico\x1b[0m');
        println('  \x1b[90mArquivo unico para o operador: .env.local (gitignored). Coloque perfis, modelos, metadata e segredos apenas ali.\x1b[0m\n');
        for (const key of envKeys) {
            println(`    \x1b[33m${key}\x1b[0m`);
        }
        println('\n  \x1b[90mPerfis vivem em COPILOT_BYOK_PROFILES_JSON; o ativo em COPILOT_BYOK_PROFILE. Exemplos seguros ficam em .env.local.example.\x1b[0m');
        println('  \x1b[90mUso: /byok | /byok providers | /byok profiles | /byok models | /byok env\x1b[0m\n');
        return;
    }

    if (sub === 'persist') {
        try {
            const message = await persistByokSelection(rest, projection);
            println(`  \x1b[32m${message}\x1b[0m`);
            println('  \x1b[90mGravação feita em .env.local sem imprimir segredos. Use /restart para reabrir a sessão SDK com a configuração persistida.\x1b[0m\n');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            println(`  \x1b[31mNão foi possível persistir BYOK: ${message}\x1b[0m\n`);
        }
        return;
    }

    if (sub === 'reload') {
        clearRuntimeSelectors();
        const result = loadDotenv({ path: '.env.local', override: true, quiet: true });
        if (result.error) {
            println(`  \x1b[31mNão foi possível recarregar .env.local: ${result.error.message}\x1b[0m\n`);
            return;
        }
        println('  \x1b[32m.env.local recarregado no processo atual. Segredos não foram exibidos.\x1b[0m');
        renderStatus(readTerminalByokProjection(), println);
        return;
    }

    if (sub === 'providers' || sub === 'provider-list') {
        const presetCounts = new Map();
        for (const profile of profiles) {
            const key = profile.preset ?? profile.providerType ?? 'custom';
            presetCounts.set(key, (presetCounts.get(key) ?? 0) + 1);
        }
        const configuredPresets = [...presetCounts.entries()]
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
            .map(([preset, count]) => `${preset}=${count}`)
            .join(' · ');
        println(`\n  \x1b[36mBYOK providers\x1b[0m (${profiles.length} perfil(is))`);
        println(`  \x1b[90mativo=${summary.profile ?? summary.preset ?? 'sdk'} · prontos=${profiles.length} · presets=${configuredPresets || '-'}\x1b[0m\n`);
        if (profiles.length === 0) {
            println('    \x1b[33mNenhum provider BYOK configurado. Adicione perfis em COPILOT_BYOK_PROFILES_JSON no .env.local.\x1b[0m\n');
            return;
        }
        for (const profile of profiles) {
            const active = profile.name === summary.profile ? ' \x1b[32m← ativo\x1b[0m' : '';
            const metadata = profile.metadataKeys.length ? ` · meta=${profile.metadataKeys.join(',')}` : '';
            const readiness =
                profile.auth.bearerTokenConfigured || profile.auth.apiKeyConfigured || profile.auth.headersConfigured
                    ? '\x1b[32mready\x1b[0m'
                    : '\x1b[33msem credencial\x1b[0m';
            println(`    \x1b[33m${profile.name}\x1b[0m${active} · ${readiness}`);
            println(
                `      \x1b[90mpreset=${profile.preset ?? '-'} · provider=${profile.providerType ?? '-'} · model=${profile.model ?? '-'} · auth=${renderProfileAuth(profile)}${metadata}\x1b[0m`,
            );
            println(
                `      \x1b[90mcomandos: /byok use ${profile.name} · /byok models refresh provider:${profile.preset ?? profile.providerType ?? profile.name} · /byok recommend provider:${profile.preset ?? profile.providerType ?? profile.name} free reasoning safe\x1b[0m`,
            );
        }
        println('\n  \x1b[90mUse /byok models all-providers free reasoning safe para comparar todos os perfis; use provider:<nome> para filtrar.\x1b[0m\n');
        return;
    }

    if (sub === 'profiles') {
        println(`\n  \x1b[36mBYOK profiles\x1b[0m (${profiles.length})\n`);
        if (profiles.length === 0) {
            println('    \x1b[33mNenhum perfil configurado em COPILOT_BYOK_PROFILES_JSON no .env.local.\x1b[0m\n');
            return;
        }
        for (const profile of profiles) {
            const active = profile.name === summary.profile ? ' \x1b[32m← ativo\x1b[0m' : '';
            const metadata = profile.metadataKeys.length ? ` · meta=${profile.metadataKeys.join(',')}` : '';
            println(`    \x1b[33m${profile.name}\x1b[0m${active}`);
            println(
                `      \x1b[90mpreset=${profile.preset ?? '-'} · provider=${profile.providerType ?? '-'} · model=${profile.model ?? '-'} · auth=${renderProfileAuth(profile)}${metadata}\x1b[0m`,
            );
        }
        println('\n  \x1b[90mUso: /byok use <perfil> para ativar no processo atual; depois /restart para abrir nova sessão SDK.\x1b[0m\n');
        return;
    }

    if (sub === 'models') {
        const forceRefresh = rest.some((item) => ['refresh', 'force', '--refresh', '--force'].includes(item.toLowerCase()));
        const showAll = rest.some((item) => ['all', '--all'].includes(item.toLowerCase()));
        const filters = parseRecommendArgs(rest);
        const limit = showAll ? Number.POSITIVE_INFINITY : filters.limit === DEFAULT_BYOK_RECOMMEND_DISPLAY_LIMIT ? DEFAULT_BYOK_MODELS_DISPLAY_LIMIT : filters.limit;
        filters.forceRefresh = filters.forceRefresh || forceRefresh;
        const discovered = await discoverByokCatalogForCommand(projection, filters);
        const runtimeBudget = readCurrentByokRequestBudget();
        const modelList = rankByokModels(discovered.models.length > 0 ? discovered.models : models).filter((model) =>
            matchesRecommendFilters(model, filters, runtimeBudget),
        );
        const modelEntries = filters.grouped
            ? groupByokModelVariants(modelList)
            : modelList.map((model) => ({ model, variants: [] }));
        const visibleEntries = modelEntries.slice(0, limit);
        const filterLabel = renderByokFilterLabel(filters);
        println(`\n  \x1b[36mBYOK models\x1b[0m (${filters.grouped ? `${modelEntries.length} grupos/${modelList.length}` : modelList.length})`);
        println(
            `  \x1b[90mfonte=${discovered.sourceLabel}${discovered.profileCount > 1 ? ` · perfis=${discovered.profileCount}` : ''}${discovered.endpoint ? ` · endpoint=${discovered.endpoint}` : ''} · ordem=free/capability/context · filtros=${filterLabel || '-'}\x1b[0m\n`,
        );
        for (const error of discovered.errors.slice(0, 6)) {
            println(`  \x1b[33m  aviso: descoberta remota indisponível (${error}); usando catálogo disponível.\x1b[0m`);
        }
        if (discovered.errors.length > 6) {
            println(`  \x1b[33m  aviso: +${discovered.errors.length - 6} erro(s) de descoberta omitidos; use provider:<nome> para isolar.\x1b[0m`);
        }
        if (modelList.length === 0) {
            println('    \x1b[33mNenhum modelo BYOK encontrado para os filtros atuais. Remova filtros, use provider:<nome> ou rode /byok models all-providers refresh.\x1b[0m\n');
            return;
        }
        for (const entry of visibleEntries) {
            const variantLabel = filters.grouped ? ` · variants=${renderByokVariantSummary(entry.variants)}` : '';
            println(`    \x1b[33m${entry.model.id}\x1b[0m  \x1b[90m${renderModelTags(entry.model)}${variantLabel}\x1b[0m`);
        }
        if (visibleEntries.length < modelEntries.length) {
            println(
                `\n  \x1b[90mexibindo ${visibleEntries.length}/${modelEntries.length}${filters.grouped ? ` grupos (${modelList.length} variantes)` : ''}; use /byok models all ou /byok models <n> para ampliar.\x1b[0m`,
            );
        }
        println('');
        return;
    }

    if (sub === 'recommend' || sub === 'rec') {
        const filters = parseRecommendArgs(rest);
        const runtimeBudget = readCurrentByokRequestBudget();
        const discovered = await discoverByokCatalogForCommand(projection, filters);
        const modelList = discovered.models.length > 0 ? discovered.models : models;
        const rankedRecommended = rankByokModels(modelList).filter((model) =>
            matchesRecommendFilters(model, filters, runtimeBudget),
        );
        const recommendedEntries = (filters.grouped
            ? groupByokModelVariants(rankedRecommended)
            : rankedRecommended.map((model) => ({ model, variants: [] }))
        ).slice(0, filters.limit);
        const filterLabel = renderByokFilterLabel(filters);
        println(`\n  \x1b[36mBYOK recommend\x1b[0m (${recommendedEntries.length}/${modelList.length}${filters.grouped ? ' grupos' : ''})`);
        println(
            `  \x1b[90mfonte=${discovered.sourceLabel}${discovered.profileCount > 1 ? ` · perfis=${discovered.profileCount}` : ''}${discovered.endpoint ? ` · endpoint=${discovered.endpoint}` : ''} · filtros=${filterLabel || '-'}\x1b[0m\n`,
        );
        if (runtimeBudget !== null) {
            const contextLabel =
                runtimeBudget.tokenLimit !== null
                    ? `${runtimeBudget.contextTokens}/${runtimeBudget.tokenLimit}`
                    : `${runtimeBudget.contextTokens}`;
            println(
                `  \x1b[90mcontexto atual≈${contextLabel} tokens · estimativa pré-turno≈${runtimeBudget.estimatedRequestTokens} tokens\x1b[0m\n`,
            );
        }
        for (const error of discovered.errors.slice(0, 6)) {
            println(`  \x1b[33m  aviso: descoberta remota indisponível (${error}); usando catálogo disponível.\x1b[0m`);
        }
        if (discovered.errors.length > 6) {
            println(`  \x1b[33m  aviso: +${discovered.errors.length - 6} erro(s) de descoberta omitidos; use provider:<nome> para isolar.\x1b[0m`);
        }
        if (recommendedEntries.length === 0) {
            println('    \x1b[33mNenhum modelo atende aos filtros. Tente remover filtros ou rode /byok models refresh.\x1b[0m\n');
            return;
        }
        let index = 1;
        for (const entry of recommendedEntries) {
            const budget = classifyByokModelBudget(entry.model, runtimeBudget);
            const color = budget.level === 'ok' ? '\x1b[32m' : budget.level === 'caution' ? '\x1b[33m' : '\x1b[31m';
            const variantLabel = filters.grouped ? ` · variants=${renderByokVariantSummary(entry.variants)}` : '';
            println(`    ${index}. \x1b[33m${entry.model.id}\x1b[0m`);
            println(`       \x1b[90m${renderModelTags(entry.model)}${variantLabel}\x1b[0m`);
            println(`       ${color}${budget.label}\x1b[0m`);
            index += 1;
        }
        println('\n  \x1b[90mUse /byok model <id> para trocar apenas o modelo do provider/perfil ativo; use /byok use <perfil> para trocar provider.\x1b[0m\n');
        return;
    }

    if (sub === 'use') {
        const target = normalizeArg(rest.join(' '));
        if (!target) {
            println('  \x1b[31mUso: /byok use <perfil|sdk>\x1b[0m\n');
            return;
        }
        if (target === 'sdk' || target === 'off' || target === 'copilot') {
            process.env['COPILOT_BYOK_ENABLED'] = 'false';
            clearRuntimeSelectors();
            println('\n  \x1b[32mBYOK desativado no processo atual; o SDK Copilot volta a governar a próxima sessão.\x1b[0m');
            println('  \x1b[90mUse /restart para reabrir o dialog loop com o SDK sem provider customizado.\x1b[0m\n');
            return;
        }
        if (!profiles.some((profile) => profile.name === target)) {
            println(`  \x1b[31mPerfil BYOK não encontrado: ${target}. Veja /byok profiles.\x1b[0m\n`);
            return;
        }
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        clearRuntimeSelectors();
        process.env['COPILOT_BYOK_PROFILE'] = target;
        renderStatus(readTerminalByokProjection(), println);
        return;
    }

    if (sub === 'model') {
        const model = normalizeArg(rest.join(' '));
        if (!model) {
            println('  \x1b[31mUso: /byok model <model-id>\x1b[0m\n');
            return;
        }
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        clearRuntimeSelectors(['COPILOT_BYOK_PROFILE']);
        process.env['COPILOT_BYOK_MODEL'] = model;
        renderStatus(readTerminalByokProjection(), println);
        return;
    }

    if (sub === 'provider') {
        const [preset, model, baseUrl] = rest;
        if (!preset) {
            println('  \x1b[31mUso: /byok provider <preset> [model] [baseUrl]\x1b[0m\n');
            return;
        }
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        clearRuntimeSelectors();
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = preset;
        if (model) process.env['COPILOT_BYOK_MODEL'] = model;
        if (baseUrl) process.env['COPILOT_BYOK_BASE_URL'] = baseUrl;
        renderStatus(readTerminalByokProjection(), println);
        return;
    }

    renderStatus(projection, println);
}
