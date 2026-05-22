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

import { discoverConfiguredByokModelsFromEnv, readConfiguredByokProfilesFromEnv } from '#copilot/config';
import {
    probeTerminalConfiguredByokAgent,
    probeTerminalConfiguredByokChat,
    listTerminalSdkSessionInventory,
    readTerminalByokProjection,
    readTerminalRuntimeState,
    setTerminalModelProjection,
} from '../frontend/index.js';
import {
    clearByokProviderModelHealth,
    flushByokProviderHealth,
    listByokProviderModelHealth,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    readByokProviderHealthState,
    readByokProviderModelHealth,
} from '../state/byok-provider-health.js';
import {
    classifyTerminalByokSdkBinding,
    isSameTerminalByokProviderBoundary,
} from '../byok/session-binding.js';

const DEFAULT_BYOK_MODELS_DISPLAY_LIMIT = 24;
const DEFAULT_BYOK_RECOMMEND_DISPLAY_LIMIT = 8;
const DEFAULT_BYOK_SHORTLIST_PROBE_LIMIT = 3;
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
 * @typedef {Awaited<ReturnType<typeof probeTerminalConfiguredByokChat>> | Awaited<ReturnType<typeof probeTerminalConfiguredByokAgent>>} ByokProbeResult
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
 * Explica a fronteira entre seletor BYOK e sessão SDK viva. Provider/profile vivem no contrato de criação/retomada de
 * sessão; `/restart` reinicia apenas o dialog loop e não pode ser narrado como rebind de provider.
 *
 * @param {(text: string) => void} println
 * @param {{ persisted?: boolean }} [options]
 * @returns {void}
 */
function printByokSdkSessionBoundaryHint(println, options = {}) {
    const prefix = options.persisted
        ? 'A seleção persistida será aplicada por uma nova sessão SDK.'
        : 'A seleção BYOK foi preparada no processo atual.';
    println(
        `  \x1b[90m${prefix} Para entrar/sair de BYOK ou rebind de provider/perfil, agende /session sdk next new e reinicie a task do terminal; /restart reinicia só o dialog loop.\x1b[0m`,
    );
    println(
        '  \x1b[90m/byok model <id> tenta setModel na sessão viva apenas quando ela já está bound ao mesmo provider BYOK.\x1b[0m',
    );
}

/**
 * Troca modelo no runtime vivo apenas quando o handle SDK atual já nasceu com o mesmo provider BYOK.
 *
 * @param {ReturnType<typeof readTerminalByokProjection>['summary']} summary
 * @param {string} model
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function tryApplyLiveByokModelSwitch(summary, model, println) {
    if (!summary.enabled || !summary.ready) return;

    let inventory;
    try {
        inventory = await listTerminalSdkSessionInventory();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        println(
            `  \x1b[33mSessão viva não inspecionada para setModel BYOK: ${message}. A seleção do processo continua pronta para o próximo boot.\x1b[0m`,
        );
        return;
    }
    if (!inventory.currentSessionId || !isSameTerminalByokProviderBoundary(summary, inventory.persistedByokBinding)) {
        println(
            '  \x1b[33mSessão viva não está bound ao mesmo provider BYOK; modelo preparado para o próximo boot, sem setModel cruzando provider.\x1b[0m',
        );
        return;
    }
    try {
        setTerminalModelProjection(model);
        println(
            `  \x1b[32mModelo BYOK solicitado na sessão viva: ${model}.\x1b[0m`,
        );
        println(
            '  \x1b[90mProvider/perfil foram preservados; confirme o modelo efetivo no próximo turno por usage/session.model_changed.\x1b[0m',
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        println(
            `  \x1b[33mNão foi possível pedir setModel BYOK no runtime vivo: ${message}. A seleção do processo continua pronta para o próximo boot.\x1b[0m`,
        );
    }
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
 *   profileFreeTier?: boolean | null;
 *   profileCostSource?: string | null;
 *   profileCostDetail?: string | null;
 *   inputModalities?: string[];
 *   outputModalities?: string[];
 *   supportsReasoning?: boolean;
 * } | undefined}
 */
function getByokModelMetadata(model) {
    return /** @type {{ byok?: { freeTier?: boolean | null; pricing?: { prompt?: number | null; completion?: number | null; request?: number | null }; rateLimits?: { maxRequestTokens?: number | null; tokensPerMinute?: number | null; requestsPerMinute?: number | null; dailyRequests?: number | null }; provider?: string | null; profile?: string | null; source?: string; profileFreeTier?: boolean | null; profileCostSource?: string | null; profileCostDetail?: string | null; inputModalities?: string[]; outputModalities?: string[]; supportsReasoning?: boolean } }} */ (model).byok;
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
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalScalarString(value) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return null;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isTruthyProfileFlag(value) {
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
 * Perfis BYOK podem declarar que a conta/plano atual tem cota gratuita mesmo quando o catálogo remoto não marca preço por
 * modelo. Isso não transforma o modelo em "free confirmado"; a UI mostra `profile-free` para preservar a origem da
 * inferência.
 *
 * @param {string | null | undefined} profileName
 * @returns {{ profileFreeTier: boolean | null; profileCostSource: string | null; profileCostDetail: string | null }}
 */
function readByokProfileCostHint(profileName) {
    if (!profileName) return { profileFreeTier: null, profileCostSource: null, profileCostDetail: null };
    try {
        const profile = readConfiguredByokProfilesFromEnv(process.env)[profileName];
        if (!profile) return { profileFreeTier: null, profileCostSource: null, profileCostDetail: null };
        const metadata = asRecord(profile['metadata']);
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
            const scalar = optionalScalarString(value);
            if (
                isTruthyProfileFlag(value) ||
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
        if (/\bfree\b/iu.test(profileName)) {
            return {
                profileFreeTier: true,
                profileCostSource: 'profile.name',
                profileCostDetail: profileName,
            };
        }
    } catch {
        return { profileFreeTier: null, profileCostSource: null, profileCostDetail: null };
    }
    return { profileFreeTier: null, profileCostSource: null, profileCostDetail: null };
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @returns {{ kind: 'free' | 'profile-free' | 'metered' | 'unknown'; label: string }}
 */
function classifyByokModelCost(model) {
    const meta = getByokModelMetadata(model);
    if (meta?.freeTier === true) return { kind: 'free', label: 'free' };
    if (meta?.freeTier === false) return { kind: 'metered', label: 'metered' };
    if (meta?.profileFreeTier === true) return { kind: 'profile-free', label: 'profile-free' };
    return { kind: 'unknown', label: 'cost?' };
}

/**
 * @param {string | null | undefined} profileName
 * @returns {string}
 */
function renderByokProfileCostTag(profileName) {
    const hint = readByokProfileCostHint(profileName);
    if (hint.profileFreeTier !== true) return '';
    const detail = hint.profileCostDetail ? `(${String(hint.profileCostDetail).slice(0, 40)})` : '';
    return ` · cost=profile-free${detail}`;
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
    const cost = classifyByokModelCost(model);
    const ctxTokens = model.capabilities?.limits?.max_context_window_tokens ?? 0;
    let score = 0;
    if (cost.kind === 'free') score += 1_000_000_000;
    if (cost.kind === 'profile-free') score += 900_000_000;
    if (supportsByokReasoning(model)) score += 100_000_000;
    if (model.capabilities?.supports?.vision) score += 10_000_000;
    score += Math.min(Number(ctxTokens) || 0, 2_000_000);
    if (meta?.freeTier === false) score -= 10_000;
    if (isByokModelKnownFailed(model)) score -= 500_000_000;
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
    const health = readHealthForByokModel(model);
    if (health && isByokHealthCurrentlyFailed(health)) {
        return {
            level: 'blocked',
            label: `chat real falhou (${formatByokHealthAge(health.lastFailureAt)}); trocar modelo/provider ou testar novamente`,
        };
    }
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
    const cost = classifyByokModelCost(model);
    const context = model.capabilities?.limits?.max_context_window_tokens ?? 0;
    const maxRequest = meta?.rateLimits?.maxRequestTokens ?? meta?.rateLimits?.tokensPerMinute ?? null;
    if (filters.freeOnly && cost.kind !== 'free' && cost.kind !== 'profile-free') return false;
    if (filters.meteredOnly && cost.kind !== 'metered') return false;
    if (filters.unknownCostOnly && cost.kind !== 'unknown') return false;
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
 * @param {ReturnType<typeof parseRecommendArgs>} filters
 * @returns {ReturnType<typeof parseRecommendArgs>}
 */
function withoutSafeFilter(filters) {
    return { ...filters, avoidLowLimit: false };
}

/**
 * @param {(text: string) => void} println
 * @param {import('#copilot/sdk/types').ModelInfo[]} candidateModels
 * @param {ReturnType<typeof parseRecommendArgs>} filters
 * @param {ReturnType<typeof estimateCurrentByokRequestBudget>} runtimeBudget
 * @returns {void}
 */
function renderEmptyByokFilterDiagnostics(println, candidateModels, filters, runtimeBudget) {
    if (!filters.avoidLowLimit || candidateModels.length === 0) return;
    const withoutSafe = rankByokModels(candidateModels).filter((model) =>
        matchesRecommendFilters(model, withoutSafeFilter(filters), runtimeBudget),
    );
    if (withoutSafe.length === 0) return;
    println(
        `    \x1b[33mO filtro safe removeu ${withoutSafe.length} candidato(s). Eles existem, mas parecem apertados/bloqueados para turno real no contexto atual.\x1b[0m`,
    );
    for (const model of withoutSafe.slice(0, 4)) {
        const budget = classifyByokModelBudget(model, runtimeBudget);
        println(`      \x1b[90m- ${model.id}: ${budget.label}\x1b[0m`);
    }
    println('    \x1b[90mTente remover safe para inspeção, usar /compact, sessão fresca, ou provider/modelo com maxReq/TPM maior.\x1b[0m');
}

/**
 * @param {(text: string) => void} println
 * @param {import('#copilot/sdk/types').ModelInfo[]} budgetSafeModels
 * @returns {void}
 */
function renderSafeRecommendationEvidenceDiagnostics(println, budgetSafeModels) {
    const unverified = budgetSafeModels.filter((model) => !isByokModelAgentProbeVerified(model));
    if (unverified.length === 0) return;
    println(
        `    \x1b[33mA recomendacao safe removeu ${unverified.length} candidato(s) sem probe agente positivo de tools + ask_user.\x1b[0m`,
    );
    for (const model of unverified.slice(0, 4)) {
        println(`      \x1b[90m- ${model.id}: ${renderByokRecommendationActionHint(model)}\x1b[0m`);
    }
    println('    \x1b[90mUse /byok models para explorar catalogo bruto; rode /byok probe agent antes de promover o modelo para a sessao viva.\x1b[0m');
}

/**
 * A shortlist agregada e uma mesa de admissao, nao um segundo catalogo. Quando varios perfis entram no mesmo
 * ranking, o operador precisa ver por que um profile desapareceu antes de sondar o top-N.
 *
 * @param {(text: string) => void} println
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @param {import('#copilot/sdk/types').ModelInfo[]} modelList
 * @param {import('#copilot/sdk/types').ModelInfo[]} eligibleModels
 * @param {import('#copilot/sdk/types').ModelInfo[]} shortlistedModels
 * @param {ReturnType<typeof parseRecommendArgs>} filters
 * @param {ReturnType<typeof estimateCurrentByokRequestBudget>} runtimeBudget
 * @returns {void}
 */
function renderByokShortlistProfileCoverage(
    println,
    projection,
    modelList,
    eligibleModels,
    shortlistedModels,
    filters,
    runtimeBudget,
) {
    if (!filters.allProviders) return;
    const profiles = selectProfilesForDiscovery(projection, filters);
    if (profiles.length === 0) return;
    println('  \x1b[90mCobertura por perfil antes das probes:\x1b[0m');
    for (const profile of profiles.slice(0, 12)) {
        /** @param {import('#copilot/sdk/types').ModelInfo} model */
        const fromProfile = (model) => getByokModelMetadata(model)?.profile === profile.name;
        const catalogCount = modelList.filter(fromProfile).length;
        const eligibleCount = eligibleModels.filter(fromProfile).length;
        const shortlistCount = shortlistedModels.filter(fromProfile).length;
        const filtersWithoutSafeCount =
            filters.avoidLowLimit && eligibleCount === 0
                ? modelList.filter(
                      (model) =>
                          fromProfile(model) &&
                          matchesRecommendFilters(model, withoutSafeFilter(filters), runtimeBudget),
                  ).length
                : 0;
        const coverage =
            catalogCount === 0
                ? 'catalogo=0'
                : eligibleCount > 0
                  ? `catalogo=${catalogCount} · elegiveis=${eligibleCount} · shortlist=${shortlistCount}`
                  : filtersWithoutSafeCount > 0
                    ? `catalogo=${catalogCount} · safe removeu=${filtersWithoutSafeCount}`
                    : `catalogo=${catalogCount} · filtros removeram=${catalogCount}`;
        const action =
            eligibleCount === 0
                ? ` · ação=/byok models all-providers provider:${profile.name} 5`
                : shortlistCount === 0
                  ? ` · ação=/byok probe shortlist all-providers provider:${profile.name} 1`
                  : '';
        println(`    \x1b[90m- ${profile.name}: ${coverage}${action}\x1b[0m`);
    }
    if (profiles.length > 12) {
        println(`    \x1b[90m... ${profiles.length - 12} perfil(is) omitido(s); filtre com provider:<perfil|preset>.\x1b[0m`);
    }
    println('');
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
 * @param {number | null} timestamp
 * @returns {string}
 */
function formatByokHealthAge(timestamp) {
    if (!timestamp) return 'sem data';
    const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (deltaSeconds < 60) return `${deltaSeconds}s atras`;
    const deltaMinutes = Math.round(deltaSeconds / 60);
    if (deltaMinutes < 60) return `${deltaMinutes}min atras`;
    const deltaHours = Math.round(deltaMinutes / 60);
    if (deltaHours < 48) return `${deltaHours}h atras`;
    return `${Math.round(deltaHours / 24)}d atras`;
}

/**
 * @param {{ lastStatus: 'failed' | 'ok' | null; lastFailureAt: number | null; lastSuccessAt: number | null }} health
 * @returns {boolean}
 */
function isByokHealthCurrentlyFailed(health) {
    return health.lastStatus === 'failed' && (health.lastFailureAt ?? 0) >= (health.lastSuccessAt ?? 0);
}

/**
 * @param {{ agentProbeStatus?: 'failed' | 'ok' | null; lastAgentProbeFailureAt?: number | null; lastAgentProbeSuccessAt?: number | null }} health
 * @returns {boolean}
 */
function isByokAgentProbeCurrentlyFailed(health) {
    return (
        health.agentProbeStatus === 'failed' &&
        (health.lastAgentProbeFailureAt ?? 0) >= (health.lastAgentProbeSuccessAt ?? 0)
    );
}

/**
 * @param {string | null | undefined} context
 * @returns {string}
 */
function renderByokChatHealthEvidence(context) {
    const normalized = typeof context === 'string' ? context.trim() : '';
    if (!normalized) return 'histórico';
    if (normalized === 'byok_probe') return 'probe';
    if (normalized === 'llm.usage' || normalized === 'live_turn') return 'turno';
    if (
        normalized === 'model_call' ||
        normalized.startsWith('session.') ||
        normalized.startsWith('dialog.')
    ) {
        return 'turno';
    }
    return normalized.length > 24 ? `${normalized.slice(0, 21)}...` : normalized;
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @returns {ReturnType<typeof readByokProviderModelHealth>}
 */
function readHealthForByokModel(model) {
    const meta = getByokModelMetadata(model);
    const exact = readByokProviderModelHealth({
        profile: meta?.profile ?? null,
        provider: meta?.provider ?? null,
        model: model.id,
    });
    if (exact) return exact;
    return (
        listByokProviderModelHealth().find(
            (health) =>
                health.model === model.id &&
                ((meta?.profile && health.profile === meta.profile) || (meta?.provider && health.provider === meta.provider)),
        ) ?? null
    );
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @returns {boolean}
 */
function isByokModelKnownFailed(model) {
    const health = readHealthForByokModel(model);
    return health ? isByokHealthCurrentlyFailed(health) || isByokAgentProbeCurrentlyFailed(health) : false;
}

/**
 * "safe" em recomendacao nao pode significar apenas "nao falhou ainda". O terminal opera como agente: para uma
 * selecao promovida ao operador, precisamos de evidencia positiva de tools + `ask_user` na sonda descartavel.
 *
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @returns {boolean}
 */
function isByokModelAgentProbeVerified(model) {
    const health = readHealthForByokModel(model);
    if (!health || health.agentProbeStatus !== 'ok') return false;
    return (health.lastAgentProbeSuccessAt ?? 0) >= (health.lastAgentProbeFailureAt ?? 0);
}

/**
 * @param {{ name: string; preset: string | null; providerType: string | null; model: string | null }} profile
 * @returns {ReturnType<typeof readByokProviderModelHealth>}
 */
function readHealthForByokProfile(profile) {
    const providerCandidates = [profile.preset, profile.providerType].filter(Boolean);
    const exact = readByokProviderModelHealth({
        profile: profile.name,
        provider: profile.preset ?? profile.providerType,
        model: profile.model,
    });
    if (exact) return exact;
    return (
        listByokProviderModelHealth().find(
            (health) =>
                Boolean(
                    profile.model &&
                        health.model === profile.model &&
                        (health.profile === profile.name || providerCandidates.includes(health.provider)),
                ),
        ) ?? null
    );
}

/**
 * @param {ReturnType<typeof readByokProviderModelHealth>} health
 * @returns {string}
 */
function renderByokHealthTag(health) {
    if (!health) return 'chat=?';
    if (isByokHealthCurrentlyFailed(health)) {
        return `chat=failed(${renderByokChatHealthEvidence(health.lastErrorContext)},${formatByokHealthAge(health.lastFailureAt)}${health.failureCount > 1 ? `,x${health.failureCount}` : ''})`;
    }
    if (health.lastStatus !== 'ok') return 'chat=?';
    return `chat=ok(${renderByokChatHealthEvidence(health.lastSuccessContext)},${formatByokHealthAge(health.lastSuccessAt)}${health.successCount > 1 ? `,x${health.successCount}` : ''})`;
}

/**
 * @param {ReturnType<typeof readByokProviderModelHealth>} health
 * @returns {string}
 */
function renderByokAgentProbeHealthTag(health) {
    if (!health || !health.agentProbeStatus) return 'agent=?';
    if (isByokAgentProbeCurrentlyFailed(health)) {
        return `agent=failed(${formatByokHealthAge(health.lastAgentProbeFailureAt)}${health.agentProbeFailureCount > 1 ? `,x${health.agentProbeFailureCount}` : ''})`;
    }
    return `agent=ok(${formatByokHealthAge(health.lastAgentProbeSuccessAt)}${health.agentProbeSuccessCount > 1 ? `,x${health.agentProbeSuccessCount}` : ''})`;
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @param {{ profileName?: string | null; preset?: string | null; providerType?: string | null }} source
 * @returns {import('#copilot/sdk/types').ModelInfo}
 */
function withByokCatalogSource(model, source) {
    const meta = getByokModelMetadata(model) ?? {};
    const profileCostHint = readByokProfileCostHint(source.profileName);
    return /** @type {import('#copilot/sdk/types').ModelInfo} */ ({
        ...model,
        byok: {
            ...meta,
            provider: meta.provider ?? source.preset ?? source.providerType ?? source.profileName ?? null,
            profile: meta.profile ?? source.profileName ?? null,
            source: meta.source ?? source.preset ?? source.providerType ?? source.profileName ?? undefined,
            profileFreeTier: meta.profileFreeTier ?? profileCostHint.profileFreeTier,
            profileCostSource: meta.profileCostSource ?? profileCostHint.profileCostSource,
            profileCostDetail: meta.profileCostDetail ?? profileCostHint.profileCostDetail,
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
 * @returns {Promise<{ models: import('#copilot/sdk/types').ModelInfo[]; sourceLabel: string; endpoint: string | null; errors: string[]; warnings: string[]; profileCount: number }>}
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
            warnings: renderConfiguredByokCatalogWarnings(discovered, {
                profile: projection.summary.profile,
                provider: projection.summary.preset ?? projection.summary.providerType,
            }),
            profileCount: projection.summary.profile ? 1 : 0,
        };
    }

    const profiles = selectProfilesForDiscovery(projection, filters);
    const models = [];
    const errors = [];
    const warnings = [];
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
        warnings.push(...renderConfiguredByokCatalogWarnings(discovered, { profile: profile.name, provider: profile.preset ?? profile.providerType }));
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
        warnings,
        profileCount: profiles.length,
    };
}

/**
 * @param {Awaited<ReturnType<typeof discoverConfiguredByokModelsFromEnv>>} discovered
 * @param {{ profile: string | null | undefined; provider: string | null | undefined }} source
 * @returns {string[]}
 */
function renderConfiguredByokCatalogWarnings(discovered, source) {
    const configuredModel = discovered.configuredModel;
    if (!configuredModel?.authoritative || configuredModel.inCatalog !== false || !configuredModel.id) return [];
    const owner = source.profile ? `perfil=${source.profile}` : source.provider ? `provider=${source.provider}` : 'seleção ativa';
    const selector = source.profile ? ` profile:${source.profile}` : '';
    return [
        `${owner}: model configurado '${configuredModel.id}' nao apareceu no catalogo remoto atual. O terminal nao troca seletor silenciosamente; explore /byok models${selector ? ` all-providers${selector}` : ''} e valide um candidato com /byok probe agent${selector} model:<id> antes de /byok model <id>.`,
    ];
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} warnings
 * @returns {void}
 */
function renderByokCatalogWarnings(println, warnings) {
    for (const warning of warnings.slice(0, 6)) {
        println(`  \x1b[33m  aviso: ${warning}\x1b[0m`);
    }
    if (warnings.length > 6) {
        println(`  \x1b[33m  aviso: +${warnings.length - 6} alerta(s) de seletor/catálogo omitidos; use provider:<nome> para isolar.\x1b[0m`);
    }
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @returns {string}
 */
function renderModelTags(model) {
    const meta = getByokModelMetadata(model);
    const cost = classifyByokModelCost(model);
    const tags = [];
    tags.push(cost.label);
    if (cost.kind === 'profile-free') {
        const detail = meta?.profileCostDetail ? String(meta.profileCostDetail).slice(0, 48) : meta?.profileCostSource ?? 'profile';
        tags.push(`freeHint=${detail}`);
    }
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
    const health = readHealthForByokModel(model);
    if (health) tags.push(renderByokHealthTag(health), renderByokAgentProbeHealthTag(health));
    const inputs = meta?.inputModalities?.length ? meta.inputModalities.join('+') : '';
    if (inputs && inputs !== 'text') tags.push(`in=${inputs}`);
    return tags.join(' · ');
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @returns {string}
 */
function renderByokRecommendationActionHint(model) {
    const meta = getByokModelMetadata(model);
    const profile = meta?.profile ?? null;
    const profileSelector = profile ? ` profile:${profile}` : '';
    const probe = `/byok probe agent${profileSelector} model:${model.id}`;
    const selection = profile
        ? `/byok use ${profile} -> /byok model ${model.id}`
        : `/byok model ${model.id}`;
    return `teste=${probe} · seleção=${selection}`;
}

/**
 * O catálogo ativo e o health operacional são superfícies diferentes: o primeiro descreve oferta/configuração, o
 * segundo registra se chat/agente realmente funcionaram. Quando a seleção ativa já falhou, o cockpit deve transformar
 * essa diferença em ação explícita sem trocar o provider/modelo silenciosamente.
 *
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @returns {import('#copilot/sdk/types').ModelInfo[]}
 */
function listActiveByokHealthAlternatives(projection) {
    const { summary } = projection;
    const activeModel = summary.model ?? null;
    return rankByokModels(
        projection.models.map((model) =>
            withByokCatalogSource(model, {
                profileName: summary.profile,
                preset: summary.preset,
                providerType: summary.providerType,
            }),
        ),
    )
        .filter((model) => model.id !== activeModel && !isByokModelKnownFailed(model))
        .slice(0, 3);
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @param {ReturnType<typeof readByokProviderModelHealth>} activeHealth
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderActiveByokHealthGuidance(projection, activeHealth, println) {
    if (!activeHealth) return;
    const chatFailed = isByokHealthCurrentlyFailed(activeHealth);
    const agentFailed = isByokAgentProbeCurrentlyFailed(activeHealth);
    if (!chatFailed && !agentFailed) return;
    const failureScope = [chatFailed ? 'chat real' : null, agentFailed ? 'probe agente' : null]
        .filter(Boolean)
        .join(' + ');
    println(
        `  \x1b[31m  healthGate: seleção ativa com falha recente em ${failureScope}; catálogo disponível não equivale a runtime saudável.\x1b[0m`,
    );
    const alternatives = listActiveByokHealthAlternatives(projection);
    if (alternatives.length === 0) {
        const provider = projection.summary.preset ?? projection.summary.providerType ?? projection.summary.profile;
        const providerFilter = provider ? ` provider:${provider}` : '';
        println(
            `  \x1b[90m  ação: rode /byok recommend${providerFilter} free reasoning safe e confirme com /byok probe agent antes da sessão viva.\x1b[0m`,
        );
        return;
    }
    println('  \x1b[90m  candidatos do mesmo catálogo ativo, preservando troca explícita:\x1b[0m');
    for (const model of alternatives) {
        println(`  \x1b[90m    - ${model.id}: ${renderByokRecommendationActionHint(model)}\x1b[0m`);
    }
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
 * @returns {Promise<void>}
 */
async function renderStatus(projection, println) {
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
    const activeHealth = readHealthForByokProfile({
        name: summary.profile ?? summary.preset ?? 'runtime',
        preset: summary.preset,
        providerType: summary.providerType,
        model: summary.model,
    });
    if (activeHealth) {
        println(`    chatHealth:    \x1b[33m${renderByokHealthTag(activeHealth)}\x1b[0m`);
        println(`    agentHealth:   \x1b[33m${renderByokAgentProbeHealthTag(activeHealth)}\x1b[0m`);
    }
    const costTag = renderByokProfileCostTag(summary.profile);
    if (costTag) {
        println(`    cost:          \x1b[33m${costTag.replace(/^ · /u, '')}\x1b[0m`);
    }
    println(`    modelList:     ${summary.modelList.count} modelo(s)`);
    try {
        const inventory = await listTerminalSdkSessionInventory();
        const binding = classifyTerminalByokSdkBinding(
            summary,
            inventory.persistedByokBinding,
            inventory.currentSessionId,
        );
        println(`    prepared:      \x1b[33m${binding.preparedLabel}\x1b[0m`);
        println(
            `    live binding:  \x1b[33m${inventory.currentSessionId ?? '(sem sessão viva)'}\x1b[0m \x1b[90m· ${binding.liveLabel}\x1b[0m`,
        );
        const color = binding.state === 'next-boot-required' || binding.state === 'selection-incomplete' ? '\x1b[33m' : '\x1b[90m';
        println(`    boundary:      ${color}${binding.headline}\x1b[0m`);
        if (binding.action) println(`      \x1b[90m${binding.action}\x1b[0m`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        println(`    live binding:  \x1b[33mindisponível\x1b[0m \x1b[90m(${message})\x1b[0m`);
    }
    for (const warning of summary.warnings) {
        println(`  \x1b[33m  aviso: ${warning}\x1b[0m`);
    }
    for (const error of summary.errors) {
        println(`  \x1b[31m  erro: ${error}\x1b[0m`);
    }
    renderActiveByokHealthGuidance(projection, activeHealth, println);
    println('  \x1b[90mArquivo unico de BYOK: .env.local. Mudancas via comando preparam o processo; o rebind da sessão SDK acontece no próximo boot.\x1b[0m');
    printByokSdkSessionBoundaryHint(println);
    println('  \x1b[90mUso: /byok | /byok reload | /byok providers | /byok profiles | /byok health [clear] | /byok probe [chat|agent] [profile:<nome>] [model:<id>] | /byok probe shortlist [all-providers] [filtros] [n] [timeout:<ms>] | /byok models [all-providers|grouped|refresh|all|n] [free|metered|cost?] [provider:<nome>] [reasoning] [vision] [safe] [ctx>N] [maxReq>N] | /byok recommend [all-providers] [grouped] [filtros] [n] | /byok use <perfil|sdk> | /byok model <id> | /byok provider <preset> [model] [baseUrl] | /byok persist <sdk|profile|model|provider> | /byok env\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderByokHealth(println) {
    const state = readByokProviderHealthState();
    const records = listByokProviderModelHealth();
    println(`\n  \x1b[36mBYOK operational health\x1b[0m (${records.length})`);
    println(
        `  \x1b[90mpersist=${state.enabled ? 'on' : 'off'} · arquivo=${state.path ?? '-'} · carregado=${state.loaded ? 'sim' : 'nao'} · dirty=${state.dirty ? 'sim' : 'nao'}\x1b[0m`,
    );
    if (state.error) println(`  \x1b[31merro=${state.error}\x1b[0m`);
    if (records.length === 0) {
        println('  \x1b[90mNenhum turno BYOK real registrou sucesso ou falha neste estado ainda.\x1b[0m\n');
        return;
    }
    for (const record of records.slice(0, 30)) {
        const label = renderByokHealthTag(record);
        const parts = [
            record.profile ? `profile=${record.profile}` : null,
            record.provider ? `provider=${record.provider}` : null,
            record.model ? `model=${record.model}` : null,
            label,
            renderByokAgentProbeHealthTag(record),
        ].filter(Boolean);
        println(`    \x1b[33m${record.key}\x1b[0m`);
        println(`      \x1b[90m${parts.join(' · ')}\x1b[0m`);
        if (record.lastMessage) println(`      \x1b[90multimo erro=${record.lastMessage}\x1b[0m`);
        if (record.lastErrorContext) println(`      \x1b[90mcontexto=${record.lastErrorContext}\x1b[0m`);
        if (record.lastAgentProbeMessage) println(`      \x1b[90multimo erro agent=${record.lastAgentProbeMessage}\x1b[0m`);
        if (record.lastAgentProbeErrorContext) println(`      \x1b[90mcontexto agent=${record.lastAgentProbeErrorContext}\x1b[0m`);
    }
    if (records.length > 30) {
        println(`  \x1b[90m... ${records.length - 30} registro(s) omitidos. Use filtros de /byok models ou /byok providers para cockpit resumido.\x1b[0m`);
    }
    println('');
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
 * @param {string[]} rest
 * @returns {{ env: Record<string, string | undefined>; model: string | null; profile: string | null; timeoutMs: number | undefined }}
 */
function buildByokProbeSelection(rest) {
    /** @type {Record<string, string | undefined>} */
    const env = { ...process.env };
    /** @type {string | null} */
    let model = null;
    /** @type {string | null} */
    let profile = null;
    /** @type {number | undefined} */
    let timeoutMs;
    for (const raw of rest) {
        const item = raw.trim();
        const lower = item.toLowerCase();
        if (!item || lower === 'active' || lower === '--active') continue;
        if (lower.startsWith('profile:') || lower.startsWith('profile=')) {
            profile = item.slice(item.indexOf(lower.startsWith('profile:') ? ':' : '=') + 1).trim() || null;
            continue;
        }
        if (lower.startsWith('model:') || lower.startsWith('model=')) {
            model = item.slice(item.indexOf(lower.startsWith('model:') ? ':' : '=') + 1).trim() || null;
            continue;
        }
        if (lower.startsWith('timeout:') || lower.startsWith('timeout=')) {
            const value = Number.parseInt(
                item.slice(item.indexOf(lower.startsWith('timeout:') ? ':' : '=') + 1),
                10,
            );
            if (Number.isFinite(value) && value > 0) timeoutMs = value;
            continue;
        }
        if (!model) model = item;
    }
    if (profile) {
        env['COPILOT_BYOK_ENABLED'] = 'true';
        env['COPILOT_BYOK_PROFILE'] = profile;
    }
    if (model) {
        env['COPILOT_BYOK_ENABLED'] = 'true';
        env['COPILOT_BYOK_MODEL'] = model;
    }
    return { env, model, profile, timeoutMs };
}

/**
 * @param {'chat' | 'agent'} mode
 * @param {ByokProbeResult} probe
 * @returns {Promise<boolean>}
 */
async function recordByokProbeHealth(mode, probe) {
    const healthIdentity = {
        profile: probe.profile,
        provider: probe.preset ?? probe.providerType,
        model: probe.model,
    };
    const providerAttempted = probe.status !== 'admission-blocked';
    if (mode === 'agent' && probe.ok) {
        recordByokProviderModelAgentProbeSuccess(healthIdentity);
    } else if (mode === 'agent' && providerAttempted) {
        recordByokProviderModelAgentProbeFailure({
            ...healthIdentity,
            message: probe.errors[0] ?? `agent probe ${probe.status}`,
            errorContext: probe.providerFailure?.errorContext ?? 'byok_agent_probe',
        });
    } else if (probe.ok) {
        recordByokProviderModelCallSuccess({
            ...healthIdentity,
            successContext: 'byok_probe',
        });
    } else if (providerAttempted) {
        recordByokProviderModelCallFailure({
            ...healthIdentity,
            message: probe.errors[0] ?? `probe ${probe.status}`,
            errorContext: probe.providerFailure?.errorContext ?? 'byok_probe',
        });
    }
    await flushByokProviderHealth();
    return providerAttempted;
}

/**
 * @param {(text: string) => void} println
 * @param {'chat' | 'agent'} mode
 * @param {ByokProbeResult} probe
 * @param {{ indent?: string; providerAttempted?: boolean; showSession?: boolean; showWarnings?: boolean }} [options]
 * @returns {void}
 */
function renderByokProbeResult(println, mode, probe, options = {}) {
    const indent = options.indent ?? '    ';
    const color = probe.ok ? '\x1b[32m' : '\x1b[31m';
    println(
        `${indent}resultado: ${color}${probe.status}\x1b[0m · profile=${valueOrDash(probe.profile)} · preset=${valueOrDash(probe.preset)} · provider=${valueOrDash(probe.providerType)} · model=${valueOrDash(probe.model)}`,
    );
    println(
        `${indent}sinal:     deltas=${probe.deltaCount}/${probe.deltaChars} chars · final=${probe.finalChars} chars · finalEvent=${yesNo(probe.observedFinalEvent)} · ${probe.elapsedMs}ms`,
    );
    if (mode === 'agent') {
        println(
            `${indent}agente:    toolCalls=${Number(Reflect.get(probe, 'toolCallCount') ?? 0)} · marker=${Number(Reflect.get(probe, 'markerToolCallCount') ?? 0)} · read=${Number(Reflect.get(probe, 'readToolCallCount') ?? 0)} · ask=${Number(Reflect.get(probe, 'userInputRequestCount') ?? 0)} · answer=${Number(Reflect.get(probe, 'userInputAnswerCount') ?? 0)}`,
        );
    }
    if (options.showSession !== false && probe.sessionId) {
        println(`${indent}\x1b[90msessão temporária=${probe.sessionId}\x1b[0m`);
    }
    if (options.showWarnings !== false) {
        if (probe.providerFailure) {
            println(`${indent}\x1b[33mdiagnóstico: ${probe.providerFailure.operatorLabel}\x1b[0m`);
            println(`${indent}\x1b[90mação: ${probe.providerFailure.operatorAction}\x1b[0m`);
        }
        for (const warning of probe.warnings) {
            println(`${indent}\x1b[33maviso: ${warning}\x1b[0m`);
        }
        for (const error of probe.errors.slice(0, 4)) {
            println(`${indent}\x1b[31merro: ${error}\x1b[0m`);
        }
    }
    if (options.providerAttempted === false) {
        println(
            `${indent}\x1b[90mA probe foi barrada antes do provider porque o limite declarado não comporta o envelope SDK do terminal; health real do modelo não foi degradado por essa admissão.\x1b[0m`,
        );
    }
}

/**
 * @param {'chat' | 'agent'} mode
 * @param {ReturnType<typeof buildByokProbeSelection>} selection
 * @returns {Promise<{ probe: ByokProbeResult; providerAttempted: boolean }>}
 */
async function runByokProbe(mode, selection) {
    const probe = await (mode === 'agent' ? probeTerminalConfiguredByokAgent : probeTerminalConfiguredByokChat)({
        env: selection.env,
        ...(selection.model ? { model: selection.model } : {}),
        ...(selection.timeoutMs ? { timeoutMs: selection.timeoutMs } : {}),
    });
    return {
        probe,
        providerAttempted: await recordByokProbeHealth(mode, probe),
    };
}

/**
 * @param {string[]} rest
 * @returns {boolean}
 */
function hasExplicitByokProbeLimit(rest) {
    return rest.some((item) => {
        const numeric = Number.parseInt(item.toLowerCase(), 10);
        return Number.isFinite(numeric) && numeric > 0;
    });
}

/**
 * @param {import('#copilot/sdk/types').ModelInfo} model
 * @param {number | undefined} timeoutMs
 * @returns {ReturnType<typeof buildByokProbeSelection>}
 */
function buildByokModelProbeSelection(model, timeoutMs) {
    const meta = getByokModelMetadata(model);
    return buildByokProbeSelection([
        ...(meta?.profile ? [`profile:${meta.profile}`] : []),
        `model:${model.id}`,
        ...(timeoutMs ? [`timeout:${timeoutMs}`] : []),
    ]);
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
            println('  \x1b[90mGravação feita em .env.local sem imprimir segredos.\x1b[0m');
            printByokSdkSessionBoundaryHint(println, { persisted: true });
            println('');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            println(`  \x1b[31mNão foi possível persistir BYOK: ${message}\x1b[0m\n`);
        }
        return;
    }

    if (sub === 'health' || sub === 'chat-health') {
        if ((rest[0] ?? '').toLowerCase() === 'clear') {
            clearByokProviderModelHealth();
            await flushByokProviderHealth();
            println('  \x1b[32mBYOK operational health limpo no processo atual e no store persistente.\x1b[0m\n');
            return;
        }
        renderByokHealth(println);
        return;
    }

    if (sub === 'probe' || sub === 'check') {
        if (/^(shortlist|recommend|recommended)$/iu.test(rest[0] ?? '')) {
            const shortlistArgs = rest.slice(1);
            const filters = parseRecommendArgs(shortlistArgs);
            const timeoutMs = buildByokProbeSelection(
                shortlistArgs.filter((item) => /^(?:--)?timeout[:=]/iu.test(item)),
            ).timeoutMs;
            if (!filters.avoidLowLimit) filters.avoidLowLimit = true;
            if (!hasExplicitByokProbeLimit(shortlistArgs)) filters.limit = DEFAULT_BYOK_SHORTLIST_PROBE_LIMIT;
            const runtimeBudget = readCurrentByokRequestBudget();
            const discovered = await discoverByokCatalogForCommand(projection, filters);
            const modelList = discovered.models.length > 0 ? discovered.models : models;
            const eligibleModels = rankByokModels(modelList).filter((model) =>
                matchesRecommendFilters(model, filters, runtimeBudget),
            );
            const candidates = eligibleModels.slice(0, filters.limit);
            println(`\n  \x1b[36mBYOK shortlist agent probe\x1b[0m (${candidates.length}/${modelList.length})`);
            println(
                `  \x1b[90mEscopo: ${filters.allProviders ? 'todos os perfis selecionados' : 'provider/perfil ativo'} + ranking do catalogo + filtros=${renderByokFilterLabel(filters) || 'safe'}; cada candidato roda a mesma sessão SDK descartável de /byok probe agent, sem trocar o dialog loop vivo.${timeoutMs ? ` timeout=${timeoutMs}ms` : ''}\x1b[0m\n`,
            );
            for (const error of discovered.errors.slice(0, 6)) {
                println(`  \x1b[33m  aviso: descoberta remota indisponível (${error}); usando catálogo disponível.\x1b[0m`);
            }
            renderByokCatalogWarnings(println, discovered.warnings);
            renderByokShortlistProfileCoverage(
                println,
                projection,
                modelList,
                eligibleModels,
                candidates,
                filters,
                runtimeBudget,
            );
            if (candidates.length === 0) {
                println('    \x1b[33mNenhum candidato cabe na shortlist atual. Ajuste provider/filtros, remova safe para inspeção ou rode /byok models.\x1b[0m\n');
                renderEmptyByokFilterDiagnostics(println, modelList, filters, runtimeBudget);
                return;
            }
            let passed = 0;
            let attempted = 0;
            for (const [index, model] of candidates.entries()) {
                println(`    ${index + 1}. \x1b[33m${model.id}\x1b[0m  \x1b[90m${renderModelTags(model)}\x1b[0m`);
                const result = await runByokProbe('agent', buildByokModelProbeSelection(model, timeoutMs));
                renderByokProbeResult(println, 'agent', result.probe, {
                    indent: '       ',
                    providerAttempted: result.providerAttempted,
                    showSession: false,
                });
                if (result.providerAttempted) attempted += 1;
                if (result.probe.ok) passed += 1;
                println('');
            }
            println(
                `  \x1b[90mShortlist encerrada: ok=${passed}/${candidates.length} · providerTentado=${attempted}/${candidates.length}. A saúde persistida alimenta /byok recommend ... safe; a sessão viva só muda com /byok use e /byok model.\x1b[0m\n`,
            );
            return;
        }
        const mode = /^(agent|runtime|full)$/iu.test(rest[0] ?? '') ? 'agent' : 'chat';
        const explicitChatMode = /^(chat|canary)$/iu.test(rest[0] ?? '');
        const selection = buildByokProbeSelection(mode === 'agent' || explicitChatMode ? rest.slice(1) : rest);
        println(`\n  \x1b[36mBYOK ${mode} probe\x1b[0m`);
        println(
            `  \x1b[90mEscopo: sessão SDK descartável; não troca o dialog loop nem grava transcript live.${mode === 'chat' ? ' Chat nega tools.' : ' Agent exige tools representativas do terminal + ask_user com resposta sintética.'}${selection.profile ? ` profile=${selection.profile}` : ''}${selection.model ? ` model=${selection.model}` : ''}\x1b[0m`,
        );
        const { probe, providerAttempted } = await runByokProbe(mode, selection);
        renderByokProbeResult(println, mode, probe, { providerAttempted });
        println(
            mode === 'agent'
                ? '  \x1b[90mAgent probe confirma a fronteira exigida pelo terminal: streaming + tools representativas + ask_user. Chat probe isolado continua disponível com /byok probe chat.\x1b[0m\n'
                : '  \x1b[90mCatálogo mostra oferta; chat probe confirma conversa canária. Para validar runtime agente, rode /byok probe agent antes do live.\x1b[0m\n',
        );
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
        await renderStatus(readTerminalByokProjection(), println);
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
            const cost = renderByokProfileCostTag(profile.name);
            const health = readHealthForByokProfile(profile);
            const healthLabel = ` · ${renderByokHealthTag(health)} · ${renderByokAgentProbeHealthTag(health)}`;
            const readiness =
                profile.auth.bearerTokenConfigured || profile.auth.apiKeyConfigured || profile.auth.headersConfigured
                    ? '\x1b[32mready\x1b[0m'
                    : '\x1b[33msem credencial\x1b[0m';
            println(`    \x1b[33m${profile.name}\x1b[0m${active} · ${readiness}`);
            println(
                `      \x1b[90mpreset=${profile.preset ?? '-'} · provider=${profile.providerType ?? '-'} · model=${profile.model ?? '-'} · auth=${renderProfileAuth(profile)}${metadata}${cost}${healthLabel}\x1b[0m`,
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
            const cost = renderByokProfileCostTag(profile.name);
            println(`    \x1b[33m${profile.name}\x1b[0m${active}`);
            println(
                `      \x1b[90mpreset=${profile.preset ?? '-'} · provider=${profile.providerType ?? '-'} · model=${profile.model ?? '-'} · auth=${renderProfileAuth(profile)}${metadata}${cost}\x1b[0m`,
            );
        }
        println('\n  \x1b[90mUso: /byok use <perfil> prepara o seletor no processo atual.\x1b[0m');
        printByokSdkSessionBoundaryHint(println);
        println('');
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
        renderByokCatalogWarnings(println, discovered.warnings);
        if (modelList.length === 0) {
            println('    \x1b[33mNenhum modelo BYOK encontrado para os filtros atuais. Remova filtros, use provider:<nome> ou rode /byok models all-providers refresh.\x1b[0m\n');
            renderEmptyByokFilterDiagnostics(println, discovered.models.length > 0 ? discovered.models : models, filters, runtimeBudget);
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
        const budgetSafeRecommendations = rankByokModels(modelList).filter((model) =>
            matchesRecommendFilters(model, filters, runtimeBudget),
        );
        const rankedRecommended = filters.avoidLowLimit
            ? budgetSafeRecommendations.filter((model) => isByokModelAgentProbeVerified(model))
            : budgetSafeRecommendations;
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
        renderByokCatalogWarnings(println, discovered.warnings);
        if (recommendedEntries.length === 0) {
            println('    \x1b[33mNenhum modelo atende aos filtros. Tente remover filtros ou rode /byok models refresh.\x1b[0m\n');
            renderEmptyByokFilterDiagnostics(println, modelList, filters, runtimeBudget);
            if (filters.avoidLowLimit) renderSafeRecommendationEvidenceDiagnostics(println, budgetSafeRecommendations);
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
            println(`       \x1b[90m${renderByokRecommendationActionHint(entry.model)}\x1b[0m`);
            index += 1;
        }
        println('\n  \x1b[90mA probe agent é a live fake descartável do terminal: valida streaming/tool/ask_user antes de trocar a sessão viva. Use /byok use <perfil> para mudar provider e /byok model <id> para mudar só o modelo ativo.\x1b[0m\n');
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
            printByokSdkSessionBoundaryHint(println);
            println('');
            return;
        }
        if (!profiles.some((profile) => profile.name === target)) {
            println(`  \x1b[31mPerfil BYOK não encontrado: ${target}. Veja /byok profiles.\x1b[0m\n`);
            return;
        }
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        clearRuntimeSelectors();
        process.env['COPILOT_BYOK_PROFILE'] = target;
        await renderStatus(readTerminalByokProjection(), println);
        return;
    }

    if (sub === 'model') {
        const model = normalizeArg(rest.join(' '));
        if (!model) {
            println('  \x1b[31mUso: /byok model <model-id>\x1b[0m\n');
            return;
        }
        const previousSummary = projection.summary;
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        clearRuntimeSelectors(['COPILOT_BYOK_PROFILE']);
        process.env['COPILOT_BYOK_MODEL'] = model;
        await renderStatus(readTerminalByokProjection(), println);
        await tryApplyLiveByokModelSwitch(previousSummary, model, println);
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
        await renderStatus(readTerminalByokProjection(), println);
        return;
    }

    await renderStatus(projection, println);
}
