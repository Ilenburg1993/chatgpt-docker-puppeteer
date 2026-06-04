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
import { join, resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import {
    buildCatalogRefreshEventBatch,
    buildCatalogRefreshStartedEvent,
    buildModelGatewaySelectionDecisionTrace,
    buildModelGatewayRuntimeProofCommands,
    buildModelGatewayRuntimeStandbyPlan,
    buildModelGatewayRuntimeSelectorPlan,
    compareModelGatewaySelectionAudits,
    buildEligibilityEvaluatedEvent,
    buildModelGatewayPreBuildReadinessReport,
    buildModelGatewayRouteCandidates,
    buildModelGatewayPreKCompatibilityReport,
    buildRouteDecisionEvent,
    buildProbeCompletedEvent,
    auditCatalogImporterSet,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    classifyByokProviderFailure,
    clearByokProviderModelHealth,
    createDefaultModelGatewayCatalogImporters,
    createEnvSecretRegistry,
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    applyModelGatewayEligibilityToSnapshot,
    evaluateModelGatewayCatalogEligibility,
    evaluateModelGatewayProviderEnvRequirements,
    explainModelGatewayRuntimeAutomationPolicySources,
    explainModelGatewayAccountLimitOverlays,
    explainModelGatewayCatalogEntry,
    explainModelGatewayProviderEntry,
    explainModelGatewayEligibilityDecision,
    explainModelGatewaySelectionComparison,
    flushAndMirrorByokProviderHealthToSqlite,
    flushByokProviderHealth,
    JsonModelGatewayCatalogStore,
    listByokProviderModelHealth,
    listModelGatewayCanonicalCommands,
    listProviderGatewayTraits,
    listProviderEndpointInventory,
    listProviderWireProbeMatrix,
    mirrorModelGatewayCatalogSnapshotToSqlite,
    MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON,
    planModelGatewayCatalogRefresh,
    planModelGatewayProbeBackoff,
    readByokProviderHealthState,
    readByokProviderModelHealth,
    recommendCatalogDiffProbes,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
    recordModelGatewayRouteDecision,
    persistModelGatewaySelectionDecisionTrace,
    refreshModelGatewayCatalog,
    resolveProviderGatewayTraits,
    resolveProviderEndpointInventory,
    renderModelGatewayLocalProviderOptInGuidance,
    renderModelGatewayCanonicalCommandLines,
    resolveModelGatewaySelectionPolicy,
    routeGatewayModels,
    runConfiguredByokAgentProbe,
    runConfiguredByokChatProbe,
    runConfiguredByokJsonProbe,
    runConfiguredByokStreamingProbe,
    runConfiguredByokVisionProbe,
    searchModelGatewayCatalogEntries,
    SqliteModelGatewayCatalogStore,
    summarizeModelGatewayAccountOverlays,
    summarizeModelGatewayLocalProviderOptInBlocks,
    summarizeModelGatewayProviderQuotaCapabilities,
    summarizeModelGatewayRuntimeAccountOverlays,
    summarizeModelGatewayRefreshLogText,
    summarizeModelGatewayProviderEnvRequirements,
    summarizeProviderWireProbeMatrix,
    summarizeCanonicalModelProjectionDiff,
    summarizeModelGatewayEligibilityDiff,
    toOpenAIModelCatalogList,
    DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH,
    listModelGatewayRuntimeAutomationPolicyPresets,
    readModelGatewayRuntimeAutomationEffectivePolicy,
    readModelGatewayRuntimeAutomationPolicy,
    readModelGatewayRuntimeAutomationPolicyFile,
    resolveModelGatewayRuntimeAutomationPolicyPreset,
    validateModelGatewayRuntimeAutomationPolicy,
    writeModelGatewayRuntimeAutomationPolicyFile,
} from '#copilot/model-gateway';

import {
    discoverConfiguredByokModelsFromEnv,
    readConfiguredByokModelDiscoveryCacheFromEnv,
    readConfiguredByokProfilesFromEnv,
} from '#copilot/config';
import {
    listTerminalSdkSessionInventory,
    readTerminalConfigProjection,
    readTerminalByokGatewayProjectionFromEnv,
    readTerminalByokProjection,
    readTerminalRuntimeState,
    setTerminalModelProjection,
} from '../frontend/index.js';
import {
    applyTerminalByokGatewayAutoEffects,
    buildTerminalByokGatewayAutoStatus,
    classifyTerminalByokSdkBinding,
    describeTerminalByokGatewayAutoEffect,
    evaluateTerminalByokProbeBudget,
    isSameTerminalByokProviderBoundary,
    parseTerminalByokGatewayAutoArgs,
    persistTerminalByokGatewayAutoEffectApplications,
    runTerminalByokGatewayPostTurnAutomation,
} from '../byok/index.js';
import { terminalThemeDivider, terminalThemeHeadline, terminalThemeRow, terminalThemeRows } from '../state/theme/index.js';

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
    return value ? 'sim' : 'não';
}

/**
 * @param {string | null} value
 * @returns {string}
 */
function valueOrDash(value) {
    return value && value.length > 0 ? value : '-';
}

/**
 * @param {Array<string | null | undefined | false>} parts
 * @returns {string}
 */
function joinTerminalSummary(parts) {
    return parts.filter((part) => typeof part === 'string' && part.length > 0).join(' · ');
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function renderByokSourceLabel(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '-';
    const labels = /** @type {Record<string, string>} */ ({
        'active-runtime': 'seleção viva',
        'provider-cache:model': 'cache do provedor',
        'model-gateway:model': 'catálogo normalizado',
        'provider-default': 'default do provedor',
        remote: 'catálogo remoto',
        'remote-cache': 'cache remoto',
        provider: 'catálogo do provedor',
        'provider-cache': 'cache do provedor',
        static: 'semente estática',
        'static-fallback': 'fallback estático',
        'terminal-catalog': 'catálogo do terminal',
        'model-gateway': 'model-gateway',
        env_compat: 'env compatível',
        runtime: 'execução observada',
        unavailable: 'indisponível',
    });
    return labels[normalized] ?? normalized.replace(/[_-]+/gu, ' ');
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function renderByokWireLabel(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '-';
    const labels = /** @type {Record<string, string>} */ ({
        completions: 'chat completions',
        responses: 'responses',
        openai_chat_completions: 'chat completions',
        openai_responses: 'responses',
    });
    return labels[normalized] ?? normalized.replace(/[_-]+/gu, ' ');
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function renderByokTokenLabel(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '-';
    const labels = /** @type {Record<string, string>} */ ({
        chat: 'chat',
        agent: 'agente',
        runtime: 'agente',
        full: 'agente',
        streaming: 'streaming',
        stream: 'streaming',
        json: 'JSON',
        structured: 'JSON',
        vision: 'visão',
        image: 'visão',
        imagem: 'visão',
        vlm: 'visão',
        health: 'saúde',
        'runtime-health': 'saúde runtime',
        probes: 'sondas',
        provider_explicit: 'provedor explícito',
        exact_model: 'modelo exato',
        local_provider_requires_explicit_request: 'provedor local exige pedido explícito',
        route_decision_ready: 'decisão de rota pronta',
        post_runtime_proved_better_route: 'rota provada em runtime venceu',
        consider_prefer_runtime_proved_policy: 'considerar política que prefere prova runtime',
        require_runtime_proof: 'exigir prova runtime',
        metadata_first: 'metadados primeiro',
        prefer_runtime_proved: 'preferir rota provada',
        allow_probe_unknown: 'permitir sonda quando acesso é desconhecido',
        block_unknown: 'bloquear acesso desconhecido',
        strict_access_only: 'somente acesso confirmado',
        terminal: 'terminal',
        runtime_health: 'saúde runtime',
        authenticated_account_api: 'API autenticada da conta',
        authenticated_catalog: 'catálogo autenticado',
        probe_failed: 'sonda falhou',
        account: 'conta/key',
        catalog: 'catálogo',
        rate_limited: 'limitado por taxa',
        quota: 'quota',
        credits: 'créditos',
        'rate-limit': 'limite de taxa',
        'provider.timeout': 'timeout do provedor',
        ok: 'ok',
        failed: 'falhou',
        pass: 'ok',
        blocked: 'bloqueado',
        'admission-blocked': 'bloqueado na admissão',
        ready: 'pronto',
        deferred: 'adiado',
    });
    return labels[normalized] ?? normalized.replace(/[_-]+/gu, ' ');
}

/**
 * @param {string[]} values
 * @returns {string}
 */
function renderByokTokenList(values) {
    return values.map(renderByokTokenLabel).join(', ');
}

/**
 * @param {unknown} seconds
 * @returns {string}
 */
function formatTerminalDurationSeconds(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '-';
    if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * @param {boolean | undefined} value
 * @returns {string}
 */
function yesNoPlain(value) {
    return value === true ? 'sim' : value === false ? 'nao' : '-';
}

/**
 * Explica a fronteira entre seletor BYOK e sessão SDK viva. Provider/profile vivem no contrato de criação/retomada de
 * sessão; `/restart` reinicia apenas a conversa e não pode ser narrado como troca de provider.
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
        terminalThemeRow(
            'Próximo',
            `${prefix} Troca de provedor/perfil entra no próximo boot: /session sdk next new.`,
        ),
    );
    println(
        terminalThemeRow(
            'Conversa',
            '/restart reinicia só a conversa; não troca o provedor da sessão viva.',
            { role: 'command' },
        ),
    );
    println(
        terminalThemeRow('Modelo vivo', '/byok model <id> só atua na sessão viva se o provedor/perfil já coincidem.', {
            role: 'command',
        }),
    );
}

/**
 * Troca modelo no runtime vivo apenas quando o handle SDK atual já nasceu com o mesmo provedor BYOK.
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
        println(terminalThemeRow('Sessão viva', `não inspecionada · ${message}; seleção fica para o próximo boot`, { role: 'warn' }));
        return;
    }
    if (!inventory.currentSessionId || !isSameTerminalByokProviderBoundary(summary, inventory.persistedByokBinding)) {
        println(
            terminalThemeRow(
                'Troca modelo',
                'sessão atual usa outro provedor/perfil; modelo preparado para o próximo boot, sem troca cruzada na conversa viva',
                { role: 'warn' },
            ),
        );
        return;
    }
    try {
        setTerminalModelProjection(model);
        println(terminalThemeRow('Modelo vivo', `solicitado ${model}`, { role: 'success' }));
        println(terminalThemeRow('Confirmar', 'provedor/perfil preservados; confira modelo efetivo no próximo turno/evento', { role: 'muted' }));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        println(
            terminalThemeRow(
                'Troca modelo',
                `falhou na sessão viva · ${message}; seleção fica pronta para o próximo boot`,
                { role: 'warn' },
            ),
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
 *   providerOwner?: string | null;
 * } | undefined}
 */
function getByokModelMetadata(model) {
    return /** @type {{ byok?: { freeTier?: boolean | null; pricing?: { prompt?: number | null; completion?: number | null; request?: number | null }; rateLimits?: { maxRequestTokens?: number | null; tokensPerMinute?: number | null; requestsPerMinute?: number | null; dailyRequests?: number | null }; provider?: string | null; profile?: string | null; source?: string; profileFreeTier?: boolean | null; profileCostSource?: string | null; profileCostDetail?: string | null; inputModalities?: string[]; outputModalities?: string[]; supportsReasoning?: boolean; capabilities?: Record<string, unknown>; gatewayId?: string | null; providerModel?: string | null; confidence?: string | null; providerOwner?: string | null } }} */ (model).byok;
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
 * @param {Record<string, any>} candidate
 * @returns {string}
 */
function gatewayRouteCandidateModelKey(candidate) {
    return [
        optionalScalarString(candidate['providerId']) ?? 'unknown-provider',
        optionalScalarString(candidate['providerModel']) ?? 'unknown-model',
    ].join(':');
}

/**
 * @param {Record<string, any>[]} candidates
 * @param {Record<string, any> | null} catalogSnapshot
 * @returns {Record<string, any>[]}
 */
function enrichGatewayRouteCandidatesWithRouteOptions(candidates, catalogSnapshot) {
    if (!catalogSnapshot) return candidates;
    const routeCandidates = buildModelGatewayRouteCandidates({
        projections: Array.isArray(catalogSnapshot['projections']) ? catalogSnapshot['projections'] : [],
        routeOptions: Array.isArray(catalogSnapshot['routeOptions']) ? catalogSnapshot['routeOptions'] : [],
        includeProjectionOnly: false,
    });
    if (routeCandidates.length === 0) return candidates;
    const routeCandidatesByModel = new Map();
    for (const routeCandidate of routeCandidates) {
        const key = gatewayRouteCandidateModelKey(routeCandidate);
        const existing = routeCandidatesByModel.get(key) ?? [];
        existing.push(routeCandidate);
        routeCandidatesByModel.set(key, existing);
    }
    return candidates.flatMap((candidate) => {
        const matches = routeCandidatesByModel.get(gatewayRouteCandidateModelKey(candidate)) ?? [];
        if (matches.length === 0) return [candidate];
        return matches.map(/** @param {Record<string, any>} routeCandidate */ (routeCandidate) => ({
            ...candidate,
            routeProfile: routeCandidate['routeProfile'],
            selectorKind: routeCandidate['selectorKind'],
            selectorSyntax: routeCandidate['selectorSyntax'],
            routeOptionRef: routeCandidate['routeOptionRef'],
            routeOptionRefs: routeCandidate['routeOptionRefs'],
            normalizedPolicy: routeCandidate['normalizedPolicy'],
            routeTraits: routeCandidate['routeTraits'],
            routing: {
                ...(asRecord(candidate['routing'])),
                ...(asRecord(routeCandidate['routing'])),
            },
            provenance: {
                ...(asRecord(candidate['provenance'])),
                ...(asRecord(routeCandidate['provenance'])),
                candidateSource: 'terminal_catalog_route_option',
            },
        }));
    });
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
    if (meta?.freeTier === true) return { kind: 'free', label: 'gratuito' };
    if (meta?.freeTier === false) return { kind: 'metered', label: 'pago/medido' };
    if (meta?.profileFreeTier === true) return { kind: 'profile-free', label: 'gratuito pelo perfil' };
    return { kind: 'unknown', label: 'custo desconhecido' };
}

/**
 * @param {string | null | undefined} profileName
 * @returns {string}
 */
function renderByokProfileCostTag(profileName) {
    const hint = readByokProfileCostHint(profileName);
    if (hint.profileFreeTier !== true) return '';
    const rawDetail = hint.profileCostDetail ? String(hint.profileCostDetail).trim() : '';
    const detail = rawDetail && rawDetail !== 'true' ? `(${rawDetail.slice(0, 40)})` : '';
    return ` · custo perfil gratuito${detail}`;
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
            label: `chat real falhou (${formatByokHealthAge(health.lastFailureAt)}); trocar modelo/provedor ou testar novamente`,
        };
    }
    const meta = getByokModelMetadata(model);
    const limit = meta?.rateLimits?.maxRequestTokens ?? meta?.rateLimits?.tokensPerMinute ?? null;
    if (limit !== null && runtimeBudget !== null && runtimeBudget.estimatedRequestTokens > limit) {
        return {
            level: 'blocked',
            label: `bloqueado para contexto atual (${runtimeBudget.estimatedRequestTokens}/${limit} tokens); use /compact, sessão fresca ou provedor maior`,
        };
    }
    if (limit !== null && limit < BYOK_LOW_REQUEST_TOKEN_LIMIT) {
        return {
            level: 'blocked',
            label: `baixo para turno real (${limit} tokens); use sessão fresca, prompt mínimo ou outro provedor`,
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
 * @returns {{ limit: number; activeOnly: boolean; freeOnly: boolean; meteredOnly: boolean; unknownCostOnly: boolean; provider: string | null; vision: boolean; reasoning: boolean; tools: boolean; streaming: boolean; probeVerified: boolean; minContext: number | null; minRequest: number | null; avoidLowLimit: boolean; forceRefresh: boolean; allProviders: boolean; grouped: boolean }}
 */
function parseRecommendArgs(rest) {
    const state = {
        limit: DEFAULT_BYOK_RECOMMEND_DISPLAY_LIMIT,
        activeOnly: false,
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
        } else if (['active', 'current', '--active', '--current'].includes(item)) {
            state.activeOnly = true;
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
 * @param {string | null | undefined} provider
 * @returns {boolean}
 */
function matchesByokProviderFilter(model, provider) {
    if (!provider) return true;
    const meta = getByokModelMetadata(model);
    const haystack = [meta?.provider, meta?.profile, meta?.source, model.id].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(provider.toLowerCase());
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
    if (!matchesByokProviderFilter(model, filters.provider)) return false;
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
        filters.allProviders ? 'todos os perfis' : null,
        filters.grouped ? 'agrupado' : null,
        filters.activeOnly ? 'ativo' : null,
        filters.provider ? `provedor:${filters.provider}` : null,
        filters.freeOnly ? 'gratuito' : null,
        filters.meteredOnly ? 'pago/medido' : null,
        filters.unknownCostOnly ? 'custo desconhecido' : null,
        filters.reasoning ? 'raciocínio' : null,
        filters.vision ? 'visão' : null,
        filters.tools ? 'tools' : null,
        filters.streaming ? 'streaming' : null,
        filters.probeVerified ? 'sonda ok' : null,
        filters.avoidLowLimit ? 'modo seguro' : null,
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
    return profile ?? provider ?? 'provedor?';
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
    const overflow = variants.length > visible.length ? ` · +${variants.length - visible.length}` : '';
    return `${visible.join(' | ')}${overflow}`;
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
 * @param {string[]} rawArgs
 * @returns {boolean}
 */
function routeArgsRequestActiveProjection(rawArgs) {
    return rawArgs.some((item) => /^(active|current|--active|--current)$/iu.test(item));
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @returns {boolean}
 */
function activeProjectionSuggestsLocalProvider(projection) {
    const summary = projection.summary;
    return [summary.profile, summary.preset, summary.providerType, summary.baseUrl]
        .filter(Boolean)
        .some((value) => /\bollama(?:-local)?\b|localhost|127\.0\.0\.1|0\.0\.0\.0/iu.test(String(value)));
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @returns {import('../../presentation/contracts/index.js').RuntimeModelInfo | null}
 */
function buildActiveByokProjectionModel(projection) {
    const summary = projection.summary;
    const activeModel = optionalScalarString(summary.model);
    if (!activeModel) return null;
    const provider =
        optionalScalarString(summary.preset) ??
        optionalScalarString(summary.providerType) ??
        optionalScalarString(summary.profile) ??
        'byok';
    const existing = [...projection.gatewayModels, ...projection.models].find((model) => {
        const meta = getByokModelMetadata(model);
        const providerMatch = [meta?.provider, meta?.profile, meta?.source, asRecord(model)['vendor']]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(provider.toLowerCase()));
        const modelMatch = model.id === activeModel || optionalScalarString(meta?.providerModel) === activeModel;
        return providerMatch && modelMatch;
    });
    if (existing) {
        return withByokCatalogSource(existing, {
            profileName: optionalScalarString(summary.profile),
            preset: optionalScalarString(summary.preset),
            providerType: optionalScalarString(summary.providerType),
        });
    }
    const contextWindowTokens = finitePositiveNumber(summary.capabilities?.contextWindowTokens);
    const vision = Boolean(summary.capabilities?.vision);
    const reasoningEffort = Boolean(summary.capabilities?.reasoningEffort);
    return /** @type {import('../../presentation/contracts/index.js').RuntimeModelInfo} */ ({
        id: activeModel,
        name: activeModel,
        displayName: activeModel,
        vendor: provider,
        capabilities: {
            supports: {
                reasoningEffort,
                vision,
                tools: true,
                streaming: true,
            },
            limits: {
                ...(contextWindowTokens !== null ? { max_context_window_tokens: contextWindowTokens } : {}),
            },
        },
        byok: {
            provider,
            profile: optionalScalarString(summary.profile) ?? provider,
            providerModel: activeModel,
            source: 'active-runtime',
            confidence: 'runtime',
            supportsReasoning: reasoningEffort,
            inputModalities: vision ? ['text', 'image'] : ['text'],
            outputModalities: ['text'],
            capabilities: {
                tools: true,
                streaming: true,
                vision,
                reasoningEffort,
            },
        },
    });
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @returns {import('../../presentation/contracts/index.js').RuntimeModelInfo[]}
 */
function activeByokProjectionModelList(projection) {
    const model = buildActiveByokProjectionModel(projection);
    return model ? [model] : [];
}

/**
 * @param {{ rejected?: Array<{ rejectedReasons?: string[] }> }} route
 * @returns {boolean}
 */
function hasLocalProviderExplicitRequestRejection(route) {
    return Array.isArray(route.rejected) && route.rejected.some((item) => item.rejectedReasons?.includes(MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON));
}

/**
 * @param {(text: string) => void} println
 * @param {string} profileId
 * @returns {void}
 */
function renderByokLocalProviderOptInHint(println, profileId) {
    println(`  \x1b[33m${renderModelGatewayLocalProviderOptInGuidance({ profileId })}\x1b[0m`);
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
    const activeLocalOptIn = routeArgsRequestActiveProjection(routeArgs) && activeProjectionSuggestsLocalProvider(projection);
    const runtimeBudget = readCurrentByokRequestBudget();
    const discovered = await discoverByokCatalogForCommand(projection, filters);
    const catalogSnapshot = await readByokGatewayCatalogSnapshotForRouting();
    const modelList = rankByokModels(discovered.models.length > 0 ? discovered.models : projection.models).filter((model) =>
        matchesRecommendFilters(model, filters, runtimeBudget),
    );
    const candidates = enrichGatewayRouteCandidatesWithRouteOptions(modelList.map(toGatewayRouteCandidate), catalogSnapshot);
    const filterLabel = renderByokFilterLabel(filters);

    println(`\n  \x1b[36mBYOK model route\x1b[0m`);
    println(
        `  \x1b[90mperfil ${profileId} · modo ${strict ? 'estrito/sonda verificada' : 'pré-sonda'} · fonte ${renderByokSourceLabel(discovered.sourceLabel)}${discovered.profileCount > 1 ? ` · perfis ${discovered.profileCount}` : ''}${discovered.endpoint ? ` · endpoint ${discovered.endpoint}` : ''} · filtros ${filterLabel || '-'}\x1b[0m\n`,
    );
    for (const error of discovered.errors.slice(0, 6)) {
        println(`  \x1b[33m  aviso: descoberta remota indisponível (${error}); usando catálogo disponível.\x1b[0m`);
    }
    renderByokCatalogWarnings(println, discovered.warnings);
    if (candidates.length === 0) {
        println('    \x1b[33mNenhum candidato encontrado para roteamento. Remova filtros, use active/current ou rode /byok models refresh.\x1b[0m\n');
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
            allowProviders: filters.provider ? [filters.provider] : [],
            allowLocalProviders: activeLocalOptIn,
            eligibilityPolicy: {
                unknownAccessPolicy: strict ? 'block' : 'allow_probe',
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        println(`    \x1b[31mPerfil de rota inválido: ${message}\x1b[0m`);
        println('    \x1b[90mPerfis conhecidos: cheap_chat, code, repo_agent, tool_agent, json_extraction, vision, deep_reasoning, local_private, local_private_strict.\x1b[0m\n');
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
    await persistByokRouteDecisionToSqlite(decisionEvent);
    eventBus?.emit?.(decisionEvent);

    println(
        `  \x1b[90mDecisão ${decisionEvent.decisionId} · admitidos ${route.candidates.length}/${candidates.length} · rejeitados ${route.rejected.length} · alternativas ${route.fallbackChain.length}\x1b[0m\n`,
    );
    if (!route.selected) {
        println(
            `    \x1b[33mNenhum modelo passou na política ${strict ? 'estrita' : 'pré-sonda'}. Use /byok models route ${profileId} --show-rejected para ver causas.\x1b[0m\n`,
        );
    } else {
        const model = route.selected.model;
        const reasons = route.selected.reasons.slice(0, 5).join(' · ') || 'sem motivo adicional';
        const health = route.selected.health
            ? `${renderByokHealthTag(route.selected.health)} · ${renderByokAgentProbeHealthTag(route.selected.health)}`
            : 'saúde sem registro';
        println(`    \x1b[32mselecionado\x1b[0m ${model['providerModel'] ?? model['id']}  \x1b[90mprovedor ${model['providerId']} · pontuação ${route.selected.score}\x1b[0m`);
        println(`      \x1b[90m${reasons} · ${health}\x1b[0m`);
        println(
            `      \x1b[90mpróximo passo: /byok probe agent provider:${model['providerId']} model:${model['providerModel'] ?? model['id']} e então /byok use <perfil> + /byok model <id>.\x1b[0m`,
        );
    }

    if (hasLocalProviderExplicitRequestRejection(route)) {
        renderByokLocalProviderOptInHint(println, profileId);
    }

    if (route.fallbackChain.length > 0) {
        println(`\n  \x1b[90mcadeia de alternativas: ${route.fallbackChain.slice(0, 8).join(' -> ')}${route.fallbackChain.length > 8 ? ' -> ...' : ''}\x1b[0m`);
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
    if (deltaSeconds < 60) return `${deltaSeconds}s atrás`;
    const deltaMinutes = Math.round(deltaSeconds / 60);
    if (deltaMinutes < 60) return `${deltaMinutes}min atrás`;
    const deltaHours = Math.round(deltaMinutes / 60);
    if (deltaHours < 48) return `${deltaHours}h atrás`;
    return `${Math.round(deltaHours / 24)}d atrás`;
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
    if (!health) return 'chat sem registro';
    if (isByokHealthCurrentlyFailed(health)) {
        const limit = health.lastResetAt
            ? ` · reset ${health.lastResetAt}`
            : health.lastRetryAfterSeconds
              ? ` · retry ${health.lastRetryAfterSeconds}s`
              : '';
        const failure = health.lastFailureKind ? `${renderByokTokenLabel(health.lastFailureKind)} · ` : '';
        return `chat falhou (${failure}${renderByokChatHealthEvidence(health.lastErrorContext)} · ${formatByokHealthAge(health.lastFailureAt)}${limit}${health.failureCount > 1 ? ` · x${health.failureCount}` : ''})`;
    }
    if (health.lastStatus !== 'ok') return 'chat sem registro';
    return `chat ok (${renderByokChatHealthEvidence(health.lastSuccessContext)} · ${formatByokHealthAge(health.lastSuccessAt)}${health.successCount > 1 ? ` · x${health.successCount}` : ''})`;
}

/**
 * @param {ReturnType<typeof readByokProviderModelHealth>} health
 * @returns {string}
 */
function renderByokAgentProbeHealthTag(health) {
    if (!health || !health.agentProbeStatus) return 'agente sem registro';
    if (isByokAgentProbeCurrentlyFailed(health)) {
        return `agente falhou (${formatByokHealthAge(health.lastAgentProbeFailureAt)}${health.agentProbeFailureCount > 1 ? ` · x${health.agentProbeFailureCount}` : ''})`;
    }
    return `agente ok (${formatByokHealthAge(health.lastAgentProbeSuccessAt)}${health.agentProbeSuccessCount > 1 ? ` · x${health.agentProbeSuccessCount}` : ''})`;
}

/**
 * @param {{ kind?: string; status?: string; providerAttempted?: boolean; count?: number }} probe
 * @returns {string}
 */
function renderByokProbeHealthItem(probe) {
    return `${renderByokTokenLabel(probe.kind)} ${renderByokTokenLabel(probe.status)}${probe.providerAttempted ? '' : ' local'}${probe.count && probe.count > 1 ? ` · x${probe.count}` : ''}`;
}

/**
 * @param {ReturnType<typeof readByokProviderModelHealth>} health
 * @returns {string[]}
 */
function renderByokProbeHealthSummaries(health) {
    const probes = health?.probes && typeof health.probes === 'object' ? Object.values(health.probes) : [];
    if (probes.length === 0) return ['probes sem registro'];
    const sorted = probes.sort((a, b) => String(a.kind).localeCompare(String(b.kind)));
    const capabilityKinds = new Set(['streaming', 'json', 'vision']);
    const protocolKinds = new Set(['live_ask_user', 'live_tool_protocol']);
    const capabilities = sorted.filter((probe) => capabilityKinds.has(String(probe.kind)));
    const protocol = sorted.filter((probe) => protocolKinds.has(String(probe.kind)));
    const other = sorted.filter((probe) => !capabilityKinds.has(String(probe.kind)) && !protocolKinds.has(String(probe.kind)));
    return [
        capabilities.length > 0 ? `capacidades ${capabilities.map(renderByokProbeHealthItem).join(' · ')}` : null,
        protocol.length > 0 ? `protocolo ${protocol.map(renderByokProbeHealthItem).join(' · ')}` : null,
        other.length > 0 ? `sondas ${other.map(renderByokProbeHealthItem).join(' · ')}` : null,
    ].filter((item) => item !== null);
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @param {{ profileName?: string | null; preset?: string | null; providerType?: string | null }} source
 * @returns {import('../../presentation/contracts/index.js').RuntimeModelInfo}
 */
function withByokCatalogSource(model, source) {
    const meta = getByokModelMetadata(model) ?? {};
    const profileCostHint = readByokProfileCostHint(source.profileName);
    const sourceProvider = source.preset ?? source.providerType ?? source.profileName ?? null;
    const providerScopedDiscoveryModel = ['remote', 'static'].includes(String(meta.source ?? ''));
    const shouldUseOperationalProvider = providerScopedDiscoveryModel && sourceProvider && !source.profileName;
    const provider = shouldUseOperationalProvider ? sourceProvider : meta.provider ?? sourceProvider;
    return /** @type {import('../../presentation/contracts/index.js').RuntimeModelInfo} */ ({
        ...model,
        byok: {
            ...meta,
            provider,
            providerOwner: shouldUseOperationalProvider ? meta.provider ?? null : meta.providerOwner ?? null,
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
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @returns {string}
 */
function byokCatalogModelIdentity(model) {
    const meta = getByokModelMetadata(model);
    return [
        optionalScalarString(meta?.provider) ?? optionalScalarString(meta?.profile) ?? 'byok',
        optionalScalarString(meta?.providerModel) ?? model.id,
    ]
        .join(':')
        .toLowerCase();
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo[]} models
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo[]} additions
 * @returns {number}
 */
function appendUniqueByokCatalogModels(models, additions) {
    const seen = new Set(models.map(byokCatalogModelIdentity));
    let added = 0;
    for (const model of additions) {
        const identity = byokCatalogModelIdentity(model);
        if (seen.has(identity)) continue;
        seen.add(identity);
        models.push(model);
        added += 1;
    }
    return added;
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
        const models = selectedModels.map((model) =>
            withByokCatalogSource(model, {
                profileName: projection.summary.profile,
                preset: projection.summary.preset,
                providerType: projection.summary.providerType,
            }),
        );
        if (filters.activeOnly) {
            appendUniqueByokCatalogModels(models, activeByokProjectionModelList(projection));
        }
        const sourceLabel =
            discovered.source === 'remote'
                ? 'provider'
                : discovered.source === 'remote-cache'
                  ? 'provider-cache'
                  : discovered.source === 'static-fallback'
                    ? 'model-gateway/static-fallback'
                    : 'model-gateway/static';
        return {
            models,
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
    if (filters.provider) {
        const gatewayFallbackModels = chooseByokCatalogModels(projection.gatewayModels, projection.models)
            .map((model) =>
                withByokCatalogSource(model, {
                    profileName: projection.summary.profile,
                    preset: projection.summary.preset,
                    providerType: projection.summary.providerType,
                }),
            )
            .filter((model) => matchesByokProviderFilter(model, filters.provider));
        const added = appendUniqueByokCatalogModels(models, gatewayFallbackModels);
        if (added > 0) sourceCounts.set('model-gateway-static', (sourceCounts.get('model-gateway-static') ?? 0) + added);
    }
    if (filters.activeOnly) {
        const added = appendUniqueByokCatalogModels(models, activeByokProjectionModelList(projection));
        if (added > 0) sourceCounts.set('active-runtime', (sourceCounts.get('active-runtime') ?? 0) + added);
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
 * @param {ReturnType<typeof buildRouteDecisionEvent>} decisionEvent
 * @returns {Promise<void>}
 */
async function persistByokRouteDecisionToSqlite(decisionEvent) {
    try {
        await new SqliteModelGatewayCatalogStore().writeRouteDecisionEvents([decisionEvent]);
    } catch {
        // Route decisions are still emitted and kept in-memory if the optional SQLite mirror is unavailable.
    }
}

/**
 * @param {Record<string, any>} snapshot
 * @param {Record<string, any>} diff
 * @param {number} limit
 * @returns {Parameters<typeof recommendCatalogDiffProbes>[0]}
 */
function buildByokProbeRecommendationInput(snapshot, diff, limit) {
    const eligibilityDecisions = Array.isArray(snapshot['modelEligibilityDecisions'])
        ? snapshot['modelEligibilityDecisions'].filter(asRecord)
        : [];
    return {
        diff,
        projections: Array.isArray(snapshot['projections']) ? snapshot['projections'].filter(asRecord) : [],
        eligibilityDecisions,
        requireEligibilityDecision: eligibilityDecisions.length > 0,
        limit,
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
    const owner = source.profile ? `perfil ${source.profile}` : source.provider ? `provedor ${source.provider}` : 'seleção ativa';
    const selector = source.profile ? ` profile:${source.profile}` : '';
    return [
        `${owner}: modelo configurado '${configuredModel.id}' nao apareceu no catalogo remoto atual. O terminal nao troca seletor silenciosamente; explore /byok models${selector ? ` all-providers${selector}` : ''} e valide um candidato com /byok probe agent${selector} model:<id> antes de /byok model <id>.`,
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
        tags.push(`hint gratuito ${detail}`);
    }
    tags.push(supportsByokReasoning(model) ? 'raciocínio' : 'raciocínio n/d');
    if (supportsByokReasoning(model) && !model.capabilities?.supports?.reasoningEffort) {
        tags.push('SDK sem flag de raciocínio');
    }
    tags.push(model.capabilities?.supports?.vision ? 'visão' : 'visão n/d');
    tags.push(`contexto ${model.capabilities?.limits?.max_context_window_tokens ?? 'n/a'}`);
    if (meta?.pricing && (meta.pricing.prompt !== null || meta.pricing.completion !== null || meta.pricing.request !== null)) {
        tags.push(`preço ${compactNumber(meta.pricing.prompt)}/${compactNumber(meta.pricing.completion)}`);
    }
    if (meta?.rateLimits?.maxRequestTokens) tags.push(`max req ${meta.rateLimits.maxRequestTokens}`);
    if (meta?.rateLimits?.tokensPerMinute) tags.push(`TPM ${meta.rateLimits.tokensPerMinute}`);
    if (meta?.rateLimits?.requestsPerMinute) tags.push(`RPM ${meta.rateLimits.requestsPerMinute}`);
    if (meta?.rateLimits?.dailyRequests) tags.push(`RPD ${meta.rateLimits.dailyRequests}`);
    if (meta?.provider) tags.push(`provedor ${meta.provider}`);
    if (meta?.profile) tags.push(`perfil ${meta.profile}`);
    if (meta?.source) tags.push(`fonte ${renderByokSourceLabel(meta.source)}`);
    if (meta?.confidence) tags.push(`confiança ${renderByokTokenLabel(meta.confidence)}`);
    const health = readHealthForByokModel(model);
    if (health) tags.push(renderByokHealthTag(health), renderByokAgentProbeHealthTag(health));
    const inputs = meta?.inputModalities?.length ? meta.inputModalities.join('+') : '';
    if (inputs && inputs !== 'text') tags.push(`entrada ${inputs}`);
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
    return `teste ${probe} · seleção ${selection}`;
}

/**
 * @param {(text: string) => void} println
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @param {string} [variantLabel='']
 * @returns {void}
 */
function renderByokModelCatalogRow(println, model, variantLabel = '') {
    println(terminalThemeRow('Modelo', model.id, { role: 'accent', width: 12 }));
    println(terminalThemeRow('Detalhes', `${renderModelTags(model)}${variantLabel}`, { width: 12 }));
}

/**
 * @param {(text: string) => void} println
 * @param {number} index
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @param {{ level: 'ok' | 'caution' | 'blocked'; label: string }} budget
 * @param {string} [variantLabel='']
 * @returns {void}
 */
function renderByokRecommendationRow(println, index, model, budget, variantLabel = '') {
    const role = budget.level === 'ok' ? 'success' : budget.level === 'caution' ? 'warn' : 'error';
    println(terminalThemeRow(`#${index}`, model.id, { role: 'accent', width: 8 }));
    println(terminalThemeRow('Detalhes', `${renderModelTags(model)}${variantLabel}`, { width: 8 }));
    println(terminalThemeRow('Orçamento', budget.label, { role, width: 8 }));
    println(terminalThemeRow('Ação', renderByokRecommendationActionHint(model), { role: 'command', width: 8 }));
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
        `  \x1b[31m  Bloqueio de saúde: seleção ativa com falha recente em ${failureScope}; catálogo disponível não equivale a execução saudável.\x1b[0m`,
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
        ? 'token bearer'
        : profile.auth.apiKeyConfigured
          ? 'chave API'
          : profile.auth.headersConfigured
            ? 'headers'
            : 'ausente';
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @param {ReturnType<typeof readTerminalByokProjection>['summary']} summary
 * @param {string} source
 * @returns {{
 *     source: string;
 *     modelId: string;
 *     reasoningEffort: boolean;
 *     sdkReasoningEffort: boolean;
 *     vision: boolean;
 *     contextWindowTokens: number;
 *     differsFromProviderDefault: boolean;
 * }}
 */
function buildByokStatusModelCapabilityProjection(model, summary, source) {
    const contextWindowTokens =
        finitePositiveNumber(model.capabilities?.limits?.max_context_window_tokens) ??
        summary.capabilities.contextWindowTokens;
    const reasoningEffort = supportsByokReasoning(model);
    const sdkReasoningEffort = Boolean(model.capabilities?.supports?.reasoningEffort);
    const vision = supportsByokVision(model);
    return {
        source,
        modelId: model.id,
        reasoningEffort,
        sdkReasoningEffort,
        vision,
        contextWindowTokens,
        differsFromProviderDefault:
            reasoningEffort !== summary.capabilities.reasoningEffort ||
            sdkReasoningEffort !== (summary.capabilities.sdkReasoningEffort ?? summary.capabilities.reasoningEffort) ||
            vision !== summary.capabilities.vision ||
            contextWindowTokens !== summary.capabilities.contextWindowTokens,
    };
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @returns {{
 *     source: string;
 *     modelId: string | null;
 *     reasoningEffort: boolean;
 *     sdkReasoningEffort: boolean;
 *     vision: boolean;
 *     contextWindowTokens: number;
 *     differsFromProviderDefault: boolean;
 * }}
 */
function resolveByokStatusCapabilities(projection) {
    const { summary } = projection;
    const cached = readConfiguredByokModelDiscoveryCacheFromEnv(process.env);
    const cachedModel = cached?.models.find((model) => model.id === summary.model) ?? null;
    if (cachedModel) {
        return buildByokStatusModelCapabilityProjection(cachedModel, summary, 'provider-cache:model');
    }
    const localModels = chooseByokCatalogModels(projection.gatewayModels, projection.models);
    const localModel = localModels.find((model) => model.id === summary.model) ?? null;
    if (localModel) {
        return buildByokStatusModelCapabilityProjection(localModel, summary, 'model-gateway:model');
    }
    return {
        source: 'provider-default',
        modelId: summary.model,
        reasoningEffort: summary.capabilities.reasoningEffort,
        sdkReasoningEffort: summary.capabilities.sdkReasoningEffort ?? summary.capabilities.reasoningEffort,
        vision: summary.capabilities.vision,
        contextWindowTokens: summary.capabilities.contextWindowTokens,
        differsFromProviderDefault: false,
    };
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderStatus(projection, println) {
    const { summary } = projection;
    const statusCapabilities = resolveByokStatusCapabilities(projection);
    println('');
    println(terminalThemeHeadline('tool', 'BYOK status'));
    println(terminalThemeDivider(66));
    println(
        terminalThemeRow('Estado', `ativo ${yesNo(summary.enabled)} · pronto ${yesNo(summary.ready)}`, {
            role: summary.ready ? 'success' : summary.enabled ? 'warn' : 'muted',
        }),
    );
    println(terminalThemeRow('Perfil', `${valueOrDash(summary.profile)} · preset ${valueOrDash(summary.preset)}`));
    println(terminalThemeRow('Provedor', `${valueOrDash(summary.providerType)} · base ${valueOrDash(summary.baseUrl)}`));
    println(
        terminalThemeRow(
            'Modelo',
            `${valueOrDash(summary.model)} · protocolo ${renderByokWireLabel(summary.wireApi)} · Azure ${valueOrDash(summary.azureApiVersion)}`,
        ),
    );
    println(
        terminalThemeRow(
            'Autenticação',
            `chave API ${yesNo(summary.auth.apiKeyConfigured)} · token bearer ${yesNo(summary.auth.bearerTokenConfigured)} · headers ${yesNo(summary.auth.headersConfigured)}`,
        ),
    );
    println(
        terminalThemeRow(
            'Capacidades',
            `raciocínio ${yesNo(statusCapabilities.reasoningEffort)} · SDK ${yesNo(statusCapabilities.sdkReasoningEffort)} · visão ${yesNo(statusCapabilities.vision)} · contexto ${statusCapabilities.contextWindowTokens}`,
        ),
    );
    if (statusCapabilities.modelId) {
        println(
            terminalThemeRow(
                'Modelo fonte',
                `${statusCapabilities.modelId} · origem ${renderByokSourceLabel(statusCapabilities.source)}${statusCapabilities.differsFromProviderDefault ? ' · sobrescreve defaults do provedor' : ''}`,
            ),
        );
    }
    const limitParts = [
        summary.limits?.maxRequestTokens ? `máximo/request ${summary.limits.maxRequestTokens}` : null,
        summary.limits?.tokensPerMinute ? `TPM ${summary.limits.tokensPerMinute}` : null,
        summary.limits?.requestsPerMinute ? `RPM ${summary.limits.requestsPerMinute}` : null,
        summary.limits?.dailyRequests ? `RPD ${summary.limits.dailyRequests}` : null,
    ].filter(Boolean);
    if (limitParts.length > 0) {
        println(terminalThemeRow('Limites', limitParts.join(' · ')));
    }
    const activeHealth = readHealthForByokProfile({
        name: summary.profile ?? summary.preset ?? 'runtime',
        preset: summary.preset,
        providerType: summary.providerType,
        model: summary.model,
    });
    if (activeHealth) {
        println(terminalThemeRow('Saúde chat', renderByokHealthTag(activeHealth)));
        println(terminalThemeRow('Saúde agente', renderByokAgentProbeHealthTag(activeHealth)));
    }
    const costTag = renderByokProfileCostTag(summary.profile);
    if (costTag) {
        println(terminalThemeRow('Custo', costTag.replace(/^ · /u, '')));
    }
    println(terminalThemeRow('Catálogo', `${summary.modelList.count} modelo(s)`));
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
        terminalThemeRow(
            'Gateway',
            `${gateway.diagnostics.providerCount} provedores · ${gateway.diagnostics.modelCount} modelos · ${gateway.diagnostics.enabledModelCount} habilitados · origem ${renderByokSourceLabel(gateway.source)}`,
        ),
    );
    const gatewayActive = /** @type {{ modelId?: string | null }} */ (gateway.active);
    if (gatewayActive.modelId) {
        println(terminalThemeRow('Gateway ativo', gatewayActive.modelId));
    }
    try {
        const inventory = await listTerminalSdkSessionInventory();
        const runtimeConfig = readTerminalConfigProjection();
        const binding = classifyTerminalByokSdkBinding(
            summary,
            inventory.persistedByokBinding,
            inventory.currentSessionId,
            runtimeConfig.currentModel,
        );
        println(terminalThemeRow('Preparada', binding.preparedLabel));
        println(
            terminalThemeRow('Sessão viva', `${inventory.currentSessionId ? 'ativa' : 'sem sessão viva'} · ${binding.liveLabel}`),
        );
        println(
            terminalThemeRow('Fronteira', binding.headline, {
                role: binding.state === 'next-boot-required' || binding.state === 'selection-incomplete' ? 'warn' : 'muted',
            }),
        );
        if (binding.action) println(terminalThemeRow('Ação', binding.action, { role: 'command' }));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        println(terminalThemeRow('Vínculo vivo', `indisponível · ${message}`, { role: 'warn' }));
    }
    for (const warning of summary.warnings) {
        println(terminalThemeRow('Aviso', warning, { role: 'warn' }));
    }
    for (const error of summary.errors) {
        println(terminalThemeRow('Erro', error, { role: 'error' }));
    }
    renderActiveByokHealthGuidance(projection, activeHealth, println);
    println(
        terminalThemeRow(
            'Arquivo',
            '.env.local · comandos preparam o processo; a sessão SDK recebe a seleção no próximo boot',
        ),
    );
    printByokSdkSessionBoundaryHint(println);
    println(terminalThemeRow('Rotina', '/byok providers · /byok profiles · /byok models · /byok recommend', { role: 'command' }));
    println(terminalThemeRow('Trocar', '/byok use <perfil|sdk> · /byok model <id> · /byok provider <preset>', { role: 'command' }));
    println(terminalThemeRow('Provar', '/byok probe chat · /byok probe agent · /byok probe shortlist', { role: 'command' }));
    println(terminalThemeRow('Avançado', '/byok gateway commands · /byok auto policy · /byok env', { role: 'command' }));
    println(terminalThemeDivider(66));
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {{ routeProfile?: string; providerId?: string; providerModel?: string }} [scope]
 * @returns {void}
 */
function renderByokHealth(println, scope = {}) {
    const state = readByokProviderHealthState();
    const records = listByokProviderModelHealth().filter((record) => {
        if (scope.routeProfile && record.routeProfile !== scope.routeProfile) return false;
        if (scope.providerId && record.providerId !== scope.providerId) return false;
        if (scope.providerModel && record.providerModel !== scope.providerModel) return false;
        return true;
    });
    println(`\n  \x1b[36mSaúde operacional BYOK\x1b[0m (${records.length})`);
    println(
        `  \x1b[90mpersistência ${state.enabled ? 'on' : 'off'} · arquivo ${state.path ?? '-'} · carregado ${state.loaded ? 'sim' : 'nao'} · alterações pendentes ${state.dirty ? 'sim' : 'nao'}\x1b[0m`,
    );
    if (scope.providerId || scope.providerModel || scope.routeProfile) {
        println(
            `  \x1b[90mfiltro provedor ${scope.providerId ?? '*'} · modelo ${scope.providerModel ?? '*'} · perfil ${scope.routeProfile ?? '*'}\x1b[0m`,
        );
    }
    if (state.error) println(`  \x1b[31merro ${state.error}\x1b[0m`);
    if (records.length === 0) {
        println('  \x1b[90mNenhum turno BYOK real registrou sucesso ou falha neste estado ainda.\x1b[0m\n');
        return;
    }
    for (const record of records.slice(0, 30)) {
        const label = renderByokHealthTag(record);
        const parts = [
            record.routeProfile ? `perfil ${record.routeProfile}` : null,
            record.providerId ? `provedor ${record.providerId}` : null,
            record.providerModel ? `modelo ${record.providerModel}` : null,
            label,
            renderByokAgentProbeHealthTag(record),
            ...renderByokProbeHealthSummaries(record),
        ].filter(Boolean);
        println(`    \x1b[33m${record.key}\x1b[0m`);
        println(`      \x1b[90m${parts.join(' · ')}\x1b[0m`);
        if (record.lastMessage) println(`      \x1b[90multimo erro ${record.lastMessage}\x1b[0m`);
        if (record.lastErrorContext) println(`      \x1b[90mcontexto ${record.lastErrorContext}\x1b[0m`);
        if (record.lastFailureKind || record.lastFailureStatusCode || record.lastRetryAfterSeconds || record.lastResetAt) {
            const failureBits = [
                record.lastFailureKind ? `tipo ${record.lastFailureKind}` : null,
                record.lastFailureStatusCode ? `http ${record.lastFailureStatusCode}` : null,
                record.lastRetryAfterSeconds ? `retry após ${record.lastRetryAfterSeconds}s` : null,
                record.lastResetAt ? `reset ${record.lastResetAt}` : null,
            ].filter(Boolean);
            println(`      \x1b[90mlimite/falha ${failureBits.join(' · ')}\x1b[0m`);
        }
        if (record.lastAgentProbeMessage) println(`      \x1b[90multimo erro agente ${record.lastAgentProbeMessage}\x1b[0m`);
        if (record.lastAgentProbeErrorContext) println(`      \x1b[90mcontexto agente ${record.lastAgentProbeErrorContext}\x1b[0m`);
    }
    if (records.length > 30) {
        println(`  \x1b[90m... ${records.length - 30} registro(s) omitidos. Use filtros de /byok models ou /byok providers para cockpit resumido.\x1b[0m`);
    }
    println('');
}

/**
 * @param {string[]} tokens
 * @returns {{ routeProfile?: string; providerId?: string; providerModel?: string }}
 */
function parseByokHealthClearScope(tokens) {
    /** @type {{ routeProfile?: string; providerId?: string; providerModel?: string }} */
    const scope = {};
    for (const token of tokens) {
        const [rawKey, ...rest] = token.split(':');
        const value = rest.join(':').trim();
        if (!value) continue;
        const key = (rawKey ?? '').trim().toLowerCase();
        if (key === 'provider' || key === 'providerid') scope.providerId = value;
        if (key === 'model' || key === 'providermodel') scope.providerModel = value;
        if (key === 'profile' || key === 'routeprofile') scope.routeProfile = value;
    }
    return scope;
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

    println(`\n  \x1b[36mBYOK endpoints de provedores\x1b[0m (${inventories.length})`);
    println('  \x1b[90mInventário estático de coleta; não prova acesso nem capacidade. Use sondas para promover confiança de execução.\x1b[0m\n');

    if (inventories.length === 0) {
        println(`    \x1b[33mProvedor não encontrado no inventário: ${selector ?? '-'}.\x1b[0m\n`);
        return;
    }

    for (const inventory of inventories) {
        println(`    \x1b[33m${inventory.providerId}\x1b[0m  \x1b[90mtipo ${renderByokTokenLabel(inventory.providerKind)} · adaptador ${inventory.adapterId}\x1b[0m`);
        println(`      \x1b[90mbases ${inventory.baseUrls.slice(0, 3).join(' · ')}${inventory.baseUrls.length > 3 ? ' · ...' : ''}\x1b[0m`);
        const sources = inventory.modelCatalogSources
            .slice(0, 3)
            .map((source) => `${source.method} ${source.url} (${source.richness})`);
        println(`      \x1b[90mcatálogo ${sources.join(' · ')}${inventory.modelCatalogSources.length > 3 ? ' · ...' : ''}\x1b[0m`);
        const runtime = inventory.runtimeEndpoints
            .slice(0, 4)
            .map((endpoint) => `${endpoint.method} ${endpoint.path}`);
        println(`      \x1b[90mexecução ${runtime.join(' · ')}${inventory.runtimeEndpoints.length > 4 ? ' · ...' : ''}\x1b[0m`);
        println(`      \x1b[90mseletores ${inventory.routeSelectors.join(',')}\x1b[0m`);
    }
    println('\n  \x1b[90mPróximo passo: importadores de catálogo usam este mapa como fonte inicial antes de sondas e seleção de execução.\x1b[0m\n');
}

/**
 * @param {Record<string, any>} importer
 * @param {string | null} selector
 * @returns {boolean}
 */
function matchesByokImporterSelector(importer, selector) {
    if (!selector) return true;
    const providerId = optionalScalarString(importer['providerId']);
    if (!providerId) return false;
    return providerId === selector || providerId === `${selector}-local`;
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokGatewayImporterAudit(println, rest) {
    const selector = optionalScalarString(rest.find((item) => !/^(importers|importer|audit|auditoria|coverage|cobertura)$/iu.test(item)));
    const allImporters = createDefaultModelGatewayCatalogImporters({ env: process.env });
    const importers = allImporters.filter((importer) => matchesByokImporterSelector(importer, selector));
    const inventories = selector
        ? [resolveProviderEndpointInventory(selector)].filter((item) => item !== null)
        : listProviderEndpointInventory();
    const audit = auditCatalogImporterSet(importers, { inventories });
    const coverageRows = audit.endpointCoverage;
    const coveredSourceCount = coverageRows.reduce((total, row) => total + row.coveredCatalogSourceCount, 0);
    const totalSourceCount = coverageRows.reduce((total, row) => total + row.catalogSourceCount, 0);

    println(`\n  \x1b[36mBYOK auditoria de importadores\x1b[0m`);
    println(
        `  \x1b[90mFiltro: ${selector ?? '-'} · importadores ${audit.importerCount}/${allImporters.length} · provedores ${audit.providerCount} · públicos ${audit.publicImporterCount} · autenticados ${audit.authenticatedImporterCount}\x1b[0m`,
    );
    println(
        `  \x1b[90mEvidências de provedor ${audit.providerEvidenceImporterCount} · rotas ${audit.routeOptionImporterCount} · overlays de conta ${audit.accountOverlayImporterCount} · cobertura de endpoints ${coveredSourceCount}/${totalSourceCount}\x1b[0m`,
    );
    println('  \x1b[90mAuditoria local e pré-execução; não chama fetchRaw, não usa rede, não executa provedor/modelo e não imprime segredos.\x1b[0m\n');

    if (selector && inventories.length === 0) {
        println(`    \x1b[33mProvedor não encontrado no inventário: ${selector}.\x1b[0m\n`);
        return;
    }

    if (audit.descriptors.length === 0) {
        println(`    \x1b[33mNenhum importer configurado para ${selector ?? 'o ambiente atual'}.\x1b[0m\n`);
    } else {
        for (const descriptor of audit.descriptors.slice(0, 32)) {
            const hookTags = Object.entries(descriptor.hooks)
                .filter(([, enabled]) => enabled)
                .map(([hook]) => hook)
                .join(',');
            const envRequirements = descriptor.envRequirements.length > 0 ? descriptor.envRequirements.join(',') : '-';
            println(
                `    \x1b[33m${descriptor.id}\x1b[0m  \x1b[90mprovedor ${descriptor.providerId} · fonte ${descriptor.sourceKind} · autenticação ${descriptor.requiresAuth ? 'sim' : 'nao'} · TTL ${formatTerminalDurationSeconds(descriptor.ttlSeconds)}\x1b[0m`,
            );
            println(`      \x1b[90metapas ${hookTags || '-'} · env ${envRequirements}\x1b[0m`);
        }
        if (audit.descriptors.length > 32) println(`\n  \x1b[90mexibindo 32/${audit.descriptors.length}; filtre com provider id.\x1b[0m`);
    }

    const uncovered = audit.uncoveredCatalogSourceIds.slice(0, 12).join(', ');
    const missingHooks = audit.missingRequiredHooks.slice(0, 12).join(', ');
    const providersWithoutImporters = audit.providersWithoutImporters.slice(0, 12).join(', ');
    println(`\n  \x1b[90mFontes de catálogo sem cobertura: ${uncovered || '-'}\x1b[0m`);
    println(`  \x1b[90mProvedores sem importador: ${providersWithoutImporters || '-'}\x1b[0m`);
    println(`  \x1b[90mEtapas obrigatórias ausentes: ${missingHooks || '-'}\x1b[0m`);
    println('  \x1b[90mUse isto antes de atualizar catálogo para decidir quais importadores, docs e overlays de conta devem ser aprofundados.\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokProviderGatewayTraits(println, rest) {
    const selector = optionalScalarString(rest.find((item) => !/^(traits|trait|caracteristicas|características)$/iu.test(item)));
    const traits = selector
        ? [resolveProviderGatewayTraits(selector)].filter((item) => item !== null)
        : listProviderGatewayTraits();

    println(`\n  \x1b[36mBYOK características de provedores\x1b[0m (${traits.length})`);
    println('  \x1b[90mMetadados pré-execução derivados de specs/endpoints; não provam acesso, saúde ou execução do modelo.\x1b[0m\n');

    if (traits.length === 0) {
        println(`    \x1b[33mProvedor não encontrado para características: ${selector ?? '-'}.\x1b[0m\n`);
        return;
    }

    for (const item of traits) {
        const capabilities = asRecord(item['capabilities']);
        const routing = asRecord(item['routing']);
        const metadata = asRecord(item['metadata']);
        const routeSelectors = Array.isArray(item['routeSelectors']) ? item['routeSelectors'].slice(0, 6).join(',') : '-';
        const richnessTags = Array.isArray(item['richnessTags']) ? item['richnessTags'].slice(0, 8).join(',') : '-';
        const richnessCategories = Array.isArray(item['richnessCategories']) ? item['richnessCategories'].slice(0, 8).join(',') : '-';
        println(
            `    \x1b[33m${optionalScalarString(item['providerId']) ?? '-'}\x1b[0m  \x1b[90mtopologia ${renderByokTokenLabel(optionalScalarString(item['topology']))} · tipo ${renderByokTokenLabel(optionalScalarString(item['providerKind']))} · compatível com OpenAI ${item['openAICompatible'] === true ? 'sim' : 'nao'}\x1b[0m`,
        );
        println(
            `      \x1b[90mfontes de catálogo ${item['catalogSourceCount'] ?? 0} · endpoints runtime ${item['runtimeEndpointCount'] ?? 0} · públicos ${item['publicCatalogSourceCount'] ?? 0} · autenticados ${item['authenticatedCatalogSourceCount'] ?? 0} · parametrizados ${item['parameterizedCatalogSourceCount'] ?? 0}\x1b[0m`,
        );
        println(
            `      \x1b[90mtipos de execução ${Array.isArray(item['runtimeKinds']) ? renderByokTokenList(item['runtimeKinds'].map(String)) || '-' : '-'} · seletores ${routeSelectors}\x1b[0m`,
        );
        println(
            `      \x1b[90mcapacidades chat:${capabilities['chatCompletions'] === true ? 'sim' : 'nao'}, responses:${capabilities['responses'] === true ? 'sim' : 'nao'}, FIM:${capabilities['fim'] === true ? 'sim' : 'nao'}, embeddings:${capabilities['embeddings'] === true ? 'sim' : 'nao'}\x1b[0m`,
        );
        println(
            `      \x1b[90mroteamento auto:${routing['supportsAutoSelection'] === true ? 'sim' : 'nao'}, fallback:${routing['supportsFallback'] === true ? 'sim' : 'nao'}, ordem de providers:${routing['supportsProviderOrder'] === true ? 'sim' : 'nao'}, BYOK:${routing['supportsGatewayByok'] === true ? 'sim' : 'nao'} · metadados preço:${metadata['hasPricingMetadata'] === true ? 'sim' : 'nao'}, contexto:${metadata['hasContextMetadata'] === true ? 'sim' : 'nao'}, provider:${metadata['hasProviderMetadata'] === true ? 'sim' : 'nao'}\x1b[0m`,
        );
        println(`      \x1b[90mriqueza ${richnessTags} · categorias ${richnessCategories}\x1b[0m`);
    }
    println('\n  \x1b[90mUse estas características como filtro inicial; elegibilidade e sondas continuam em fases separadas.\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderByokGatewayLocalGuidance(println) {
    println(`\n  \x1b[36mBYOK model-gateway local/Ollama\x1b[0m`);
    println('  \x1b[90mPadrão: excluído · daemon não iniciado · sem runtime · opt-in obrigatório\x1b[0m\n');
    println(`    \x1b[90mMotivo: ${MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON}\x1b[0m`);
    println('    \x1b[90mPolítica: excluir providers locais por padrão\x1b[0m');
    println('    \x1b[90mOpt-in por provider: /byok gateway selection audit provider:ollama\x1b[0m');
    println('    \x1b[90mOpt-in por perfil:   /byok gateway selection audit local_private\x1b[0m');
    println('    \x1b[90mmodelo ativo:   /byok provider ollama-local <modelo> http://127.0.0.1:11434/v1\x1b[0m');
    println('    \x1b[90mchecagem:       /byok gateway selection audit strict local_private_strict\x1b[0m\n');
    println('  \x1b[90mEste comando nao inicia Ollama, nao faz probe e nao altera env. Ele apenas mostra o caminho explicito.\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokGatewayProbeMatrix(println, rest) {
    const selector = optionalScalarString(rest.find((item) => !/^(probes|probe|matrix|matriz)$/iu.test(item)));
    const rows = listProviderWireProbeMatrix({ providerId: selector ?? undefined });
    const summary = summarizeProviderWireProbeMatrix(rows);

    println(`\n  \x1b[36mBYOK matriz de sondas por protocolo\x1b[0m`);
    println(
        `  \x1b[90mProvedores ${summary.providerCount} · linhas ${summary.rowCount} · filtro ${selector ?? '-'} · fase: planejamento pré-execução\x1b[0m\n`,
    );

    if (rows.length === 0) {
        println(`    \x1b[33mNenhuma linha de matriz encontrada para ${selector ?? 'inventário atual'}.\x1b[0m\n`);
        return;
    }

    for (const row of rows.slice(0, 24)) {
        const implemented = Array.isArray(row['implementedProbeKinds']) ? renderByokTokenList(row['implementedProbeKinds'].map(String)) : '-';
        const pending = Array.isArray(row['pendingProbeKinds']) ? renderByokTokenList(row['pendingProbeKinds'].map(String)) : '-';
        const notes = Array.isArray(row['notes']) ? row['notes'].join(',') : '-';
        println(
            `    \x1b[33m${optionalScalarString(row['providerId']) ?? '-'}\x1b[0m  \x1b[90mprotocolo ${renderByokWireLabel(optionalScalarString(row['wireApi']))} · execução ${renderByokTokenLabel(optionalScalarString(row['runtimeKind']))} · topologia ${renderByokTokenLabel(optionalScalarString(row['topology']))}\x1b[0m`,
        );
        println(`      \x1b[90mimplementados ${implemented || '-'} · pendentes ${pending || '-'} · notas ${notes || '-'}\x1b[0m`);
    }
    if (rows.length > 24) println(`\n  \x1b[90mexibindo 24/${rows.length}; filtre com provider id.\x1b[0m`);

    const pendingKinds = Object.entries(summary.pendingProbeKindCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, count]) => `${renderByokTokenLabel(kind)}:${count}`)
        .join(', ');
    println(`\n  \x1b[90mTipos de sonda pendentes: ${pendingKinds || '-'}\x1b[0m`);
    println('  \x1b[90mMatriz não executa provedor/modelo; ela só orienta sondas futuras e seleção por política.\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayProbeBackoff(println, rest) {
    const args = parseGatewayCatalogListArgs(rest);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const latestRun = findLatestCatalogRefreshRun(snapshot);
    const diff = latestRun ? normalizeCatalogDiffForDisplay(latestRun['diff']) : { added: [], removed: [], changed: [] };
    const recommendations = recommendCatalogDiffProbes(buildByokProbeRecommendationInput(snapshot, diff, args.limit));
    const filteredRecommendations = recommendations.filter((recommendation) =>
        matchesGatewayCatalogRecordSelector(/** @type {Record<string, unknown>} */ (recommendation), args.selector),
    );
    const plan = planModelGatewayProbeBackoff({
        recommendations: filteredRecommendations,
        accountOverlays: Array.isArray(snapshot.accountOverlays) ? snapshot.accountOverlays : [],
        healthRecords: listByokProviderModelHealth(),
    });
    const reasonCounts = Object.entries(plan.summary.reasonCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([reason, count]) => `${reason}:${count}`)
        .join(',');
    println(`\n  \x1b[36mBYOK planejador de pausa para sondas\x1b[0m`);
    println(
        `  \x1b[90mCatálogo: ${store.filePath} · filtro ${args.selector ?? '-'} · recomendações ${filteredRecommendations.length}/${recommendations.length} · prontas ${plan.summary.ready} · adiadas ${plan.summary.deferred} · motivos ${reasonCounts || '-'}\x1b[0m\n`,
    );
    if (filteredRecommendations.length === 0) {
        println('    \x1b[33mNenhuma recomendação de probe disponível no último diff persistido.\x1b[0m\n');
        return;
    }
    for (const item of plan.deferred.slice(0, args.limit)) {
        const retry = item.resetAt ? `reset ${item.resetAt}` : item.retryAfterSeconds ? `retentar em ${item.retryAfterSeconds}s` : 'reset -';
        const probe = item.probeKind ? ` · probe ${item.probeKind}` : '';
        println(
            `    \x1b[33mADIAR\x1b[0m ${item.key}  \x1b[90mmotivo ${renderByokTokenLabel(item.reason)}${probe} · ${retry} · provedor ${item.providerId}\x1b[0m`,
        );
    }
    for (const item of plan.ready.slice(0, Math.max(0, args.limit - plan.deferred.length))) {
        println(
            `    \x1b[32mPRONTO\x1b[0m ${item.key}  \x1b[90msondas ${renderByokTokenList(item.probeKinds) || '-'} · motivos ${renderByokTokenList(item.reasons.slice(0, 3)) || '-'}\x1b[0m`,
        );
    }
    println('  \x1b[90mPlanner não executa provedor/modelo; ele só evita sondas durante janelas dinâmicas conhecidas.\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokGatewayEnvRequirements(println, rest) {
    const selector = optionalScalarString(rest.find((item) => !/^(secrets|secret|env|requirements|requisitos|missing)$/iu.test(item)));
    const rows = evaluateModelGatewayProviderEnvRequirements({ env: process.env, providerId: selector ?? undefined });
    const summary = summarizeModelGatewayProviderEnvRequirements(rows);

    println(`\n  \x1b[36mBYOK provider env requirements\x1b[0m`);
    println(
        `  \x1b[90mProviders ${summary.providerCount} · prontos ${summary.readyCount} · parciais ${summary.partialCount} · ausentes ${summary.missingCount} · filtro ${selector ?? '-'}\x1b[0m\n`,
    );

    if (rows.length === 0) {
        println(`    \x1b[33mNenhum provedor encontrado para requisitos: ${selector ?? '-'}.\x1b[0m\n`);
        return;
    }

    for (const row of rows.slice(0, 24)) {
        const configured = row.configuredKeys.length > 0 ? row.configuredKeys.join(',') : '-';
        const missing = row.missingRequiredKeys.length > 0 ? row.missingRequiredKeys.join(',') : '-';
        const recommended = row.missingRecommendedKeys.length > 0 ? row.missingRecommendedKeys.join(',') : '-';
        const aliases = Array.isArray(row.providerAliases) && row.providerAliases.length > 0 ? ` · aliases ${row.providerAliases.join(',')}` : '';
        println(
            `    \x1b[33m${row.providerId}\x1b[0m  \x1b[90mestado ${row.status} · obrigatórias ${row.satisfiedRequiredGroupCount}/${row.requiredGroupCount} · recomendadas ${row.satisfiedRecommendedGroupCount}/${row.recommendedGroupCount}${aliases}\x1b[0m`,
        );
        println(`      \x1b[90mconfiguradas ${configured} · obrigatórias ausentes ${missing} · recomendadas ausentes ${recommended}\x1b[0m`);
    }
    if (rows.length > 24) println(`\n  \x1b[90mexibindo 24/${rows.length}; filtre com provider id.\x1b[0m`);
    println('\n  \x1b[90mA saída lista apenas nomes de variáveis; nenhum valor de segredo é impresso.\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderByokGatewayPreKGate(println) {
    const report = buildModelGatewayPreKCompatibilityReport();
    println(`\n  \x1b[36mBYOK model-gateway pre-K gate\x1b[0m`);
    println(
        `  \x1b[90mEtapa ${report.stage} · pronto ${report.ready ? 'sim' : 'nao'} · checks ${report.passed}/${report.total} · falhas ${report.failed}\x1b[0m\n`,
    );
    for (const check of report.checks) {
        const mark = check.passed ? '\x1b[32m[x]\x1b[0m' : '\x1b[31m[ ]\x1b[0m';
        println(`    ${mark} \x1b[33m${check.id}\x1b[0m  \x1b[90mfaixa=${check.track} · ${check.summary}\x1b[0m`);
    }
    println('\n  \x1b[90mEste gate fecha a camada A-J; catálogo universal, SQLite e importers profundos continuam nas Faixas K+.\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderByokGatewayPreBuildReadiness(println) {
    const report = buildModelGatewayPreBuildReadinessReport();
    println(`\n  \x1b[36mBYOK model-gateway pre-build readiness\x1b[0m`);
    println(
        `  \x1b[90mEtapa ${report.stage} · pronto ${report.ready ? 'sim' : 'nao'} · checks ${report.passed}/${report.total} · falhas ${report.failed}\x1b[0m\n`,
    );
    for (const check of report.checks) {
        const mark = check.passed ? '\x1b[32m[x]\x1b[0m' : '\x1b[31m[ ]\x1b[0m';
        println(`    ${mark} \x1b[33m${check.id}\x1b[0m  \x1b[90mfaixa=${check.track} · ${check.summary}\x1b[0m`);
    }
    println(
        '\n  \x1b[90mEste readiness prepara o build do banco de metadados; ele não substitui probes runtime nem executa modelos.\x1b[0m\n',
    );
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokGatewayCanonicalCommands(println, rest) {
    const surface = rest.find((item) => /^(package|make|terminal)$/iu.test(item))?.toLowerCase();
    const phase = rest.find((item) => /^(orientation|metadata|pre-runtime|selection|validate|prebuild|live-readiness)$/iu.test(item))?.toLowerCase();
    const commands = listModelGatewayCanonicalCommands({ surface, phase });
    println(`\n  \x1b[36mBYOK model-gateway canonical commands\x1b[0m`);
    println(
        `  \x1b[90mFaixa Y · escopo package + make + terminal · build em preparação · superfície ${surface ?? '-'} · fase ${phase ?? '-'} · comandos ${commands.length}\x1b[0m\n`,
    );
    for (const line of renderModelGatewayCanonicalCommandLines({ surface, phase })) {
        const [head, summary] = line.split(' :: ');
        println(`    \x1b[33m${head}\x1b[0m`);
        if (summary) println(`      \x1b[90m${summary}\x1b[0m`);
    }
    println(
        '\n  \x1b[90mBuild do banco de metadados deve partir de npm run model-gateway:build ou make model-gateway-build.\x1b[0m\n',
    );
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayOperatorReady(println, rest) {
    const limit = parseByokGatewayAutoHistoryLimit(rest);
    const [status, diagnostics, liveRuns] = await Promise.all([
        buildTerminalByokGatewayAutoStatus(rest, {
            allowEffects: false,
            persistAutomationDecision: false,
        }),
        new SqliteModelGatewayCatalogStore().readStorageDiagnostics(),
        new SqliteModelGatewayCatalogStore().readLiveScenarioRunRecords({ limit: 5 }),
    ]);
    const standbyPlan = buildModelGatewayRuntimeStandbyPlan(status.runtimeSelectorPlan, {
        limit,
        profileId: status.args.profileId,
    });
    const standbyRows = standbyPlan.routes;
    const standbyProviderCount = standbyPlan.summary.providerCount;
    const persistedStandbyRows = finitePositiveNumber(diagnostics.standbyPlanRows) ?? 0;
    const latestPersistedStandby = diagnostics.latestStandbyPlan ?? {};
    const liveRunRows = Math.max(finitePositiveNumber(diagnostics.liveScenarioRunRows) ?? 0, liveRuns.length);
    const diagnosticLatestLiveRun = diagnostics.latestLiveScenarioRun ?? {};
    const latestLiveRun = optionalScalarString(diagnosticLatestLiveRun.summaryPath) ? diagnosticLatestLiveRun : (liveRuns[0] ?? {});
    const activeSnapshot = diagnostics.activeSnapshot?.exists === true;
    const policy = await readModelGatewayRuntimeAutomationEffectivePolicy();
    const checks = [
        {
            id: 'catalog_snapshot',
            pass: activeSnapshot,
            detail: `${diagnostics.activeSnapshot?.source ?? '-'}:${diagnostics.activeSnapshot?.generatedAtMs ?? '-'}`,
        },
        {
            id: 'runtime_selector',
            pass: status.runtimeSelectorPlan.ok === true && status.runtimeSelectorPlan.ready === true,
            detail: `selecionados ${status.runtimeSelectorPlan.summary.selectedProfileCount}/${status.runtimeSelectorPlan.summary.profileCount}`,
        },
        {
            id: 'automation_decision',
            pass: status.decision.ok === true || status.decision.action === 'keep_current',
            detail: `ação ${status.decision.action} · bloqueios ${status.decision.blockers.length}`,
        },
        {
            id: 'standby_routes',
            pass: standbyRows.length > 0,
            detail: `rotas ${standbyRows.length} · provedores ${standbyProviderCount}`,
        },
        {
            id: 'terminal_boundary',
            pass: Boolean(status.inventory.currentSessionId) || status.decision.requiresNewSession === true,
            detail: `sessão ${status.inventory.currentSessionId ?? '-'} · atual ${status.decision.currentBoundary.preset ?? '-'}:${status.decision.currentBoundary.model ?? '-'}`,
        },
    ];
    const blockers = checks.filter((check) => !check.pass);
    const nextCommands = [
        ...status.decision.nextCommands,
        `/byok auto standby profile:${status.args.profileId} ${limit}`,
        `/byok auto proof-plan profile:${status.args.profileId} ${limit}`,
        `npm run model-gateway:auto:standby -- --profile=${status.args.profileId} --limit=${limit} --write-sqlite`,
        ...standbyPlan.nextCommands,
        'npm run model-gateway:runtime-health:diff -- --write-snapshot --fail-on-regression',
    ];
    println('\n  \x1b[36mBYOK model-gateway operator-ready\x1b[0m');
    println(
        `  \x1b[90mperfil ${status.args.profileId} · ok ${blockers.length === 0 ? 'sim' : 'nao'} · checagens ${checks.length - blockers.length}/${checks.length} · standby ${standbyRows.length} · persistidos ${persistedStandbyRows} · provedores ${standbyProviderCount} · sem chamada a provedor\x1b[0m`,
    );
    println(
        `    política:      \x1b[33mativa ${policy.enabled ? 'sim' : 'nao'} · preset ${policy.preset} · modo ${renderByokTokenLabel(policy.policy)} · modelo vivo ${policy.allowLiveSetModel ? 'sim' : 'nao'} · nova sessão ${policy.allowNewSession ? 'sim' : 'nao'} · local privado ${policy.allowLocalPrivate ? 'sim' : 'nao'}\x1b[0m`,
    );
    println(
        `    vivo:          \x1b[33m${status.decision.currentBoundary.preset ?? '-'} · ${status.decision.currentBoundary.model ?? '-'}\x1b[0m`,
    );
    println(
        `    alvo:          \x1b[33m${status.decision.targetBoundary.preset ?? '-'} · ${status.decision.targetBoundary.model ?? '-'} · ação ${renderByokTokenLabel(status.decision.action)}\x1b[0m`,
    );
    if (status.decision.fallbackFromSelectedRouteKey || status.decision.fallbackReason) {
        println(
            `    alternativa:   \x1b[33mde ${status.decision.fallbackFromSelectedRouteKey ?? '-'} · motivo ${renderByokTokenLabel(status.decision.fallbackReason)}\x1b[0m`,
        );
    }
    for (const check of checks) {
        println(
            `    ${check.pass ? '\x1b[32m[x]\x1b[0m' : '\x1b[31m[ ]\x1b[0m'} \x1b[33m${check.id}\x1b[0m  \x1b[90m${check.detail}\x1b[0m`,
        );
    }
    for (const [index, row] of standbyRows.slice(0, Math.min(limit, 5)).entries()) {
        println(
            `    standby ${index + 1}:  \x1b[33m${row.providerId}:${row.providerModel}\x1b[0m \x1b[90m${renderByokSourceLabel(row.source)} · classe ${renderByokTokenLabel(row.standbyClass)} · sonda ${row.needsProbe ? 'sim' : 'nao'} · prova ${row.hasRuntimeProof ? 'sim' : 'nao'} · env ${renderByokTokenLabel(row.runtimeEnvStatus)}\x1b[0m`,
        );
        println(`      \x1b[90mprovar: ${row.commands.probeAgent ?? '-'}\x1b[0m`);
        println(`      \x1b[90musar: ${row.commands.liveModel ?? '-'}\x1b[0m`);
        println(`      \x1b[90mnovo boot: ${row.commands.newSession ?? '-'} && ${row.commands.provider ?? '-'}\x1b[0m`);
        if (row.providerId && row.providerModel) {
            println(
                `      \x1b[90mclear: /byok health clear provider:${row.providerId} model:${row.providerModel} profile:${row.profileId ?? status.args.profileId}\x1b[0m`,
            );
        }
    }
    println(
        `    banco standby: \x1b[33mlinhas ${persistedStandbyRows} · mais recente ${latestPersistedStandby.standbyPlanId ?? '-'} · perfil ${latestPersistedStandby.routeProfile ?? '-'} · rotas ${latestPersistedStandby.routeCount ?? '-'}\x1b[0m`,
    );
    println(
        `    banco live:    \x1b[33mlinhas ${liveRunRows} · mais recente ${optionalScalarString(latestLiveRun['scenarioKind']) ?? '-'} · estado ${optionalScalarString(latestLiveRun['status']) ?? '-'} · resumo ${optionalScalarString(latestLiveRun['summaryPath']) ?? '-'}\x1b[0m`,
    );
    for (const [index, run] of liveRuns.slice(0, 3).entries()) {
        println(
            `    live ${index + 1}:     \x1b[33m${optionalScalarString(run['scenarioKind']) ?? optionalScalarString(run['kind']) ?? '-'}\x1b[0m \x1b[90mestado ${optionalScalarString(run['status']) ?? '-'} · ok ${run['ok'] === true ? 'sim' : run['ok'] === false ? 'nao' : '-'} · resumo ${optionalScalarString(run['summaryPath']) ?? '-'}\x1b[0m`,
        );
    }
    if (status.decision.blockers.length > 0) println(`    bloqueios:     \x1b[33m${status.decision.blockers.join(', ')}\x1b[0m`);
    println(`    resumo:        \x1b[90m${status.decision.operatorSummary}\x1b[0m`);
    println(`    próximo:       \x1b[90m${[...new Set(nextCommands)].slice(0, 5).join(' && ')}\x1b[0m\n`);
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
        `  \x1b[90mCatálogo: ${store.filePath} · Filtro: ${normalizedSelector ?? '-'} · Importers: ${importers.map((importer) => importer.id).join(', ') || '-'} · Schema: OpenAI + x_model_gateway\x1b[0m\n`,
    );
    if (importers.length === 0) {
        println('    \x1b[33mNenhum importer habilitado para este seletor. Configure rede/credenciais, remova o filtro ou use uma fonte pública disponível.\x1b[0m\n');
        return;
    }
    try {
        eventBus?.emit?.(buildCatalogRefreshStartedEvent(refreshContext));
        let lastProgressPct = -1;
        const result = await refreshModelGatewayCatalog({
            store,
            importers,
            incremental: true,
            refreshAccountOverlays: true,
            eligibility: {
                enabled: true,
                secretRegistry: createEnvSecretRegistry(),
                policy: {
                    unknownAccessPolicy: 'allow_probe',
                    policyProfile: 'terminal-refresh',
                },
            },
            writePolicy: 'commit',
            lockKey: store.filePath,
            onProgress: (event) => {
                const progressPct = typeof event.progressPct === 'number' ? event.progressPct : lastProgressPct;
                const shouldPrint = event.phase === 'refresh_plan_ready' ||
                    event.phase === 'refresh_completed' ||
                    event.phase === 'eligibility_evaluated' ||
                    event.phase === 'snapshot_written' ||
                    event.phase === 'snapshot_previewed' ||
                    event.phase.endsWith(':importer_started') ||
                    event.phase.endsWith(':importer_completed') ||
                    event.phase.endsWith(':importer_failed') ||
                    progressPct - lastProgressPct >= 15;
                if (!shouldPrint) return;
                lastProgressPct = Math.max(lastProgressPct, progressPct);
                const importer = event.importer && typeof event.importer === 'object' ? event.importer['importerId'] : null;
                /** @type {Record<string, string>} */
                const phaseLabels = {
                    refresh_plan_ready: 'plano pronto',
                    refresh_completed: 'refresh concluído',
                    eligibility_evaluated: 'elegibilidade recalculada',
                    snapshot_written: 'snapshot gravado',
                    snapshot_previewed: 'snapshot pré-visualizado',
                };
                const phase = phaseLabels[event.phase] ?? event.phase
                    .replace(/:importer_started$/u, ': importer iniciado')
                    .replace(/:importer_completed$/u, ': importer concluído')
                    .replace(/:importer_failed$/u, ': importer falhou')
                    .replaceAll('_', ' ');
                const counts = joinTerminalSummary([
                    typeof event.selectedCount === 'number' ? `selecionados ${event.selectedCount}` : '',
                    typeof event.skippedCount === 'number' ? `adiados ${event.skippedCount}` : '',
                    typeof event.rowCount === 'number' ? `linhas ${event.rowCount}` : '',
                    typeof event.evidenceCount === 'number' ? `evidências ${event.evidenceCount}` : '',
                    typeof event.projectionCount === 'number' ? `projeções ${event.projectionCount}` : '',
                    typeof event.eligibilityDecisionCount === 'number' ? `decisões ${event.eligibilityDecisionCount}` : '',
                    typeof event.eligibilityAddedCount === 'number' ? `elegibilidade +${event.eligibilityAddedCount}` : '',
                    typeof event.eligibilityRemovedCount === 'number' ? `elegibilidade -${event.eligibilityRemovedCount}` : '',
                    typeof event.eligibilityChangedCount === 'number' ? `elegibilidade ~${event.eligibilityChangedCount}` : '',
                    typeof event.addedCount === 'number' ? `novos ${event.addedCount}` : '',
                    typeof event.removedCount === 'number' ? `removidos ${event.removedCount}` : '',
                    typeof event.changedCount === 'number' ? `alterados ${event.changedCount}` : '',
                ]);
                println(
                    `    \x1b[90m${String(progressPct).padStart(3)}% · ${phase}${importer ? ` · importer ${importer}` : ''}${counts ? ` · ${counts}` : ''}\x1b[0m`,
                );
            },
            retentionPolicy: {
                maxImportRuns: 200,
                maxRawPayloadRefs: 200,
                maxConflicts: 500,
                maxModelEligibilityRuns: 100,
            },
        });
        const refreshEvents = buildCatalogRefreshEventBatch({
            ...refreshContext,
            snapshot: result.snapshot,
            diff: result.diff,
            openai: result.openai,
        });
        for (const event of refreshEvents.events) eventBus?.emit?.(event);
        println(
            `    \x1b[32mRefresh concluído\x1b[0m  \x1b[90mprojeções ${result.snapshot.projections.length} · modelos OpenAI ${result.openai.data.length} · runs retidos ${result.snapshot.importRuns.length}\x1b[0m`,
        );
        println(
            `    \x1b[90mDiferença do catálogo: novos ${result.diff.added.length} · removidos ${result.diff.removed.length} · alterados ${result.diff.changed.length}\x1b[0m`,
        );
        println(
            `    \x1b[90mPersistência: ${result.writePolicy.mode} · commit ${yesNoPlain(result.writePolicy.committed)} · overlays ${result.overlayRefresh.total} · elegibilidade ${result.eligibilityRefresh.decisionCount} · runs retidos ${result.retention.importRuns.after}\x1b[0m`,
        );
        const eligibilityDiffSummary = result.eligibilityRefresh.diffSummary;
        if (eligibilityDiffSummary) {
            println(
                `    \x1b[90mDiferença de elegibilidade: novas ${eligibilityDiffSummary.addedCount} · removidas ${eligibilityDiffSummary.removedCount} · alteradas ${eligibilityDiffSummary.changedCount} · ficaram elegíveis ${eligibilityDiffSummary.becameEligibleCount} · ficaram excluídas ${eligibilityDiffSummary.becameExcludedCount}\x1b[0m`,
            );
            if (eligibilityDiffSummary.changedKinds.length > 0) {
                println(`    \x1b[90mTipos de mudança em elegibilidade: ${eligibilityDiffSummary.changedKinds.join(',')}\x1b[0m`);
            }
        }
        if (refreshEvents.completedEvent.changedKinds.length > 0) {
            println(`    \x1b[90mTipos de mudança no catálogo: ${refreshEvents.completedEvent.changedKinds.join(',')}\x1b[0m`);
        }
        const probeRecommendations = recommendCatalogDiffProbes(buildByokProbeRecommendationInput(result.snapshot, result.diff, 5));
        if (probeRecommendations.length > 0) {
            println(`    \x1b[90mSugestões de prova runtime: ${probeRecommendations.length}\x1b[0m`);
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
 * @param {(text: string) => void} println
 * @param {string | null} [selector]
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogRefreshPlan(println, selector = null) {
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const allImporters = createDefaultModelGatewayCatalogImporters({ env: process.env });
    const normalizedSelector = optionalScalarString(selector)?.toLowerCase() ?? null;
    const importers = normalizedSelector
        ? allImporters.filter((importer) =>
              [importer.id, importer.providerId].some((value) => String(value ?? '').toLowerCase().includes(normalizedSelector)),
          )
        : allImporters;
    println(`\n  \x1b[36mBYOK model-gateway catalog refresh plan\x1b[0m`);
    println(`  \x1b[90mCatálogo: ${store.filePath} · Filtro: ${normalizedSelector ?? '-'} · Prévia local, sem rede e sem escrita\x1b[0m\n`);
    if (importers.length === 0) {
        println('    \x1b[33mNenhum importer habilitado para este seletor.\x1b[0m\n');
        return;
    }
    const snapshot = await store.readSnapshot();
    const plan = planModelGatewayCatalogRefresh({
        importers,
        sources: snapshot.sources,
    });
    println(
        terminalThemeRow(
            'Importers',
            `avaliados ${plan.importerCount} · executar agora ${plan.selected.length} · adiar ${plan.skipped.length} · fontes conhecidas ${plan.sourceCount}`,
        ),
    );
    for (const item of plan.selected.slice(0, 16)) {
        println(
            terminalThemeRow(
                'Executar',
                `${item.sourceId} · provedor ${item.providerId} · motivo ${item.reason} · TTL ${formatTerminalDurationSeconds(item.ttlSeconds)} · idade ${formatTerminalDurationSeconds(item.ageSeconds)}`,
                { role: 'success' },
            ),
        );
    }
    for (const item of plan.skipped.slice(0, 16)) {
        println(
            terminalThemeRow(
                'Adiar',
                `${item.sourceId} · provedor ${item.providerId} · motivo ${item.reason} · TTL ${formatTerminalDurationSeconds(item.ttlSeconds)} · idade ${formatTerminalDurationSeconds(item.ageSeconds)}`,
            ),
        );
    }
    println('');
    println(terminalThemeRow('Comando', 'npm run model-gateway:refresh -- --provider=<provider> --force'));
    println('');
}

/**
 * @returns {Promise<string | null>}
 */
async function findLatestModelGatewayRefreshLogPath() {
    const dir = resolve('logs/model-gateway-refresh');
    let entries;
    try {
        entries = await fs.readdir(dir);
    } catch {
        return null;
    }
    /** @type {Array<{ path: string; mtimeMs: number }>} */
    const candidates = [];
    for (const entry of entries.filter((item) => item.endsWith('.jsonl'))) {
        const filePath = join(dir, entry);
        try {
            const metadata = await fs.stat(filePath);
            if (metadata.isFile()) candidates.push({ path: filePath, mtimeMs: metadata.mtimeMs });
        } catch {
            // Operational logs can rotate while the terminal is open; ignore vanished files.
        }
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return candidates[0]?.path ?? null;
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogRefreshLog(println) {
    println(`\n  \x1b[36mBYOK model-gateway refresh log\x1b[0m`);
    const logPath = await findLatestModelGatewayRefreshLogPath();
    if (!logPath) {
        println('    \x1b[33mNenhum log JSONL de refresh encontrado. Rode /byok gateway catalog refresh primeiro.\x1b[0m\n');
        return;
    }
    const text = await fs.readFile(logPath, 'utf8');
    const summary = summarizeModelGatewayRefreshLogText(text, { logPath });
    println(`  \x1b[90mLog: ${logPath} · eventos ${summary.eventCount} · linhas inválidas ${summary.invalidLineCount}\x1b[0m\n`);
    println(
        `    \x1b[90mRefresh completo ${yesNoPlain(summary.completed)} · commit ${yesNoPlain(summary.committed)} · duração ${summary.elapsedMs ?? '-'}ms\x1b[0m`,
    );
    println(
        `    \x1b[90mTotais: projeções ${summary.totals.projections ?? '-'} · modelos OpenAI ${summary.totals.openai ?? '-'} · overlays ${summary.totals.overlays ?? '-'} · novos ${summary.totals.added ?? '-'} · removidos ${summary.totals.removed ?? '-'} · alterados ${summary.totals.changed ?? '-'}\x1b[0m`,
    );
    const importerEntries = Object.entries(summary.importers);
    println(`    \x1b[90mImporters com eventos ${importerEntries.length} · falhas ${summary.failures.length}\x1b[0m`);
    for (const [importerId, importer] of importerEntries.slice(0, 12)) {
        println(
            `      \x1b[90m${importerId}: iniciados ${importer.started} · concluídos ${importer.completed} · falhas ${importer.failed} · linhas ${importer.rowCount} · evidências ${importer.evidenceCount}\x1b[0m`,
        );
    }
    for (const failure of summary.failures.slice(0, 8)) {
        println(`      \x1b[31mfalha\x1b[0m \x1b[90m${failure.phase} · importer ${failure.importerId ?? '-'} · ${failure.errors.join('; ')}\x1b[0m`);
    }
    println('');
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
 * @param {unknown} value
 * @returns {{ added: string[]; removed: string[]; changed: Array<{ key: string; changedFields: string[]; changedKinds: string[]; previousInclude?: boolean | null; nextInclude?: boolean | null }> }}
 */
function normalizeEligibilityDiffForDisplay(value) {
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
                  previousInclude: typeof changedRecord['previousInclude'] === 'boolean' ? changedRecord['previousInclude'] : null,
                  nextInclude: typeof changedRecord['nextInclude'] === 'boolean' ? changedRecord['nextInclude'] : null,
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
 * @param {ReturnType<InstanceType<typeof JsonModelGatewayCatalogStore>['readSnapshot']> extends Promise<infer T> ? T : never} snapshot
 * @returns {Record<string, any> | null}
 */
function findLatestEligibilityRun(snapshot) {
    const runs = Array.isArray(snapshot.modelEligibilityRuns) ? snapshot.modelEligibilityRuns : [];
    return [...runs]
        .reverse()
        .find((run) => run && typeof run === 'object' && (run['diff'] || run['diffSummary'])) ?? null;
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayEligibilityRuns(println, rest) {
    const limit = Math.min(Number(rest.find((item) => /^\d+$/u.test(item)) ?? 8), 50);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const allRuns = Array.isArray(snapshot.modelEligibilityRuns) ? snapshot.modelEligibilityRuns : [];
    const runs = [...allRuns]
        .sort((left, right) => String(right['completedAt'] ?? '').localeCompare(String(left['completedAt'] ?? '')))
        .slice(0, limit);
    println(`\n  \x1b[36mBYOK model-gateway eligibility runs\x1b[0m`);
    println(`  \x1b[90mCatálogo: ${store.filePath} · runs persistidos ${allRuns.length} · sem runtime\x1b[0m\n`);
    if (runs.length === 0) {
        println('    \x1b[33mNenhum run de eligibility persistido. Rode /byok gateway catalog refresh primeiro.\x1b[0m\n');
        return;
    }
    for (const run of runs) {
        const summary = run['diffSummary'] ? summarizeModelGatewayEligibilityDiff(normalizeEligibilityDiffForDisplay(run['diff'])) : null;
        println(
            `    \x1b[33m${run['runId'] ?? '-'}\x1b[0m  \x1b[90mpolítica ${run['policyProfile'] ?? '-'} · tarefa ${run['taskProfile'] ?? '-'} · conta ${run['accountScope'] ?? '-'} · estado ${run['status'] ?? '-'}\x1b[0m`,
        );
        println(
            `      \x1b[90mconcluído ${run['completedAt'] ?? '-'} · modelos ${run['modelCount'] ?? 0} · elegíveis ${run['eligibleCount'] ?? 0} · desconhecidos ${run['unknownCount'] ?? 0} · excluídos ${run['excludedCount'] ?? 0}\x1b[0m`,
        );
        if (summary) {
            println(
                `      \x1b[90mdiferença: novas ${summary.addedCount} · removidas ${summary.removedCount} · alteradas ${summary.changedCount} · ficaram elegíveis ${summary.becameEligibleCount} · ficaram excluídas ${summary.becameExcludedCount}\x1b[0m`,
            );
        }
    }
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayEligibilityDiff(println) {
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const run = findLatestEligibilityRun(snapshot);
    println(`\n  \x1b[36mBYOK model-gateway eligibility diff\x1b[0m`);
    println(`  \x1b[90mCatálogo: ${store.filePath} · fonte: último run de elegibilidade persistido · sem runtime\x1b[0m\n`);
    if (!run) {
        println('    \x1b[33mNenhum diff de eligibility persistido. Rode /byok gateway catalog refresh primeiro.\x1b[0m\n');
        return;
    }
    const diff = normalizeEligibilityDiffForDisplay(run['diff']);
    const summary = summarizeModelGatewayEligibilityDiff(diff);
    println(
        `    \x1b[90mRun ${run['runId'] ?? '-'} · novas ${summary.addedCount} · removidas ${summary.removedCount} · alteradas ${summary.changedCount} · ficaram elegíveis ${summary.becameEligibleCount} · ficaram excluídas ${summary.becameExcludedCount}\x1b[0m`,
    );
    if (summary.changedKinds.length > 0) println(`    \x1b[90mTipos de mudança: ${summary.changedKinds.join(',')}\x1b[0m`);
    for (const id of diff.added.slice(0, 8)) println(`      \x1b[32m+\x1b[0m ${id}`);
    for (const id of diff.removed.slice(0, 8)) println(`      \x1b[31m-\x1b[0m ${id}`);
    for (const item of diff.changed.slice(0, 8)) {
        const kinds = item.changedKinds.length > 0 ? ` · ${item.changedKinds.join(',')}` : '';
        println(`      \x1b[33m~\x1b[0m ${item.key}${kinds}`);
    }
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogDiff(println) {
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    println(`\n  \x1b[36mBYOK model-gateway catalog diff\x1b[0m`);
    println(`  \x1b[90mCatálogo: ${store.filePath} · fonte: último refresh persistido · sem rede\x1b[0m\n`);
    const snapshot = await store.readSnapshot();
    const latestRun = findLatestCatalogRefreshRun(snapshot);
    if (!latestRun) {
        println('    \x1b[33mNenhum diff persistido encontrado. Rode /byok gateway catalog refresh primeiro.\x1b[0m\n');
        return;
    }
    const diff = normalizeCatalogDiffForDisplay(latestRun['diff']);
    const summary = summarizeCanonicalModelProjectionDiff(diff);
    const recommendations = recommendCatalogDiffProbes(buildByokProbeRecommendationInput(snapshot, diff, 8));
    println(
        `    \x1b[90mRun ${latestRun['runId'] ?? '-'} · novos ${summary.addedCount} · removidos ${summary.removedCount} · alterados ${summary.changedCount} · conflitos ${snapshot.conflicts.length}\x1b[0m`,
    );
    if (summary.changedKinds.length > 0) {
        println(`    \x1b[90mTipos de mudança: ${summary.changedKinds.join(',')}\x1b[0m`);
    }
    for (const id of diff.added.slice(0, 8)) println(`      \x1b[32m+\x1b[0m ${id}`);
    for (const id of diff.removed.slice(0, 8)) println(`      \x1b[31m-\x1b[0m ${id}`);
    for (const item of diff.changed.slice(0, 8)) {
        const kinds = item.changedKinds.length > 0 ? ` · ${item.changedKinds.join(',')}` : '';
        println(`      \x1b[33m~\x1b[0m ${item.key} (${item.changedFields.join(',')}${kinds})`);
    }
    if (recommendations.length > 0) {
        println(`\n    \x1b[90mSugestões de prova runtime: ${recommendations.length}\x1b[0m`);
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
async function renderByokGatewayCatalogIntegrity(println) {
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const integrity = auditModelGatewayCatalogSnapshotIntegrity(snapshot);
    println(`\n  \x1b[36mBYOK model-gateway catalog integrity\x1b[0m`);
    println(
        `  \x1b[90mCatálogo: ${store.filePath} · integridade ${integrity.ok ? 'ok' : 'falha'} · identidades redigidas ${integrity.redactedIdentityCount} · sem rede\x1b[0m\n`,
    );
    for (const [field, check] of Object.entries(integrity.duplicateChecks)) {
        const color = check.duplicateExtraRowCount === 0 ? '\x1b[32m' : '\x1b[31m';
        println(
            `    ${color}${field}\x1b[0m \x1b[90mlinhas ${check.rowCount} · únicas ${check.uniqueKeyCount} · chaves duplicadas ${check.duplicateKeyCount} · excedentes ${check.duplicateExtraRowCount}\x1b[0m`,
        );
    }
    for (const sample of integrity.redactedIdentitySamples.slice(0, 8)) {
        println(`      \x1b[31mredacted\x1b[0m \x1b[90m${sample.field}: ${sample.id ?? sample.providerModel ?? sample.providerId ?? '-'}\x1b[0m`);
    }
    println('');
}

/**
 * @param {string[]} rest
 * @returns {{ strict: boolean; effective: boolean; requireRuntimeProof: boolean; writeTrace: boolean; traceDir: string; traceId: string; selectionPolicy: string; profiles: string[] }}
 */
function parseByokGatewaySelectionAuditArgs(rest) {
    const requireRuntimeProof = rest.some((item) =>
        /^(runtime-proof|proof|proved|provado|require-proof|--runtime-proof|--require-runtime-proof)$/iu.test(item),
    );
    const writeTrace = rest.some((item) =>
        /^(trace|write-trace|persist-trace|decision-trace|--write-trace|--persist-trace)$/iu.test(item),
    );
    const traceDir =
        rest
            .map((item) => item.match(/^--?trace-dir[:=](.+)$/iu)?.[1] ?? null)
            .find((item) => item !== null) ?? DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR;
    const traceId =
        rest
            .map((item) => item.match(/^--?trace-id[:=](.+)$/iu)?.[1] ?? item.match(/^trace-id[:=](.+)$/iu)?.[1] ?? null)
            .find((item) => item !== null) ?? '';
    const selectionPolicy =
        rest
            .map((item) => item.match(/^--?selection-policy[:=](.+)$/iu)?.[1] ?? item.match(/^policy[:=](.+)$/iu)?.[1] ?? null)
            .find((item) => item !== null) ?? (requireRuntimeProof ? 'require_runtime_proof' : 'metadata_first');
    const effective =
        requireRuntimeProof ||
        writeTrace ||
        rest.some((item) => /^(effective|efetiva|observed|health|--effective)$/iu.test(item));
    const strict = effective || rest.some((item) => /^(strict|block|bloquear|--strict)$/iu.test(item));
    const profiles = rest
        .flatMap((item) => {
            const profileArg = item.match(/^--?profiles?[:=](.+)$/iu)?.[1];
            if (
                /^--?selection-policy[:=]/iu.test(item) ||
                /^policy[:=]/iu.test(item) ||
                /^--?trace-dir[:=]/iu.test(item) ||
                /^--?trace-id[:=]/iu.test(item) ||
                /^trace-id[:=]/iu.test(item)
            ) {
                return [];
            }
            if (profileArg) return profileArg.split(',');
            if (
                /^(audit|auditoria|selection|selecao|seleção|strict|block|bloquear|--strict|effective|efetiva|observed|health|--effective|runtime-proof|proof|proved|provado|require-proof|--runtime-proof|--require-runtime-proof|trace|write-trace|persist-trace|decision-trace|--write-trace|--persist-trace)$/iu.test(
                    item,
                )
            ) {
                return [];
            }
            return [item];
        })
        .map((item) => item.trim())
        .filter(Boolean);
    return { strict, effective, requireRuntimeProof, writeTrace, traceDir, traceId, selectionPolicy, profiles };
}

/**
 * @param {Record<string, number>} counts
 * @returns {string}
 */
function formatCountMap(counts) {
    const text = Object.entries(counts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, count]) => `${key}:${count}`)
        .join(',');
    return text || '-';
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewaySelectionAudit(println, rest) {
    const args = parseByokGatewaySelectionAuditArgs(rest);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const integrity = auditModelGatewayCatalogSnapshotIntegrity(snapshot);
    const secretRegistry = createEnvSecretRegistry();
    const healthRecords = args.effective ? listByokProviderModelHealth() : [];
    const runtimeOverlays = args.effective ? deriveModelGatewayRuntimeAccountOverlaysFromHealth(healthRecords) : [];
    const evaluationNow = new Date();
    const runtimeOverlaySummary = args.effective
        ? summarizeModelGatewayRuntimeAccountOverlays(runtimeOverlays, { now: evaluationNow })
        : null;
    const effectiveEligibility = args.effective
        ? evaluateModelGatewayCatalogEligibility({
              snapshot,
              secretRegistry,
              healthRecords,
              now: () => evaluationNow,
              policy: {
                  unknownAccessPolicy: args.strict ? 'block' : 'allow_probe',
                  policyProfile: args.strict ? 'terminal-effective-strict-no-runtime' : 'terminal-effective-allow-probe-no-runtime',
              },
          })
        : null;
    const selectionSnapshot = effectiveEligibility
        ? {
              ...snapshot,
              source: 'terminal-effective-selection-preview',
              modelEligibilityDecisions: effectiveEligibility.decisions,
              modelEligibilityRuns: [
                  ...(Array.isArray(snapshot.modelEligibilityRuns) ? snapshot.modelEligibilityRuns : []),
                  effectiveEligibility.run,
              ],
          }
        : snapshot;
    const selection = auditModelGatewayPreRuntimeSelection(selectionSnapshot, {
        strict: args.strict,
        profiles: args.profiles,
        secretRegistry,
    });
    const postRuntimeSelection = args.effective
        ? auditModelGatewayPostRuntimeSelection(selectionSnapshot, {
              strict: args.strict,
              profiles: args.profiles,
              secretRegistry,
              runtimeHealthRecords: healthRecords,
              requireRuntimeProof: args.requireRuntimeProof,
          })
        : null;
    const selectionComparison = postRuntimeSelection ? compareModelGatewaySelectionAudits(selection, postRuntimeSelection) : null;
    const selectionComparisonExplanation = selectionComparison ? explainModelGatewaySelectionComparison(selectionComparison) : null;
    const policyResolution = selectionComparison
        ? resolveModelGatewaySelectionPolicy(selectionComparison, { mode: args.selectionPolicy })
        : null;
    const runtimeSelectorPlan = policyResolution
        ? buildModelGatewayRuntimeSelectorPlan(policyResolution, {
              source: 'terminal-byok-selection-audit',
              requireRuntimeProof: args.requireRuntimeProof,
          })
        : null;
    const tracePersistence =
        args.writeTrace && postRuntimeSelection && selectionComparison && policyResolution
            ? await persistModelGatewaySelectionDecisionTrace(
                  buildModelGatewaySelectionDecisionTrace({
                      snapshot,
                      integrity,
                      selection,
                      postRuntimeSelection,
                      selectionComparison,
                      policyResolution,
                      runtimeSource: 'terminal-file',
                      runtimeHealthRecordCount: healthRecords.length,
                      runtimeAccountOverlaySummary: runtimeOverlaySummary ?? {},
                      ...(args.traceId ? { traceId: args.traceId } : {}),
                      source: 'terminal-byok-selection-audit',
                  }),
                  { directory: args.traceDir },
              )
            : null;
    const persistedStatus = tracePersistence?.written === true ? 'sim' : args.writeTrace ? 'falha' : 'nao';
    println(`\n  \x1b[36mBYOK model-gateway selection audit\x1b[0m`);
    println(
            `  \x1b[90mcatálogo ${store.filePath} · integridade ${integrity.ok ? 'ok' : 'falha'} · modo ${renderByokTokenLabel(selection.mode)}${args.effective ? '+efetivo' : ''}${args.requireRuntimeProof ? '+prova obrigatória' : ''} · sem execução · persistido ${persistedStatus} · perfis ${selection.summary.selectedProfileCount}/${selection.summary.profileCount}\x1b[0m`,
    );
    println(
            `  \x1b[90mprojeções ${selection.snapshotContext['projectionCount']} · rotas ${selection.snapshotContext['routeOptionCount']} · overlays ${selection.snapshotContext['accountOverlayCount']} · elegibilidade ${selection.snapshotContext['eligibilityDecisionCount']} · candidatos ${selection.snapshotContext['candidateCount']}\x1b[0m\n`,
    );
    if (args.effective) {
        println(
            `  \x1b[90msaúde observada ${healthRecords.length} · overlays de execução ${runtimeOverlays.length} · ativos ${runtimeOverlaySummary?.activeCount ?? 0} · expirados ${runtimeOverlaySummary?.expiredCount ?? 0} · falhas ${formatCountMap(runtimeOverlaySummary?.byFailureKind ?? {})} · provedores ${formatCountMap(runtimeOverlaySummary?.byProvider ?? {})} · elegibilidade efetiva ${effectiveEligibility?.decisions.length ?? 0}\x1b[0m\n`,
        );
        println(
            `  \x1b[90mpós-execução perfis ${postRuntimeSelection?.summary.selectedProfileCount ?? 0}/${postRuntimeSelection?.summary.profileCount ?? 0} · saúde casada ${postRuntimeSelection?.summary.healthRecordCount ?? 0} · provas de saúde ${postRuntimeSelection?.summary.runtimeHealthProofCount ?? 0} · provas agente ${postRuntimeSelection?.summary.runtimeAgentProbeProofCount ?? 0} · provas de sonda ${postRuntimeSelection?.summary.runtimeProbeProofCount ?? 0} · provedores ${formatCountMap(postRuntimeSelection?.summary.selectedProviders ?? {})}\x1b[0m\n`,
        );
        println(
            `  \x1b[90mcomparação mudou ${selectionComparison?.summary.changedCount ?? 0}/${selectionComparison?.summary.profileCount ?? 0} · prova pós-runtime selecionada ${selectionComparison?.summary.postRuntimeProofSelectedCount ?? 0}/${selectionComparison?.summary.profileCount ?? 0}\x1b[0m\n`,
        );
        println(
            `  \x1b[90mrazões da comparação ${formatCountMap(selectionComparisonExplanation?.summary.reasonCounts ?? {})} · próximos ${selectionComparisonExplanation?.summary.nextActions.slice(0, 4).join(',') || '-'}\x1b[0m\n`,
        );
        println(
            `  \x1b[90mpolítica ${renderByokTokenLabel(policyResolution?.mode ?? args.selectionPolicy)} · selecionados finais ${policyResolution?.summary.selectedCount ?? 0}/${policyResolution?.summary.profileCount ?? 0} · vencedores pós-execução ${policyResolution?.summary.postRuntimeWinnerCount ?? 0} · mudou do pré-runtime ${policyResolution?.summary.changedFromPreRuntimeCount ?? 0}\x1b[0m\n`,
        );
        println(
            `  \x1b[90mseletor de execução ${runtimeSelectorPlan?.ready ? 'pronto' : 'bloqueado'} · selecionados ${runtimeSelectorPlan?.summary.selectedProfileCount ?? 0}/${runtimeSelectorPlan?.summary.profileCount ?? 0} · bloqueados ${runtimeSelectorPlan?.summary.blockedProfileCount ?? 0} · env pronto ${runtimeSelectorPlan?.summary.runtimeEnvReadyCount ?? 0} · env bloqueado ${runtimeSelectorPlan?.summary.runtimeEnvBlockedCount ?? 0} · prova selecionada ${runtimeSelectorPlan?.summary.runtimeProofSelectedCount ?? 0}\x1b[0m\n`,
        );
        if (args.writeTrace) {
            println(
                `  \x1b[90mtrace persistido ${tracePersistence?.written ? 'sim' : 'nao'} · arquivo ${tracePersistence?.filePath ?? '-'} · mais recente ${tracePersistence?.latestPath ?? '-'} · erro ${tracePersistence?.error ?? '-'}\x1b[0m\n`,
            );
        }
    }
    for (const profile of selection.profiles) {
        const selected = profile.selected;
        const supply = profile.capabilitySupply;
        const supplyLine =
            supply && typeof supply === 'object'
                ? [
                      `obrigatórias ${formatCountMap(supply.required ?? {})}`,
                      `flexíveis ${formatCountMap(supply.softRequired ?? {})}`,
                      `preferidas ${formatCountMap(supply.preferred ?? {})}`,
                  ].join(' · ')
                : '';
        if (selected) {
            println(
                `    \x1b[32m${profile.profileId}\x1b[0m  \x1b[90m${selected['providerId']}:${selected['providerModel']} · seletor ${renderByokTokenLabel(optionalScalarString(selected['selectorKind']))} · pontuação ${selected['score'] ?? '-'} · candidatos ${profile.candidateCount} · rejeitados ${profile.rejectedCount}\x1b[0m`,
            );
        } else {
            println(
                `    \x1b[31m${profile.profileId}\x1b[0m  \x1b[90msem selecionado · candidatos ${profile.candidateCount} · rejeitados ${profile.rejectedCount} · próxima ação ${profile.nextActions.slice(0, 3).join(',') || '-'}\x1b[0m`,
            );
            if (profile.topRejectedReasons.length > 0) {
                println(`      \x1b[90mmotivos de rejeição ${profile.topRejectedReasons.slice(0, 5).join(',')}\x1b[0m`);
            }
        }
        if (supplyLine) println(`      \x1b[90msupply ${supplyLine}\x1b[0m`);
        const comparisonRow = selectionComparison?.rows.find((row) => row.profileId === profile.profileId);
        const comparisonExplanation = selectionComparisonExplanation?.rows.find((row) => row.profileId === profile.profileId);
        if (comparisonRow?.changed || (args.effective && comparisonRow?.postSelected)) {
            const postSelected = comparisonRow.postSelected;
            const postLabel = postSelected
                ? `${postSelected['providerId']}:${postSelected['providerModel']} · seletor ${renderByokTokenLabel(optionalScalarString(postSelected['selectorKind']))} · pontuação ${postSelected['score'] ?? '-'}`
                : 'sem selecionado';
            println(
                `      \x1b[90mpós-execução ${comparisonRow.changed ? 'mudou' : 'igual'} -> ${postLabel} · prova runtime ${comparisonRow.postSelectedHasRuntimeProof ? 'sim' : 'nao'}\x1b[0m`,
            );
        }
        if (args.effective && comparisonExplanation) {
            println(
                `      \x1b[90mcomparação ${comparisonExplanation.reason} · próxima ação ${comparisonExplanation.nextActions.slice(0, 3).join(',')}\x1b[0m`,
            );
        }
        if (Array.isArray(profile.supplyWarnings) && profile.supplyWarnings.length > 0) {
            println(`      \x1b[33mavisos ${profile.supplyWarnings.slice(0, 6).join(',')}\x1b[0m`);
        }
    }
    const localProviderBlocks = summarizeModelGatewayLocalProviderOptInBlocks(selection);
    if (localProviderBlocks.hasBlocks) {
        println(`\n  \x1b[33m${renderModelGatewayLocalProviderOptInGuidance({ profileIds: localProviderBlocks.blockedProfileIds })}\x1b[0m`);
    }
    println(
        `\n  \x1b[90mEsta auditoria encerra a etapa ${args.effective ? 'efetiva sem novas sondas' : 'pré-runtime'}: ela rankeia por metadados/overlays/política${args.effective ? ' e saúde já observada' : ''}; sondas live ficam para a fase seguinte.\x1b[0m\n`,
    );
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
        `  \x1b[90mJSON: ${jsonStore.filePath} · SQLite: copilot.sqlite · modo espelho redigido · sem rede\x1b[0m\n`,
    );
    const result = await mirrorModelGatewayCatalogSnapshotToSqlite({
        sourceStore: jsonStore,
        sqliteStore,
    });
    const diagnostics = await sqliteStore.readStorageDiagnostics();
    const counts = result.sqliteCounts;
    println(
        `    \x1b[32mSnapshot espelhado no SQLite\x1b[0m  \x1b[90mfonte ${result.sqliteSnapshot.source} · projeções ${counts.projections} · evidências ${counts.evidences} · rotas ${counts.routeOptions} · overlays ${counts.accountOverlays} · elegibilidade ${counts.modelEligibilityDecisions}\x1b[0m`,
    );
    println(
        `    \x1b[90mprovedores ${counts.providerProjections} · evidências de provedor ${counts.providerEvidences} · refs brutas ${counts.rawPayloadRefs} · conflitos ${counts.conflicts} · runs de importação ${counts.importRuns}\x1b[0m`,
    );
    println(
        `    \x1b[90mSQLite: versão ${diagnostics.userVersion} · linhas de catálogo ${diagnostics.catalogRows} · histórico de conta ${diagnostics.accountHistoryRows} · execução ${diagnostics.runtimeRows} · decisões de rota ${diagnostics.routeDecisionRows}\x1b[0m`,
    );
    println(
        `    \x1b[90mParidade ${result.parity.ok ? 'ok' : 'divergente'} · snapshot ${result.parity.snapshotIdMatches ? 'ok' : 'diferente'} · divergências ${result.parity.countMismatches.length}\x1b[0m`,
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
    println(`\n  \x1b[36mBYOK espelho SQLite da saúde runtime\x1b[0m`);
    println('  \x1b[90mFonte: byok-provider-health · destino: copilot.sqlite · fatos de execução separados do catálogo\x1b[0m\n');
    const result = await flushAndMirrorByokProviderHealthToSqlite({ sqliteStore });
    println(
        `    \x1b[32mSaúde runtime espelhada no SQLite\x1b[0m  \x1b[90mflush ${result.flushed ? 'sim' : 'nao'} · registros ${result.records} · observações ${result.healthObservations} · sondas ${result.probeResults} · run ${result.runId}\x1b[0m\n`,
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
              routeOptions: snapshot?.routeOptions ?? [],
    });
    println(`\n  \x1b[36mBYOK schema OpenAI normalizado\x1b[0m`);
    println(
        `  \x1b[90mFonte: ${useSqlite ? 'sqlite' : 'json'} · objeto ${openaiList.object} · modelos ${openaiList.data.length} · extensão x_model_gateway\x1b[0m\n`,
    );
    for (const model of openaiList.data.slice(0, 12)) {
        const gateway = asRecord(model.x_model_gateway);
        const providerId = optionalScalarString(gateway['provider_id']) ?? '-';
        const providerModel = optionalScalarString(gateway['provider_model']) ?? model.id;
        const eligibility = asRecord(gateway['eligibility']);
        const eligibilityStatus = renderByokTokenLabel(optionalScalarString(eligibility['status']));
        const routeOptionCount = Array.isArray(gateway['route_options']) ? gateway['route_options'].length : 0;
        println(
            `    \x1b[33m${model.id}\x1b[0m  \x1b[90mprovedor ${providerId} · modelo do provedor ${providerModel} · rotas ${routeOptionCount} · elegibilidade ${eligibilityStatus}\x1b[0m`,
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
    println(`\n  \x1b[36mBYOK explicação do catálogo\x1b[0m`);
    println(`  \x1b[90mCatálogo: ${store.filePath} · filtro ${normalizedSelector ?? '-'} · sem runtime\x1b[0m\n`);
    if (!normalizedSelector) {
        println('    \x1b[33mInforme um modelo, provedor:modelo ou trecho do nome exibido.\x1b[0m\n');
        return;
    }
    const snapshot = await store.readSnapshot();
    let explanation = explainModelGatewayCatalogEntry(snapshot, normalizedSelector);
    if (!explanation.found || !explanation.projection) {
        println(
            `    \x1b[33mModelo não encontrado no snapshot atual.\x1b[0m  \x1b[90mpróxima ação ${explanation.nextActions.join(',')}\x1b[0m\n`,
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
        println('    \x1b[33mModelo não encontrado após juntar saúde runtime.\x1b[0m\n');
        return;
    }
    const eligibility = explanation.eligibility;
    println(`    \x1b[33m${explanation.key}\x1b[0m`);
    println(
        `      \x1b[90mnome ${optionalScalarString(projection['displayName']) ?? '-'} · lifecycle ${optionalScalarString(projection['lifecycle']) ?? '-'} · família ${optionalScalarString(projection['family']) ?? '-'}\x1b[0m`,
    );
    println(
        `      \x1b[90mrotas ${explanation.routeOptions.length} · overlays ${explanation.accountOverlays.length} · elegibilidade ${eligibility?.status ?? '-'} · OpenAI id ${explanation.openai?.id ?? '-'}\x1b[0m`,
    );
    println(
        `      \x1b[90msaúde runtime ${renderByokTokenLabel(explanation.runtimeHealth?.status)} · sondas runtime ${explanation.runtimeProbes.length}\x1b[0m`,
    );
    println(
        `      \x1b[90mmetadados: campos com confiança ${explanation.metadataCoverage.confidenceFields} · proveniência ${explanation.metadataCoverage.provenanceFields} · parâmetros suportados ${explanation.metadataCoverage.supportedParameters} · não suportados ${explanation.metadataCoverage.unsupportedParameters}\x1b[0m`,
    );
    for (const route of explanation.routeOptions.slice(0, 4)) {
        const policy = asRecord(route['normalizedPolicy']);
        println(
            `      \x1b[90mrota ${renderByokTokenLabel(optionalScalarString(route['selectorKind']))}:${optionalScalarString(route['selectorSyntax']) ?? '-'} · camada ${renderByokTokenLabel(optionalScalarString(policy['routeLayer']))} · protocolo ${renderByokWireLabel(optionalScalarString(policy['wireApi']))}\x1b[0m`,
        );
    }
    for (const overlay of explanation.accountOverlays.slice(0, 3)) {
        println(
            `      \x1b[90moverlay escopo ${optionalScalarString(overlay['accountScope']) ?? 'default'} · segredo ${optionalScalarString(overlay['secretRef']) ?? '-'} · habilitados ${Array.isArray(overlay['enabledModels']) ? overlay['enabledModels'].length : 0} · bloqueados ${Array.isArray(overlay['blockedModels']) ? overlay['blockedModels'].length : 0}\x1b[0m`,
        );
    }
    if (eligibility) {
        println(
            `      \x1b[90melegibilidade ${eligibility.summary} · próxima ação ${eligibility.nextActions.slice(0, 4).join(',') || '-'}\x1b[0m`,
        );
    }
    println(`      \x1b[90mpróxima ação ${explanation.nextActions.slice(0, 6).join(',') || '-'}\x1b[0m\n`);
}

/**
 * @param {(text: string) => void} println
 * @param {string | null} selector
 * @returns {Promise<void>}
 */
async function renderByokGatewayProviderExplain(println, selector) {
    const normalizedSelector = optionalScalarString(selector);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    println(`\n  \x1b[36mBYOK explicação do provedor\x1b[0m`);
    println(`  \x1b[90mCatálogo: ${store.filePath} · filtro ${normalizedSelector ?? '-'} · sem runtime\x1b[0m\n`);
    if (!normalizedSelector) {
        println('    \x1b[33mInforme um id de provedor ou nome exibido.\x1b[0m\n');
        return;
    }
    const explanation = explainModelGatewayProviderEntry(await store.readSnapshot(), normalizedSelector);
    if (!explanation.found) {
        println(`    \x1b[33mProvedor não encontrado.\x1b[0m  \x1b[90mpróxima ação ${explanation.nextActions.join(',')}\x1b[0m\n`);
        return;
    }
    println(`    \x1b[33m${explanation.providerId}\x1b[0m`);
    println(
        `      \x1b[90mfontes ${explanation.sources.length} · evidências de provedor ${explanation.providerEvidences.length} · modelos ${explanation.projections.length} · rotas ${explanation.routeOptions.length} · overlays ${explanation.accountOverlays.length} · conflitos ${explanation.conflicts.length}\x1b[0m`,
    );
    println(
        `      \x1b[90mfrescor mais novo ${explanation.freshness.newestSourceAt ?? '-'} · mais antigo ${explanation.freshness.oldestSourceAt ?? '-'}\x1b[0m`,
    );
    if (explanation.providerProjection) {
        println(
            `      \x1b[90mnome ${optionalScalarString(explanation.providerProjection['displayName']) ?? '-'} · provedor descrito ${optionalScalarString(explanation.providerProjection['subjectProviderId']) ?? '-'}\x1b[0m`,
        );
    }
    for (const source of explanation.sources.slice(0, 4)) {
        println(
            `      \x1b[90mfonte ${optionalScalarString(source['id']) ?? '-'} · tipo ${renderByokTokenLabel(optionalScalarString(source['kind']))} · autenticação ${renderByokTokenLabel(optionalScalarString(source['authMode']))} · atualização ${renderByokTokenLabel(optionalScalarString(source['refreshPolicy']))}\x1b[0m`,
        );
    }
    const firstConflict = explanation.conflicts[0] ?? null;
    if (firstConflict) {
        println(
            `      \x1b[90mconflito ${optionalScalarString(firstConflict['projectionKey']) ?? '-'} · campo ${optionalScalarString(firstConflict['fieldPath']) ?? '-'}\x1b[0m`,
        );
    }
    println(`      \x1b[90mpróxima ação ${explanation.nextActions.slice(0, 6).join(',') || '-'}\x1b[0m\n`);
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
 * @param {{ apply?: boolean; persist?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoStatus(println, rest, options = {}) {
    const status = await buildTerminalByokGatewayAutoStatus(rest, {
        allowEffects: options.apply === true,
        persistAutomationDecision: options.persist === true || options.apply === true,
    });
    const { args, controllerStep, decision, inventory, persistence, runtimeSelectorPlan } = status;
    const activeRoute =
        runtimeSelectorPlan.routes.find((route) => route.profileId === args.profileId) ?? runtimeSelectorPlan.routes[0] ?? null;
    const alternativeSummary = activeRoute?.alternativeSummary ?? null;
    println(`\n  \x1b[36mBYOK model-gateway auto\x1b[0m`);
    println(
        `  \x1b[90mperfil ${args.profileId} · seletor de execução ${runtimeSelectorPlan.ok ? 'ok' : 'bloqueado'} · selecionados ${runtimeSelectorPlan.summary.selectedProfileCount}/${runtimeSelectorPlan.summary.profileCount} · ação ${renderByokTokenLabel(decision.action)} · ok ${decision.ok ? 'sim' : 'nao'}\x1b[0m`,
    );
    println(
        `    política:      \x1b[33mtroca viva ${args.allowLiveSetModel ? 'sim' : 'nao'} · nova sessão ${args.allowNewSession ? 'sim' : 'nao'} · local privado ${args.allowLocalPrivate ? 'sim' : 'nao'}\x1b[0m`,
    );
    println(`    rota:          \x1b[33m${decision.selectedRouteKey ?? '-'}\x1b[0m`);
    if (decision.fallbackFromSelectedRouteKey || decision.fallbackReason) {
        println(
            `    alternativa:   \x1b[33morigem ${decision.fallbackFromSelectedRouteKey ?? '-'} · motivo ${renderByokTokenLabel(decision.fallbackReason)}\x1b[0m`,
        );
    }
    println(`    alvo:          \x1b[33m${decision.targetBoundary.preset ?? '-'} · ${decision.targetBoundary.model ?? '-'}\x1b[0m`);
    println(`    sessão viva:   \x1b[33m${inventory.currentSessionId ?? '(sem sessão viva)'}\x1b[0m`);
    println(`    atual:         \x1b[33m${decision.currentBoundary.preset ?? '-'} · ${decision.currentBoundary.model ?? '-'}\x1b[0m`);
    println(`    troca viva:    \x1b[33m${decision.canApplyLiveModel ? 'sim' : 'nao'}\x1b[0m`);
    println(`    nova sessao:   \x1b[33m${decision.requiresNewSession ? 'sim' : 'nao'}\x1b[0m`);
    if (decision.blockerClass && decision.blockerClass !== 'none') {
        println(`    classe:        \x1b[33m${decision.blockerClass}\x1b[0m`);
    }
    if (decision.nonActionReason) println(`    sem ação:      \x1b[33m${decision.nonActionReason}\x1b[0m`);
    if (decision.cooldown?.active === true) {
        println(
            `    cooldown:      \x1b[33m${decision.cooldown.reason ?? 'ativo'} · reset ${decision.cooldown.resetAt ?? '-'} · nova tentativa ${decision.cooldown.retryAfterSeconds ?? '-'}s\x1b[0m`,
        );
    }
    if (alternativeSummary) {
        const rejectionCounts = asRecord(alternativeSummary.rejectionReasonCounts);
        const topReasons = Object.entries(rejectionCounts)
            .sort((left, right) => Number(right[1] ?? 0) - Number(left[1] ?? 0))
            .slice(0, 4)
            .map(([reason, count]) => `${renderByokTokenLabel(reason)}:${count}`)
            .join(', ');
        println(
            `    alternativas:  \x1b[33musáveis ${alternativeSummary.usableCount}/${alternativeSummary.evaluatedCount} · provedores ${alternativeSummary.providerCount}${topReasons ? ` · ${topReasons}` : ''}\x1b[0m`,
        );
        const topBlocked = Array.isArray(alternativeSummary.topBlockedRoutes) ? alternativeSummary.topBlockedRoutes.slice(0, 3) : [];
        for (const blocked of topBlocked) {
            const providerId = optionalScalarString(blocked?.providerId) ?? '-';
            const providerModel = optionalScalarString(blocked?.providerModel) ?? '-';
            const reasons = Array.isArray(blocked?.reasons)
                ? blocked.reasons.map(optionalScalarString).filter((item) => item !== null).slice(0, 3).join('+')
                : '-';
            println(`      \x1b[90mbloqueada: ${providerId}:${providerModel} · ${renderByokTokenList((reasons || '-').split('+'))}\x1b[0m`);
        }
        for (const proof of buildModelGatewayRuntimeProofCommands(alternativeSummary)) {
            println(`      \x1b[90mprovar: ${proof.command}\x1b[0m`);
        }
    }
    if (decision.blockers.length > 0) println(`    bloqueios:     \x1b[33m${decision.blockers.join(', ')}\x1b[0m`);
    if (persistence) {
        println(`    persistência:  \x1b[32m${persistence.automationDecisions} decisão(ões) gravada(s)\x1b[0m`);
    }
    if (controllerStep.effects.length > 0) {
        println(
            `    efeitos:       \x1b[90m${controllerStep.effects.map((effect) => `${effect['kind']} · ${effect['execute'] === true ? 'executar' : optionalScalarString(effect['authorization']) ?? 'simular'}${effect['blockedReason'] ? ` · bloqueio ${effect['blockedReason']}` : ''}`).join(', ')}\x1b[0m`,
        );
    }
    println(`    resumo:        \x1b[90m${decision.operatorSummary}\x1b[0m`);
    println(`    próximo:       \x1b[90m${decision.nextCommands.join(' && ')}\x1b[0m\n`);
    if (options.apply === true) {
        const application = await applyByokGatewayAutoEffects(println, controllerStep);
        const effectPersistence = await persistTerminalByokGatewayAutoEffectApplications(status, application, {
            source: 'terminal-byok-auto-apply',
        });
        if (effectPersistence) {
            println(
                `  \x1b[90mtrilha auto: ${effectPersistence.automationEffectApplications} efeito(s) e ${effectPersistence.sdkSessionHandoffs} handoff(s) gravado(s) no SQLite.\x1b[0m\n`,
            );
        }
    }
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoProofPlan(println, rest) {
    const limit = parseByokGatewayAutoHistoryLimit(rest);
    const status = await buildTerminalByokGatewayAutoStatus(rest, {
        allowEffects: false,
        persistAutomationDecision: false,
    });
    const rows = status.runtimeSelectorPlan.routes.flatMap((route) =>
        buildModelGatewayRuntimeProofCommands(route.alternativeSummary, { limit }).map((proof) => ({
            profileId: route.profileId,
            status: route.status,
            alternativeSummary: route.alternativeSummary,
            ...proof,
        })),
    );
    const visibleRows = rows.slice(0, limit);
    const evaluated = status.runtimeSelectorPlan.routes.reduce((sum, route) => sum + route.alternativeSummary.evaluatedCount, 0);
    const usable = status.runtimeSelectorPlan.routes.reduce((sum, route) => sum + route.alternativeSummary.usableCount, 0);
    println('\n  \x1b[36mBYOK plano de provas automáticas\x1b[0m');
    println(
        `  \x1b[90mperfil ${status.args.profileId} · seletor de execução ${status.runtimeSelectorPlan.ok ? 'ok' : 'bloqueado'} · comandos ${rows.length} · alternativas ${usable}/${evaluated} · sem chamada a provedor\x1b[0m`,
    );
    if (visibleRows.length === 0) {
        println('  \x1b[90mNenhum comando de prova foi derivado das alternativas bloqueadas atuais.\x1b[0m\n');
        return;
    }
    for (const [index, row] of visibleRows.entries()) {
        println(
            `    ${index + 1}. \x1b[33m${row.command}\x1b[0m  \x1b[90mperfil ${row.profileId} · motivos ${renderByokTokenList(row.reasons.slice(0, 3)) || '-'}\x1b[0m`,
        );
    }
    println('  \x1b[90mCada comando roda sessão SDK descartável e alimenta a saúde runtime usada pelo seletor; nada é aplicado automaticamente aqui.\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoStandby(println, rest) {
    const limit = parseByokGatewayAutoHistoryLimit(rest);
    if (rest.some((item) => /^(persisted|persistido|read-sqlite|sqlite|db)$/iu.test(item))) {
        const profile =
            rest
                .map((item) => item.match(/^profile[:=](.+)$/iu)?.[1]?.trim())
                .find((value) => value) ?? 'repo_agent';
        const plans = await new SqliteModelGatewayCatalogStore().readStandbyPlanRecords({ limit, profileId: profile });
        const latest = plans[0] ?? null;
        const latestSummary = asRecord(latest?.['summary']);
        const latestRoutes = Array.isArray(latest?.['routes']) ? latest['routes'] : [];
        println('\n  \x1b[36mBYOK model-gateway auto standby persistido\x1b[0m');
        println(
            `  \x1b[90mperfil ${profile} · planos ${plans.length} · rotas mais recentes ${latestSummary['routeCount'] ?? latestRoutes.length} · sem chamada a provedor\x1b[0m`,
        );
        if (plans.length === 0) {
            println(
                `  \x1b[90mNenhum standby persistido. Grave com: npm run model-gateway:auto:standby -- --profile=${profile} --limit=${limit} --write-sqlite\x1b[0m\n`,
            );
            return;
        }
        for (const [index, plan] of plans.entries()) {
            const summary = asRecord(plan['summary']);
            const routes = Array.isArray(plan['routes']) ? plan['routes'] : [];
            println(
                `    ${index + 1}. \x1b[33m${plan['standbyPlanId'] ?? '-'}\x1b[0m  \x1b[90mestado ${renderByokTokenLabel(optionalScalarString(plan['status']))} · rotas ${summary['routeCount'] ?? routes.length} · provedores ${summary['providerCount'] ?? 0} · gerado ${plan['generatedAt'] ?? plan['generatedAtMs'] ?? '-'}\x1b[0m`,
            );
        }
        return;
    }
    const status = await buildTerminalByokGatewayAutoStatus(rest, {
        allowEffects: false,
        persistAutomationDecision: false,
    });
    const standbyPlan = buildModelGatewayRuntimeStandbyPlan(status.runtimeSelectorPlan, {
        limit,
        profileId: status.args.profileId,
    });
    const rows = standbyPlan.routes;
    const visibleRows = rows.slice(0, limit);
    const proofCount = standbyPlan.summary.runtimeProofCount;
    const providerCount = standbyPlan.summary.providerCount;
    println('\n  \x1b[36mBYOK model-gateway auto standby\x1b[0m');
    println(
        `  \x1b[90mperfil ${status.args.profileId} · seletor de execução ${status.runtimeSelectorPlan.ok ? 'ok' : 'bloqueado'} · rotas ${rows.length} · provas ${proofCount} · provedores ${providerCount} · sem chamada a provedor\x1b[0m`,
    );
    if (visibleRows.length === 0) {
        println('  \x1b[90mNenhuma rota de prontidao foi derivada do selector atual.\x1b[0m\n');
        return;
    }
    for (const [index, row] of visibleRows.entries()) {
        const source = row.source === 'selected' ? 'selecionada' : 'alternativa';
        println(
            `    ${index + 1}. \x1b[33m${row.providerId}:${row.providerModel}\x1b[0m  \x1b[90m${source} · classe ${renderByokTokenLabel(row.standbyClass)} · precisa sonda ${row.needsProbe ? 'sim' : 'nao'} · perfil ${row.profileId} · prova ${row.hasRuntimeProof ? 'sim' : 'nao'} · env ${renderByokTokenLabel(row.runtimeEnvStatus)} · pontuação ${row.score ?? '-'}\x1b[0m`,
        );
        println(`       \x1b[90mprovar: ${row.commands.probeAgent ?? '-'}\x1b[0m`);
        println(`       \x1b[90mmesmo provedor: ${row.commands.liveModel ?? '-'}\x1b[0m`);
        println(`       \x1b[90mnovo boot: ${row.commands.newSession} && ${row.commands.provider ?? '-'}\x1b[0m`);
        println(`       \x1b[90mpersistir: ${row.commands.persistProvider ?? '-'}\x1b[0m`);
    }
    println('  \x1b[90mStandby nao aplica efeitos; ele mostra substitutos prontos e comandos explicitos para o operador escolher.\x1b[0m\n');
}

/**
 * @param {string[]} rest
 * @returns {string}
 */
function resolveByokGatewayAutoOnPresetId(rest) {
    const presetToken = rest.find((item) => /^(?:preset|policyPreset|policy-preset|autoPreset|auto-preset)[:=]/iu.test(item));
    return (
        optionalScalarString(
            presetToken?.replace(/^(?:preset|policyPreset|policy-preset|autoPreset|auto-preset)[:=]/iu, ''),
        ) ?? 'auto_same_boundary'
    );
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoOn(println, rest) {
    const presetId = resolveByokGatewayAutoOnPresetId(rest);
    const autoOnRest = rest.some((item) => /^(?:preset|policyPreset|policy-preset|autoPreset|auto-preset)[:=]/iu.test(item))
        ? rest
        : [...rest, `preset:${presetId}`];
    const args = parseTerminalByokGatewayAutoArgs(autoOnRest);
    const status = await buildTerminalByokGatewayAutoStatus(autoOnRest);
    const { decision } = status;
    const policyPatch = resolveModelGatewayRuntimeAutomationPolicyPreset(args.presetId, {
        enabled: true,
        profiles: [args.profileId],
        allowLiveSetModel: args.allowLiveSetModel,
        allowNewSession: args.allowNewSession,
        allowLocalPrivate: args.allowLocalPrivate,
    });
    const policyValidation = validateModelGatewayRuntimeAutomationPolicy(policyPatch);
    if (policyValidation.ok !== true) {
        println('\n  \x1b[36mBYOK model-gateway auto on\x1b[0m');
        println(`    preset:        \x1b[33m${args.presetId}\x1b[0m`);
        println(`    validacao:     \x1b[33m${policyValidation.issues.join(', ')}\x1b[0m`);
        println(`    presets:       \x1b[90m${policyValidation.allowedPresets.join(', ')}\x1b[0m\n`);
        return;
    }
    const written = await writeModelGatewayRuntimeAutomationPolicyFile(policyPatch);
    const exports = [
        'COPILOT_BYOK_GATEWAY_AUTO=true',
        `COPILOT_BYOK_GATEWAY_AUTO_PRESET=${written.policy.preset}`,
        `COPILOT_BYOK_GATEWAY_AUTO_POLICY=${written.policy.policy}`,
        `COPILOT_BYOK_GATEWAY_AUTO_PROFILES=${args.profileId}`,
        `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LIVE_SET_MODEL=${args.allowLiveSetModel ? 'true' : 'false'}`,
        `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_NEW_SESSION=${args.allowNewSession ? 'true' : 'false'}`,
        `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LOCAL_PRIVATE=${args.allowLocalPrivate ? 'true' : 'false'}`,
    ];
    println('\n  \x1b[36mBYOK model-gateway auto on\x1b[0m');
    println('  \x1b[90mPolicy segura persistida para o proximo boot; segredos nao sao gravados nesse arquivo.\x1b[0m');
    println(`    arquivo:       \x1b[33m${written.filePath}\x1b[0m`);
    println(`    perfil:        \x1b[33m${args.profileId}\x1b[0m`);
    println(`    preset:        \x1b[33m${written.policy.preset}\x1b[0m`);
    println(`    policy:        \x1b[33m${written.policy.policy}\x1b[0m`);
    println(
        `    flags:         \x1b[33mtroca viva ${args.allowLiveSetModel ? 'sim' : 'nao'} · nova sessão ${args.allowNewSession ? 'sim' : 'nao'} · local privado ${args.allowLocalPrivate ? 'sim' : 'nao'}\x1b[0m`,
    );
    println(`    preview:       \x1b[33mação ${decision.action} · rota ${decision.selectedRouteKey ?? '-'} · ok ${decision.ok ? 'sim' : 'nao'}\x1b[0m`);
    println(`    resumo:        \x1b[90m${decision.operatorSummary}\x1b[0m`);
    println('    env sugerido:');
    for (const line of exports) {
        println(`      \x1b[90mexport ${line}\x1b[0m`);
    }
    println('    próximo:       \x1b[90mreinicie o terminal ou exporte as variaveis antes de iniciar a proxima sessao\x1b[0m\n');
}

/**
 * @param {string[]} rest
 * @returns {number}
 */
function parseByokGatewayAutoHistoryLimit(rest) {
    const numeric = rest.map((item) => Number(item)).find((value) => Number.isFinite(value) && value > 0);
    return Math.min(Math.max(Math.floor(numeric ?? 10), 1), 50);
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoHistory(println, rest) {
    const limit = parseByokGatewayAutoHistoryLimit(rest);
    const rows = await new SqliteModelGatewayCatalogStore().readAutomationDecisionRecords({ limit });
    println('\n  \x1b[36mBYOK model-gateway auto history\x1b[0m');
    if (rows.length === 0) {
        println('  \x1b[90mNenhuma decisão auto persistida ainda. Use /byok auto record profile:<id> para gravar uma trilha.\x1b[0m\n');
        return;
    }
    rows.slice(0, limit).forEach((row, index) => {
        const decidedAt = optionalScalarString(row['timestamp']) ?? optionalScalarString(row['generatedAt']) ?? '-';
        const action = optionalScalarString(row['action']) ?? '-';
        const route = optionalScalarString(row['selectedRouteKey']) ?? '-';
        const profile = optionalScalarString(row['routeProfile']) ?? '-';
        const ok = row['ok'] === true ? 'ok' : row['ok'] === false ? 'blocked' : optionalScalarString(row['status']) ?? '-';
        println(`    ${index + 1}. \x1b[33m${action}\x1b[0m  \x1b[90mrota ${route} · perfil ${profile} · estado ${ok} · decidido ${decidedAt}\x1b[0m`);
    });
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoHandoffs(println, rest) {
    const limit = parseByokGatewayAutoHistoryLimit(rest);
    const rows = await new SqliteModelGatewayCatalogStore().readSdkSessionHandoffRecords({ limit });
    println('\n  \x1b[36mBYOK model-gateway auto handoffs\x1b[0m');
    if (rows.length === 0) {
        println('  \x1b[90mNenhum handoff SDK persistido ainda.\x1b[0m\n');
        return;
    }
    rows.slice(0, limit).forEach((row, index) => {
        const status = optionalScalarString(row['status']) ?? '-';
        const model = optionalScalarString(row['targetModel']) ?? optionalScalarString(row['model']) ?? '-';
        const route = optionalScalarString(row['selectedRouteKey']) ?? '-';
        const requestedAt = optionalScalarString(row['requestedAt']) ?? optionalScalarString(row['timestamp']) ?? '-';
        println(`    ${index + 1}. \x1b[33m${status}\x1b[0m  \x1b[90mmodelo ${model} · rota ${route} · solicitado ${requestedAt}\x1b[0m`);
    });
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoConfirmations(println, rest) {
    const limit = parseByokGatewayAutoHistoryLimit(rest);
    const rows = await new SqliteModelGatewayCatalogStore().readSdkSessionConfirmationRecords({ limit });
    println('\n  \x1b[36mBYOK model-gateway auto confirmations\x1b[0m');
    if (rows.length === 0) {
        println('  \x1b[90mNenhuma confirmação SDK persistida ainda.\x1b[0m\n');
        return;
    }
    rows.slice(0, limit).forEach((row, index) => {
        const status = optionalScalarString(row['status']) ?? '-';
        const previousModel = optionalScalarString(row['previousModel']) ?? '-';
        const confirmedModel = optionalScalarString(row['confirmedModel']) ?? optionalScalarString(row['newModel']) ?? '-';
        const observedAt = optionalScalarString(row['observedAt']) ?? optionalScalarString(row['timestamp']) ?? '-';
        println(
            `    ${index + 1}. \x1b[33m${status}\x1b[0m  \x1b[90m${previousModel} -> ${confirmedModel} · observado ${observedAt}\x1b[0m`,
        );
    });
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoRecoveries(println, rest) {
    const limit = parseByokGatewayAutoHistoryLimit(rest);
    const rows = await new SqliteModelGatewayCatalogStore().readRecoveryAttemptRecords({ limit });
    println('\n  \x1b[36mBYOK model-gateway auto recoveries\x1b[0m');
    if (rows.length === 0) {
        println('  \x1b[90mNenhum recovery attempt pós-falha persistido ainda.\x1b[0m\n');
        return;
    }
    rows.slice(0, limit).forEach((row, index) => {
        const status = optionalScalarString(row['status']) ?? '-';
        const scope = optionalScalarString(row['recoveryScope']) ?? '-';
        const failureKind = optionalScalarString(row['failureKind']) ?? '-';
        const route = optionalScalarString(row['selectedRouteKey']) ?? '-';
        const observedAt = optionalScalarString(row['observedAt']) ?? optionalScalarString(row['timestamp']) ?? '-';
        println(
            `    ${index + 1}. \x1b[33m${status}\x1b[0m  \x1b[90mescopo ${scope} · falha ${failureKind} · rota ${route} · observado ${observedAt}\x1b[0m`,
        );
    });
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoRecoveryFixture(println, rest) {
    const args = parseTerminalByokGatewayAutoArgs(
        rest.filter(
            (item) =>
                !/^(?:recovery-fixture|fixture-recovery|fixture|simulate|simular)$/iu.test(item) &&
                !/^(?:failure|kind|failureKind|failure-kind|provider|providerId|provider-id|model|providerModel|provider-model)[:=]/iu.test(item),
        ),
    );
    const failureKindToken = rest.find((item) => /^(?:failure|kind|failureKind|failure-kind)[:=]/iu.test(item));
    const failureKind = optionalScalarString(failureKindToken?.replace(/^(?:failure|kind|failureKind|failure-kind)[:=]/iu, '')) ?? 'rate-limit';
    const providerToken = rest.find((item) => /^(?:provider|providerId|provider-id)[:=]/iu.test(item));
    const modelToken = rest.find((item) => /^(?:model|providerModel|provider-model)[:=]/iu.test(item));
    const providerId = optionalScalarString(providerToken?.replace(/^(?:provider|providerId|provider-id)[:=]/iu, ''));
    const providerModel = optionalScalarString(modelToken?.replace(/^(?:model|providerModel|provider-model)[:=]/iu, ''));
    const writeRealHealth = rest.some((item) => /^(?:real-health|real-route|write-real-health)$/iu.test(item));
    const healthProviderId = writeRealHealth ? providerId : 'model-gateway-fixture';
    const healthProviderModel = writeRealHealth
        ? providerModel
        : `synthetic-${args.profileId}-${failureKind.replace(/[^a-z0-9_-]+/giu, '-')}`;
    const fixtureEnv = {
        ...process.env,
        COPILOT_BYOK_GATEWAY_AUTO: 'true',
        COPILOT_BYOK_GATEWAY_AUTO_PROFILES: args.profileId,
        COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LIVE_SET_MODEL: 'false',
        COPILOT_BYOK_GATEWAY_AUTO_ALLOW_NEW_SESSION: 'false',
        COPILOT_BYOK_GATEWAY_AUTO_ALLOW_PROVIDER_PROBES: 'false',
        COPILOT_BYOK_GATEWAY_AUTO_ACCOUNT_WIDE_FAILURE_KINDS: 'rate-limit,credits,quota',
    };
    const result = await runTerminalByokGatewayPostTurnAutomation(
        {
            profile: args.profileId,
            provider: healthProviderId,
            model: healthProviderModel,
            failureKind,
            retryAfterSeconds: failureKind === 'rate-limit' ? 900 : null,
            message: `fixture ${failureKind} failure for model-gateway post-turn recovery`,
            errorContext: 'terminal.byok.auto_recovery_fixture',
        },
        { env: fixtureEnv },
    );
    println('\n  \x1b[36mBYOK model-gateway auto recovery fixture\x1b[0m');
    println(
        `  \x1b[90mperfil ${args.profileId} · falha ${renderByokTokenLabel(failureKind)} · executou ${result.ran ? 'sim' : 'nao'} · sem chamada a provedor · saúde sintética ${writeRealHealth ? 'nao' : 'sim'}\x1b[0m`,
    );
    if (result.ran !== true || !result.status) {
        println('    \x1b[33mFixture não executou; verifique policy e snapshot ativo.\x1b[0m\n');
        return;
    }
    const applied = result.application?.applied ?? [];
    const skipped = result.application?.skipped ?? [];
    println(
        `    decisão:       \x1b[33mação ${result.status.decision.action} · rota ${result.status.decision.selectedRouteKey ?? '-'}\x1b[0m`,
    );
    println(
        `    efeitos:       \x1b[33maplicados ${applied.length} · pulados ${skipped.length} · persistidos ${result.effectPersistence?.automationEffectApplications ?? 0}\x1b[0m`,
    );
    println(
        `    recoveries:    \x1b[33m${result.effectPersistence?.recoveryAttempts ?? 0}\x1b[0m`,
    );
    const health = result.healthPersistence;
    if (health) {
        println(
            `    health:        \x1b[33mregistrado ${health.recorded ? 'sim' : 'nao'} · rota ${health.providerId ?? '-'}:${health.providerModel ?? '-'} · SQLite ${health.sqlite ? `${health.sqlite.healthObservations}/${health.sqlite.records}` : '-'}\x1b[0m`,
        );
    }
    const details = [...applied, ...skipped].map(describeTerminalByokGatewayAutoEffect).slice(0, 5);
    if (details.length > 0) println(`    detalhe:       \x1b[90m${details.join('; ')}\x1b[0m`);
    println('  \x1b[90mUse /byok auto recoveries 10 para ler o ledger persistido.\x1b[0m\n');
}

/**
 * @param {boolean} value
 * @returns {string}
 */
function enabledDisabled(value) {
    return value ? 'ativo' : 'desativado';
}

/**
 * @param {string | null | undefined} preset
 * @returns {string}
 */
function renderByokAutoPresetLabel(preset) {
    if (preset === 'operator_manual') return 'manual do operador';
    if (preset === 'llm_operator_guarded') return 'LLM guiada pelo operador';
    if (preset === 'auto_same_boundary') return 'auto: mesma fronteira';
    if (preset === 'auto_prepare_new_session') return 'auto: preparar nova sessão';
    return preset || '-';
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoPolicy(println) {
    const [filePolicy, effectivePolicy] = await Promise.all([
        readModelGatewayRuntimeAutomationPolicyFile(),
        readModelGatewayRuntimeAutomationEffectivePolicy(),
    ]);
    const envPolicy = readModelGatewayRuntimeAutomationPolicy();
    const policySources = explainModelGatewayRuntimeAutomationPolicySources({
        filePolicy,
        env: process.env,
    });
    const presets = listModelGatewayRuntimeAutomationPolicyPresets();
    const fileConfigured = Object.keys(filePolicy).length > 0;
    const envConfigured = Object.keys(process.env).some((key) => key.startsWith('COPILOT_BYOK_GATEWAY_AUTO'));
    println('\n  \x1b[36mBYOK model-gateway auto policy\x1b[0m');
    println(`    arquivo:       \x1b[33m${DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH}\x1b[0m`);
    println(`    arquivo cfg:   \x1b[33m${fileConfigured ? 'sim' : 'nao'}\x1b[0m`);
    println(`    env cfg:       \x1b[33m${envConfigured ? 'sim' : 'nao'}\x1b[0m`);
    println(`    efetivo:       \x1b[33m${enabledDisabled(effectivePolicy.enabled)}\x1b[0m`);
    println(
        `    política:      \x1b[33m${renderByokAutoPresetLabel(effectivePolicy.preset)}\x1b[0m  \x1b[90mfonte ${policySources['preset']?.source ?? '-'} · preset ${effectivePolicy.preset}\x1b[0m`,
    );
    println(`    regra:         \x1b[33m${effectivePolicy.policy}\x1b[0m`);
    println(`    perfis:        \x1b[33m${effectivePolicy.profiles.join(', ') || '-'}\x1b[0m`);
    println(
        `    flags:         \x1b[33mtroca viva ${effectivePolicy.allowLiveSetModel ? 'sim' : 'nao'} · nova sessão ${effectivePolicy.allowNewSession ? 'sim' : 'nao'} · probes provider ${effectivePolicy.allowProviderProbes ? 'sim' : 'nao'} · local privado ${effectivePolicy.allowLocalPrivate ? 'sim' : 'nao'}\x1b[0m`,
    );
    println(
        `    conta:         \x1b[33mfalhas globais ${effectivePolicy.accountWideFailureKinds.join(', ') || '-'}\x1b[0m`,
    );
    println('    presets:');
    for (const preset of presets) {
        println(
            `      \x1b[90m${renderByokAutoPresetLabel(String(preset['preset']))} (${preset['preset']}) · regra ${preset['policy']} · troca viva ${preset['allowLiveSetModel'] ? 'sim' : 'nao'} · nova sessão ${preset['allowNewSession'] ? 'sim' : 'nao'} · local privado ${preset['allowLocalPrivate'] ? 'sim' : 'nao'}\x1b[0m`,
        );
    }
    if (envConfigured && envPolicy.enabled !== effectivePolicy.enabled) {
        println('    \x1b[33mobs: env explicito pode sobrescrever o arquivo persistente no proximo boot.\x1b[0m');
    }
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoDoctor(println, rest) {
    const [filePolicy, effectivePolicy, status, diagnostics] = await Promise.all([
        readModelGatewayRuntimeAutomationPolicyFile(),
        readModelGatewayRuntimeAutomationEffectivePolicy(),
        buildTerminalByokGatewayAutoStatus(rest),
        new SqliteModelGatewayCatalogStore().readStorageDiagnostics(),
    ]);
    const commandCount = listModelGatewayCanonicalCommands().length;
    const fileConfigured = Object.keys(filePolicy).length > 0;
    const policySources = explainModelGatewayRuntimeAutomationPolicySources({ filePolicy, env: process.env });
    const policyValidation = validateModelGatewayRuntimeAutomationPolicy(effectivePolicy);
    const activeSnapshot = diagnostics.activeSnapshot?.exists === true;
    const effectsRows = finitePositiveNumber(diagnostics.automationEffectApplicationRows) ?? 0;
    const recoveryRows = finitePositiveNumber(diagnostics.recoveryAttemptRows) ?? 0;
    const handoffRows = finitePositiveNumber(diagnostics.sdkSessionHandoffRows) ?? 0;
    const confirmationRows = finitePositiveNumber(diagnostics.sdkSessionConfirmationRows) ?? 0;
    const liveScenarioRunRows = finitePositiveNumber(diagnostics.liveScenarioRunRows) ?? 0;
    const decision = status.decision;
    const activeRoute =
        status.runtimeSelectorPlan.routes.find((route) => route.profileId === status.args.profileId) ??
        status.runtimeSelectorPlan.routes[0] ??
        null;
    const alternativeSummary = activeRoute?.alternativeSummary ?? null;
    const warnings = [];
    if (effectivePolicy.enabled !== true) warnings.push('policy_disabled');
    if (effectivePolicy.allowLiveSetModel !== true && effectivePolicy.allowNewSession !== true) {
        warnings.push('no_effect_policy_enabled');
    }
    if (!activeSnapshot) warnings.push('no_active_catalog_snapshot');
    if (decision.ok !== true) warnings.push('automation_decision_blocked');
    if (policyValidation.ok !== true) warnings.push(...policyValidation.issues);
    println('\n  \x1b[36mBYOK model-gateway auto doctor\x1b[0m');
    println(
        `  \x1b[90mperfil ${status.args.profileId} · snapshot ativo ${activeSnapshot ? 'sim' : 'nao'} · comandos ${commandCount} · avisos ${warnings.length}\x1b[0m`,
    );
    println(
        `    política:      \x1b[33mativa ${effectivePolicy.enabled ? 'sim' : 'nao'} · arquivo ${fileConfigured ? 'sim' : 'nao'} · set model vivo ${effectivePolicy.allowLiveSetModel ? 'sim' : 'nao'} · nova sessão ${effectivePolicy.allowNewSession ? 'sim' : 'nao'}\x1b[0m`,
    );
    println(
        `    origem policy: \x1b[33mativa ${policySources['enabled']?.source ?? '-'} · perfis ${policySources['profiles']?.source ?? '-'} · set model vivo ${policySources['allowLiveSetModel']?.source ?? '-'} · nova sessão ${policySources['allowNewSession']?.source ?? '-'}\x1b[0m`,
    );
    println(
        `    decisão:       \x1b[33mok ${decision.ok ? 'sim' : 'nao'} · ação ${decision.action} · rota ${decision.selectedRouteKey ?? '-'}\x1b[0m`,
    );
    println(
        `    target:        \x1b[33m${decision.targetBoundary.preset ?? '-'} · ${decision.targetBoundary.model ?? '-'}\x1b[0m`,
    );
    if (decision.cooldown?.active === true) {
        println(
            `    cooldown:      \x1b[33m${decision.cooldown.reason ?? 'ativo'} · reset ${decision.cooldown.resetAt ?? '-'} · nova tentativa ${decision.cooldown.retryAfterSeconds ?? '-'}s\x1b[0m`,
        );
    }
    if (alternativeSummary) {
        const rejectionCounts = asRecord(alternativeSummary.rejectionReasonCounts);
        const topReasons = Object.entries(rejectionCounts)
            .sort((left, right) => Number(right[1] ?? 0) - Number(left[1] ?? 0))
            .slice(0, 4)
            .map(([reason, count]) => `${reason} ${count}`)
            .join(', ');
        println(
            `    alternativas:  \x1b[33musáveis ${alternativeSummary.usableCount}/${alternativeSummary.evaluatedCount} · provedores ${alternativeSummary.providerCount}${topReasons ? ` · ${topReasons}` : ''}\x1b[0m`,
        );
        for (const proof of buildModelGatewayRuntimeProofCommands(alternativeSummary)) {
            println(`      \x1b[90mprovar: ${proof.command}\x1b[0m`);
        }
    }
    println(
        `    registros:     \x1b[33mdecisões ${diagnostics.automationDecisionRows ?? 0} · políticas ${diagnostics.automationPolicySnapshotRows ?? 0} · efeitos ${effectsRows} · recoveries ${recoveryRows} · handoffs ${handoffRows} · confirmações ${confirmationRows} · testes vivos ${liveScenarioRunRows}\x1b[0m`,
    );
    println(
        `    sdk:           \x1b[33msessão ${status.inventory.currentSessionId ?? '-'} · sessão viva ${decision.currentBoundary.preset ?? '-'} · ${decision.currentBoundary.model ?? '-'}\x1b[0m`,
    );
    if (decision.blockers.length > 0) println(`    bloqueios:     \x1b[33m${decision.blockers.join(', ')}\x1b[0m`);
    if (warnings.length > 0) println(`    avisos:        \x1b[33m${warnings.join(', ')}\x1b[0m`);
    println(`    resumo:        \x1b[90m${decision.operatorSummary}\x1b[0m`);
    println(
        `    próximo:       \x1b[90m${warnings.includes('policy_disabled') ? '/byok auto on profile:' + status.args.profileId : decision.nextCommands.join(' && ')}\x1b[0m\n`,
    );
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayAutoOff(println) {
    const effectivePolicy = await readModelGatewayRuntimeAutomationEffectivePolicy();
    const written = await writeModelGatewayRuntimeAutomationPolicyFile({
        ...effectivePolicy,
        enabled: false,
    });
    println('\n  \x1b[36mBYOK model-gateway auto off\x1b[0m');
    println('  \x1b[90mPolicy persistente atualizada para disabled; segredos e catalogo nao foram alterados.\x1b[0m');
    println(`    arquivo:       \x1b[33m${written.filePath}\x1b[0m`);
    println(
        '  \x1b[90mSe COPILOT_BYOK_GATEWAY_AUTO=true continuar no ambiente, ele ainda sobrescreve o arquivo no proximo boot.\x1b[0m\n',
    );
}

 /**
 * @param {(text: string) => void} println
 * @param {{ effects: Array<Record<string, unknown>> }} controllerStep
 * @returns {ReturnType<typeof applyTerminalByokGatewayAutoEffects>}
 */
async function applyByokGatewayAutoEffects(println, controllerStep) {
    const application = await applyTerminalByokGatewayAutoEffects(controllerStep);
    if (application.applied.length === 0 && application.skipped.length > 0) {
        const reasons = application.skipped
            .map((effect) => describeTerminalByokGatewayAutoEffect(effect))
            .slice(0, 4)
            .join('; ');
        println(
            `  \x1b[33mNenhum efeito auto foi aplicado. ${reasons || 'Use /byok auto status para revisar blockers e flags'}.\x1b[0m\n`,
        );
        return application;
    }
    for (const effect of application.applied) {
        println(`  \x1b[32mAuto apply: ${describeTerminalByokGatewayAutoEffect(effect)}.\x1b[0m`);
    }
    for (const effect of application.skipped) {
        if (effect['skippedReason'] === 'effect_not_authorized') continue;
        println(`  \x1b[33mAuto apply: ${describeTerminalByokGatewayAutoEffect(effect)}.\x1b[0m`);
    }
    println('');
    return application;
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
        `  \x1b[90mCatálogo: ${store.filePath} · busca ${args.query || '-'} · provider ${args.providerId ?? '-'} · só elegíveis ${args.onlyEligible ? 'sim' : 'nao'} · exige tools ${args.requireTools ? 'sim' : 'nao'} · resultados ${results.length}\x1b[0m\n`,
    );
    if (results.length === 0) {
        println('    \x1b[33mNenhum modelo encontrado para os filtros informados.\x1b[0m\n');
        return;
    }
    for (const result of results) {
        println(`    \x1b[33m${result.key}\x1b[0m  \x1b[90mscore ${result.score} · elegibilidade ${result.eligibilityStatus}\x1b[0m`);
        println(
            `      \x1b[90m${result.displayName} · rotas ${result.routeOptionCount} · overlays ${result.accountOverlayCount} · campos encontrados ${result.matchedFields.slice(0, 4).join(',') || '-'}\x1b[0m`,
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
    println(`  \x1b[90mCatálogo: ${store.filePath} · filtro ${args.selector ?? '-'} · rotas ${routes.length}/${snapshot.routeOptions.length}\x1b[0m\n`);
    if (routes.length === 0) {
        println('    \x1b[33mNenhuma route option encontrada para o filtro informado.\x1b[0m\n');
        return;
    }
    for (const route of routes.slice(0, args.limit)) {
        const policy = asRecord(route['normalizedPolicy']);
        println(
            `    \x1b[33m${optionalScalarString(route['providerId']) ?? '-'}:${optionalScalarString(route['providerModel']) ?? '-'}\x1b[0m  \x1b[90mperfil ${optionalScalarString(route['routeProfile']) ?? 'default'} · seletor ${optionalScalarString(route['selectorKind']) ?? '-'}:${optionalScalarString(route['selectorSyntax']) ?? '-'}\x1b[0m`,
        );
        println(
            `      \x1b[90mcamada ${optionalScalarString(policy['routeLayer']) ?? '-'} · wire ${optionalScalarString(policy['wireApi']) ?? '-'} · fonte ${optionalScalarString(route['sourceId']) ?? '-'} · confiança ${optionalScalarString(route['confidence']) ?? '-'}\x1b[0m`,
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
        `  \x1b[90mCatálogo: ${store.filePath} · filtro ${args.selector ?? '-'} · overlays ${overlays.length}/${snapshot.accountOverlays.length} · segredos protegidos sim\x1b[0m\n`,
    );
    if (overlays.length === 0) {
        println('    \x1b[33mNenhum account overlay encontrado para o filtro informado.\x1b[0m\n');
        return;
    }
    for (const overlay of overlays.slice(0, args.limit)) {
        const enabled = Array.isArray(overlay['enabledModels']) ? overlay['enabledModels'].length : 0;
        const blocked = Array.isArray(overlay['blockedModels']) ? overlay['blockedModels'].length : 0;
        println(
            `    \x1b[33m${optionalScalarString(overlay['providerId']) ?? '-'}\x1b[0m  \x1b[90mescopo ${optionalScalarString(overlay['accountScope']) ?? 'default'} · segredo ${optionalScalarString(overlay['secretRef']) ?? '-'} · fonte ${optionalScalarString(overlay['sourceId']) ?? '-'} · confiança ${optionalScalarString(overlay['confidence']) ?? '-'}\x1b[0m`,
        );
        println(`      \x1b[90mhabilitados ${enabled} · bloqueados ${blocked} · redigido ${optionalScalarString(overlay['redactionStatus']) ?? '-'}\x1b[0m`);
    }
    if (overlays.length > args.limit) println(`\n  \x1b[90mexibindo ${args.limit}/${overlays.length}; use filtro ou limite numerico.\x1b[0m`);
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayAccounts(println, rest) {
    const args = parseGatewayCatalogListArgs(rest);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const catalogOverlays = Array.isArray(snapshot.accountOverlays) ? snapshot.accountOverlays : [];
    const runtimeOverlays = deriveModelGatewayRuntimeAccountOverlaysFromHealth(listByokProviderModelHealth());
    const accountSummary = summarizeModelGatewayAccountOverlays([...catalogOverlays, ...runtimeOverlays], { selector: args.selector });
    const statusCounts = Object.entries(accountSummary.summary.statusCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([status, count]) => `${status}:${count}`)
        .join(',');
    println(`\n  \x1b[36mBYOK contas e chaves\x1b[0m`);
    println(
        `  \x1b[90mCatálogo: ${store.filePath} · filtro ${args.selector ?? '-'} · overlays ${accountSummary.summary.matched}/${accountSummary.summary.total} · sinais runtime ${runtimeOverlays.length} · provedores ${accountSummary.summary.providers} · estados ${statusCounts || '-'}\x1b[0m\n`,
    );
    if (accountSummary.rows.length === 0) {
        println('    \x1b[33mNenhuma conta/key overlay encontrada para o filtro informado.\x1b[0m\n');
        return;
    }
    for (const row of accountSummary.rows.slice(0, args.limit)) {
        const retry = row.resetAt ? `reset ${row.resetAt}` : row.retryAfterSeconds ? `retentar em ${row.retryAfterSeconds}s` : 'reset -';
        const resetState = row.quotaResetExpired === true ? 'janela expirada' : row.quotaResetActive === true ? 'janela ativa' : null;
        const remaining = [
            row.remainingUsd !== null ? `USD restante ${row.remainingUsd}` : null,
            row.remainingCreditsUsd !== null ? `créditos USD ${row.remainingCreditsUsd}` : null,
            resetState,
        ]
            .filter(Boolean)
            .join(' · ');
        println(
            `    \x1b[33m${row.providerId}\x1b[0m  \x1b[90mescopo ${row.accountScope} · segredo ${row.secretRef ?? '-'} · estado ${row.limitStatus} · ${retry}\x1b[0m`,
        );
        println(
            `      \x1b[90mfonte ${row.sourceId ?? '-'} · tipo ${renderByokTokenLabel(row.sourceKind)} · confiança ${renderByokTokenLabel(row.confidence)} · frescor ${renderByokTokenLabel(row.freshnessStatus)} · habilitados ${row.enabledModelCount} · bloqueados ${row.blockedModelCount} · ${remaining || 'saldo -'}\x1b[0m`,
        );
    }
    if (accountSummary.rows.length > args.limit) {
        println(`\n  \x1b[90mexibindo ${args.limit}/${accountSummary.rows.length}; use filtro ou limite numerico.\x1b[0m`);
    }
    println('  \x1b[90mEsta visão é da conta/key e não executa modelo; saúde runtime continua em /byok health.\x1b[0m\n');
}

/**
 * @param {Record<string, number>} counts
 * @returns {string}
 */
function renderGatewayCountMap(counts) {
    return Object.entries(counts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, count]) => `${key}:${count}`)
        .join(',') || '-';
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {Promise<void>}
 */
async function renderByokGatewayLimits(println, rest) {
    const args = parseGatewayCatalogListArgs(rest);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const snapshot = await store.readSnapshot();
    const catalogOverlays = Array.isArray(snapshot.accountOverlays) ? snapshot.accountOverlays : [];
    const runtimeOverlays = deriveModelGatewayRuntimeAccountOverlaysFromHealth(listByokProviderModelHealth());
    const runtimeSummary = summarizeModelGatewayRuntimeAccountOverlays(runtimeOverlays);
    const explanation = explainModelGatewayAccountLimitOverlays([...catalogOverlays, ...runtimeOverlays], { selector: args.selector });
    println(`\n  \x1b[36mBYOK limites de conta\x1b[0m`);
    println(
        `  \x1b[90mCatálogo: ${store.filePath} · filtro ${args.selector ?? '-'} · overlays ${explanation.summary.matched}/${explanation.summary.total} · bloqueios ativos ${explanation.summary.activeBlockers} · sinais expirados ${explanation.summary.expiredSignals} · temporários ${explanation.summary.temporaryBlockers} · execução ${runtimeSummary.activeCount}/${runtimeSummary.total}\x1b[0m`,
    );
    println(
        `  \x1b[90mEstados: ${renderGatewayCountMap(explanation.summary.byStatus)} · camadas de fonte: ${renderGatewayCountMap(explanation.summary.bySourceLayer)}\x1b[0m\n`,
    );
    if (explanation.rows.length === 0) {
        println('    \x1b[33mNenhum limite account/key encontrado para o filtro informado.\x1b[0m\n');
        return;
    }
    for (const row of explanation.rows.slice(0, args.limit)) {
        const state = row.activeBlocker ? 'ativo' : row.expiredSignal ? 'expirado' : 'livre';
        const reset = row.resetAt ? `reset ${row.resetAt}` : row.retryAfterSeconds ? `retentar em ${row.retryAfterSeconds}s` : 'reset -';
        const money = [
            row.remainingUsd !== null ? `USD restante ${row.remainingUsd}` : null,
            row.remainingCreditsUsd !== null ? `créditos USD ${row.remainingCreditsUsd}` : null,
        ].filter(Boolean).join(' · ');
        println(
            `    \x1b[33m${row.providerId}\x1b[0m  \x1b[90mescopo ${row.accountScope} · estado ${row.limitStatus} · sinal ${state} · frescor ${row.freshnessStatus} · janela ${row.resetWindowClass} · ${reset} · expira ${row.expiresAt ?? row.effectiveExpiresAt ?? '-'}\x1b[0m`,
        );
        println(
            `      \x1b[90mfonte ${renderByokTokenLabel(row.sourceKind)}:${row.sourceId ?? '-'} · camada ${renderByokTokenLabel(row.sourceLayer)} · falha ${renderByokTokenLabel(row.failureKind)} · segredo ${row.secretRef ?? '-'} · próxima atualização ${row.nextRefreshAfter ?? '-'} · ${money || 'saldo -'}\x1b[0m`,
        );
        println(`      \x1b[90mpróxima ação ${row.nextAction}\x1b[0m`);
    }
    if (explanation.rows.length > args.limit) {
        println(`\n  \x1b[90mexibindo ${args.limit}/${explanation.rows.length}; use filtro ou limite numerico.\x1b[0m`);
    }
    println(
        '  \x1b[90mLimites provider/account podem bloquear pré-runtime; AssistantUsageQuotaSnapshot é quota SDK/Copilot e não substitui overlay BYOK externo.\x1b[0m\n',
    );
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokGatewayQuotaMatrix(println, rest) {
    const args = parseGatewayCatalogListArgs(rest);
    const matrix = summarizeModelGatewayProviderQuotaCapabilities({ selector: args.selector });
    println(`\n  \x1b[36mBYOK matriz de quotas dos provedores\x1b[0m`);
    println(
        `  \x1b[90mFiltro ${args.selector ?? '-'} · provedores ${matrix.summary.providerCount}/${matrix.summary.total} · visibilidade de conta ${matrix.summary.accountVisibilityCount} · snapshots de quota ${matrix.summary.quotaSnapshotCount} · overlays runtime ${matrix.summary.runtimeFailureOverlayCount} · quota SDK aplicável a BYOK ${matrix.summary.sdkQuotaByokTruthCount}\x1b[0m`,
    );
    println(`  \x1b[90mTipos de quota: ${renderGatewayCountMap(matrix.summary.byQuotaSnapshot)}\x1b[0m\n`);
    if (matrix.rows.length === 0) {
        println('    \x1b[33mNenhum provedor encontrado para o filtro informado.\x1b[0m\n');
        return;
    }
    for (const row of matrix.rows.slice(0, args.limit)) {
        println(
            `    \x1b[33m${row.providerId}\x1b[0m  \x1b[90mvisibilidade ${renderByokTokenLabel(row.accountVisibility)} · quota ${renderByokTokenLabel(row.quotaSnapshot)} · gasto ${renderByokTokenLabel(row.spendingLimit)} · limite de taxa ${renderByokTokenLabel(row.rateLimit)}\x1b[0m`,
        );
        println(
            `      \x1b[90moverlay runtime ${row.runtimeFailureOverlay ? 'sim' : 'nao'} · quota SDK cobre BYOK ${row.sdkQuotaAppliesToByok ? 'sim' : 'nao'} · env ${row.requiredEnv.join(',') || '-'}\x1b[0m`,
        );
        println(`      \x1b[90mendpoints ${row.endpoints.slice(0, 4).join(',') || '-'}\x1b[0m`);
    }
    if (matrix.rows.length > args.limit) {
        println(`\n  \x1b[90mexibindo ${args.limit}/${matrix.rows.length}; use filtro ou limite numerico.\x1b[0m`);
    }
    println('  \x1b[90mA matriz descreve fontes pré-runtime possíveis; ela não prova acesso runtime nem altera catálogo.\x1b[0m\n');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogConflicts(println) {
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    println(`\n  \x1b[36mBYOK model-gateway catalog conflicts\x1b[0m`);
    println(`  \x1b[90mCatálogo: ${store.filePath} · fonte: snapshot persistido · sem rede\x1b[0m\n`);
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
        println(`    \x1b[33m${projectionKey}\x1b[0m  \x1b[90mcampo ${fieldPath} · evidência selecionada ${selected} · conflitos ${conflicting}\x1b[0m`);
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
    println(`  \x1b[90mCatálogo: ${store.filePath} · filtro ${args.selector ?? '-'} · fontes ${sources.length}/${snapshot.sources.length}\x1b[0m\n`);
    if (sources.length === 0) {
        println('    \x1b[33mNenhuma source encontrada para o filtro informado.\x1b[0m\n');
        return;
    }
    for (const item of sources.slice(0, args.limit)) {
        const source = item.source;
        println(
            `    \x1b[33m${optionalScalarString(source['id']) ?? '-'}\x1b[0m  \x1b[90mprovedor ${optionalScalarString(source['providerId']) ?? '-'} · tipo ${optionalScalarString(source['kind']) ?? '-'} · autenticação ${optionalScalarString(source['authMode']) ?? '-'} · refresh ${optionalScalarString(source['refreshPolicy']) ?? '-'} · atualizado ${item.at}\x1b[0m`,
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
        healthRecords: listByokProviderModelHealth(),
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
            decisions: evaluated.decisions,
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
        `  \x1b[90mCatálogo: ${store.filePath} · filtro ${args.selector ?? '-'} · política ${args.strict ? 'strict/block_unknown' : 'allow_probe_unknown'} · persistir ${args.persist ? 'sim' : 'nao'} · total ${explained.length} · elegíveis ${eligibleCount} · desconhecidos ${unknownCount} · excluídos ${excludedCount}\x1b[0m\n`,
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
            `    \x1b[32melegibilidade persistida\x1b[0m  \x1b[90mrun ${optionalScalarString(run['runId']) ?? '-'} · decisões ${evaluated.decisions.length}\x1b[0m`,
        );
    }
    for (const item of explained.slice(0, args.limit)) {
        const color = item.status === 'eligible' ? '\x1b[32m' : item.status === 'unknown' ? '\x1b[33m' : '\x1b[31m';
        println(`    ${color}${item.status}\x1b[0m  \x1b[33m${item.key}\x1b[0m`);
        println(`      \x1b[90m${item.summary} · disposição ${item.disposition}\x1b[0m`);
        println(
            `      \x1b[90mdica ${item.actionable?.operatorHint ?? '-'} · dados necessários ${item.actionable?.dataNeeded?.slice(0, 4).join(',') || '-'} · probe seguro ${item.actionable?.probeSafe ? 'sim' : 'nao'}\x1b[0m`,
        );
        if (item.hardExclusions.length > 0) println(`      \x1b[90mexclusões fortes ${item.hardExclusions.slice(0, 4).join(',')}\x1b[0m`);
        if (item.softPenalties.length > 0) println(`      \x1b[90mpenalidades leves ${item.softPenalties.slice(0, 4).join(',')}\x1b[0m`);
        if (item.nextActions.length > 0) println(`      \x1b[90mpróxima ação ${item.nextActions.slice(0, 4).join(',')}\x1b[0m`);
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
 * @returns {{ env: Record<string, string | undefined>; model: string | null; profile: string | null; provider: string | null; baseUrl: string | null; wireApi: string | null; timeoutMs: number | undefined }}
 */
function buildByokProbeSelection(rest) {
    /** @type {Record<string, string | undefined>} */
    const env = { ...process.env };
    /** @type {string | null} */
    let model = null;
    /** @type {string | null} */
    let profile = null;
    /** @type {string | null} */
    let provider = null;
    /** @type {string | null} */
    let baseUrl = null;
    /** @type {string | null} */
    let wireApi = null;
    /** @type {number | undefined} */
    let timeoutMs;
    /**
     * @param {string} item
     * @param {string} colonPrefix
     * @param {string} [equalsPrefix]
     * @returns {string | null}
     */
    const readTokenValue = (item, colonPrefix, equalsPrefix = colonPrefix.replace(/:$/u, '=')) =>
        item.toLowerCase().startsWith(colonPrefix)
            ? item.slice(colonPrefix.length).trim() || null
            : item.toLowerCase().startsWith(equalsPrefix)
              ? item.slice(equalsPrefix.length).trim() || null
              : null;
    for (const raw of rest) {
        const item = raw.trim();
        const lower = item.toLowerCase();
        if (!item || lower === 'active' || lower === '--active') continue;
        if (lower.startsWith('profile:') || lower.startsWith('profile=')) {
            profile = readTokenValue(item, 'profile:') ?? profile;
            continue;
        }
        if (lower.startsWith('provider:') || lower.startsWith('provider=')) {
            provider = readTokenValue(item, 'provider:') ?? provider;
            continue;
        }
        if (lower.startsWith('preset:') || lower.startsWith('preset=')) {
            provider = readTokenValue(item, 'preset:') ?? provider;
            continue;
        }
        if (lower.startsWith('baseurl:') || lower.startsWith('baseurl=')) {
            baseUrl = readTokenValue(item, 'baseurl:') ?? baseUrl;
            continue;
        }
        if (lower.startsWith('base-url:') || lower.startsWith('base-url=')) {
            baseUrl = readTokenValue(item, 'base-url:') ?? baseUrl;
            continue;
        }
        if (lower.startsWith('wire:') || lower.startsWith('wire=')) {
            wireApi = readTokenValue(item, 'wire:') ?? wireApi;
            continue;
        }
        if (lower.startsWith('wireapi:') || lower.startsWith('wireapi=')) {
            wireApi = readTokenValue(item, 'wireapi:') ?? wireApi;
            continue;
        }
        if (lower.startsWith('model:') || lower.startsWith('model=')) {
            model = readTokenValue(item, 'model:') ?? model;
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
    if (provider) {
        env['COPILOT_BYOK_ENABLED'] = 'true';
        env['COPILOT_BYOK_PROVIDER_PRESET'] = provider;
        delete env['COPILOT_BYOK_PROFILE'];
    }
    if (profile) {
        env['COPILOT_BYOK_ENABLED'] = 'true';
        env['COPILOT_BYOK_PROFILE'] = profile;
    }
    if (model) {
        env['COPILOT_BYOK_ENABLED'] = 'true';
        env['COPILOT_BYOK_MODEL'] = model;
    }
    if (baseUrl) {
        env['COPILOT_BYOK_ENABLED'] = 'true';
        env['COPILOT_BYOK_BASE_URL'] = baseUrl;
    }
    if (wireApi) {
        env['COPILOT_BYOK_ENABLED'] = 'true';
        env['COPILOT_BYOK_WIRE_API'] = wireApi;
    }
    return { env, model, profile, provider, baseUrl, wireApi, timeoutMs };
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
        failureKind: probe.providerFailure?.kind ?? null,
        failureStatusCode: probe.providerFailure?.statusCode ?? null,
        retryAfterSeconds: probe.providerFailure?.retryAfterSeconds ?? null,
        resetAt: probe.providerFailure?.resetAt ?? null,
    });
    if (mode !== 'chat' && mode !== 'agent') {
        await flushByokProviderHealth();
        return providerAttempted;
    }
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
            failureKind: probe.providerFailure?.kind ?? null,
            failureStatusCode: probe.providerFailure?.statusCode ?? null,
            retryAfterSeconds: probe.providerFailure?.retryAfterSeconds ?? null,
            resetAt: probe.providerFailure?.resetAt ?? null,
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
    println(
        terminalThemeRow(
            'Resultado',
            `${renderByokTokenLabel(probe.status)} · perfil ${valueOrDash(probe.profile)} · preset ${valueOrDash(probe.preset)} · provedor ${valueOrDash(probe.providerType)} · modelo ${valueOrDash(probe.model)}`,
            { role: probe.ok ? 'success' : 'error' },
        ),
    );
    println(
        terminalThemeRow(
            'Sinal',
            `${probe.deltaCount} fragmentos · ${probe.deltaChars} ${probe.deltaChars === 1 ? 'caractere' : 'caracteres'} parciais · final ${probe.finalChars} ${probe.finalChars === 1 ? 'caractere' : 'caracteres'} · evento final ${yesNo(probe.observedFinalEvent)} · ${probe.elapsedMs}ms`,
        ),
    );
    if (mode === 'agent') {
        println(
            terminalThemeRow(
                'Agente',
                `chamadas de ferramenta ${Number(Reflect.get(probe, 'toolCallCount') ?? 0)} · marcador ${Number(Reflect.get(probe, 'markerToolCallCount') ?? 0)} · leituras ${Number(Reflect.get(probe, 'readToolCallCount') ?? 0)} · perguntas ${Number(Reflect.get(probe, 'userInputRequestCount') ?? 0)} · respostas ${Number(Reflect.get(probe, 'userInputAnswerCount') ?? 0)}`,
            ),
        );
    }
    if (mode === 'vision') {
        const dominantColor = Reflect.get(probe, 'dominantColor');
        const attachmentMimeType = Reflect.get(probe, 'attachmentMimeType');
        const attachmentBytes = Reflect.get(probe, 'attachmentBytes');
        println(
            terminalThemeRow(
                'Visão',
                `prova ${yesNo(Reflect.get(probe, 'visionProved') === true)} · cor ${valueOrDash(typeof dominantColor === 'string' ? dominantColor : null)} · fixture ${valueOrDash(typeof attachmentMimeType === 'string' ? attachmentMimeType : null)}${typeof attachmentBytes === 'number' ? `/${attachmentBytes} bytes` : ''}`,
            ),
        );
    }
    if (options.showSession !== false && probe.sessionId) {
        println(terminalThemeRow('Sessão', `temporária ${probe.sessionId}`));
    }
    if (options.showWarnings !== false) {
        if (probe.providerFailure) {
            println(terminalThemeRow('Diagnóstico', probe.providerFailure.operatorLabel, { role: 'warn' }));
            println(terminalThemeRow('Ação', probe.providerFailure.operatorAction, { role: 'command' }));
        }
        for (const warning of probe.warnings) {
            println(terminalThemeRow('Aviso', warning, { role: 'warn' }));
        }
        for (const error of probe.errors.slice(0, 4)) {
            println(terminalThemeRow('Erro', error, { role: 'error' }));
        }
    }
    if (options.providerAttempted === false) {
        println(
            terminalThemeRow(
                'Admissão',
                'probe barrada antes do provedor porque o limite declarado não comporta o envelope SDK; health real do modelo não foi degradado',
            ),
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
        ...(!meta?.profile && meta?.provider ? [`provider:${meta.provider}`] : []),
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
        return `Provedor BYOK persistido: ${preset}${model ? ` · modelo ${model}` : ''}.`;
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
        println('');
        println(terminalThemeHeadline('tool', 'BYOK env canônico'));
        println(terminalThemeDivider(60));
        println(
            terminalThemeRow(
                'Arquivo',
                '.env.local · gitignored · perfis, modelos, metadados e segredos vivem somente ali',
            ),
        );
        println(terminalThemeRows('Chaves', [...envKeys], { role: 'command', width: 12 }));
        println(
            terminalThemeRow(
                'Perfis',
                'COPILOT_BYOK_PROFILES_JSON define perfis; COPILOT_BYOK_PROFILE escolhe o ativo',
            ),
        );
        println(terminalThemeRows('Uso', ['/byok', '/byok providers', '/byok profiles', '/byok models', '/byok env'], { role: 'command', width: 12 }));
        println(terminalThemeDivider(60));
        println('');
        return;
    }

    if (sub === 'persist') {
        try {
            const message = await persistByokSelection(rest, projection);
            println(terminalThemeRow('BYOK', message, { role: 'success' }));
            println(terminalThemeRow('Arquivo', 'gravação feita em .env.local sem imprimir segredos'));
            printByokSdkSessionBoundaryHint(println, { persisted: true });
            println('');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            println(terminalThemeRow('BYOK', `não foi possível persistir: ${message}`, { role: 'error' }));
            println('');
        }
        return;
    }

    if (sub === 'health' || sub === 'chat-health') {
        if ((rest[0] ?? '').toLowerCase() === 'clear') {
            const scope = parseByokHealthClearScope(rest.slice(1));
            clearByokProviderModelHealth(scope);
            await flushByokProviderHealth();
            const scoped = scope.providerId || scope.providerModel || scope.routeProfile;
            println(
                scoped
                    ? `  \x1b[32mSaúde operacional BYOK limpa para provedor ${scope.providerId ?? '*'} · modelo ${scope.providerModel ?? '*'} · perfil ${scope.routeProfile ?? '*'}.\x1b[0m\n`
                    : '  \x1b[32mSaúde operacional BYOK limpa no processo atual e no arquivo persistente.\x1b[0m\n',
            );
            return;
        }
        renderByokHealth(println, parseByokHealthClearScope(rest));
        return;
    }

    if (sub === 'auto' || sub === 'automation') {
        if (rest.some((item) => /^(off|disable|disabled|desligar)$/iu.test(item))) {
            await renderByokGatewayAutoOff(println);
            return;
        }
        if (rest.some((item) => /^(on|enable|enabled|ligar)$/iu.test(item))) {
            await renderByokGatewayAutoOn(println, rest);
            return;
        }
        if (rest.some((item) => /^(policy|politica|política|config|configuracao|configuração)$/iu.test(item))) {
            await renderByokGatewayAutoPolicy(println);
            return;
        }
        if (rest.some((item) => /^(doctor|diagnostic|diagnostico|diagnóstico|check|ready|readiness)$/iu.test(item))) {
            await renderByokGatewayAutoDoctor(println, rest);
            return;
        }
        if (rest.some((item) => /^(explain|explicar|why|porque|por-que)$/iu.test(item))) {
            await renderByokGatewayAutoStatus(println, rest);
            await renderByokGatewayAutoDoctor(println, rest);
            return;
        }
        if (rest.some((item) => /^(proof-plan|proofs|runtime-proofs|provas|plano-provas)$/iu.test(item))) {
            await renderByokGatewayAutoProofPlan(println, rest);
            return;
        }
        if (rest.some((item) => /^(standby|alternatives|alternativas|substitutes|substitutos|prontidao|prontidão)$/iu.test(item))) {
            await renderByokGatewayAutoStandby(println, rest);
            return;
        }
        if (rest.some((item) => /^(switch|fallback|trocar|mudar|change|apply-best)$/iu.test(item))) {
            await renderByokGatewayAutoStatus(println, rest, { apply: true, persist: true });
            return;
        }
        if (rest.some((item) => /^(history|historico|histórico|decisions|ledger)$/iu.test(item))) {
            await renderByokGatewayAutoHistory(println, rest);
            return;
        }
        if (rest.some((item) => /^(handoffs|handoff|session-handoffs)$/iu.test(item))) {
            await renderByokGatewayAutoHandoffs(println, rest);
            return;
        }
        if (rest.some((item) => /^(confirmations|confirmation|confirmacoes|confirmações|model-changed)$/iu.test(item))) {
            await renderByokGatewayAutoConfirmations(println, rest);
            return;
        }
        if (rest.some((item) => /^(recovery-fixture|fixture-recovery|simulate-recovery|simular-recovery)$/iu.test(item))) {
            await renderByokGatewayAutoRecoveryFixture(println, rest);
            return;
        }
        if (rest.some((item) => /^(recoveries|recovery|recuperacoes|recuperações|post-turn)$/iu.test(item))) {
            await renderByokGatewayAutoRecoveries(println, rest);
            return;
        }
        await renderByokGatewayAutoStatus(println, rest, {
            apply: rest.some((item) => /^(apply|aplicar|execute|executar)$/iu.test(item)),
            persist: rest.some((item) => /^(record|write|persist|gravar|registrar)$/iu.test(item)),
        });
        return;
    }

    if (sub === 'gateway' || sub === 'gate' || sub === 'migration') {
        if (/^(auto|automation)$/iu.test(rest[0] ?? '')) {
            const autoRest = rest.slice(1);
            if (autoRest.some((item) => /^(off|disable|disabled|desligar)$/iu.test(item))) {
                await renderByokGatewayAutoOff(println);
                return;
            }
            if (autoRest.some((item) => /^(on|enable|enabled|ligar)$/iu.test(item))) {
                await renderByokGatewayAutoOn(println, autoRest);
                return;
            }
            if (autoRest.some((item) => /^(policy|politica|política|config|configuracao|configuração)$/iu.test(item))) {
                await renderByokGatewayAutoPolicy(println);
                return;
            }
            if (autoRest.some((item) => /^(doctor|diagnostic|diagnostico|diagnóstico|check|ready|readiness)$/iu.test(item))) {
                await renderByokGatewayAutoDoctor(println, autoRest);
                return;
            }
            if (autoRest.some((item) => /^(explain|explicar|why|porque|por-que)$/iu.test(item))) {
                await renderByokGatewayAutoStatus(println, autoRest);
                await renderByokGatewayAutoDoctor(println, autoRest);
                return;
            }
            if (autoRest.some((item) => /^(proof-plan|proofs|runtime-proofs|provas|plano-provas)$/iu.test(item))) {
                await renderByokGatewayAutoProofPlan(println, autoRest);
                return;
            }
            if (autoRest.some((item) => /^(standby|alternatives|alternativas|substitutes|substitutos|prontidao|prontidão)$/iu.test(item))) {
                await renderByokGatewayAutoStandby(println, autoRest);
                return;
            }
            if (autoRest.some((item) => /^(switch|fallback|trocar|mudar|change|apply-best)$/iu.test(item))) {
                await renderByokGatewayAutoStatus(println, autoRest, { apply: true, persist: true });
                return;
            }
            if (autoRest.some((item) => /^(history|historico|histórico|decisions|ledger)$/iu.test(item))) {
                await renderByokGatewayAutoHistory(println, autoRest);
                return;
            }
            if (autoRest.some((item) => /^(handoffs|handoff|session-handoffs)$/iu.test(item))) {
                await renderByokGatewayAutoHandoffs(println, autoRest);
                return;
            }
            if (autoRest.some((item) => /^(confirmations|confirmation|confirmacoes|confirmações|model-changed)$/iu.test(item))) {
                await renderByokGatewayAutoConfirmations(println, autoRest);
                return;
            }
            if (autoRest.some((item) => /^(recovery-fixture|fixture-recovery|simulate-recovery|simular-recovery)$/iu.test(item))) {
                await renderByokGatewayAutoRecoveryFixture(println, autoRest);
                return;
            }
            if (autoRest.some((item) => /^(recoveries|recovery|recuperacoes|recuperações|post-turn)$/iu.test(item))) {
                await renderByokGatewayAutoRecoveries(println, autoRest);
                return;
            }
            await renderByokGatewayAutoStatus(println, autoRest, {
                apply: autoRest.some((item) => /^(apply|aplicar|execute|executar)$/iu.test(item)),
                persist: autoRest.some((item) => /^(record|write|persist|gravar|registrar)$/iu.test(item)),
            });
            return;
        }
        if (/^(operator-ready|operator|cockpit|ops|status)$/iu.test(rest[0] ?? '')) {
            await renderByokGatewayOperatorReady(println, rest.slice(1));
            return;
        }
        if (/^(commands|command|comandos|canonical|canonico|canônico|help|ajuda)$/iu.test(rest[0] ?? '')) {
            renderByokGatewayCanonicalCommands(println, rest.slice(1));
            return;
        }
        if (/^(prebuild|pre-build|readiness|ready|build)$/iu.test(rest[0] ?? '')) {
            renderByokGatewayPreBuildReadiness(println);
            return;
        }
        if (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(refresh|reload|sync|atualizar)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayCatalogRefresh(println, eventBus, rest[2] ?? null);
            return;
        }
        if (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(refresh-plan|plan|dry-run|dryrun)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayCatalogRefreshPlan(println, rest[2] ?? null);
            return;
        }
        if (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(refresh-log|refreshlog|log|logs)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayCatalogRefreshLog(println);
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
        if (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(integrity|integridade|audit|auditoria)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayCatalogIntegrity(println);
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
        if (/^(probes|probe)$/iu.test(rest[0] ?? '') && /^(backoff|retry|defer|adiar)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayProbeBackoff(println, rest.slice(2));
            return;
        }
        if (/^(probes|probe)$/iu.test(rest[0] ?? '') && /^(matrix|matriz|plan|planner)$/iu.test(rest[1] ?? '')) {
            renderByokGatewayProbeMatrix(println, rest.slice(2));
            return;
        }
        if (/^(secrets|secret|env|requirements|requisitos|missing)$/iu.test(rest[0] ?? '')) {
            renderByokGatewayEnvRequirements(println, rest.slice(1));
            return;
        }
        if (/^(importers|importer|imports|audit-importers|auditoria-importers)$/iu.test(rest[0] ?? '')) {
            renderByokGatewayImporterAudit(println, rest.slice(1));
            return;
        }
        if (/^(selection|selecao|seleção|route-selection|routing)$/iu.test(rest[0] ?? '')) {
            await renderByokGatewaySelectionAudit(println, rest.slice(1));
            return;
        }
        if (/^(routes|route|rotas)$/iu.test(rest[0] ?? '')) {
            await renderByokGatewayRoutes(println, rest.slice(1));
            return;
        }
        if (/^(quota-matrix|quota-capabilities|limits-matrix|matrix-limits|matriz-quotas)$/iu.test(rest[0] ?? '')) {
            renderByokGatewayQuotaMatrix(println, rest.slice(1));
            return;
        }
        if (/^(limits|limit|limites|quota|quotas|rate-limits|account-limits)$/iu.test(rest[0] ?? '')) {
            await renderByokGatewayLimits(println, rest.slice(1));
            return;
        }
        if (/^(accounts|account|contas|keys|key|account-keys|account-limits)$/iu.test(rest[0] ?? '')) {
            await renderByokGatewayAccounts(println, rest.slice(1));
            return;
        }
        if (/^(overlays|overlay)$/iu.test(rest[0] ?? '')) {
            await renderByokGatewayOverlays(println, rest.slice(1));
            return;
        }
        if (
            /^(provider|providers|provedor|provedores)$/iu.test(rest[0] ?? '') &&
            /^(traits|trait|caracteristicas|características)$/iu.test(rest[1] ?? '')
        ) {
            renderByokProviderGatewayTraits(println, rest.slice(2));
            return;
        }
        if (/^(local|ollama|local-private)$/iu.test(rest[0] ?? '')) {
            renderByokGatewayLocalGuidance(println);
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
            if (/^(runs|run|historico|histórico|history)$/iu.test(rest[1] ?? '')) {
                await renderByokGatewayEligibilityRuns(println, rest.slice(2));
                return;
            }
            if (/^(diff|changes|mudancas|mudanças)$/iu.test(rest[1] ?? '')) {
                await renderByokGatewayEligibilityDiff(println);
                return;
            }
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
            println('');
            println(terminalThemeHeadline('tool', 'BYOK shortlist agent probe', [`${candidates.length}/${modelList.length}`]));
            println(
                terminalThemeRow(
                    'Escopo',
                    `${filters.allProviders ? 'todos os perfis selecionados' : 'provider/perfil ativo'} + ranking do catálogo + filtros ${renderByokFilterLabel(filters) || 'safe'}; cada candidato roda sessão SDK descartável de /byok probe agent, sem trocar a conversa viva${timeoutMs ? ` · timeout ${timeoutMs}ms` : ''}`,
                ),
            );
            for (const error of discovered.errors.slice(0, 6)) {
                println(terminalThemeRow('Aviso', `descoberta remota indisponível (${error}); usando catálogo disponível`, { role: 'warn' }));
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
                println(terminalThemeRow('Shortlist', 'nenhum candidato cabe nos filtros atuais', { role: 'warn' }));
                println(terminalThemeRow('Próximo', 'ajuste provider/filtros, remova safe para inspeção ou rode /byok models', { role: 'command' }));
                println('');
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
                terminalThemeRow(
                    'Shortlist',
                    `encerrada · aprovados ${passed}/${candidates.length} · providers tentados ${attempted}/${candidates.length} · saúde persistida alimenta /byok recommend ... safe`,
                ),
            );
            println(terminalThemeRow('Sessão viva', 'só muda com /byok use e /byok model', { role: 'command' }));
            println('');
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
        println('');
        println(terminalThemeHeadline('tool', `BYOK ${mode} probe`));
        println(
            terminalThemeRow(
                'Escopo',
                `sessão SDK descartável; não troca a conversa viva nem grava transcript live.${mode === 'chat' ? ' Sonda de chat não usa ferramentas.' : mode === 'agent' ? ' Sonda agente exige ferramentas representativas do terminal + ask_user com resposta sintética.' : mode === 'streaming' ? ' Sonda de streaming exige delta real; não degrada saúde de chat.' : mode === 'json' ? ' Sonda JSON exige payload parseável; não degrada saúde de chat.' : ' Sonda de visão anexa fixture PNG hermética e exige identificação visual; não degrada saúde de chat.'}${selection.profile ? ` perfil ${selection.profile}` : ''}${selection.provider ? ` provedor ${selection.provider}` : ''}${selection.model ? ` modelo ${selection.model}` : ''}${selection.baseUrl ? ` base URL ${selection.baseUrl}` : ''}${selection.wireApi ? ` protocolo ${renderByokWireLabel(selection.wireApi)}` : ''}`,
            ),
        );
        const { probe, providerAttempted } = await runByokProbe(mode, selection, eventBus);
        renderByokProbeResult(println, mode, probe, { providerAttempted });
        const probeGuidance =
            mode === 'agent'
                ? 'sonda agente confirma streaming + ferramentas representativas + ask_user; sonda de chat isolada segue disponível com /byok probe chat'
                : mode === 'streaming'
                  ? 'sonda de streaming separa resposta final de delta incremental; falha no delta não torna chat inutilizável, mas deixa a UX live cega'
                  : mode === 'json'
                    ? 'sonda JSON confirma saída estruturada parseável; use junto com sonda agente antes de promover modelo'
                    : mode === 'vision'
                      ? probe.ok
                          ? 'sonda de visão confirmou anexo de imagem e interpretação da fixture; combine com agente/JSON para automação multimodal'
                          : 'sonda de visão registrou resultado sem prova visual positiva; chat/agente não são degradados por essa capacidade'
                      : 'catálogo mostra oferta; sonda de chat confirma conversa canária; para validar execução agente, rode /byok probe agent';
        println(terminalThemeRow('Guia', probeGuidance));
        println('');
        return;
    }

    if (sub === 'reload') {
        const skipStatus = rest.some((item) => /^(quiet|--quiet|no-status|--no-status|statusless|--statusless)$/iu.test(item));
        clearRuntimeSelectors();
        const result = loadDotenv({ path: '.env.local', override: true, quiet: true });
        if (result.error) {
            println(terminalThemeRow('BYOK', `não foi possível recarregar .env.local: ${result.error.message}`, { role: 'error' }));
            println('');
            return;
        }
        println(terminalThemeRow('BYOK', '.env.local recarregado no processo atual · segredos não exibidos', { role: 'success' }));
        if (skipStatus) {
            println(terminalThemeRow('Status', 'omitido por solicitação; rode /byok para o cockpit final'));
            println('');
            return;
        }
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
        const configuredPresetEntries = [...presetCounts.entries()].sort((a, b) =>
            String(a[0]).localeCompare(String(b[0])),
        );
        const configuredPresets = configuredPresetEntries
            .slice(0, 6)
            .map(([preset, count]) => `${preset} ${count}`)
            .join(' · ');
        const omittedPresetCount = Math.max(0, configuredPresetEntries.length - 6);
        const presetSummary = configuredPresets
            ? `${configuredPresetEntries.length} tipo(s) · ${configuredPresets}${omittedPresetCount > 0 ? ` · +${omittedPresetCount}` : ''}`
            : '-';
        println('');
        println(terminalThemeHeadline('tool', 'BYOK provedores', [`${profiles.length} perfil(is)`]));
        println(terminalThemeDivider(64));
        println(
            terminalThemeRow(
                'Resumo',
                `ativo ${summary.profile ?? summary.preset ?? 'sdk'} · prontos ${profiles.length} · presets ${presetSummary}`,
            ),
        );
        if (profiles.length === 0) {
            println(terminalThemeRow('Provedores', 'nenhum configurado', { role: 'warn' }));
            println(terminalThemeRow('Próximo', 'adicione perfis em COPILOT_BYOK_PROFILES_JSON no .env.local', { role: 'command' }));
            println('');
            return;
        }
        for (const profile of profiles) {
            const active = profile.name === summary.profile ? 'ativo' : 'disponível';
            const metadata = profile.metadataKeys.length ? ` · metadados ${profile.metadataKeys.join(',')}` : '';
            const cost = renderByokProfileCostTag(profile.name);
            const health = readHealthForByokProfile(profile);
            const healthLabel = ` · ${renderByokHealthTag(health)} · ${renderByokAgentProbeHealthTag(health)}`;
            const readiness =
                profile.auth.bearerTokenConfigured || profile.auth.apiKeyConfigured || profile.auth.headersConfigured
                    ? 'pronto'
                    : 'sem credencial';
            println(terminalThemeRow(profile.name, `${active} · ${readiness}`, { role: readiness === 'pronto' ? 'success' : 'warn', width: 24 }));
            println(
                terminalThemeRow(
                    'Configuração',
                    `preset ${profile.preset ?? '-'} · provedor ${profile.providerType ?? '-'} · modelo ${profile.model ?? '-'} · autenticação ${renderProfileAuth(profile)}${metadata}${cost}${healthLabel}`,
                    { width: 24 },
                ),
            );
            println(
                terminalThemeRows(
                    'Comandos',
                    [
                        `/byok use ${profile.name}`,
                        `/byok models refresh provider:${profile.preset ?? profile.providerType ?? profile.name}`,
                        `/byok recommend provider:${profile.preset ?? profile.providerType ?? profile.name} free reasoning safe`,
                    ],
                    { role: 'command', width: 24 },
                ),
            );
        }
        println(terminalThemeRow('Comparar', '/byok models all-providers free reasoning safe · filtro provider:<nome>', { role: 'command' }));
        println(terminalThemeDivider(64));
        println('');
        return;
    }

    if (sub === 'profiles') {
        println('');
        println(terminalThemeHeadline('tool', 'BYOK profiles', [`${profiles.length}`]));
        println(terminalThemeDivider(60));
        if (profiles.length === 0) {
            println(terminalThemeRow('Perfis', 'nenhum configurado em COPILOT_BYOK_PROFILES_JSON no .env.local', { role: 'warn' }));
            println('');
            return;
        }
        for (const profile of profiles) {
            const active = profile.name === summary.profile ? 'ativo' : 'disponível';
            const metadata = profile.metadataKeys.length ? ` · metadados ${profile.metadataKeys.join(',')}` : '';
            const cost = renderByokProfileCostTag(profile.name);
            println(terminalThemeRow(profile.name, active, { role: active === 'ativo' ? 'success' : 'muted', width: 24 }));
            println(
                terminalThemeRow(
                    'Configuração',
                    `preset ${profile.preset ?? '-'} · provedor ${profile.providerType ?? '-'} · modelo ${profile.model ?? '-'} · autenticação ${renderProfileAuth(profile)}${metadata}${cost}`,
                    { width: 24 },
                ),
            );
        }
        println(terminalThemeRow('Uso', '/byok use <perfil> prepara o seletor no processo atual', { role: 'command' }));
        printByokSdkSessionBoundaryHint(println);
        println(terminalThemeDivider(60));
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
        println('');
        println(
            terminalThemeHeadline('tool', 'BYOK models', [
                filters.grouped ? `${modelEntries.length} grupos/${modelList.length}` : `${modelList.length}`,
            ]),
        );
        println(
            terminalThemeRow(
                'Fonte',
                `${discovered.sourceLabel}${discovered.profileCount > 1 ? ` · perfis ${discovered.profileCount}` : ''}${discovered.endpoint ? ` · endpoint ${discovered.endpoint}` : ''}`,
            ),
        );
        println(terminalThemeRow('Ordenação', `free/capability/context · filtros ${filterLabel || '-'}`));
        for (const error of discovered.errors.slice(0, 6)) {
            println(terminalThemeRow('Aviso', `descoberta remota indisponível (${error}); usando catálogo disponível`, { role: 'warn' }));
        }
        if (discovered.errors.length > 6) {
            println(terminalThemeRow('Aviso', `+${discovered.errors.length - 6} erro(s) de descoberta omitidos; use provider:<nome> para isolar`, { role: 'warn' }));
        }
        renderByokCatalogWarnings(println, discovered.warnings);
        if (modelList.length === 0) {
            println(terminalThemeRow('Modelos', 'nenhum encontrado para os filtros atuais', { role: 'warn' }));
            println(terminalThemeRow('Próximo', 'remova filtros, use provider:<nome> ou rode /byok models all-providers refresh', { role: 'command' }));
            println('');
            renderEmptyByokFilterDiagnostics(println, discovered.models.length > 0 ? discovered.models : models, filters, runtimeBudget);
            return;
        }
        for (const entry of visibleEntries) {
            const variantLabel = filters.grouped ? ` · variantes ${renderByokVariantSummary(entry.variants)}` : '';
            renderByokModelCatalogRow(println, entry.model, variantLabel);
        }
        if (visibleEntries.length < modelEntries.length) {
            println('');
            println(
                terminalThemeRow(
                    'Exibindo',
                    `${visibleEntries.length}/${modelEntries.length}${filters.grouped ? ` grupos (${modelList.length} variantes)` : ''}; use /byok models all ou /byok models <n> para ampliar`,
                    { role: 'command' },
                ),
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
        println('');
        println(
            terminalThemeHeadline('tool', 'BYOK recommend', [
                `${recommendedEntries.length}/${modelList.length}${filters.grouped ? ' grupos' : ''}`,
            ]),
        );
        println(
            terminalThemeRow(
                'Fonte',
                `${discovered.sourceLabel}${discovered.profileCount > 1 ? ` · perfis ${discovered.profileCount}` : ''}${discovered.endpoint ? ` · endpoint ${discovered.endpoint}` : ''}`,
            ),
        );
        println(terminalThemeRow('Filtros', filterLabel || '-'));
        if (runtimeBudget !== null) {
            const contextLabel =
                runtimeBudget.tokenLimit !== null
                    ? `${runtimeBudget.contextTokens}/${runtimeBudget.tokenLimit}`
                    : `${runtimeBudget.contextTokens}`;
            println(
                terminalThemeRow(
                    'Contexto',
                    `atual ≈${contextLabel} tokens · estimativa pré-turno ≈${runtimeBudget.estimatedRequestTokens} tokens`,
                ),
            );
        }
        for (const error of discovered.errors.slice(0, 6)) {
            println(terminalThemeRow('Aviso', `descoberta remota indisponível (${error}); usando catálogo disponível`, { role: 'warn' }));
        }
        if (discovered.errors.length > 6) {
            println(terminalThemeRow('Aviso', `+${discovered.errors.length - 6} erro(s) de descoberta omitidos; use provider:<nome> para isolar`, { role: 'warn' }));
        }
        renderByokCatalogWarnings(println, discovered.warnings);
        if (recommendedEntries.length === 0) {
            println(terminalThemeRow('Recomendação', 'nenhum modelo atende aos filtros', { role: 'warn' }));
            println(terminalThemeRow('Próximo', 'remova filtros ou rode /byok models refresh', { role: 'command' }));
            println('');
            renderEmptyByokFilterDiagnostics(println, modelList, filters, runtimeBudget);
            if (filters.avoidLowLimit) renderSafeRecommendationEvidenceDiagnostics(println, budgetSafeRecommendations);
            return;
        }
        let index = 1;
        for (const entry of recommendedEntries) {
            const budget = classifyByokModelBudget(entry.model, runtimeBudget);
            const variantLabel = filters.grouped ? ` · variantes ${renderByokVariantSummary(entry.variants)}` : '';
            renderByokRecommendationRow(println, index, entry.model, budget, variantLabel);
            index += 1;
        }
        println('');
        println(
            terminalThemeRow(
                'Probe agent',
                'live descartável do terminal: valida streaming/tool/ask_user antes de trocar a sessão viva',
            ),
        );
        println(terminalThemeRow('Troca viva', '/byok use <perfil> troca provedor; /byok model <id> troca só modelo ativo', { role: 'command' }));
        println('');
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
        const [preset, ...providerArgs] = rest;
        const wireApi = providerArgs.find((item) => /^wire:/iu.test(item))?.replace(/^wire:/iu, '').trim();
        const [model, baseUrl] = providerArgs.filter((item) => !/^wire:/iu.test(item));
        if (!preset) {
            println('  \x1b[31mUso: /byok provider <preset> [model] [baseUrl] [wire:<completions|responses>]\x1b[0m\n');
            return;
        }
        if (wireApi && wireApi !== 'completions' && wireApi !== 'responses') {
            println('  \x1b[31mwireApi inválido. Use wire:completions ou wire:responses.\x1b[0m\n');
            return;
        }
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        clearRuntimeSelectors();
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = preset;
        if (model) process.env['COPILOT_BYOK_MODEL'] = model;
        if (baseUrl) process.env['COPILOT_BYOK_BASE_URL'] = baseUrl;
        if (wireApi) process.env['COPILOT_BYOK_WIRE_API'] = wireApi;
        await renderStatus(readTerminalByokProjection(), println);
        return;
    }

    await renderStatus(projection, println);
}
