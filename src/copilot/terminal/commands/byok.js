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
import {
    buildCatalogRefreshEventBatch,
    buildCatalogRefreshStartedEvent,
    buildEligibilityEvaluatedEvent,
    buildModelGatewayPreKCompatibilityReport,
    buildRouteDecisionEvent,
    buildProbeCompletedEvent,
    classifyByokProviderFailure,
    clearByokProviderModelHealth,
    createDefaultModelGatewayCatalogImporters,
    createEnvSecretRegistry,
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    applyModelGatewayEligibilityToSnapshot,
    evaluateModelGatewayCatalogEligibility,
    explainModelGatewayCatalogEntry,
    explainModelGatewayProviderEntry,
    explainModelGatewayEligibilityDecision,
    flushByokProviderHealth,
    JsonModelGatewayCatalogStore,
    listByokProviderModelHealth,
    listProviderEndpointInventory,
    mirrorModelGatewayCatalogSnapshotToSqlite,
    mirrorByokProviderHealthToSqlite,
    readByokProviderHealthState,
    readByokProviderModelHealth,
    recommendCatalogDiffProbes,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
    recordModelGatewayRouteDecision,
    refreshModelGatewayCatalog,
    resolveProviderEndpointInventory,
    routeGatewayModels,
    runConfiguredByokAgentProbe,
    runConfiguredByokChatProbe,
    runConfiguredByokJsonProbe,
    runConfiguredByokStreamingProbe,
    runConfiguredByokVisionProbe,
    searchModelGatewayCatalogEntries,
    SqliteModelGatewayCatalogStore,
    summarizeCanonicalModelProjectionDiff,
    toOpenAIModelCatalogList,
} from '#copilot/model-gateway';

import { discoverConfiguredByokModelsFromEnv, readConfiguredByokProfilesFromEnv } from '#copilot/config';
import {
    listTerminalSdkSessionInventory,
    readTerminalByokGatewayProjectionFromEnv,
    readTerminalByokProjection,
    readTerminalRuntimeState,
    setTerminalModelProjection,
} from '../frontend/index.js';
import {
    classifyTerminalByokSdkBinding,
    evaluateTerminalByokProbeBudget,
    isSameTerminalByokProviderBoundary,
} from '../byok/index.js';

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
 * @property {{ emit?: (event: { type: string; [key: string]: unknown }) => unknown } | null} [eventBus]
 */

/**
 * @typedef {Awaited<ReturnType<typeof runConfiguredByokChatProbe>> | Awaited<ReturnType<typeof runConfiguredByokAgentProbe>> | Awaited<ReturnType<typeof runConfiguredByokStreamingProbe>> | Awaited<ReturnType<typeof runConfiguredByokJsonProbe>> | Awaited<ReturnType<typeof runConfiguredByokVisionProbe>>} ByokProbeResult
 * @typedef {'chat' | 'agent' | 'streaming' | 'json' | 'vision'} ByokProbeMode
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
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
 *   capabilities?: Record<string, unknown>;
 *   gatewayId?: string | null;
 *   providerModel?: string | null;
 *   confidence?: string | null;
 * } | undefined}
 */
function getByokModelMetadata(model) {
    return /** @type {{ byok?: { freeTier?: boolean | null; pricing?: { prompt?: number | null; completion?: number | null; request?: number | null }; rateLimits?: { maxRequestTokens?: number | null; tokensPerMinute?: number | null; requestsPerMinute?: number | null; dailyRequests?: number | null }; provider?: string | null; profile?: string | null; source?: string; profileFreeTier?: boolean | null; profileCostSource?: string | null; profileCostDetail?: string | null; inputModalities?: string[]; outputModalities?: string[]; supportsReasoning?: boolean; capabilities?: Record<string, unknown>; gatewayId?: string | null; providerModel?: string | null; confidence?: string | null } }} */ (model).byok;
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @returns {boolean}
 */
function supportsByokReasoning(model) {
    const meta = getByokModelMetadata(model);
    return meta?.supportsReasoning ?? Boolean(model.capabilities?.supports?.reasoningEffort);
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @returns {boolean}
 */
function supportsByokTools(model) {
    const meta = getByokModelMetadata(model);
    return booleanField(asRecord(meta?.capabilities), 'tools', booleanField(asRecord(model.capabilities?.supports), 'tools', true));
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @returns {boolean}
 */
function supportsByokStreaming(model) {
    const meta = getByokModelMetadata(model);
    return booleanField(asRecord(meta?.capabilities), 'streaming', booleanField(asRecord(model.capabilities?.supports), 'streaming', true));
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @returns {boolean}
 */
function supportsByokVision(model) {
    const meta = getByokModelMetadata(model);
    return (
        Boolean(model.capabilities?.supports?.vision) ||
        booleanField(asRecord(meta?.capabilities), 'vision', false) ||
        (Array.isArray(meta?.inputModalities) && meta.inputModalities.includes('image'))
    );
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
 * @param {Record<string, unknown>} record
 * @param {string} key
 * @param {boolean} fallback
 * @returns {boolean}
 */
function booleanField(record, key, fallback) {
    return typeof record[key] === 'boolean' ? record[key] : fallback;
}

/**
 * O catálogo terminal vem do SDK/provedores como `RuntimeModelInfo`; o policy engine trabalha com registros do
 * model-gateway. Esta ponte mantém a decisão inicial auditável sem exigir que cada provider exponha metadados perfeitos.
 * Para BYOK OpenAI-compatible, tools ficam habilitadas por padrão salvo negação explícita, porque a probe agent é a
 * etapa que deve derrubar um falso positivo antes da promoção para a sessão viva.
 *
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @returns {Record<string, any>}
 */
function toGatewayRouteCandidate(model) {
    const meta = getByokModelMetadata(model);
    const metaRecord = asRecord(meta);
    const metaCapabilities = asRecord(meta?.capabilities);
    const supportRecord = asRecord(model.capabilities?.supports);
    const providerId =
        optionalScalarString(meta?.provider) ??
        optionalScalarString(meta?.profile) ??
        optionalScalarString(model.vendor) ??
        'byok';
    const providerModel = optionalScalarString(meta?.providerModel) ?? model.id;
    const contextWindow =
        finitePositiveNumber(model.capabilities?.limits?.max_context_window_tokens) ??
        finitePositiveNumber(meta?.rateLimits?.maxRequestTokens) ??
        null;
    const inputModalities = Array.isArray(meta?.inputModalities) ? meta.inputModalities : [];
    const outputModalities = Array.isArray(meta?.outputModalities) ? meta.outputModalities : ['text'];
    const source = optionalScalarString(meta?.source) ?? 'terminal-catalog';
    const confidence =
        optionalScalarString(meta?.confidence) ??
        (source === 'remote' || source === 'provider' || source === 'provider-cache' || source === 'remote-cache'
            ? 'catalog'
            : 'static_seed');
    const cost = classifyByokModelCost(model);
    const freeCost = meta?.freeTier === true || cost.kind === 'profile-free';

    return {
        id: optionalScalarString(meta?.gatewayId) ?? `${providerId}:${providerModel}`,
        providerId,
        providerModel,
        displayName: model.displayName ?? model.name ?? providerModel,
        enabled: true,
        modalities: {
            input: inputModalities.length > 0 ? inputModalities : ['text'],
            output: outputModalities.length > 0 ? outputModalities : ['text'],
        },
        capabilities: {
            text: true,
            streaming: booleanField(metaCapabilities, 'streaming', true),
            tools: booleanField(metaCapabilities, 'tools', booleanField(supportRecord, 'tools', true)),
            forcedToolChoice: booleanField(metaCapabilities, 'forcedToolChoice', false),
            parallelToolCalls: booleanField(metaCapabilities, 'parallelToolCalls', false),
            structuredOutputs: booleanField(metaCapabilities, 'structuredOutputs', false),
            jsonMode: booleanField(metaCapabilities, 'jsonMode', false),
            jsonSchema: booleanField(metaCapabilities, 'jsonSchema', false),
            vision:
                Boolean(model.capabilities?.supports?.vision) ||
                booleanField(metaCapabilities, 'vision', false) ||
                inputModalities.includes('image'),
            reasoningEffort: supportsByokReasoning(model) || booleanField(metaCapabilities, 'reasoningEffort', false),
            reasoningBudgetTokens: booleanField(metaCapabilities, 'reasoningBudgetTokens', false),
            local: booleanField(metaCapabilities, 'local', providerId.includes('ollama')),
            privacy: booleanField(metaCapabilities, 'privacy', providerId.includes('ollama')),
            no_remote_secrets: booleanField(metaCapabilities, 'no_remote_secrets', providerId.includes('ollama')),
        },
        limits: {
            ...(contextWindow !== null ? { contextWindowTokens: contextWindow } : {}),
            ...(finitePositiveNumber(meta?.rateLimits?.maxRequestTokens) !== null
                ? { maxRequestTokens: finitePositiveNumber(meta?.rateLimits?.maxRequestTokens) }
                : {}),
            ...(finitePositiveNumber(meta?.rateLimits?.tokensPerMinute) !== null
                ? { tokensPerMinute: finitePositiveNumber(meta?.rateLimits?.tokensPerMinute) }
                : {}),
            ...(finitePositiveNumber(meta?.rateLimits?.requestsPerMinute) !== null
                ? { requestsPerMinute: finitePositiveNumber(meta?.rateLimits?.requestsPerMinute) }
                : {}),
            ...(finitePositiveNumber(meta?.rateLimits?.dailyRequests) !== null
                ? { dailyRequests: finitePositiveNumber(meta?.rateLimits?.dailyRequests) }
                : {}),
        },
        pricing: {
            ...(finitePositiveNumber(meta?.pricing?.prompt) !== null
                ? { inputUsdPerMillion: finitePositiveNumber(meta?.pricing?.prompt) }
                : freeCost
                  ? { inputUsdPerMillion: 0 }
                  : {}),
            ...(finitePositiveNumber(meta?.pricing?.completion) !== null
                ? { outputUsdPerMillion: finitePositiveNumber(meta?.pricing?.completion) }
                : freeCost
                  ? { outputUsdPerMillion: 0 }
                  : {}),
            ...(finitePositiveNumber(meta?.pricing?.request) !== null ? { requestUsd: finitePositiveNumber(meta?.pricing?.request) } : {}),
        },
        routing: {
            tier: cost.kind === 'free' || cost.kind === 'profile-free' ? 'free' : cost.kind === 'metered' ? 'paid' : 'balanced',
            useCases: [],
        },
        verification: {
            confidence,
            sources: [source],
        },
        provenance: {
            source,
            profile: metaRecord['profile'] ?? null,
        },
    };
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo[]} models
 * @returns {import('../../presentation/contracts/index.js').RuntimeModelInfo[]}
 */
function rankByokModels(models) {
    return models
        .map((model, index) => ({ model, index }))
        .sort((a, b) => scoreByokModel(b.model) - scoreByokModel(a.model) || a.index - b.index)
        .map((item) => item.model);
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
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
 * @returns {{ limit: number; freeOnly: boolean; meteredOnly: boolean; unknownCostOnly: boolean; provider: string | null; vision: boolean; reasoning: boolean; tools: boolean; streaming: boolean; probeVerified: boolean; minContext: number | null; minRequest: number | null; avoidLowLimit: boolean; forceRefresh: boolean; allProviders: boolean; grouped: boolean }}
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
        tools: false,
        streaming: false,
        probeVerified: false,
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
        } else if (['tools', 'tool', '--tools', '--tool'].includes(item)) {
            state.tools = true;
        } else if (['streaming', 'stream', '--streaming', '--stream'].includes(item)) {
            state.streaming = true;
        } else if (['probed', 'verified', 'probe-ok', 'agent-ok', '--probed', '--verified', '--probe-ok', '--agent-ok'].includes(item)) {
            state.probeVerified = true;
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
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
    if (filters.vision && !supportsByokVision(model)) return false;
    if (filters.reasoning && !supportsByokReasoning(model)) return false;
    if (filters.tools && !supportsByokTools(model)) return false;
    if (filters.streaming && !supportsByokStreaming(model)) return false;
    if (filters.probeVerified && !isByokModelAgentProbeVerified(model)) return false;
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
        filters.tools ? 'tools' : null,
        filters.streaming ? 'streaming' : null,
        filters.probeVerified ? 'probe-ok' : null,
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo[]} candidateModels
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo[]} budgetSafeModels
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo[]} modelList
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo[]} eligibleModels
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo[]} shortlistedModels
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
        /** @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model */
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo[]} models
 * @returns {{ model: import('../../presentation/contracts/index.js').RuntimeModelInfo; variants: string[] }[]}
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
 * @param {ReturnType<typeof parseRecommendArgs>} filters
 * @param {string[]} rawArgs
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @returns {ReturnType<typeof parseRecommendArgs>}
 */
function normalizeRouteDiscoveryFilters(filters, rawArgs, projection) {
    const activeOnly = rawArgs.some((item) => /^(active|current|--active|--current)$/iu.test(item));
    if (!activeOnly && projection.profiles.length > 0) {
        return { ...filters, allProviders: true };
    }
    return filters;
}

/**
 * @param {(text: string) => void} println
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @param {string[]} rest
 * @param {ByokCommandContext['eventBus']} [eventBus]
 * @returns {Promise<void>}
 */
async function renderByokModelRoute(println, projection, rest, eventBus = null) {
    const requestedProfile = optionalScalarString(rest[1]);
    const hasExplicitProfile = requestedProfile !== null && !requestedProfile.startsWith('-');
    const profileId = hasExplicitProfile ? requestedProfile : 'repo_agent';
    const routeArgs = hasExplicitProfile ? rest.slice(2) : rest.slice(1);
    const showRejected = routeArgs.some((item) => /^(rejected|show-rejected|--rejected|--show-rejected)$/iu.test(item));
    const strict = routeArgs.some((item) => /^(strict|verified|--strict|--verified)$/iu.test(item));
    const filters = normalizeRouteDiscoveryFilters(parseRecommendArgs(routeArgs), routeArgs, projection);
    const runtimeBudget = readCurrentByokRequestBudget();
    const discovered = await discoverByokCatalogForCommand(projection, filters);
    const catalogSnapshot = await readByokGatewayCatalogSnapshotForRouting();
    const modelList = rankByokModels(discovered.models.length > 0 ? discovered.models : projection.models).filter((model) =>
        matchesRecommendFilters(model, filters, runtimeBudget),
    );
    const candidates = modelList.map(toGatewayRouteCandidate);
    const filterLabel = renderByokFilterLabel(filters);

    println(`\n  \x1b[36mBYOK model route\x1b[0m`);
    println(
        `  \x1b[90mperfil=${profileId} · modo=${strict ? 'strict/probe-verificada' : 'pre-probe'} · fonte=${discovered.sourceLabel}${discovered.profileCount > 1 ? ` · perfis=${discovered.profileCount}` : ''}${discovered.endpoint ? ` · endpoint=${discovered.endpoint}` : ''} · filtros=${filterLabel || '-'}\x1b[0m\n`,
    );
    for (const error of discovered.errors.slice(0, 6)) {
        println(`  \x1b[33m  aviso: descoberta remota indisponível (${error}); usando catálogo disponível.\x1b[0m`);
    }
    renderByokCatalogWarnings(println, discovered.warnings);
    if (candidates.length === 0) {
        println('    \x1b[33mNenhum candidato encontrado para roteamento. Remova filtros, use active/current ou rode /models refresh.\x1b[0m\n');
        return;
    }

    let route;
    try {
        route = routeGatewayModels(candidates, profileId, {
            routeProfile: projection.summary.profile ?? null,
            excludeFailed: true,
            requireAgentProbeOk: strict,
            evaluateEligibility: true,
            routeOptions: catalogSnapshot?.routeOptions ?? [],
            accountOverlays: catalogSnapshot?.accountOverlays ?? [],
            secretRegistry: createEnvSecretRegistry(),
            eligibilityPolicy: {
                unknownAccessPolicy: strict ? 'block' : 'allow_probe',
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        println(`    \x1b[31mPerfil de rota inválido: ${message}\x1b[0m`);
        println('    \x1b[90mPerfis conhecidos: cheap_chat, code, repo_agent, tool_agent, json_extraction, vision, deep_reasoning, local_private.\x1b[0m\n');
        return;
    }
    const decisionEvent = buildRouteDecisionEvent({
        taskProfile: profileId,
        routeProfile: projection.summary.profile ?? null,
        mode: strict ? 'strict' : 'pre-probe',
        source: 'terminal.models.route',
        route,
        estimatedInputTokens: runtimeBudget?.estimatedRequestTokens ?? null,
        estimatedOutputTokens: null,
        estimatedCostUsd: null,
        failure: route.selected ? null : 'no_candidate_selected',
    });
    recordModelGatewayRouteDecision(decisionEvent);
    eventBus?.emit?.(decisionEvent);

    println(
        `  \x1b[90mdecision=${decisionEvent.decisionId} · admissão=${route.candidates.length}/${candidates.length} · rejeitados=${route.rejected.length} · fallback=${route.fallbackChain.length}\x1b[0m\n`,
    );
    if (!route.selected) {
        println(
            `    \x1b[33mNenhum modelo passou na política ${strict ? 'strict' : 'pre-probe'}. Use /models route ${profileId} --show-rejected para ver causas.\x1b[0m\n`,
        );
    } else {
        const model = route.selected.model;
        const reasons = route.selected.reasons.slice(0, 5).join(' · ') || 'sem motivo adicional';
        const health = route.selected.health
            ? `${renderByokHealthTag(route.selected.health)} · ${renderByokAgentProbeHealthTag(route.selected.health)}`
            : 'health=sem registro';
        println(`    \x1b[32mselecionado\x1b[0m ${model['providerModel'] ?? model['id']}  \x1b[90mprovider=${model['providerId']} · score=${route.selected.score}\x1b[0m`);
        println(`      \x1b[90m${reasons} · ${health}\x1b[0m`);
        println(
            `      \x1b[90mpróximo passo: /byok probe agent provider:${model['providerId']} model:${model['providerModel'] ?? model['id']} e então /byok use <perfil> + /byok model <id>.\x1b[0m`,
        );
    }

    if (route.fallbackChain.length > 0) {
        println(`\n  \x1b[90mfallback chain: ${route.fallbackChain.slice(0, 8).join(' -> ')}${route.fallbackChain.length > 8 ? ' -> ...' : ''}\x1b[0m`);
    }
    if (showRejected && route.rejected.length > 0) {
        println('\n  \x1b[90mRejeitados principais:\x1b[0m');
        for (const rejected of route.rejected.slice(0, 8)) {
            const model = rejected.model;
            println(
                `    \x1b[90m- ${model['providerModel'] ?? model['id']} (${model['providerId']}): ${rejected.rejectedReasons.join(', ') || 'sem causa'}\x1b[0m`,
            );
        }
    }
    println('');
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @returns {ReturnType<typeof readByokProviderModelHealth>}
 */
function readHealthForByokModel(model) {
    const meta = getByokModelMetadata(model);
    const exact = readByokProviderModelHealth({
        routeProfile: meta?.profile ?? null,
        providerId: meta?.provider ?? null,
        providerModel: model.id,
    });
    if (exact) return exact;
    return (
        listByokProviderModelHealth().find(
            (health) =>
                health.providerModel === model.id &&
                ((meta?.profile && health.routeProfile === meta.profile) ||
                    (meta?.provider && health.providerId === meta.provider)),
        ) ?? null
    );
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
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
        routeProfile: profile.name,
        providerId: profile.preset ?? profile.providerType,
        providerModel: profile.model,
    });
    if (exact) return exact;
    return (
        listByokProviderModelHealth().find(
            (health) =>
                Boolean(
                    profile.model &&
                        health.providerModel === profile.model &&
                        (health.routeProfile === profile.name || providerCandidates.includes(health.providerId)),
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
 * @param {ReturnType<typeof readByokProviderModelHealth>} health
 * @returns {string}
 */
function renderByokProbeHealthSummary(health) {
    const probes = health?.probes && typeof health.probes === 'object' ? Object.values(health.probes) : [];
    if (probes.length === 0) return 'probes=?';
    return probes
        .sort((a, b) => String(a.kind).localeCompare(String(b.kind)))
        .map((probe) => `${probe.kind}=${probe.status}${probe.providerAttempted ? '' : ':local'}${probe.count > 1 ? `x${probe.count}` : ''}`)
        .join(' ');
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @param {{ profileName?: string | null; preset?: string | null; providerType?: string | null }} source
 * @returns {import('../../presentation/contracts/index.js').RuntimeModelInfo}
 */
function withByokCatalogSource(model, source) {
    const meta = getByokModelMetadata(model) ?? {};
    const profileCostHint = readByokProfileCostHint(source.profileName);
    return /** @type {import('../../presentation/contracts/index.js').RuntimeModelInfo} */ ({
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo[]} primary
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo[]} fallback
 * @returns {import('../../presentation/contracts/index.js').RuntimeModelInfo[]}
 */
function chooseByokCatalogModels(primary, fallback) {
    return primary.length > 0 ? primary : fallback;
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
 * @returns {Promise<{ models: import('../../presentation/contracts/index.js').RuntimeModelInfo[]; sourceLabel: string; endpoint: string | null; errors: string[]; warnings: string[]; profileCount: number }>}
 */
async function discoverByokCatalogForCommand(projection, filters) {
    if (!filters.allProviders) {
        const discovered = await discoverConfiguredByokModelsFromEnv(process.env, { forceRefresh: filters.forceRefresh });
        const remoteAuthoritative = discovered.source === 'remote' || discovered.source === 'remote-cache';
        const gatewayModels = chooseByokCatalogModels(projection.gatewayModels, projection.models);
        const selectedModels = remoteAuthoritative
            ? chooseByokCatalogModels(discovered.models, gatewayModels)
            : chooseByokCatalogModels(gatewayModels, discovered.models);
        const sourceLabel =
            discovered.source === 'remote'
                ? 'provider'
                : discovered.source === 'remote-cache'
                  ? 'provider-cache'
                  : discovered.source === 'static-fallback'
                    ? 'model-gateway/static-fallback'
                    : 'model-gateway/static';
        return {
            models: selectedModels.map((model) =>
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
        const gateway = readTerminalByokGatewayProjectionFromEnv(env);
        const remoteAuthoritative = discovered.source === 'remote' || discovered.source === 'remote-cache';
        const profileModels = remoteAuthoritative
            ? chooseByokCatalogModels(discovered.models, gateway.gatewayModels)
            : chooseByokCatalogModels(gateway.gatewayModels, discovered.models);
        sourceCounts.set(discovered.source, (sourceCounts.get(discovered.source) ?? 0) + 1);
        if (!endpoint && discovered.endpoint) endpoint = discovered.endpoint;
        if (discovered.error) errors.push(`${profile.name}: ${discovered.error}`);
        warnings.push(...renderConfiguredByokCatalogWarnings(discovered, { profile: profile.name, provider: profile.preset ?? profile.providerType }));
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
 * @returns {Promise<Awaited<ReturnType<JsonModelGatewayCatalogStore['readSnapshot']>> | null>}
 */
async function readByokGatewayCatalogSnapshotForRouting() {
    try {
        return await new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH }).readSnapshot();
    } catch {
        return null;
    }
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
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
    if (meta?.source) tags.push(`source=${meta.source}`);
    if (meta?.confidence) tags.push(`confidence=${meta.confidence}`);
    const health = readHealthForByokModel(model);
    if (health) tags.push(renderByokHealthTag(health), renderByokAgentProbeHealthTag(health));
    const inputs = meta?.inputModalities?.length ? meta.inputModalities.join('+') : '';
    if (inputs && inputs !== 'text') tags.push(`in=${inputs}`);
    return tags.join(' · ');
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
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
 * @returns {import('../../presentation/contracts/index.js').RuntimeModelInfo[]}
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
    const gateway =
        projection.modelGateway ?? {
            source: 'unavailable',
            active: { modelId: null },
            diagnostics: {
                providerCount: 0,
                modelCount: projection.models.length,
                enabledModelCount: projection.models.length,
            },
        };
    println(
        `    gateway:       \x1b[33mproviders=${gateway.diagnostics.providerCount} · models=${gateway.diagnostics.modelCount} · enabled=${gateway.diagnostics.enabledModelCount} · source=${gateway.source}\x1b[0m`,
    );
    const gatewayActive = /** @type {{ modelId?: string | null }} */ (gateway.active);
    if (gatewayActive.modelId) {
        println(`    gatewayModel:  \x1b[33m${gatewayActive.modelId}\x1b[0m`);
    }
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
    println('  \x1b[90mUso: /byok | /byok reload | /byok providers | /byok profiles | /byok gateway catalog <refresh [provider]|diff|conflicts|sqlite|openai [sqlite]|explain <model>|search <query>|freshness [filtro]> | /byok gateway provider explain <provider> | /byok gateway routes [filtro] [n] | /byok gateway overlays [filtro] [n] | /byok gateway health sqlite | /byok gateway eligibility [strict] [filtro] [n] | /byok health [clear] | /byok probe [chat|agent|streaming|json|vision] [profile:<nome>] [model:<id>] | /byok probe shortlist [all-providers] [filtros] [n] [timeout:<ms>] | /byok models [catalog refresh [provider]|catalog diff|conflicts|all-providers|grouped|refresh|all|n] [free|metered|cost?] [provider:<nome>] [reasoning] [vision] [safe] [ctx>N] [maxReq>N] | /byok recommend [all-providers] [grouped] [filtros] [n] | /byok use <perfil|sdk> | /byok model <id> | /byok provider <preset> [model] [baseUrl] | /byok persist <sdk|profile|model|provider> | /byok env\x1b[0m\n');
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
            record.routeProfile ? `routeProfile=${record.routeProfile}` : null,
            record.providerId ? `providerId=${record.providerId}` : null,
            record.providerModel ? `providerModel=${record.providerModel}` : null,
            label,
            renderByokAgentProbeHealthTag(record),
            renderByokProbeHealthSummary(record),
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
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokProviderEndpointInventory(println, rest) {
    const selector = optionalScalarString(rest.find((item) => !/^(endpoints|endpoint|catalog|sources)$/iu.test(item)));
    const inventories = selector
        ? [resolveProviderEndpointInventory(selector)].filter((item) => item !== null)
        : listProviderEndpointInventory();

    println(`\n  \x1b[36mBYOK provider endpoints\x1b[0m (${inventories.length})`);
    println('  \x1b[90mInventário estático de coleta; não prova acesso nem capability. Use probes para promover confiança runtime.\x1b[0m\n');

    if (inventories.length === 0) {
        println(`    \x1b[33mProvider não encontrado no inventário: ${selector ?? '-'}.\x1b[0m\n`);
        return;
    }

    for (const inventory of inventories) {
        println(`    \x1b[33m${inventory.providerId}\x1b[0m  \x1b[90mkind=${inventory.providerKind} · adapter=${inventory.adapterId}\x1b[0m`);
        println(`      \x1b[90mbase=${inventory.baseUrls.slice(0, 3).join(' · ')}${inventory.baseUrls.length > 3 ? ' · ...' : ''}\x1b[0m`);
        const sources = inventory.modelCatalogSources
            .slice(0, 3)
            .map((source) => `${source.method} ${source.url} (${source.richness})`);
        println(`      \x1b[90mcatalog=${sources.join(' · ')}${inventory.modelCatalogSources.length > 3 ? ' · ...' : ''}\x1b[0m`);
        const runtime = inventory.runtimeEndpoints
            .slice(0, 4)
            .map((endpoint) => `${endpoint.method} ${endpoint.path}`);
        println(`      \x1b[90mruntime=${runtime.join(' · ')}${inventory.runtimeEndpoints.length > 4 ? ' · ...' : ''}\x1b[0m`);
        println(`      \x1b[90mselectors=${inventory.routeSelectors.join(',')}\x1b[0m`);
    }
    println('\n  \x1b[90mPróximo passo: catalog importers vão usar este mapa como fonte inicial antes de probes e seleção runtime.\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderByokGatewayPreKGate(println) {
    const report = buildModelGatewayPreKCompatibilityReport();
    println(`\n  \x1b[36mBYOK model-gateway pre-K gate\x1b[0m`);
    println(
        `  \x1b[90mstage=${report.stage} · ready=${report.ready ? 'sim' : 'nao'} · checks=${report.passed}/${report.total} · failed=${report.failed}\x1b[0m\n`,
    );
    for (const check of report.checks) {
        const mark = check.passed ? '\x1b[32m[x]\x1b[0m' : '\x1b[31m[ ]\x1b[0m';
        println(`    ${mark} \x1b[33m${check.id}\x1b[0m  \x1b[90mfaixa=${check.track} · ${check.summary}\x1b[0m`);
    }
    println('\n  \x1b[90mEste gate fecha a camada A-J; catálogo universal, SQLite e importers profundos continuam nas Faixas K+.\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @param {ByokCommandContext['eventBus']} [eventBus]
 * @param {string | null} [selector]
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogRefresh(println, eventBus = null, selector = null) {
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const allImporters = createDefaultModelGatewayCatalogImporters({ env: process.env });
    const normalizedSelector = optionalScalarString(selector)?.toLowerCase() ?? null;
    const importers = normalizedSelector
        ? allImporters.filter((importer) =>
              [importer.id, importer.providerId].some((value) => String(value ?? '').toLowerCase().includes(normalizedSelector)),
          )
        : allImporters;
    const refreshContext = {
        source: 'terminal-byok',
        storePath: store.filePath,
        importerIds: importers.map((importer) => importer.id),
    };
    println(`\n  \x1b[36mBYOK model-gateway catalog refresh\x1b[0m`);
    println(
        `  \x1b[90mstore=${store.filePath} · selector=${normalizedSelector ?? '-'} · importers=${importers.map((importer) => importer.id).join(',') || '-'} · schema=OpenAI+x_model_gateway\x1b[0m\n`,
    );
    if (importers.length === 0) {
        println('    \x1b[33mNenhum importer habilitado para este seletor. Configure rede/credenciais, remova o filtro ou use uma fonte pública disponível.\x1b[0m\n');
        return;
    }
    try {
        eventBus?.emit?.(buildCatalogRefreshStartedEvent(refreshContext));
        const result = await refreshModelGatewayCatalog({ store, importers });
        const refreshEvents = buildCatalogRefreshEventBatch({
            ...refreshContext,
            snapshot: result.snapshot,
            diff: result.diff,
            openai: result.openai,
        });
        for (const event of refreshEvents.events) eventBus?.emit?.(event);
        println(
            `    \x1b[32mrefresh concluído\x1b[0m  \x1b[90mprojections=${result.snapshot.projections.length} · openai=${result.openai.data.length} · runs=${result.snapshot.importRuns.length}\x1b[0m`,
        );
        println(
            `    \x1b[90mdiff: added=${result.diff.added.length} · removed=${result.diff.removed.length} · changed=${result.diff.changed.length}\x1b[0m`,
        );
        if (refreshEvents.completedEvent.changedKinds.length > 0) {
            println(`    \x1b[90mdiff kinds: ${refreshEvents.completedEvent.changedKinds.join(',')}\x1b[0m`);
        }
        const probeRecommendations = recommendCatalogDiffProbes({
            diff: result.diff,
            projections: result.snapshot.projections,
            limit: 5,
        });
        if (probeRecommendations.length > 0) {
            println(`    \x1b[90mprobe suggestions: ${probeRecommendations.length}\x1b[0m`);
            for (const recommendation of probeRecommendations) {
                println(
                    `      \x1b[90m? ${recommendation.key}: ${recommendation.probeKinds.join(',')} · ${recommendation.priority} · ${recommendation.reasons.slice(0, 4).join(',')}\x1b[0m`,
                );
                println(`        \x1b[90m${recommendation.commands[0]}\x1b[0m`);
            }
        }
        for (const id of result.diff.added.slice(0, 5)) println(`      \x1b[32m+\x1b[0m ${id}`);
        for (const id of result.diff.removed.slice(0, 5)) println(`      \x1b[31m-\x1b[0m ${id}`);
        for (const item of result.diff.changed.slice(0, 5)) {
            const kinds = Array.isArray(item.changedKinds) && item.changedKinds.length > 0 ? ` · ${item.changedKinds.join(',')}` : '';
            println(`      \x1b[33m~\x1b[0m ${item.key} (${item.changedFields.join(',')}${kinds})`);
        }
        println('\n  \x1b[90mSaída interoperável disponível como OpenAI Models list em memória; snapshot interno ficou em data/copilot/model-gateway/catalog.json.\x1b[0m\n');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        println(`    \x1b[31mrefresh falhou: ${message}\x1b[0m\n`);
    }
}

/**
 * @param {ReturnType<InstanceType<typeof JsonModelGatewayCatalogStore>['readSnapshot']> extends Promise<infer T> ? T : never} snapshot
 * @returns {Record<string, any> | null}
 */
function findLatestCatalogRefreshRun(snapshot) {
    return [...snapshot.importRuns]
        .reverse()
        .find((run) => run['providerId'] === 'model-gateway' && run['sourceId'] === 'catalog-refresh' && run['diff']) ?? null;
}

/**
 * @param {unknown} value
 * @returns {{ added: string[]; removed: string[]; changed: Array<{ key: string; changedFields: string[]; changedKinds: string[] }> }}
 */
function normalizeCatalogDiffForDisplay(value) {
    const record = asRecord(value);
    const changed = Array.isArray(record['changed'])
        ? record['changed'].filter((item) => item && typeof item === 'object').map((item) => {
              const changedRecord = /** @type {Record<string, any>} */ (item);
              return {
                  key: optionalScalarString(changedRecord['key']) ?? 'unknown',
                  changedFields: Array.isArray(changedRecord['changedFields'])
                      ? changedRecord['changedFields'].map(String)
                      : [],
                  changedKinds: Array.isArray(changedRecord['changedKinds'])
                      ? changedRecord['changedKinds'].map(String)
                      : [],
              };
          })
        : [];
    return {
        added: Array.isArray(record['added']) ? record['added'].map(String) : [],
        removed: Array.isArray(record['removed']) ? record['removed'].map(String) : [],
        changed,
    };
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogDiff(println) {
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    println(`\n  \x1b[36mBYOK model-gateway catalog diff\x1b[0m`);
    println(`  \x1b[90mstore=${store.filePath} · fonte=ultimo refresh persistido · sem rede\x1b[0m\n`);
    const snapshot = await store.readSnapshot();
    const latestRun = findLatestCatalogRefreshRun(snapshot);
    if (!latestRun) {
        println('    \x1b[33mNenhum diff persistido encontrado. Rode /byok gateway catalog refresh primeiro.\x1b[0m\n');
        return;
    }
    const diff = normalizeCatalogDiffForDisplay(latestRun['diff']);
    const summary = summarizeCanonicalModelProjectionDiff(diff);
    const recommendations = recommendCatalogDiffProbes({ diff, projections: snapshot.projections, limit: 8 });
    println(
        `    \x1b[90mrun=${latestRun['runId'] ?? '-'} · added=${summary.addedCount} · removed=${summary.removedCount} · changed=${summary.changedCount} · conflicts=${snapshot.conflicts.length}\x1b[0m`,
    );
    if (summary.changedKinds.length > 0) {
        println(`    \x1b[90mdiff kinds: ${summary.changedKinds.join(',')}\x1b[0m`);
    }
    for (const id of diff.added.slice(0, 8)) println(`      \x1b[32m+\x1b[0m ${id}`);
    for (const id of diff.removed.slice(0, 8)) println(`      \x1b[31m-\x1b[0m ${id}`);
    for (const item of diff.changed.slice(0, 8)) {
        const kinds = item.changedKinds.length > 0 ? ` · ${item.changedKinds.join(',')}` : '';
        println(`      \x1b[33m~\x1b[0m ${item.key} (${item.changedFields.join(',')}${kinds})`);
    }
    if (recommendations.length > 0) {
        println(`\n    \x1b[90mprobe suggestions: ${recommendations.length}\x1b[0m`);
        for (const recommendation of recommendations.slice(0, 5)) {
            println(`      \x1b[90m? ${recommendation.key}: ${recommendation.probeKinds.join(',')} · ${recommendation.reasons.slice(0, 4).join(',')}\x1b[0m`);
            println(`        \x1b[90m${recommendation.commands[0]}\x1b[0m`);
        }
    }
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogSqliteMirror(println) {
    const jsonStore = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const sqliteStore = new SqliteModelGatewayCatalogStore();
    println(`\n  \x1b[36mBYOK model-gateway catalog SQLite mirror\x1b[0m`);
    println(
        `  \x1b[90mjson=${jsonStore.filePath} · sqlite=copilot.sqlite · modo=mirror-redacted · sem rede\x1b[0m\n`,
    );
    const result = await mirrorModelGatewayCatalogSnapshotToSqlite({
        sourceStore: jsonStore,
        sqliteStore,
    });
    const counts = result.sqliteCounts;
    println(
        `    \x1b[32msnapshot espelhado no SQLite\x1b[0m  \x1b[90msource=${result.sqliteSnapshot.source} · projections=${counts.projections} · evidences=${counts.evidences} · routeOptions=${counts.routeOptions} · overlays=${counts.accountOverlays} · eligibility=${counts.modelEligibilityDecisions}\x1b[0m`,
    );
    println(
        `    \x1b[90mproviders=${counts.providerProjections} · providerEvidence=${counts.providerEvidences} · rawRefs=${counts.rawPayloadRefs} · conflicts=${counts.conflicts} · importRuns=${counts.importRuns}\x1b[0m`,
    );
    println(
        '    \x1b[90mJSON permanece como export/debug; SQLite agora materializa as camadas normalizadas para consultas futuras.\x1b[0m\n',
    );
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayHealthSqliteMirror(println) {
    const sqliteStore = new SqliteModelGatewayCatalogStore();
    println(`\n  \x1b[36mBYOK model-gateway runtime health SQLite mirror\x1b[0m`);
    println('  \x1b[90mfonte=byok-provider-health · destino=copilot.sqlite · runtime facts separados do catálogo\x1b[0m\n');
    const result = await mirrorByokProviderHealthToSqlite({ sqliteStore });
    println(
        `    \x1b[32mhealth runtime espelhado no SQLite\x1b[0m  \x1b[90mrecords=${result.records} · observations=${result.healthObservations} · probes=${result.probeResults} · run=${result.runId}\x1b[0m\n`,
    );
}

/**
 * @param {(text: string) => void} println
 * @param {{ sqlite?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogOpenAISchema(println, options = {}) {
    const useSqlite = options.sqlite === true;
    const jsonStore = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = useSqlite ? null : await jsonStore.readSnapshot();
    const openaiList = useSqlite
        ? await new SqliteModelGatewayCatalogStore().readOpenAIModelCatalogList()
        : toOpenAIModelCatalogList(snapshot?.projections ?? [], {
              providerProjections: snapshot?.providerProjections ?? [],
              eligibilityDecisions: snapshot?.modelEligibilityDecisions ?? [],
          });
    println(`\n  \x1b[36mBYOK model-gateway OpenAI schema\x1b[0m`);
    println(
        `  \x1b[90mfonte=${useSqlite ? 'sqlite' : 'json'} · object=${openaiList.object} · models=${openaiList.data.length} · extensão=x_model_gateway\x1b[0m\n`,
    );
    for (const model of openaiList.data.slice(0, 12)) {
        const gateway = asRecord(model.x_model_gateway);
        const providerId = optionalScalarString(gateway['provider_id']) ?? '-';
        const providerModel = optionalScalarString(gateway['provider_model']) ?? model.id;
        const eligibility = asRecord(gateway['eligibility']);
        const eligibilityStatus = optionalScalarString(eligibility['status']) ?? '-';
        println(
            `    \x1b[33m${model.id}\x1b[0m  \x1b[90mprovider=${providerId} · providerModel=${providerModel} · eligibility=${eligibilityStatus}\x1b[0m`,
        );
    }
    if (openaiList.data.length > 12) {
        println(`\n  \x1b[90mexibindo 12/${openaiList.data.length}; use JSON/SQLite store para export completo.\x1b[0m`);
    }
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string | null} selector
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogExplain(println, selector) {
    const normalizedSelector = optionalScalarString(selector);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    println(`\n  \x1b[36mBYOK model-gateway catalog explain\x1b[0m`);
    println(`  \x1b[90mstore=${store.filePath} · selector=${normalizedSelector ?? '-'} · runtime=nao\x1b[0m\n`);
    if (!normalizedSelector) {
        println('    \x1b[33mInforme um modelo, provider:model ou trecho do display name.\x1b[0m\n');
        return;
    }
    const snapshot = await store.readSnapshot();
    let explanation = explainModelGatewayCatalogEntry(snapshot, normalizedSelector);
    if (!explanation.found || !explanation.projection) {
        println(
            `    \x1b[33mModelo não encontrado no snapshot atual.\x1b[0m  \x1b[90mnext=${explanation.nextActions.join(',')}\x1b[0m\n`,
        );
        return;
    }
    try {
        const runtime = await new SqliteModelGatewayCatalogStore().readRuntimeHealthForModel({
            providerId: optionalScalarString(explanation.projection['providerId']),
            providerModel: optionalScalarString(explanation.projection['providerModel']),
            routeProfile: optionalScalarString(explanation.projection['routeProfile']),
        });
        explanation = explainModelGatewayCatalogEntry(snapshot, normalizedSelector, {
            runtimeHealthRecords: runtime.health ? [runtime.health] : [],
            runtimeProbeResults: runtime.probes,
        });
    } catch {
        // SQLite runtime mirror is optional for explain; the catalog view remains useful without it.
    }
    const projection = explanation.projection;
    if (!projection) {
        println('    \x1b[33mModelo não encontrado após juntar runtime health.\x1b[0m\n');
        return;
    }
    const eligibility = explanation.eligibility;
    println(`    \x1b[33m${explanation.key}\x1b[0m`);
    println(
        `      \x1b[90mdisplay=${optionalScalarString(projection['displayName']) ?? '-'} · lifecycle=${optionalScalarString(projection['lifecycle']) ?? '-'} · family=${optionalScalarString(projection['family']) ?? '-'}\x1b[0m`,
    );
    println(
        `      \x1b[90mroutes=${explanation.routeOptions.length} · overlays=${explanation.accountOverlays.length} · eligibility=${eligibility?.status ?? '-'} · openai.id=${explanation.openai?.id ?? '-'}\x1b[0m`,
    );
    println(
        `      \x1b[90mruntimeHealth=${explanation.runtimeHealth?.status ?? '-'} · runtimeProbes=${explanation.runtimeProbes.length}\x1b[0m`,
    );
    println(
        `      \x1b[90mmetadata: confidenceFields=${explanation.metadataCoverage.confidenceFields} · provenanceFields=${explanation.metadataCoverage.provenanceFields} · supported=${explanation.metadataCoverage.supportedParameters} · unsupported=${explanation.metadataCoverage.unsupportedParameters}\x1b[0m`,
    );
    for (const route of explanation.routeOptions.slice(0, 4)) {
        const policy = asRecord(route['normalizedPolicy']);
        println(
            `      \x1b[90mroute ${optionalScalarString(route['selectorKind']) ?? '-'}:${optionalScalarString(route['selectorSyntax']) ?? '-'} · layer=${optionalScalarString(policy['routeLayer']) ?? '-'} · wire=${optionalScalarString(policy['wireApi']) ?? '-'}\x1b[0m`,
        );
    }
    for (const overlay of explanation.accountOverlays.slice(0, 3)) {
        println(
            `      \x1b[90moverlay scope=${optionalScalarString(overlay['accountScope']) ?? 'default'} · secretRef=${optionalScalarString(overlay['secretRef']) ?? '-'} · enabled=${Array.isArray(overlay['enabledModels']) ? overlay['enabledModels'].length : 0} · blocked=${Array.isArray(overlay['blockedModels']) ? overlay['blockedModels'].length : 0}\x1b[0m`,
        );
    }
    if (eligibility) {
        println(
            `      \x1b[90meligibility ${eligibility.summary} · next=${eligibility.nextActions.slice(0, 4).join(',') || '-'}\x1b[0m`,
        );
    }
    println(`      \x1b[90mnext=${explanation.nextActions.slice(0, 6).join(',') || '-'}\x1b[0m\n`);
}

/**
 * @param {(text: string) => void} println
 * @param {string | null} selector
 * @returns {Promise<void>}
 */
async function renderByokGatewayProviderExplain(println, selector) {
    const normalizedSelector = optionalScalarString(selector);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    println(`\n  \x1b[36mBYOK model-gateway provider explain\x1b[0m`);
    println(`  \x1b[90mstore=${store.filePath} · selector=${normalizedSelector ?? '-'} · runtime=nao\x1b[0m\n`);
    if (!normalizedSelector) {
        println('    \x1b[33mInforme um provider id ou display name.\x1b[0m\n');
        return;
    }
    const explanation = explainModelGatewayProviderEntry(await store.readSnapshot(), normalizedSelector);
    if (!explanation.found) {
        println(`    \x1b[33mProvider não encontrado.\x1b[0m  \x1b[90mnext=${explanation.nextActions.join(',')}\x1b[0m\n`);
        return;
    }
    println(`    \x1b[33m${explanation.providerId}\x1b[0m`);
    println(
        `      \x1b[90msources=${explanation.sources.length} · providerEvidence=${explanation.providerEvidences.length} · models=${explanation.projections.length} · routes=${explanation.routeOptions.length} · overlays=${explanation.accountOverlays.length} · conflicts=${explanation.conflicts.length}\x1b[0m`,
    );
    println(
        `      \x1b[90mfreshness newest=${explanation.freshness.newestSourceAt ?? '-'} · oldest=${explanation.freshness.oldestSourceAt ?? '-'}\x1b[0m`,
    );
    if (explanation.providerProjection) {
        println(
            `      \x1b[90mdisplay=${optionalScalarString(explanation.providerProjection['displayName']) ?? '-'} · subject=${optionalScalarString(explanation.providerProjection['subjectProviderId']) ?? '-'}\x1b[0m`,
        );
    }
    for (const source of explanation.sources.slice(0, 4)) {
        println(
            `      \x1b[90msource ${optionalScalarString(source['id']) ?? '-'} · kind=${optionalScalarString(source['kind']) ?? '-'} · auth=${optionalScalarString(source['authMode']) ?? '-'} · refresh=${optionalScalarString(source['refreshPolicy']) ?? '-'}\x1b[0m`,
        );
    }
    const firstConflict = explanation.conflicts[0] ?? null;
    if (firstConflict) {
        println(
            `      \x1b[90mconflict ${optionalScalarString(firstConflict['projectionKey']) ?? '-'} · field=${optionalScalarString(firstConflict['fieldPath']) ?? '-'}\x1b[0m`,
        );
    }
    println(`      \x1b[90mnext=${explanation.nextActions.slice(0, 6).join(',') || '-'}\x1b[0m\n`);
}

/**
 * @param {string[]} rest
 * @returns {{ query: string; providerId: string | undefined; onlyEligible: boolean; requireTools: boolean; requireStreaming: boolean; requireReasoning: boolean; limit: number }}
 */
function parseByokGatewayCatalogSearchArgs(rest) {
    const numeric = rest.map((item) => Number(item)).find((value) => Number.isFinite(value) && value > 0);
    const providerToken = rest.find((item) => /^(?:provider|providerId)[:=]/iu.test(item));
    const providerId = providerToken ? providerToken.slice(providerToken.search(/[:=]/u) + 1).trim() || undefined : undefined;
    const query = rest
        .filter((item) => Number.isNaN(Number(item)))
        .filter((item) => !/^(eligible|tools|streaming|reasoning|provider[:=]|providerId[:=])/iu.test(item))
        .join(' ')
        .trim();
    return {
        query,
        providerId,
        onlyEligible: rest.some((item) => /^(eligible|only-eligible)$/iu.test(item)),
        requireTools: rest.some((item) => /^(tools|tool)$/iu.test(item)),
        requireStreaming: rest.some((item) => /^(streaming|stream)$/iu.test(item)),
        requireReasoning: rest.some((item) => /^(reasoning|raciocinio|raciocínio)$/iu.test(item)),
        limit: Math.min(Math.floor(numeric ?? 20), 100),
    };
}

/**
 * @param {Record<string, unknown>} item
 * @param {string | null} selector
 * @returns {boolean}
 */
function matchesGatewayCatalogRecordSelector(item, selector) {
    if (!selector) return true;
    const normalized = selector.toLowerCase();
    return [
        item['providerId'],
        item['providerModel'],
        item['routeProfile'],
        item['selectorKind'],
        item['selectorSyntax'],
        item['accountScope'],
        item['secretRef'],
        item['sourceId'],
        optionalScalarString(asRecord(item['normalizedPolicy'])['routeLayer']),
        optionalScalarString(asRecord(item['normalizedPolicy'])['wireApi']),
    ]
        .map((value) => optionalScalarString(value)?.toLowerCase() ?? '')
        .some((value) => value.includes(normalized));
}

/**
 * @param {string[]} rest
 * @returns {{ selector: string | null; limit: number }}
 */
function parseGatewayCatalogListArgs(rest) {
    const numeric = rest.map((item) => Number(item)).find((value) => Number.isFinite(value) && value > 0);
    const selector =
        rest
            .map(optionalScalarString)
            .find((item) => item && Number.isNaN(Number(item))) ?? null;
    return {
        selector,
        limit: Math.min(Math.floor(numeric ?? 30), 150),
    };
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogSearch(println, rest) {
    const args = parseByokGatewayCatalogSearchArgs(rest);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const results = searchModelGatewayCatalogEntries(snapshot, args);
    println(`\n  \x1b[36mBYOK model-gateway catalog search\x1b[0m`);
    println(
        `  \x1b[90mstore=${store.filePath} · query=${args.query || '-'} · provider=${args.providerId ?? '-'} · eligible=${args.onlyEligible ? 'sim' : 'nao'} · tools=${args.requireTools ? 'sim' : 'nao'} · results=${results.length}\x1b[0m\n`,
    );
    if (results.length === 0) {
        println('    \x1b[33mNenhum modelo encontrado para os filtros informados.\x1b[0m\n');
        return;
    }
    for (const result of results) {
        println(`    \x1b[33m${result.key}\x1b[0m  \x1b[90mscore=${result.score} · eligibility=${result.eligibilityStatus}\x1b[0m`);
        println(
            `      \x1b[90m${result.displayName} · routes=${result.routeOptionCount} · overlays=${result.accountOverlayCount} · matched=${result.matchedFields.slice(0, 4).join(',') || '-'}\x1b[0m`,
        );
    }
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayRoutes(println, rest) {
    const args = parseGatewayCatalogListArgs(rest);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const routes = snapshot.routeOptions.filter((route) => matchesGatewayCatalogRecordSelector(route, args.selector));
    println(`\n  \x1b[36mBYOK model-gateway routes\x1b[0m`);
    println(`  \x1b[90mstore=${store.filePath} · selector=${args.selector ?? '-'} · routes=${routes.length}/${snapshot.routeOptions.length}\x1b[0m\n`);
    if (routes.length === 0) {
        println('    \x1b[33mNenhuma route option encontrada para o filtro informado.\x1b[0m\n');
        return;
    }
    for (const route of routes.slice(0, args.limit)) {
        const policy = asRecord(route['normalizedPolicy']);
        println(
            `    \x1b[33m${optionalScalarString(route['providerId']) ?? '-'}:${optionalScalarString(route['providerModel']) ?? '-'}\x1b[0m  \x1b[90mrouteProfile=${optionalScalarString(route['routeProfile']) ?? 'default'} · selector=${optionalScalarString(route['selectorKind']) ?? '-'}:${optionalScalarString(route['selectorSyntax']) ?? '-'}\x1b[0m`,
        );
        println(
            `      \x1b[90mlayer=${optionalScalarString(policy['routeLayer']) ?? '-'} · wire=${optionalScalarString(policy['wireApi']) ?? '-'} · source=${optionalScalarString(route['sourceId']) ?? '-'} · confidence=${optionalScalarString(route['confidence']) ?? '-'}\x1b[0m`,
        );
    }
    if (routes.length > args.limit) println(`\n  \x1b[90mexibindo ${args.limit}/${routes.length}; use filtro ou limite numerico.\x1b[0m`);
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayOverlays(println, rest) {
    const args = parseGatewayCatalogListArgs(rest);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const overlays = snapshot.accountOverlays.filter((overlay) =>
        matchesGatewayCatalogRecordSelector(overlay, args.selector),
    );
    println(`\n  \x1b[36mBYOK model-gateway account overlays\x1b[0m`);
    println(
        `  \x1b[90mstore=${store.filePath} · selector=${args.selector ?? '-'} · overlays=${overlays.length}/${snapshot.accountOverlays.length} · secret-safe=sim\x1b[0m\n`,
    );
    if (overlays.length === 0) {
        println('    \x1b[33mNenhum account overlay encontrado para o filtro informado.\x1b[0m\n');
        return;
    }
    for (const overlay of overlays.slice(0, args.limit)) {
        const enabled = Array.isArray(overlay['enabledModels']) ? overlay['enabledModels'].length : 0;
        const blocked = Array.isArray(overlay['blockedModels']) ? overlay['blockedModels'].length : 0;
        println(
            `    \x1b[33m${optionalScalarString(overlay['providerId']) ?? '-'}\x1b[0m  \x1b[90mscope=${optionalScalarString(overlay['accountScope']) ?? 'default'} · secretRef=${optionalScalarString(overlay['secretRef']) ?? '-'} · source=${optionalScalarString(overlay['sourceId']) ?? '-'} · confidence=${optionalScalarString(overlay['confidence']) ?? '-'}\x1b[0m`,
        );
        println(`      \x1b[90menabled=${enabled} · blocked=${blocked} · redaction=${optionalScalarString(overlay['redactionStatus']) ?? '-'}\x1b[0m`);
    }
    if (overlays.length > args.limit) println(`\n  \x1b[90mexibindo ${args.limit}/${overlays.length}; use filtro ou limite numerico.\x1b[0m`);
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogConflicts(println) {
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    println(`\n  \x1b[36mBYOK model-gateway catalog conflicts\x1b[0m`);
    println(`  \x1b[90mstore=${store.filePath} · fonte=snapshot persistido · sem rede\x1b[0m\n`);
    const snapshot = await store.readSnapshot();
    if (snapshot.conflicts.length === 0) {
        println('    \x1b[32mNenhum conflito de evidência no snapshot atual.\x1b[0m\n');
        return;
    }
    for (const conflict of snapshot.conflicts.slice(0, 20)) {
        const record = asRecord(conflict);
        const projectionKey = optionalScalarString(record['projectionKey']) ?? 'projection?';
        const fieldPath = optionalScalarString(record['fieldPath']) ?? 'field?';
        const selected = optionalScalarString(record['selectedEvidenceId']) ?? '-';
        const conflicting = Array.isArray(record['conflictingEvidenceIds'])
            ? record['conflictingEvidenceIds'].map(String).slice(0, 4).join(',')
            : '-';
        println(`    \x1b[33m${projectionKey}\x1b[0m  \x1b[90mfield=${fieldPath} · selected=${selected} · conflicts=${conflicting}\x1b[0m`);
    }
    if (snapshot.conflicts.length > 20) {
        println(`\n  \x1b[90mexibindo 20/${snapshot.conflicts.length}; refine depois com /models explain <provider:model>.\x1b[0m`);
    }
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogFreshness(println, rest) {
    const args = parseGatewayCatalogListArgs(rest);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const sources = snapshot.sources
        .filter((source) => matchesGatewayCatalogRecordSelector(source, args.selector))
        .map((source) => ({
            source,
            at: optionalScalarString(source['updatedAt']) ?? optionalScalarString(source['createdAt']) ?? '-',
        }))
        .sort((a, b) => b.at.localeCompare(a.at));
    println(`\n  \x1b[36mBYOK model-gateway catalog freshness\x1b[0m`);
    println(`  \x1b[90mstore=${store.filePath} · selector=${args.selector ?? '-'} · sources=${sources.length}/${snapshot.sources.length}\x1b[0m\n`);
    if (sources.length === 0) {
        println('    \x1b[33mNenhuma source encontrada para o filtro informado.\x1b[0m\n');
        return;
    }
    for (const item of sources.slice(0, args.limit)) {
        const source = item.source;
        println(
            `    \x1b[33m${optionalScalarString(source['id']) ?? '-'}\x1b[0m  \x1b[90mprovider=${optionalScalarString(source['providerId']) ?? '-'} · kind=${optionalScalarString(source['kind']) ?? '-'} · auth=${optionalScalarString(source['authMode']) ?? '-'} · refresh=${optionalScalarString(source['refreshPolicy']) ?? '-'} · at=${item.at}\x1b[0m`,
        );
    }
    if (sources.length > args.limit) println(`\n  \x1b[90mexibindo ${args.limit}/${sources.length}; use filtro ou limite numerico.\x1b[0m`);
    println('');
}

/**
 * @param {Record<string, any>} projection
 * @param {string | null} selector
 * @returns {boolean}
 */
function matchesCatalogEligibilitySelector(projection, selector) {
    if (!selector) return true;
    const haystack = [
        projection['providerId'],
        projection['providerModel'],
        projection['displayName'],
        projection['family'],
    ]
        .map((value) => optionalScalarString(value)?.toLowerCase() ?? '')
        .join(' ');
    return haystack.includes(selector.toLowerCase());
}

/**
 * @param {string[]} rest
 * @returns {{ selector: string | null; limit: number; strict: boolean; persist: boolean }}
 */
function parseByokGatewayEligibilityArgs(rest) {
    const strict = rest.some((item) => /^(strict|block|bloquear|--strict)$/iu.test(item));
    const persist = rest.some((item) => /^(refresh|persist|write|sync|salvar|gravar)$/iu.test(item));
    const numeric = rest.map((item) => Number(item)).find((value) => Number.isFinite(value) && value > 0);
    const selector =
        rest
            .map(optionalScalarString)
            .find(
                (item) =>
                    item &&
                    !/^(strict|block|bloquear|--strict|refresh|persist|write|sync|salvar|gravar)$/iu.test(item) &&
                    Number.isNaN(Number(item)),
            ) ?? null;
    return {
        selector,
        limit: Math.min(Math.floor(numeric ?? 16), 100),
        strict,
        persist,
    };
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @param {ByokCommandContext['eventBus']} [eventBus]
 * @returns {Promise<void>}
 */
async function renderByokGatewayEligibility(println, rest, eventBus = null) {
    const args = parseByokGatewayEligibilityArgs(rest);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const secretRegistry = createEnvSecretRegistry();
    const evaluated = evaluateModelGatewayCatalogEligibility({
        snapshot,
        secretRegistry,
        policy: {
            unknownAccessPolicy: args.strict ? 'block' : 'allow_probe',
        },
    });
    if (args.persist) {
        await store.writeSnapshot(applyModelGatewayEligibilityToSnapshot(snapshot, evaluated.decisions, evaluated.run));
    }
    eventBus?.emit?.(
        buildEligibilityEvaluatedEvent({
            source: 'terminal-byok',
            storePath: store.filePath,
            run: evaluated.run,
            summary: evaluated.summary,
            persisted: args.persist,
        }),
    );
    const projectionKeys = new Set(
        snapshot.projections
            .filter((projection) => matchesCatalogEligibilitySelector(projection, args.selector))
            .map((projection) =>
                [
                    optionalScalarString(projection['providerId']) ?? 'unknown-provider',
                    optionalScalarString(projection['providerModel']) ?? 'unknown-model',
                    optionalScalarString(projection['routeProfile']) ?? 'default',
                ].join(':'),
            ),
    );
    const decisions = evaluated.decisions.filter((decision) =>
        projectionKeys.has(
            [
                optionalScalarString(decision['providerId']) ?? 'unknown-provider',
                optionalScalarString(decision['providerModel']) ?? 'unknown-model',
                optionalScalarString(decision['routeProfile']) ?? 'default',
            ].join(':'),
        ),
    );
    const explained = decisions.map(explainModelGatewayEligibilityDecision);
    const excludedCount = explained.filter((item) => item.status === 'excluded').length;
    const unknownCount = explained.filter((item) => item.status === 'unknown').length;
    const eligibleCount = explained.filter((item) => item.status === 'eligible').length;

    println(`\n  \x1b[36mBYOK model-gateway eligibility\x1b[0m`);
    println(
        `  \x1b[90mstore=${store.filePath} · selector=${args.selector ?? '-'} · policy=${args.strict ? 'strict/block_unknown' : 'allow_probe_unknown'} · persist=${args.persist ? 'sim' : 'nao'} · total=${explained.length} · eligible=${eligibleCount} · unknown=${unknownCount} · excluded=${excludedCount}\x1b[0m\n`,
    );
    if (snapshot.projections.length === 0) {
        println('    \x1b[33mNenhum snapshot de catálogo encontrado. Rode /byok gateway catalog refresh primeiro.\x1b[0m\n');
        return;
    }
    if (explained.length === 0) {
        println('    \x1b[33mNenhum modelo encontrado para o filtro informado.\x1b[0m\n');
        return;
    }
    if (args.persist) {
        const run = asRecord(evaluated.run);
        println(
            `    \x1b[32melegibilidade persistida\x1b[0m  \x1b[90mrun=${optionalScalarString(run['runId']) ?? '-'} · decisions=${evaluated.decisions.length}\x1b[0m`,
        );
    }
    for (const item of explained.slice(0, args.limit)) {
        const color = item.status === 'eligible' ? '\x1b[32m' : item.status === 'unknown' ? '\x1b[33m' : '\x1b[31m';
        println(`    ${color}${item.status}\x1b[0m  \x1b[33m${item.key}\x1b[0m`);
        println(`      \x1b[90m${item.summary} · disposition=${item.disposition}\x1b[0m`);
        if (item.hardExclusions.length > 0) println(`      \x1b[90mhard=${item.hardExclusions.slice(0, 4).join(',')}\x1b[0m`);
        if (item.softPenalties.length > 0) println(`      \x1b[90msoft=${item.softPenalties.slice(0, 4).join(',')}\x1b[0m`);
        if (item.nextActions.length > 0) println(`      \x1b[90mnext=${item.nextActions.slice(0, 4).join(',')}\x1b[0m`);
    }
    if (explained.length > args.limit) {
        println(`\n  \x1b[90mexibindo ${args.limit}/${explained.length}. Use filtro ou limite numerico para reduzir.\x1b[0m`);
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
 * @param {ByokProbeMode} mode
 * @param {ByokProbeResult} probe
 * @returns {Promise<boolean>}
 */
async function recordByokProbeHealth(mode, probe) {
    const healthIdentity = {
        routeProfile: probe.profile,
        providerId: probe.preset ?? probe.providerType,
        providerModel: probe.model,
    };
    const providerAttempted = probe.status !== 'admission-blocked';
    recordByokProviderModelProbeResult({
        ...healthIdentity,
        probeKind: mode,
        status: probe.status,
        ok: probe.ok,
        providerAttempted,
        message: probe.errors[0] ?? null,
        errorContext: probe.providerFailure?.errorContext ?? `byok_${mode}_probe`,
    });
    if (mode !== 'chat' && mode !== 'agent') return providerAttempted;
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
 * @param {ByokProbeMode} mode
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
    if (mode === 'vision') {
        const dominantColor = Reflect.get(probe, 'dominantColor');
        const attachmentMimeType = Reflect.get(probe, 'attachmentMimeType');
        const attachmentBytes = Reflect.get(probe, 'attachmentBytes');
        println(
            `${indent}vision:    proved=${yesNo(Reflect.get(probe, 'visionProved') === true)} · color=${valueOrDash(typeof dominantColor === 'string' ? dominantColor : null)} · fixture=${valueOrDash(typeof attachmentMimeType === 'string' ? attachmentMimeType : null)}${typeof attachmentBytes === 'number' ? `/${attachmentBytes} bytes` : ''}`,
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
 * @param {ByokProbeMode} mode
 * @param {ReturnType<typeof buildByokProbeSelection>} selection
 * @param {ByokCommandContext['eventBus']} [eventBus]
 * @returns {Promise<{ probe: ByokProbeResult; providerAttempted: boolean }>}
 */
async function runByokProbe(mode, selection, eventBus = null) {
    const probeRunner =
        mode === 'agent'
            ? runConfiguredByokAgentProbe
            : mode === 'streaming'
              ? runConfiguredByokStreamingProbe
              : mode === 'json'
                ? runConfiguredByokJsonProbe
                : mode === 'vision'
                  ? runConfiguredByokVisionProbe
                : runConfiguredByokChatProbe;
    const probe = await probeRunner({
        env: selection.env,
        ...(selection.model ? { model: selection.model } : {}),
        ...(selection.timeoutMs ? { timeoutMs: selection.timeoutMs } : {}),
        deps: {
            evaluateAdmission: evaluateTerminalByokProbeBudget,
            classifyProviderFailure: classifyByokProviderFailure,
        },
    });
    const providerAttempted = await recordByokProbeHealth(mode, probe);
    if (eventBus?.emit) {
        try {
            eventBus.emit(buildProbeCompletedEvent({ probeKind: mode, result: probe, providerAttempted }));
        } catch {
            // Observability is diagnostic and must not break the operator command path.
        }
    }
    return {
        probe,
        providerAttempted,
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
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
export async function cmdByok({ println, eventBus = null }, arg) {
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

    if (sub === 'gateway' || sub === 'gate' || sub === 'migration') {
        if (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(refresh|reload|sync|atualizar)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayCatalogRefresh(println, eventBus, rest[2] ?? null);
            return;
        }
        if (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(diff|changes|mudancas|mudanças)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayCatalogDiff(println);
            return;
        }
        if (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(conflicts|conflitos)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayCatalogConflicts(println);
            return;
        }
        if (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(freshness|fresh|fontes|sources)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayCatalogFreshness(println, rest.slice(2));
            return;
        }
        if (
            /^(catalog|catalogo)$/iu.test(rest[0] ?? '') &&
            /^(sqlite|sql|mirror|migrate|migrar|sync-sqlite)$/iu.test(rest[1] ?? '')
        ) {
            await renderByokGatewayCatalogSqliteMirror(println);
            return;
        }
        if (
            /^(catalog|catalogo)$/iu.test(rest[0] ?? '') &&
            /^(openai|schema|export|models-list)$/iu.test(rest[1] ?? '')
        ) {
            await renderByokGatewayCatalogOpenAISchema(println, {
                sqlite: rest.slice(2).some((item) => /^(sqlite|sql)$/iu.test(item)),
            });
            return;
        }
        if (
            /^(catalog|catalogo)$/iu.test(rest[0] ?? '') &&
            /^(explain|explicar|describe|show)$/iu.test(rest[1] ?? '')
        ) {
            await renderByokGatewayCatalogExplain(println, rest.slice(2).join(' ') || null);
            return;
        }
        if (
            /^(catalog|catalogo)$/iu.test(rest[0] ?? '') &&
            /^(search|buscar|find|filter|filtrar)$/iu.test(rest[1] ?? '')
        ) {
            await renderByokGatewayCatalogSearch(println, rest.slice(2));
            return;
        }
        if (/^(health|runtime-health|probes)$/iu.test(rest[0] ?? '') && /^(sqlite|sql|mirror|sync)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayHealthSqliteMirror(println);
            return;
        }
        if (/^(routes|route|rotas)$/iu.test(rest[0] ?? '')) {
            await renderByokGatewayRoutes(println, rest.slice(1));
            return;
        }
        if (/^(overlays|overlay|accounts|account|contas)$/iu.test(rest[0] ?? '')) {
            await renderByokGatewayOverlays(println, rest.slice(1));
            return;
        }
        if (
            /^(provider|providers|provedor|provedores)$/iu.test(rest[0] ?? '') &&
            /^(explain|explicar|describe|show)$/iu.test(rest[1] ?? '')
        ) {
            await renderByokGatewayProviderExplain(println, rest.slice(2).join(' ') || null);
            return;
        }
        if (/^(eligibility|elegibilidade|eligible|exclusion|exclusao|exclusão)$/iu.test(rest[0] ?? '')) {
            await renderByokGatewayEligibility(println, rest.slice(1), eventBus);
            return;
        }
        if (/^(endpoints|endpoint|catalog|catalogo|sources)$/iu.test(rest[0] ?? '')) {
            renderByokProviderEndpointInventory(println, rest.slice(1));
            return;
        }
        renderByokGatewayPreKGate(println);
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
                const result = await runByokProbe('agent', buildByokModelProbeSelection(model, timeoutMs), eventBus);
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
        /** @type {ByokProbeMode} */
        const mode = /^(agent|runtime|full)$/iu.test(rest[0] ?? '')
            ? 'agent'
            : /^(streaming|stream|delta|deltas)$/iu.test(rest[0] ?? '')
              ? 'streaming'
              : /^(json|structured)$/iu.test(rest[0] ?? '')
                ? 'json'
                : /^(vision|image|imagem|vlm)$/iu.test(rest[0] ?? '')
                  ? 'vision'
                : 'chat';
        const explicitMode = /^(chat|canary|agent|runtime|full|streaming|stream|delta|deltas|json|structured|vision|image|imagem|vlm)$/iu.test(
            rest[0] ?? '',
        );
        const selection = buildByokProbeSelection(explicitMode ? rest.slice(1) : rest);
        println(`\n  \x1b[36mBYOK ${mode} probe\x1b[0m`);
        println(
            `  \x1b[90mEscopo: sessão SDK descartável; não troca o dialog loop nem grava transcript live.${mode === 'chat' ? ' Chat nega tools.' : mode === 'agent' ? ' Agent exige tools representativas do terminal + ask_user com resposta sintética.' : mode === 'streaming' ? ' Streaming exige assistant.message_delta real; não degrada health de chat.' : mode === 'json' ? ' JSON exige payload parseável; não degrada health de chat.' : ' Vision anexa fixture PNG hermética e exige identificação visual; não degrada health de chat.'}${selection.profile ? ` profile=${selection.profile}` : ''}${selection.model ? ` model=${selection.model}` : ''}\x1b[0m`,
        );
        const { probe, providerAttempted } = await runByokProbe(mode, selection, eventBus);
        renderByokProbeResult(println, mode, probe, { providerAttempted });
        println(
            mode === 'agent'
                ? '  \x1b[90mAgent probe confirma a fronteira exigida pelo terminal: streaming + tools representativas + ask_user. Chat probe isolado continua disponível com /byok probe chat.\x1b[0m\n'
                : mode === 'streaming'
                  ? '  \x1b[90mStreaming probe separa resposta final de delta incremental. Falha no delta não implica que o chat seja inutilizável, mas a UX live ficaria cega.\x1b[0m\n'
                  : mode === 'json'
                    ? '  \x1b[90mJSON probe confirma saída estruturada parseável. Use junto com agent probe antes de promover modelo para fluxos automatizados.\x1b[0m\n'
                    : mode === 'vision'
                      ? '  \x1b[90mVision probe confirma que o provider aceitou attachment de imagem e interpretou a fixture. Use junto com agent/JSON quando o fluxo precisar automação multimodal.\x1b[0m\n'
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
        if (/^(health|chat-health|status)$/iu.test(rest[0] ?? '')) {
            renderByokHealth(println);
            return;
        }
        if (/^(endpoints|endpoint|catalog|sources)$/iu.test(rest[0] ?? '')) {
            renderByokProviderEndpointInventory(println, rest.slice(1));
            return;
        }
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
        if (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(refresh|reload|sync|atualizar)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayCatalogRefresh(println, eventBus, rest[2] ?? null);
            return;
        }
        if (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(diff|changes|mudancas|mudanças)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayCatalogDiff(println);
            return;
        }
        if (
            /^(conflicts|conflitos)$/iu.test(rest[0] ?? '') ||
            (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(conflicts|conflitos)$/iu.test(rest[1] ?? ''))
        ) {
            await renderByokGatewayCatalogConflicts(println);
            return;
        }
        if (/^(route|select|rank)$/iu.test(rest[0] ?? '')) {
            await renderByokModelRoute(println, projection, rest, eventBus);
            return;
        }
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
