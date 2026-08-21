// @ts-check
/**
 * src/copilot/terminal/commands/byok.js
 *
 * Diagnostico seguro da configuracao BYOK do SDK Copilot. Este comando nunca imprime segredos; ele mostra apenas
 * presenca de credenciais, provider/modelo efetivos e erros acionaveis.
 *
 * @module copilot/terminal/commands/byok
 */

import { readTextFreshTrusted, writeFileAtomicTrusted } from '#copilot/infra/public/filesystem/trusted';
import { createWorkspaceIo } from '#copilot/infra/public/filesystem/workspace';
import { join, resolve } from 'node:path';
import { executeModelGatewayProbe } from '../../model-gateway/control-plane/probe-execution.js';

import {
    activateModelGatewayByokProfileEnv,
    applyModelGatewayEligibilityToSnapshot,
    auditCatalogImporterSet,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPostRuntimeSelection,
    auditModelGatewayPreRuntimeSelection,
    buildCatalogRefreshEventBatch,
    buildCatalogRefreshStartedEvent,
    buildEligibilityEvaluatedEvent,
    buildModelGatewayPreBuildReadinessReport,
    buildModelGatewayPreKCompatibilityReport,
    buildModelGatewayRouteCandidates,
    buildModelGatewayRuntimeProofCommands,
    buildModelGatewayRuntimeSelectorPlan,
    buildModelGatewayRuntimeStandbyPlan,
    buildModelGatewaySelectionDecisionTrace,
    buildProbeCompletedEvent,
    buildRouteDecisionEvent,
    classifyByokProviderFailure,
    clearByokProviderModelHealth,
    compareModelGatewaySelectionAudits,
    createDefaultModelGatewayCatalogImporters,
    createEnvSecretRegistry,
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH,
    DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR,
    deriveModelGatewayRuntimeAccountOverlaysFromHealth,
    didConfiguredByokProbeAttemptProvider,
    evaluateModelGatewayCatalogEligibility,
    evaluateModelGatewayProviderEnvRequirements,
    explainModelGatewayAccountLimitOverlays,
    explainModelGatewayCatalogEntry,
    explainModelGatewayEligibilityDecision,
    explainModelGatewayProviderEntry,
    explainModelGatewayRuntimeAutomationPolicySources,
    explainModelGatewaySelectionComparison,
    flushAndMirrorByokProviderHealthToSqlite,
    flushByokProviderHealth,
    JsonModelGatewayCatalogStore,
    listByokProviderModelHealth,
    listModelGatewayCanonicalCommands,
    listModelGatewayRuntimeAutomationPolicyPresets,
    listProviderEndpointInventory,
    listProviderGatewayTraits,
    listProviderWireProbeMatrix,
    materializeModelGatewayActiveByokProfileEnv,
    mirrorModelGatewayCatalogSnapshotToSqlite,
    MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON,
    persistModelGatewaySelectionDecisionTrace,
    planModelGatewayCatalogRefresh,
    planModelGatewayProbeBackoff,
    readByokProviderHealthState,
    readByokProviderModelHealth,
    readModelGatewayByokProfileCostHint,
    readModelGatewayRuntimeAutomationEffectivePolicy,
    readModelGatewayRuntimeAutomationPolicy,
    readModelGatewayRuntimeAutomationPolicyFile,
    recommendCatalogDiffProbes,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelProbeResult,
    recordModelGatewayRouteDecision,
    refreshModelGatewayCatalog,
    renderModelGatewayCanonicalCommandLines,
    renderModelGatewayLocalProviderOptInGuidance,
    resolveModelGatewayRuntimeAutomationPolicyPreset,
    resolveModelGatewaySelectionPolicy,
    resolveProviderEndpointInventory,
    resolveProviderGatewayTraits,
    routeGatewayModels,
    runConfiguredByokAgentProbe,
    runConfiguredByokChatProbe,
    runConfiguredByokJsonProbe,
    runConfiguredByokStreamingProbe,
    runConfiguredByokVisionProbe,
    searchModelGatewayCatalogEntries,
    SqliteModelGatewayCatalogStore,
    summarizeCanonicalModelProjectionDiff,
    summarizeGatewayRuntimeProofFreshness,
    summarizeModelGatewayAccountOverlays,
    summarizeModelGatewayEligibilityDiff,
    summarizeModelGatewayLocalProviderOptInBlocks,
    summarizeModelGatewayProviderEnvRequirements,
    summarizeModelGatewayProviderQuotaCapabilities,
    summarizeModelGatewayRefreshLogText,
    summarizeModelGatewayRuntimeAccountOverlays,
    summarizeProviderWireProbeMatrix,
    toOpenAIModelCatalogList,
    validateModelGatewayRuntimeAutomationPolicy,
    writeModelGatewayRuntimeAutomationPolicyFile,
} from '#copilot/model-gateway';
import { config as loadDotenv } from 'dotenv';

import { discoverConfiguredByokModelsFromEnv, readConfiguredByokModelDiscoveryCacheFromEnv } from '#copilot/config';
import {
    classifyTerminalByokSdkBinding,
    isSameTerminalByokProviderBoundary,
    renderTerminalByokBindingMachineAlias,
} from '../byok/binding/index.js';
import {
    applyTerminalByokGatewayAutoEffects,
    buildTerminalByokGatewayAutoStatus,
    describeTerminalByokGatewayAutoEffect,
    parseTerminalByokGatewayAutoArgs,
    persistTerminalByokGatewayAutoEffectApplications,
    runTerminalByokGatewayPostTurnAutomation,
} from '../byok/gateway/index.js';
import {
    recordTerminalLiveByokModelSwitchDeferred,
    requestTerminalLiveByokModelSwitch,
    requestTerminalLiveByokRouteSwitch,
} from '../byok/live/index.js';
import { evaluateTerminalByokProbeBudget } from '../byok/policy/index.js';
import {
    countLabel,
    formatTerminalDurationSeconds,
    joinTerminalSummary,
    renderByokAuthLine,
    renderByokCapabilityLine,
    renderByokSourceIdLabel,
    renderByokSourceLabel,
    renderByokStatusLine,
    renderByokTokenLabel,
    renderByokTokenList,
    renderByokWireLabel,
    valueOrDash,
    yesNo,
    yesNoPlain,
} from '../byok/rendering/index.js';
import { formatTerminalToolPathForOperator } from '../events/presenters/tools/index.js';
import {
    listTerminalSdkSessionInventory,
    readTerminalByokGatewayProjectionFromEnv,
    readTerminalByokProjection,
    readTerminalByokRuntimeConfigProjection,
    readTerminalRuntimeContextWindow,
} from '../frontend/index.js';
import {
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeRows,
    terminalThemeWrappedRow,
} from '../state/theme/index.js';

const terminalByokWorkspaceIo = createWorkspaceIo({ workspaceRoot: process.cwd() });

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
 * @typedef {import('../../model-gateway/control-plane/probe-execution.js').ModelGatewayExecutableProbeResult} ByokProbeResult
 *
 *
 * @typedef {'chat' | 'agent' | 'streaming' | 'json' | 'vision'} ByokProbeMode
 */

/**
 * Explica a fronteira entre seletor BYOK e sessão SDK viva. Provider/profile vivem no contrato de criação/retomada de
 * sessão; `/restart` força o ciclo de sessão SDK, enquanto `/conversation-restart` reinicia só o diálogo.
 *
 * @param {(text: string) => void} println
 * @param {{ persisted?: boolean }} [options]
 * @returns {void}
 */
function printByokSdkSessionBoundaryHint(println, options = {}) {
    const prefix = options.persisted
        ? 'A seleção persistida será reaplicada à identidade da sessão atual.'
        : 'A seleção BYOK foi preparada no processo atual.';
    println(terminalThemeRow('Próximo', `${prefix} Mudança de provedor usa reattach do mesmo sessionId.`));
    println(
        terminalThemeRow(
            'Sessão SDK',
            '/restart reinicia a sessão SDK; /conversation-restart reinicia só a conversa.',
            {
                role: 'command',
            },
        ),
    );
    println(
        terminalThemeRow('Modelo vivo', '/byok model, provider e use tentam aplicar a seleção na sessão atual.', {
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
 * @param {{ idempotencyKey?: string; forceApplyDeferred?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function tryApplyLiveByokModelSwitch(summary, model, println, options = {}) {
    if (!summary.enabled || !summary.ready) return;

    let inventory;
    try {
        inventory = await listTerminalSdkSessionInventory();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordTerminalLiveByokModelSwitchDeferred({
            model,
            reason: `sessão viva não inspecionada: ${message}; seleção preservada sem criar nova sessão`,
            source: 'terminal.byok_model',
        });
        println(
            terminalThemeRow('Sessão viva', `não inspecionada · ${message}; seleção preservada`, {
                role: 'warn',
            }),
        );
        return;
    }
    if (!inventory.currentSessionId) {
        recordTerminalLiveByokModelSwitchDeferred({
            model,
            reason: 'não há sessão viva para aplicar a seleção; nenhuma sessão nova foi criada',
            source: 'terminal.byok_model',
        });
        println(
            terminalThemeRow('Troca modelo', 'sem sessão viva; seleção preservada e nenhuma sessão nova foi criada', {
                role: 'warn',
            }),
        );
        return;
    }
    try {
        if (!isSameTerminalByokProviderBoundary(summary, inventory.persistedByokBinding)) {
            const providerId = summary.preset ?? summary.providerType;
            if (!providerId) throw new Error('LIVE_ROUTE_SWITCH_PROVIDER_ID_MISSING');
            const request = await requestTerminalLiveByokRouteSwitch(
                {
                    providerId,
                    providerModel: model,
                    selectorSyntax: model,
                    baseUrl: summary.baseUrl,
                    openAICompatibleBaseUrl: summary.baseUrl,
                    wireApi: summary.wireApi,
                    providerProfile: summary.profile,
                    routeProfile: summary.profile,
                    selectedRouteKey: null,
                },
                {
                    source: 'terminal.byok_model',
                    reason: 'solicitação manual /byok com mudança de provider',
                    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
                    ...(options.forceApplyDeferred ? { forceApplyDeferred: true } : {}),
                },
            );
            println(terminalThemeRow('Rota viva', request.detail, { role: 'success' }));
            return;
        }
        const request = await requestTerminalLiveByokModelSwitch(model, {
            source: 'terminal.byok_model',
            reason: 'solicitação manual /byok model',
        });
        const transition =
            request.previousModel && request.previousModel !== request.currentModel
                ? `${request.previousModel} → ${request.currentModel}`
                : request.currentModel;
        println(terminalThemeRow('Modelo vivo', `solicitado ${transition}`, { role: 'success' }));
        println(
            terminalThemeRow(
                'Confirmação',
                'aguarde confirmação do SDK ou próximo uso observado para confirmar o modelo efetivo',
                { role: 'muted' },
            ),
        );
        if (request.reasoningAdjusted) {
            println(
                terminalThemeRow('Raciocínio', `ajustado para ${request.currentReasoningEffort ?? 'off'}`, {
                    role: 'warn',
                }),
            );
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordTerminalLiveByokModelSwitchDeferred({
            model,
            reason: `falhou na sessão viva: ${message}; seleção preservada sem criar nova sessão`,
            source: 'terminal.byok_model',
        });
        println(
            terminalThemeRow(
                'Troca modelo',
                `falhou na sessão viva · ${message}; seleção preservada, sem criar nova sessão`,
                { role: 'warn' },
            ),
        );
    }
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @returns {import('../../presentation/contracts/index.js').RuntimeModelInfo['byok']}
 */
function getByokModelMetadata(model) {
    return model.byok;
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
    return booleanField(
        asRecord(meta?.capabilities),
        'tools',
        booleanField(asRecord(model.capabilities?.supports), 'tools', true),
    );
}

/**
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @returns {boolean}
 */
function supportsByokStreaming(model) {
    const meta = getByokModelMetadata(model);
    return booleanField(
        asRecord(meta?.capabilities),
        'streaming',
        booleanField(asRecord(model.capabilities?.supports), 'streaming', true),
    );
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
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
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
 * model-gateway. Esta ponte mantém a decisão inicial auditável sem exigir que cada provider exponha metadados
 * perfeitos. Para BYOK OpenAI-compatible, tools ficam habilitadas por padrão salvo negação explícita, porque a probe
 * agent é a etapa que deve derrubar um falso positivo antes da promoção para a sessão viva.
 *
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @returns {Record<string, unknown>}
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
            ...(finitePositiveNumber(meta?.pricing?.request) !== null
                ? { requestUsd: finitePositiveNumber(meta?.pricing?.request) }
                : {}),
        },
        routing: {
            tier:
                cost.kind === 'free' || cost.kind === 'profile-free'
                    ? 'free'
                    : cost.kind === 'metered'
                      ? 'paid'
                      : 'balanced',
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
 * @param {Record<string, unknown>} candidate
 * @returns {string}
 */
function gatewayRouteCandidateModelKey(candidate) {
    return [
        optionalScalarString(candidate['providerId']) ?? 'unknown-provider',
        optionalScalarString(candidate['providerModel']) ?? 'unknown-model',
    ].join(':');
}

/**
 * @param {Record<string, unknown>[]} candidates
 * @param {Record<string, unknown> | null} catalogSnapshot
 * @returns {Record<string, unknown>[]}
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
        return matches.map(
            /** @param {Record<string, unknown>} routeCandidate */ (routeCandidate) => ({
                ...candidate,
                routeProfile: routeCandidate['routeProfile'],
                selectorKind: routeCandidate['selectorKind'],
                selectorSyntax: routeCandidate['selectorSyntax'],
                routeOptionRef: routeCandidate['routeOptionRef'],
                routeOptionRefs: routeCandidate['routeOptionRefs'],
                normalizedPolicy: routeCandidate['normalizedPolicy'],
                routeTraits: routeCandidate['routeTraits'],
                routing: {
                    ...asRecord(candidate['routing']),
                    ...asRecord(routeCandidate['routing']),
                },
                provenance: {
                    ...asRecord(candidate['provenance']),
                    ...asRecord(routeCandidate['provenance']),
                    candidateSource: 'terminal_catalog_route_option',
                },
            }),
        );
    });
}

/**
 * Perfis BYOK podem declarar que a conta/plano atual tem cota gratuita mesmo quando o catálogo remoto não marca preço
 * por modelo. Isso não transforma o modelo em "free confirmado"; a UI mostra `profile-free` para preservar a origem da
 * inferência.
 *
 * @param {string | null | undefined} profileName
 * @returns {{ profileFreeTier: boolean | null; profileCostSource: string | null; profileCostDetail: string | null }}
 */
function readByokProfileCostHint(profileName) {
    return readModelGatewayByokProfileCostHint(profileName, process.env);
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
 * @param {ReturnType<typeof readTerminalRuntimeContextWindow>} contextState
 * @returns {{
 *     estimatedRequestTokens: number;
 *     contextTokens: number;
 *     tokenLimit: number | null;
 *     utilization: number | null;
 * } | null}
 */
function estimateCurrentByokRequestBudget(contextState) {
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
        return estimateCurrentByokRequestBudget(readTerminalRuntimeContextWindow());
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
 * @returns {{
 *     limit: number;
 *     activeOnly: boolean;
 *     freeOnly: boolean;
 *     meteredOnly: boolean;
 *     unknownCostOnly: boolean;
 *     provider: string | null;
 *     vision: boolean;
 *     reasoning: boolean;
 *     tools: boolean;
 *     streaming: boolean;
 *     probeVerified: boolean;
 *     minContext: number | null;
 *     minRequest: number | null;
 *     avoidLowLimit: boolean;
 *     forceRefresh: boolean;
 *     allProviders: boolean;
 *     grouped: boolean;
 * }}
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
        } else if (
            [
                'probed',
                'verified',
                'probe-ok',
                'agent-ok',
                '--probed',
                '--verified',
                '--probe-ok',
                '--agent-ok',
            ].includes(item)
        ) {
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
 * @returns {string}
 */
function renderByokMachineFilterLabel(filters) {
    return [
        filters.allProviders ? 'all-providers' : null,
        filters.grouped ? 'grouped' : null,
        filters.activeOnly ? 'active' : null,
        filters.provider ? `provider:${filters.provider}` : null,
        filters.freeOnly ? 'free' : null,
        filters.meteredOnly ? 'metered' : null,
        filters.unknownCostOnly ? 'unknown-cost' : null,
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
        terminalThemeWrappedRow(
            'Filtro safe',
            `O filtro safe removeu ${countLabel(withoutSafe.length, 'candidato', 'candidatos')} · existem no catálogo, mas parecem apertados ou bloqueados para turno real no contexto atual`,
            { role: 'warn', columns: 112 },
        ),
    );
    for (const model of withoutSafe.slice(0, 4)) {
        const budget = classifyByokModelBudget(model, runtimeBudget);
        println(terminalThemeWrappedRow('Modelo', `${model.id} · ${budget.label}`, { role: 'muted', columns: 112 }));
    }
    println(
        terminalThemeWrappedRow(
            'Próximo',
            'remova safe para inspeção, use /compact, sessão fresca ou provedor/modelo com maxReq/TPM maior',
            { role: 'command', columns: 112 },
        ),
    );
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
        terminalThemeWrappedRow(
            'Prova agente',
            `${countLabel(unverified.length, 'candidato removido', 'candidatos removidos')} sem probe agente positivo de tools + ask_user`,
            { role: 'warn', columns: 112 },
        ),
    );
    for (const model of unverified.slice(0, 4)) {
        println(
            terminalThemeWrappedRow('Modelo', `${model.id} · ${renderByokRecommendationActionHint(model)}`, {
                role: 'muted',
                columns: 112,
            }),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Próximo',
            'use /byok models para explorar catálogo bruto; rode /byok probe agent antes de promover o modelo para a sessão viva',
            { role: 'command', columns: 112 },
        ),
    );
}

/**
 * A shortlist agregada e uma mesa de admissao, não um segundo catalogo. Quando varios perfis entram no mesmo ranking, o
 * operador precisa ver por que um profile desapareceu antes de sondar o top-N.
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
    println(terminalThemeHeadline('tool', 'Cobertura por perfil', ['antes das probes']));
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
        println(
            terminalThemeWrappedRow(profile.name, `${coverage}${action}`, { role: 'muted', columns: 112, width: 24 }),
        );
    }
    if (profiles.length > 12) {
        println(
            terminalThemeWrappedRow(
                'Omitidos',
                `${countLabel(profiles.length - 12, 'perfil omitido', 'perfis omitidos')} · filtre com provider:<perfil|preset>`,
                { role: 'muted', columns: 112 },
            ),
        );
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
 * @param {{ rejected?: { rejectedReasons?: string[] }[] }} route
 * @returns {boolean}
 */
function hasLocalProviderExplicitRequestRejection(route) {
    return (
        Array.isArray(route.rejected) &&
        route.rejected.some((item) =>
            item.rejectedReasons?.includes(MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON),
        )
    );
}

/**
 * @param {(text: string) => void} println
 * @param {string} profileId
 * @returns {void}
 */
function renderByokLocalProviderOptInHint(println, profileId) {
    println(
        terminalThemeWrappedRow('Provider local', renderModelGatewayLocalProviderOptInGuidance({ profileId }), {
            role: 'warn',
            columns: 112,
        }),
    );
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
    const activeLocalOptIn =
        routeArgsRequestActiveProjection(routeArgs) && activeProjectionSuggestsLocalProvider(projection);
    const runtimeBudget = readCurrentByokRequestBudget();
    const discovered = await discoverByokCatalogForCommand(projection, filters);
    const catalogSnapshot = await readByokGatewayCatalogSnapshotForRouting();
    const modelList = rankByokModels(discovered.models.length > 0 ? discovered.models : projection.models).filter(
        (model) => matchesRecommendFilters(model, filters, runtimeBudget),
    );
    const candidates = enrichGatewayRouteCandidatesWithRouteOptions(
        modelList.map(toGatewayRouteCandidate),
        catalogSnapshot,
    );
    const filterLabel = renderByokFilterLabel(filters);

    println('');
    println(terminalThemeHeadline('tool', 'BYOK model route / BYOK rota de modelo'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `perfil ${profileId} · modo ${strict ? 'estrito/sonda verificada' : 'pré-sonda'} · fonte ${renderByokSourceLabel(discovered.sourceLabel)}${discovered.profileCount > 1 ? ` · perfis ${discovered.profileCount}` : ''}${discovered.endpoint ? ` · endpoint ${discovered.endpoint}` : ''} · filtros ${filterLabel || '-'}`,
            { role: 'muted', columns: 112 },
        ),
    );
    for (const error of discovered.errors.slice(0, 6)) {
        println(
            terminalThemeWrappedRow('Aviso', `descoberta remota indisponível (${error}); usando catálogo disponível`, {
                role: 'warn',
                columns: 112,
            }),
        );
    }
    renderByokCatalogWarnings(println, discovered.warnings);
    if (candidates.length === 0) {
        println(
            terminalThemeWrappedRow(
                'Resultado',
                'nenhum candidato encontrado para roteamento; remova filtros, use active/current ou rode /byok models refresh',
                { role: 'warn', columns: 112 },
            ),
        );
        println('');
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
        println(
            terminalThemeWrappedRow('Erro', `perfil de rota inválido: ${message}`, { role: 'error', columns: 112 }),
        );
        println(
            terminalThemeWrappedRow(
                'Perfis conhecidos',
                'cheap_chat, code, repo_agent, tool_agent, json_extraction, vision, deep_reasoning, local_private, local_private_strict',
                { role: 'muted', columns: 112 },
            ),
        );
        println('');
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
        terminalThemeWrappedRow(
            'Decisão',
            `${decisionEvent.decisionId} · admitidos ${route.candidates.length}/${candidates.length} · rejeitados ${route.rejected.length} · alternativas ${route.fallbackChain.length}`,
            { role: route.selected ? 'success' : 'warn', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Máquina',
            `decision=${decisionEvent.decisionId} candidates=${route.candidates.length}/${candidates.length} rejected=${route.rejected.length} fallback=${route.fallbackChain.length}`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (!route.selected) {
        println(
            terminalThemeWrappedRow(
                'Resultado',
                `nenhum modelo passou na política ${strict ? 'estrita' : 'pré-sonda'}; use /byok models route ${profileId} --show-rejected para ver causas`,
                { role: 'warn', columns: 112 },
            ),
        );
    } else {
        const model = route.selected.model;
        const reasons = renderByokTokenList(route.selected.reasons.slice(0, 5).map(String)) || 'sem motivo adicional';
        const health = route.selected.health
            ? `${renderByokHealthTag(route.selected.health)} · ${renderByokAgentProbeHealthTag(route.selected.health)}`
            : 'saúde sem registro';
        println(
            terminalThemeWrappedRow(
                'Selecionado',
                `${model['providerModel'] ?? model['id']} · provedor ${model['providerId']} · pontuação ${route.selected.score}`,
                { role: 'success', columns: 112 },
            ),
        );
        println(terminalThemeWrappedRow('Motivos', `${reasons} · ${health}`, { role: 'muted', columns: 112 }));
        println(
            terminalThemeWrappedRow(
                'Próximo',
                `/byok probe agent provider:${model['providerId']} model:${model['providerModel'] ?? model['id']} && /byok use <perfil> && /byok model <id>`,
                { role: 'command', columns: 112 },
            ),
        );
    }

    if (hasLocalProviderExplicitRequestRejection(route)) {
        renderByokLocalProviderOptInHint(println, profileId);
    }

    if (route.fallbackChain.length > 0) {
        println(
            terminalThemeWrappedRow(
                'fallback chain / Cadeia de alternativas',
                `${route.fallbackChain.slice(0, 8).join(' -> ')}${route.fallbackChain.length > 8 ? ' -> ...' : ''}`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    if (showRejected && route.rejected.length > 0) {
        for (const rejected of route.rejected.slice(0, 8)) {
            const model = rejected.model;
            println(
                terminalThemeWrappedRow(
                    'Rejeitado',
                    `${model['providerModel'] ?? model['id']} (${model['providerId']}): ${renderByokTokenList(rejected.rejectedReasons.map(String)) || 'sem causa'}`,
                    { role: 'warn', columns: 112 },
                ),
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
 * @param {{
 *     agentProbeStatus?: 'failed' | 'ok' | null;
 *     lastAgentProbeFailureAt?: number | null;
 *     lastAgentProbeSuccessAt?: number | null;
 * }} health
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
    if (normalized === 'model_call' || normalized.startsWith('session.') || normalized.startsWith('dialog.')) {
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
 * "safe" em recomendacao não pode significar apenas "não falhou ainda". O terminal opera como agente: para uma selecao
 * promovida ao operador, precisamos de evidencia positiva de tools + `ask_user` na sonda descartavel.
 *
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @returns {boolean}
 */
function isByokModelAgentProbeVerified(model) {
    const health = readHealthForByokModel(model);
    return health ? summarizeGatewayRuntimeProofFreshness(health).agentFresh : false;
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
        listByokProviderModelHealth().find((health) =>
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
    const proof = summarizeGatewayRuntimeProofFreshness(health);
    const state = proof.chatFresh ? 'chat ok' : 'chat histórico/stale';
    return `${state} (${renderByokChatHealthEvidence(health.lastSuccessContext)} · ${formatByokHealthAge(health.lastSuccessAt)}${health.successCount > 1 ? ` · x${health.successCount}` : ''})`;
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
    const proof = summarizeGatewayRuntimeProofFreshness(health);
    const state = proof.agentFresh ? 'agente ok' : 'agente histórico/stale';
    return `${state} (${formatByokHealthAge(health.lastAgentProbeSuccessAt)}${health.agentProbeSuccessCount > 1 ? ` · x${health.agentProbeSuccessCount}` : ''})`;
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
    const other = sorted.filter(
        (probe) => !capabilityKinds.has(String(probe.kind)) && !protocolKinds.has(String(probe.kind)),
    );
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
    const provider = shouldUseOperationalProvider ? sourceProvider : (meta.provider ?? sourceProvider);
    return /** @type {import('../../presentation/contracts/index.js').RuntimeModelInfo} */ ({
        ...model,
        byok: {
            ...meta,
            provider,
            providerOwner: shouldUseOperationalProvider ? (meta.provider ?? null) : (meta.providerOwner ?? null),
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
 * @returns {ReturnType<typeof readTerminalByokProjection>['profiles'][number][]}
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
 * @returns {Promise<{
 *     models: import('../../presentation/contracts/index.js').RuntimeModelInfo[];
 *     sourceLabel: string;
 *     endpoint: string | null;
 *     errors: string[];
 *     warnings: string[];
 *     profileCount: number;
 * }>}
 */
async function discoverByokCatalogForCommand(projection, filters) {
    if (!filters.allProviders) {
        const discovered = await discoverConfiguredByokModelsFromEnv(process.env, {
            forceRefresh: filters.forceRefresh,
        });
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
        const env = materializeModelGatewayActiveByokProfileEnv({
            ...process.env,
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROFILE: profile.name,
        }).env;
        const discovered = await discoverConfiguredByokModelsFromEnv(env, { forceRefresh: filters.forceRefresh });
        const gateway = readTerminalByokGatewayProjectionFromEnv(env);
        const remoteAuthoritative = discovered.source === 'remote' || discovered.source === 'remote-cache';
        const profileModels = remoteAuthoritative
            ? chooseByokCatalogModels(discovered.models, gateway.gatewayModels)
            : chooseByokCatalogModels(gateway.gatewayModels, discovered.models);
        sourceCounts.set(discovered.source, (sourceCounts.get(discovered.source) ?? 0) + 1);
        if (!endpoint && discovered.endpoint) endpoint = discovered.endpoint;
        if (discovered.error) errors.push(`${profile.name}: ${discovered.error}`);
        warnings.push(
            ...renderConfiguredByokCatalogWarnings(discovered, {
                profile: profile.name,
                provider: profile.preset ?? profile.providerType,
            }),
        );
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
        if (added > 0)
            sourceCounts.set('model-gateway-static', (sourceCounts.get('model-gateway-static') ?? 0) + added);
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
 * @param {Record<string, unknown>} snapshot
 * @param {Record<string, unknown>} diff
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
    const owner = source.profile
        ? `perfil ${source.profile}`
        : source.provider
          ? `provedor ${source.provider}`
          : 'seleção ativa';
    const selector = source.profile ? ` profile:${source.profile}` : '';
    return [
        `${owner}: modelo configurado '${configuredModel.id}' não apareceu no catálogo remoto atual. O terminal não troca seletor silenciosamente; explore /byok models${selector ? ` all-providers${selector}` : ''} e valide um candidato com /byok probe agent${selector} model:<id> antes de /byok model <id>.`,
    ];
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} warnings
 * @returns {void}
 */
function renderByokCatalogWarnings(println, warnings) {
    for (const warning of warnings.slice(0, 6)) {
        println(terminalThemeWrappedRow('Aviso', warning, { role: 'warn', columns: 112 }));
    }
    if (warnings.length > 6) {
        println(
            terminalThemeWrappedRow(
                'Aviso',
                `${countLabel(warnings.length - 6, 'alerta omitido', 'alertas omitidos')} de seletor/catálogo · use provider:<nome> para isolar`,
                { role: 'warn', columns: 112 },
            ),
        );
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
        const detail = meta?.profileCostDetail
            ? String(meta.profileCostDetail).slice(0, 48)
            : (meta?.profileCostSource ?? 'profile');
        tags.push(`hint gratuito ${detail}`);
    }
    tags.push(supportsByokReasoning(model) ? 'raciocínio' : 'raciocínio n/d');
    if (supportsByokReasoning(model) && !model.capabilities?.supports?.reasoningEffort) {
        tags.push('SDK sem flag de raciocínio');
    }
    tags.push(model.capabilities?.supports?.vision ? 'visão' : 'visão n/d');
    tags.push(`contexto ${model.capabilities?.limits?.max_context_window_tokens ?? 'n/a'}`);
    if (
        meta?.pricing &&
        (meta.pricing.prompt !== null || meta.pricing.completion !== null || meta.pricing.request !== null)
    ) {
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
    const selection = profile ? `/byok use ${profile} -> /byok model ${model.id}` : `/byok model ${model.id}`;
    return `teste ${probe} · seleção ${selection}`;
}

/**
 * @param {(text: string) => void} println
 * @param {import('../../presentation/contracts/index.js').RuntimeModelInfo} model
 * @param {string} [variantLabel=''] Default is `''`
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
 * @param {string} [variantLabel=''] Default is `''`
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
        terminalThemeWrappedRow(
            'Bloqueio de saúde',
            `seleção ativa com falha recente em ${failureScope}; catálogo disponível não equivale a execução saudável`,
            { role: 'error', columns: 112 },
        ),
    );
    const alternatives = listActiveByokHealthAlternatives(projection);
    if (alternatives.length === 0) {
        const provider = projection.summary.preset ?? projection.summary.providerType ?? projection.summary.profile;
        const providerFilter = provider ? ` provider:${provider}` : '';
        println(
            terminalThemeWrappedRow(
                'Ação',
                `rode /byok recommend${providerFilter} free reasoning safe e confirme com /byok probe agent antes da sessão viva`,
                { role: 'command', columns: 112 },
            ),
        );
        return;
    }
    println(terminalThemeRow('Alternativas', 'mesmo catálogo ativo · troca explícita preservada', { role: 'muted' }));
    for (const model of alternatives) {
        println(
            terminalThemeWrappedRow('Modelo', `${model.id} · ${renderByokRecommendationActionHint(model)}`, {
                role: 'muted',
                columns: 112,
            }),
        );
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
 * @param {ReturnType<typeof readTerminalByokProjection>['profiles'][number]} profile
 * @returns {{ label: string; detail: string; role: 'success' | 'warn' | 'error' | 'muted' }}
 */
function classifyByokProfileReadiness(profile) {
    const errors = Array.isArray(profile['errors']) ? profile['errors'].map(String).filter(Boolean) : [];
    const hasModel = typeof profile.model === 'string' && profile.model.trim().length > 0;
    const hasBaseUrl = typeof profile.baseUrl === 'string' && profile.baseUrl.trim().length > 0;
    const hasProvider = typeof profile.providerType === 'string' && profile.providerType.trim().length > 0;
    const explicitReady = typeof profile['ready'] === 'boolean' ? profile['ready'] : null;
    if (!hasModel || errors.some((error) => /COPILOT_BYOK_MODEL|model=auto|model id/iu.test(error))) {
        return {
            label: 'bloqueado',
            detail: 'defina modelo explícito para o SDK 1.0',
            role: 'error',
        };
    }
    if (!hasBaseUrl || !hasProvider || errors.length > 0 || explicitReady === false) {
        return {
            label: 'incompleto',
            detail: errors[0] ?? 'confira provedor/base antes do reattach da sessão atual',
            role: 'warn',
        };
    }
    if (!profile.auth.bearerTokenConfigured && !profile.auth.apiKeyConfigured && !profile.auth.headersConfigured) {
        return {
            label: 'sem credencial',
            detail: 'ok apenas para providers locais ou sem auth',
            role: 'warn',
        };
    }
    return { label: 'pronto', detail: 'provider e modelo explícitos', role: 'success' };
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
 * @param {string} liveLabel
 * @returns {string}
 */
function compactByokLiveBindingLabel(liveLabel) {
    return String(liveLabel)
        .replace(/^BYOK · perfil /u, '')
        .replace(/ · preset /u, '/')
        .replace(/ · provedor /u, ' · ')
        .replace(/ · modelo /u, ' · ');
}

/**
 * @param {string | null | undefined} action
 * @returns {string | null}
 */
function compactByokModelAction(action) {
    const value = String(action ?? '').trim();
    if (!value) return null;
    if (/\/byok model <id>.*confirme/iu.test(value)) {
        return 'confirme por próximo uso registrado ou evento SDK';
    }
    return value;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @param {ReturnType<typeof readTerminalByokRuntimeConfigProjection>['modelGatewayProjection'] | null} runtimeProjection
 * @returns {Record<string, unknown> | null}
 */
function resolveByokGatewayActiveRoute(projection, runtimeProjection) {
    if (runtimeProjection?.effectiveRoute && typeof runtimeProjection.effectiveRoute === 'object') {
        return /** @type {Record<string, unknown>} */ (runtimeProjection.effectiveRoute);
    }
    const gatewayProjection = projection.modelGatewayProjection ?? {};
    if (gatewayProjection['effectiveRoute'] && typeof gatewayProjection['effectiveRoute'] === 'object') {
        return /** @type {Record<string, unknown>} */ (gatewayProjection['effectiveRoute']);
    }
    const active = projection.modelGateway?.active;
    if (active && typeof active === 'object') return /** @type {Record<string, unknown>} */ (active);
    return null;
}

/**
 * @param {Record<string, unknown> | null} route
 * @returns {string | null}
 */
function renderByokGatewayActiveRouteLabel(route) {
    if (!route) return null;
    if (typeof route['label'] === 'string' && route['label'].trim()) return route['label'].trim();
    const provider = typeof route['providerId'] === 'string' ? route['providerId'].trim() : '';
    const providerModel = typeof route['providerModel'] === 'string' ? route['providerModel'].trim() : '';
    if (provider && providerModel) return `${provider} · ${providerModel}`;
    const modelId = typeof route['modelId'] === 'string' ? route['modelId'].trim() : '';
    return modelId || null;
}

/**
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderStatus(projection, println) {
    const { summary } = projection;
    const statusCapabilities = resolveByokStatusCapabilities(projection);
    const runtimeConfig = readTerminalByokRuntimeConfigProjection();
    println('');
    println(terminalThemeHeadline('tool', 'BYOK status'));
    println(terminalThemeDivider(66));
    println(
        terminalThemeRow('Estado', renderByokStatusLine(summary.enabled, summary.ready), {
            role: summary.ready ? 'success' : summary.enabled ? 'warn' : 'muted',
        }),
    );
    println(terminalThemeRow('Flags', `enabled: ${yesNo(summary.enabled)} · ready: ${yesNo(summary.ready)}`));
    println(terminalThemeRow('Perfil', `${valueOrDash(summary.profile)} · preset ${valueOrDash(summary.preset)}`));
    println(
        terminalThemeRow('Provedor', `${valueOrDash(summary.providerType)} · base ${valueOrDash(summary.baseUrl)}`),
    );
    const modelParts = [
        valueOrDash(summary.model),
        summary.wireApi ? `protocolo ${renderByokWireLabel(summary.wireApi)}` : null,
        summary.azureApiVersion ? `Azure ${summary.azureApiVersion}` : null,
    ].filter(Boolean);
    println(terminalThemeRow('Modelo', modelParts.join(' · ')));
    println(terminalThemeRow('Autenticação', renderByokAuthLine(summary.auth)));
    if (summary.enabled) {
        println(
            terminalThemeWrappedRow(
                'Quota',
                'BYOK usa quota/cobrança do provider externo; GitHub Copilot/AI Credits e tokens só valem para rotas não-BYOK',
                { role: 'muted', columns: 112 },
            ),
        );
    }
    println(terminalThemeRow('Capacidades', renderByokCapabilityLine(statusCapabilities)));
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
    println(
        terminalThemeRow(
            'Catálogo',
            `${summary.modelList.count} ${summary.modelList.count === 1 ? 'modelo' : 'modelos'}`,
        ),
    );
    const gateway = projection.modelGateway ?? {
        source: 'unavailable',
        active: { modelId: null },
        diagnostics: {
            providerCount: 0,
            modelCount: projection.models.length,
            enabledModelCount: projection.models.length,
        },
    };
    const gatewayProjection = projection.modelGatewayProjection ?? {};
    const gatewayCounts = {
        providerCount: optionalCount(gatewayProjection['providerCount']) ?? gateway.diagnostics.providerCount,
        modelCount: optionalCount(gatewayProjection['modelCount']) ?? gateway.diagnostics.modelCount,
        enabledModelCount:
            optionalCount(gatewayProjection['enabledModelCount']) ?? gateway.diagnostics.enabledModelCount,
    };
    println(
        terminalThemeRow(
            'Gateway',
            `${gatewayCounts.providerCount} provedores · ${gatewayCounts.modelCount} modelos · ${gatewayCounts.enabledModelCount} habilitados · origem ${renderByokSourceLabel(gateway.source)}`,
        ),
    );
    const gatewayActive = resolveByokGatewayActiveRoute(projection, runtimeConfig.modelGatewayProjection ?? null);
    const gatewayActiveLabel = renderByokGatewayActiveRouteLabel(gatewayActive);
    if (gatewayActiveLabel) {
        println(terminalThemeRow('Gateway ativo', gatewayActiveLabel));
    }
    try {
        const inventory = await listTerminalSdkSessionInventory();
        const binding = classifyTerminalByokSdkBinding(
            summary,
            inventory.persistedByokBinding,
            inventory.currentSessionId,
            runtimeConfig.currentModel,
        );
        println(terminalThemeRow('Preparada', binding.preparedLabel));
        println(
            terminalThemeRow(
                'Sessão viva',
                `${inventory.currentSessionId ? 'ativa' : 'sem sessão viva'} · ${binding.liveLabel}`,
            ),
        );
        println(
            terminalThemeRow(
                'Alias BYOK',
                renderTerminalByokBindingMachineAlias(
                    summary,
                    inventory.persistedByokBinding,
                    inventory.currentSessionId,
                    runtimeConfig.currentModel,
                ),
                { role: 'muted' },
            ),
        );
        println(
            terminalThemeRow('Fronteira', binding.headline, {
                role:
                    binding.state === 'same-session-reattach-required' || binding.state === 'selection-incomplete'
                        ? 'warn'
                        : 'muted',
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
    println(terminalThemeRow('Arquivo', '.env.local · persistência de configuração; troca viva preserva o sessionId'));
    printByokSdkSessionBoundaryHint(println);
    println(
        terminalThemeRow('Rotina', '/byok providers · /byok profiles · /byok models · /byok recommend', {
            role: 'command',
        }),
    );
    println(
        terminalThemeRow('Trocar', '/byok use <perfil|sdk> · /byok model <id> · /byok provider <preset>', {
            role: 'command',
        }),
    );
    println(
        terminalThemeRow('Provar', '/byok probe chat · /byok probe agent · /byok probe shortlist', { role: 'command' }),
    );
    println(
        terminalThemeRow('Avançado', '/byok gateway commands · /byok auto policy · /byok env', { role: 'command' }),
    );
    println(terminalThemeDivider(66));
    println('');
}

/**
 * Renderiza somente o resumo necessário para uma troca de modelo. `/byok` continua sendo o painel completo; `/byok
 * model` precisa ser uma ação operacional curta, sem repetir catálogo, rotina e comandos avançados.
 *
 * @param {ReturnType<typeof readTerminalByokProjection>} projection
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokModelSwitchSummary(projection, println) {
    const { summary } = projection;
    println('');
    println(terminalThemeHeadline('tool', 'BYOK modelo', [valueOrDash(summary.model)]));
    println(
        terminalThemeRow(
            'Preparada',
            `${valueOrDash(summary.profile)} · ${valueOrDash(summary.preset)} · ${valueOrDash(summary.providerType)} · ${valueOrDash(summary.model)}`,
        ),
    );
    try {
        const inventory = await listTerminalSdkSessionInventory();
        const runtimeConfig = readTerminalByokRuntimeConfigProjection();
        const binding = classifyTerminalByokSdkBinding(
            summary,
            inventory.persistedByokBinding,
            inventory.currentSessionId,
            runtimeConfig.currentModel,
        );
        println(
            terminalThemeRow(
                'Sessão viva',
                `${inventory.currentSessionId ? 'ativa' : 'sem sessão viva'} · ${compactByokLiveBindingLabel(binding.liveLabel)}`,
            ),
        );
        println(
            terminalThemeRow(
                'Alias BYOK',
                renderTerminalByokBindingMachineAlias(
                    summary,
                    inventory.persistedByokBinding,
                    inventory.currentSessionId,
                    runtimeConfig.currentModel,
                ),
                { role: 'muted' },
            ),
        );
        println(
            terminalThemeRow('Fronteira', binding.headline, {
                role:
                    binding.state === 'same-session-reattach-required' || binding.state === 'selection-incomplete'
                        ? 'warn'
                        : 'muted',
            }),
        );
        const compactAction = compactByokModelAction(binding.action);
        if (compactAction) println(terminalThemeRow('Ação', compactAction, { role: 'command' }));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        println(
            terminalThemeRow('Sessão viva', `indisponível · ${message}; seleção preservada sem nova sessão`, {
                role: 'warn',
            }),
        );
    }
}

/**
 * @param {(text: string) => void} println
 * @param {{ routeProfile?: string; providerId?: string; providerModel?: string; full?: boolean }} [scope]
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
    println('');
    println(
        terminalThemeHeadline('tool', 'Saúde operacional BYOK', [countLabel(records.length, 'registro', 'registros')]),
    );
    println(
        terminalThemeWrappedRow(
            'Persistência',
            `${state.enabled ? 'ativa' : 'desativada'} · arquivo ${state.path ?? '-'} · carregado ${yesNo(Boolean(state.loaded))} · alterações pendentes ${yesNo(Boolean(state.dirty))}`,
            { role: state.enabled ? 'success' : 'muted', columns: 112 },
        ),
    );
    if (scope.providerId || scope.providerModel || scope.routeProfile) {
        println(
            terminalThemeWrappedRow(
                'Filtro',
                `provedor ${scope.providerId ?? '*'} · modelo ${scope.providerModel ?? '*'} · perfil ${scope.routeProfile ?? '*'}`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    if (state.error) println(terminalThemeWrappedRow('Erro', state.error, { role: 'error', columns: 112 }));
    if (records.length === 0) {
        println(
            terminalThemeRow('Resultado', 'nenhum turno BYOK real registrou sucesso ou falha neste estado ainda', {
                role: 'muted',
            }),
        );
        println('');
        return;
    }
    const visibleLimit = scope.full === true ? 30 : 12;
    for (const record of records.slice(0, visibleLimit)) {
        const label = renderByokHealthTag(record);
        const parts = [
            record.routeProfile ? `perfil ${record.routeProfile}` : null,
            record.providerId ? `provedor ${record.providerId}` : null,
            record.providerModel ? `modelo ${record.providerModel}` : null,
            label,
            renderByokAgentProbeHealthTag(record),
            ...renderByokProbeHealthSummaries(record),
        ].filter(Boolean);
        println(terminalThemeWrappedRow('Registro', record.key, { role: 'warn', columns: 112 }));
        println(terminalThemeWrappedRow('Estado', parts.join(' · '), { role: 'muted', columns: 112 }));
        if (record.lastMessage)
            println(terminalThemeWrappedRow('Último erro', record.lastMessage, { role: 'muted', columns: 112 }));
        if (record.lastErrorContext) println(terminalThemeRow('Contexto', record.lastErrorContext, { role: 'muted' }));
        if (
            record.lastFailureKind ||
            record.lastFailureStatusCode ||
            record.lastRetryAfterSeconds ||
            record.lastResetAt
        ) {
            const failureBits = [
                record.lastFailureKind ? `tipo ${record.lastFailureKind}` : null,
                record.lastFailureStatusCode ? `http ${record.lastFailureStatusCode}` : null,
                record.lastRetryAfterSeconds ? `retry após ${record.lastRetryAfterSeconds}s` : null,
                record.lastResetAt ? `reset ${record.lastResetAt}` : null,
            ].filter(Boolean);
            println(terminalThemeWrappedRow('Limite/falha', failureBits.join(' · '), { role: 'warn', columns: 112 }));
        }
        if (record.lastAgentProbeMessage) {
            println(
                terminalThemeWrappedRow('Erro agente', record.lastAgentProbeMessage, { role: 'muted', columns: 112 }),
            );
        }
        if (record.lastAgentProbeErrorContext)
            println(terminalThemeRow('Contexto agente', record.lastAgentProbeErrorContext, { role: 'muted' }));
    }
    if (records.length > visibleLimit) {
        println(
            terminalThemeWrappedRow(
                'Omitidos',
                `${countLabel(records.length - visibleLimit, 'registro omitido', 'registros omitidos')} · use filtros ou /byok health full para ampliar`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    println('');
}

/**
 * @param {string[]} tokens
 * @returns {{ routeProfile?: string; providerId?: string; providerModel?: string; full?: boolean }}
 */
function parseByokHealthClearScope(tokens) {
    /** @type {{ routeProfile?: string; providerId?: string; providerModel?: string; full?: boolean }} */
    const scope = {};
    for (const token of tokens) {
        if (/^(full|all|--full|--all)$/iu.test(token)) {
            scope.full = true;
            continue;
        }
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

    println('');
    println(
        terminalThemeHeadline('tool', 'BYOK endpoints de provedores', [
            countLabel(inventories.length, 'provedor', 'provedores'),
        ]),
    );
    println(
        terminalThemeWrappedRow(
            'Escopo',
            'inventário estático de coleta · não prova acesso nem execução · sondas promovem confiança depois',
            { role: 'muted', columns: 112 },
        ),
    );

    if (inventories.length === 0) {
        println(
            terminalThemeWrappedRow('Estado', `provedor não encontrado no inventário: ${selector ?? '-'}`, {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }

    for (const inventory of inventories) {
        println(
            terminalThemeWrappedRow(
                'Provedor',
                `${inventory.providerId} · tipo ${renderByokTokenLabel(inventory.providerKind)} · adaptador ${inventory.adapterId}`,
                { role: 'warn', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Bases',
                `${inventory.baseUrls.slice(0, 3).join(' · ')}${inventory.baseUrls.length > 3 ? ' · ...' : ''}`,
                { role: 'muted', columns: 112 },
            ),
        );
        const sources = inventory.modelCatalogSources
            .slice(0, 3)
            .map((source) => `${source.method} ${source.url} (${renderByokTokenLabel(source.richness)})`);
        println(
            terminalThemeWrappedRow(
                'Catálogo',
                `${sources.join(' · ')}${inventory.modelCatalogSources.length > 3 ? ' · ...' : ''}`,
                { role: 'muted', columns: 112 },
            ),
        );
        const runtime = inventory.runtimeEndpoints.slice(0, 4).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
        println(
            terminalThemeWrappedRow(
                'Execução',
                `${runtime.join(' · ')}${inventory.runtimeEndpoints.length > 4 ? ' · ...' : ''}`,
                { role: 'muted', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow('Seletores', renderByokTokenList(inventory.routeSelectors.map(String)), {
                role: 'muted',
                columns: 112,
            }),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Próximo',
            'importadores de catálogo usam este mapa antes de elegibilidade, sondas e seleção de execução',
            { role: 'command', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {Record<string, unknown>} importer
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
    const selector = optionalScalarString(
        rest.find((item) => !/^(importers|importer|audit|auditoria|coverage|cobertura)$/iu.test(item)),
    );
    const allImporters = createDefaultModelGatewayCatalogImporters({ env: process.env });
    const importers = allImporters.filter((importer) => matchesByokImporterSelector(importer, selector));
    const inventories = selector
        ? [resolveProviderEndpointInventory(selector)].filter((item) => item !== null)
        : listProviderEndpointInventory();
    const audit = auditCatalogImporterSet(importers, { inventories });
    const coverageRows = audit.endpointCoverage;
    const coveredSourceCount = coverageRows.reduce((total, row) => total + row.coveredCatalogSourceCount, 0);
    const totalSourceCount = coverageRows.reduce((total, row) => total + row.catalogSourceCount, 0);

    println('');
    println(terminalThemeHeadline('tool', 'BYOK auditoria de importadores'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `filtro ${selector ?? '-'} · importadores ${audit.importerCount}/${allImporters.length} · provedores ${audit.providerCount} · públicos ${audit.publicImporterCount} · autenticados ${audit.authenticatedImporterCount}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Cobertura',
            `evidências de provedor ${audit.providerEvidenceImporterCount} · rotas ${audit.routeOptionImporterCount} · overlays de conta ${audit.accountOverlayImporterCount} · endpoints ${coveredSourceCount}/${totalSourceCount}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow('Escopo', 'auditoria local e pré-execução · sem rede · sem runtime · sem segredos', {
            role: 'muted',
            columns: 112,
        }),
    );

    if (selector && inventories.length === 0) {
        println(
            terminalThemeWrappedRow('Estado', `provedor não encontrado no inventário: ${selector}`, {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }

    if (audit.descriptors.length === 0) {
        println(
            terminalThemeWrappedRow('Estado', `nenhum importer configurado para ${selector ?? 'o ambiente atual'}`, {
                role: 'warn',
                columns: 112,
            }),
        );
    } else {
        for (const descriptor of audit.descriptors.slice(0, 32)) {
            const hookTags = Object.entries(descriptor.hooks)
                .filter(([, enabled]) => enabled)
                .map(([hook]) => renderByokTokenLabel(hook))
                .join(',');
            const envRequirements = descriptor.envRequirements.length > 0 ? descriptor.envRequirements.join(',') : '-';
            println(
                terminalThemeWrappedRow(
                    'Importer',
                    `${descriptor.id} · provedor ${descriptor.providerId} · fonte ${renderByokTokenLabel(descriptor.sourceKind)} · autenticação ${yesNo(descriptor.requiresAuth)} · TTL ${formatTerminalDurationSeconds(descriptor.ttlSeconds)}`,
                    { role: 'warn', columns: 112 },
                ),
            );
            println(
                terminalThemeWrappedRow('Etapas', `${hookTags || '-'} · env ${envRequirements}`, {
                    role: 'muted',
                    columns: 112,
                }),
            );
        }
        if (audit.descriptors.length > 32)
            println(
                terminalThemeWrappedRow('Omitidos', `exibindo 32/${audit.descriptors.length}; filtre com provider id`, {
                    role: 'muted',
                    columns: 112,
                }),
            );
    }

    const uncovered = audit.uncoveredCatalogSourceIds.slice(0, 12).join(', ');
    const missingHooks = audit.missingRequiredHooks.slice(0, 12).join(', ');
    const providersWithoutImporters = audit.providersWithoutImporters.slice(0, 12).join(', ');
    println(
        terminalThemeWrappedRow('Sem cobertura', uncovered || '-', {
            role: uncovered ? 'warn' : 'success',
            columns: 112,
        }),
    );
    println(
        terminalThemeWrappedRow('Sem importador', providersWithoutImporters || '-', {
            role: providersWithoutImporters ? 'warn' : 'success',
            columns: 112,
        }),
    );
    println(
        terminalThemeWrappedRow('Etapas ausentes', missingHooks || '-', {
            role: missingHooks ? 'warn' : 'success',
            columns: 112,
        }),
    );
    println(
        terminalThemeWrappedRow(
            'Próximo',
            'use antes de atualizar catálogo para priorizar importers, docs e overlays de conta',
            { role: 'command', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokProviderGatewayTraits(println, rest) {
    const selector = optionalScalarString(
        rest.find((item) => !/^(traits|trait|caracteristicas|características)$/iu.test(item)),
    );
    const traits = selector
        ? [resolveProviderGatewayTraits(selector)].filter((item) => item !== null)
        : listProviderGatewayTraits();

    println('');
    println(
        terminalThemeHeadline('tool', 'BYOK características de provedores', [
            countLabel(traits.length, 'provedor', 'provedores'),
        ]),
    );
    println(
        terminalThemeWrappedRow(
            'Escopo',
            'metadados pré-execução derivados de specs/endpoints · não provam acesso, saúde ou execução',
            { role: 'muted', columns: 112 },
        ),
    );

    if (traits.length === 0) {
        println(
            terminalThemeWrappedRow('Estado', `provedor não encontrado para características: ${selector ?? '-'}`, {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }

    for (const item of traits) {
        const capabilities = asRecord(item['capabilities']);
        const routing = asRecord(item['routing']);
        const metadata = asRecord(item['metadata']);
        const routeSelectors = Array.isArray(item['routeSelectors'])
            ? renderByokTokenList(item['routeSelectors'].slice(0, 6).map(String))
            : '-';
        const richnessTags = Array.isArray(item['richnessTags'])
            ? renderByokTokenList(item['richnessTags'].slice(0, 8).map(String))
            : '-';
        const richnessCategories = Array.isArray(item['richnessCategories'])
            ? renderByokTokenList(item['richnessCategories'].slice(0, 8).map(String))
            : '-';
        println(
            terminalThemeWrappedRow(
                'Provedor',
                `${optionalScalarString(item['providerId']) ?? '-'} · topologia ${renderByokTokenLabel(optionalScalarString(item['topology']))} · tipo ${renderByokTokenLabel(optionalScalarString(item['providerKind']))} · compatível com OpenAI ${yesNo(item['openAICompatible'] === true)}`,
                { role: 'warn', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Catálogo',
                `fontes ${item['catalogSourceCount'] ?? 0} · endpoints runtime ${item['runtimeEndpointCount'] ?? 0} · públicos ${item['publicCatalogSourceCount'] ?? 0} · autenticados ${item['authenticatedCatalogSourceCount'] ?? 0} · parametrizados ${item['parameterizedCatalogSourceCount'] ?? 0}`,
                { role: 'muted', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Execução',
                `tipos ${Array.isArray(item['runtimeKinds']) ? renderByokTokenList(item['runtimeKinds'].map(String)) || '-' : '-'} · seletores ${routeSelectors}`,
                { role: 'muted', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Capacidades',
                `chat ${yesNo(capabilities['chatCompletions'] === true)} · responses ${yesNo(capabilities['responses'] === true)} · FIM ${yesNo(capabilities['fim'] === true)} · embeddings ${yesNo(capabilities['embeddings'] === true)}`,
                { role: 'muted', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Roteamento',
                `auto ${yesNo(routing['supportsAutoSelection'] === true)} · fallback ${yesNo(routing['supportsFallback'] === true)} · ordem de providers ${yesNo(routing['supportsProviderOrder'] === true)} · BYOK ${yesNo(routing['supportsGatewayByok'] === true)} · preço ${yesNo(metadata['hasPricingMetadata'] === true)} · contexto ${yesNo(metadata['hasContextMetadata'] === true)} · provider ${yesNo(metadata['hasProviderMetadata'] === true)}`,
                { role: 'muted', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow('Riqueza', `${richnessTags} · categorias ${richnessCategories}`, {
                role: 'muted',
                columns: 112,
            }),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Próximo',
            'usar como filtro inicial; elegibilidade e sondas continuam em fases separadas',
            { role: 'command', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderByokGatewayLocalGuidance(println) {
    println('');
    println(terminalThemeHeadline('tool', 'BYOK local/Ollama'));
    println(
        terminalThemeWrappedRow('Padrão', 'excluído · daemon não iniciado · sem runtime · opt-in obrigatório', {
            role: 'warn',
            columns: 112,
        }),
    );
    println(
        terminalThemeWrappedRow('Motivo', renderByokTokenLabel(MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON), {
            role: 'muted',
            columns: 112,
        }),
    );
    println(
        terminalThemeWrappedRow('Política', 'excluir providers locais por padrão', { role: 'muted', columns: 112 }),
    );
    println(
        terminalThemeWrappedRow('Opt-in provider', '/byok gateway selection audit provider:ollama', {
            role: 'command',
            columns: 112,
        }),
    );
    println(
        terminalThemeWrappedRow('Opt-in perfil', '/byok gateway selection audit local_private', {
            role: 'command',
            columns: 112,
        }),
    );
    println(
        terminalThemeWrappedRow('Modelo ativo', '/byok provider ollama-local <modelo> http://127.0.0.1:11434/v1', {
            role: 'command',
            columns: 112,
        }),
    );
    println(
        terminalThemeWrappedRow('Checagem', '/byok gateway selection audit strict local_private_strict', {
            role: 'command',
            columns: 112,
        }),
    );
    println(
        terminalThemeWrappedRow(
            'Garantia',
            'não inicia Ollama, não faz probe e não altera env; apenas mostra o caminho explícito',
            { role: 'muted', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokGatewayProbeMatrix(println, rest) {
    const selector = optionalScalarString(rest.find((item) => !/^(probes|probe|matrix|matriz)$/iu.test(item)));
    const rows = listProviderWireProbeMatrix(selector === null ? {} : { providerId: selector });
    const summary = summarizeProviderWireProbeMatrix(rows);

    println('');
    println(terminalThemeHeadline('tool', 'BYOK matriz de sondas por protocolo'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `provedores ${summary.providerCount} · linhas ${summary.rowCount} · filtro ${selector ?? '-'} · fase planejamento pré-execução`,
            { role: 'muted', columns: 112 },
        ),
    );

    if (rows.length === 0) {
        println(
            terminalThemeWrappedRow(
                'Estado',
                `nenhuma linha de matriz encontrada para ${selector ?? 'inventário atual'}`,
                { role: 'warn', columns: 112 },
            ),
        );
        println('');
        return;
    }

    for (const row of rows.slice(0, 24)) {
        const implemented = Array.isArray(row['implementedProbeKinds'])
            ? renderByokTokenList(row['implementedProbeKinds'].map(String))
            : '-';
        const pending = Array.isArray(row['pendingProbeKinds'])
            ? renderByokTokenList(row['pendingProbeKinds'].map(String))
            : '-';
        const notes = Array.isArray(row['notes'])
            ? row['notes'].map((note) => renderByokTokenLabel(String(note))).join(',')
            : '-';
        println(
            terminalThemeWrappedRow(
                'Provedor',
                `${optionalScalarString(row['providerId']) ?? '-'} · protocolo ${renderByokWireLabel(optionalScalarString(row['wireApi']))} · execução ${renderByokTokenLabel(optionalScalarString(row['runtimeKind']))} · topologia ${renderByokTokenLabel(optionalScalarString(row['topology']))}`,
                { role: 'warn', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Sondas',
                `implementados ${implemented || '-'} · pendentes ${pending || '-'} · notas ${notes || '-'}`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    if (rows.length > 24)
        println(
            terminalThemeWrappedRow('Omitidos', `exibindo 24/${rows.length}; filtre com provider id`, {
                role: 'muted',
                columns: 112,
            }),
        );

    const pendingKinds = Object.entries(summary.pendingProbeKindCounts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, count]) => `${renderByokTokenLabel(kind)}:${count}`)
        .join(', ');
    println(
        terminalThemeWrappedRow('Sondas pendentes', pendingKinds || '-', {
            role: pendingKinds ? 'warn' : 'success',
            columns: 112,
        }),
    );
    println(
        terminalThemeWrappedRow(
            'Escopo',
            'não executa provedor/modelo; orienta sondas futuras e seleção por política',
            { role: 'muted', columns: 112 },
        ),
    );
    println('');
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
    const diff = latestRun
        ? normalizeCatalogDiffForDisplay(latestRun['diff'])
        : { added: [], removed: [], changed: [] };
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
        .map(([reason, count]) => `${renderByokTokenLabel(reason)}:${count}`)
        .join(',');
    println('');
    println(terminalThemeHeadline('tool', 'BYOK planejador de pausa para sondas'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · filtro ${args.selector ?? '-'} · recomendações ${filteredRecommendations.length}/${recommendations.length} · prontas ${plan.summary.ready} · adiadas ${plan.summary.deferred} · motivos ${reasonCounts || '-'}`,
            { role: plan.summary.deferred > 0 ? 'warn' : 'success', columns: 112 },
        ),
    );
    if (filteredRecommendations.length === 0) {
        println(
            terminalThemeWrappedRow('Estado', 'nenhuma recomendação de probe disponível no último diff persistido', {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }
    for (const item of plan.deferred.slice(0, args.limit)) {
        const retry = item.resetAt
            ? `reset ${item.resetAt}`
            : item.retryAfterSeconds
              ? `retentar em ${item.retryAfterSeconds}s`
              : 'reset -';
        const probe = item.probeKind ? ` · sonda ${renderByokTokenLabel(item.probeKind)}` : '';
        println(
            terminalThemeWrappedRow(
                'Adiar',
                `${item.key} · motivo ${renderByokTokenLabel(item.reason)}${probe} · ${retry} · provedor ${item.providerId}`,
                {
                    role: 'warn',
                    columns: 112,
                },
            ),
        );
    }
    for (const item of plan.ready.slice(0, Math.max(0, args.limit - plan.deferred.length))) {
        println(
            terminalThemeWrappedRow(
                'Pronto',
                `${item.key} · sondas ${renderByokTokenList(item.probeKinds) || '-'} · motivos ${renderByokTokenList(item.reasons.slice(0, 3)) || '-'}`,
                {
                    role: 'success',
                    columns: 112,
                },
            ),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Escopo',
            'não executa provedor/modelo; evita sondas durante janelas dinâmicas conhecidas',
            { role: 'muted', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokGatewayEnvRequirements(println, rest) {
    const selector = optionalScalarString(
        rest.find((item) => !/^(secrets|secret|env|requirements|requisitos|missing)$/iu.test(item)),
    );
    const rows = evaluateModelGatewayProviderEnvRequirements({
        env: process.env,
        ...(selector === null ? {} : { providerId: selector }),
    });
    const summary = summarizeModelGatewayProviderEnvRequirements(rows);

    println('');
    println(terminalThemeHeadline('tool', 'BYOK requisitos de ambiente'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `providers ${summary.providerCount} · prontos ${summary.readyCount} · parciais ${summary.partialCount} · ausentes ${summary.missingCount} · filtro ${selector ?? '-'}`,
            { role: summary.missingCount > 0 ? 'warn' : 'success', columns: 112 },
        ),
    );

    if (rows.length === 0) {
        println(
            terminalThemeWrappedRow('Estado', `nenhum provedor encontrado para requisitos: ${selector ?? '-'}`, {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }

    for (const row of rows.slice(0, 24)) {
        const configured = row.configuredKeys.length > 0 ? row.configuredKeys.join(',') : '-';
        const missing = row.missingRequiredKeys.length > 0 ? row.missingRequiredKeys.join(',') : '-';
        const recommended = row.missingRecommendedKeys.length > 0 ? row.missingRecommendedKeys.join(',') : '-';
        const aliases =
            Array.isArray(row.providerAliases) && row.providerAliases.length > 0
                ? ` · aliases ${row.providerAliases.join(',')}`
                : '';
        println(
            terminalThemeWrappedRow(
                'Provedor',
                `${row.providerId} · estado ${renderByokTokenLabel(row.status)} · obrigatórias ${row.satisfiedRequiredGroupCount}/${row.requiredGroupCount} · recomendadas ${row.satisfiedRecommendedGroupCount}/${row.recommendedGroupCount}${aliases}`,
                { role: row.status === 'ready' ? 'success' : 'warn', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Variáveis',
                `configuradas ${configured} · obrigatórias ausentes ${missing} · recomendadas ausentes ${recommended}`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    if (rows.length > 24)
        println(
            terminalThemeWrappedRow('Omitidos', `exibindo 24/${rows.length}; filtre com provider id`, {
                role: 'muted',
                columns: 112,
            }),
        );
    println(
        terminalThemeWrappedRow('Segurança', 'lista apenas nomes de variáveis; nenhum valor de segredo é impresso', {
            role: 'muted',
            columns: 112,
        }),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderByokGatewayPreKGate(println) {
    const report = buildModelGatewayPreKCompatibilityReport();
    println('');
    println(terminalThemeHeadline('tool', 'BYOK gate pré-K'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `etapa ${report.stage} · pronto ${yesNo(report.ready)} · checks ${report.passed}/${report.total} · falhas ${report.failed}`,
            { role: report.ready ? 'success' : 'warn', columns: 112 },
        ),
    );
    for (const check of report.checks) {
        println(
            terminalThemeWrappedRow(
                'Check',
                `${check.passed ? 'ok' : 'pendente'} · ${renderByokTokenLabel(check.id)} · faixa ${check.track} · ${check.summary}`,
                { role: check.passed ? 'success' : 'warn', columns: 112 },
            ),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Escopo',
            'este gate fecha a camada A-J; catálogo universal, SQLite e importers profundos continuam nas Faixas K+',
            { role: 'muted', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function renderByokGatewayPreBuildReadiness(println) {
    const report = buildModelGatewayPreBuildReadinessReport();
    println('');
    println(terminalThemeHeadline('tool', 'BYOK prontidão pré-build'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `etapa ${report.stage} · pronto ${yesNo(report.ready)} · checks ${report.passed}/${report.total} · falhas ${report.failed}`,
            { role: report.ready ? 'success' : 'warn', columns: 112 },
        ),
    );
    for (const check of report.checks) {
        println(
            terminalThemeWrappedRow(
                'Check',
                `${check.passed ? 'ok' : 'pendente'} · ${renderByokTokenLabel(check.id)} · faixa ${check.track} · ${check.summary}`,
                { role: check.passed ? 'success' : 'warn', columns: 112 },
            ),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Escopo',
            'este readiness prepara o build do banco de metadados; ele não substitui probes runtime nem executa modelos',
            { role: 'muted', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokGatewayCanonicalCommands(println, rest) {
    const surface = rest.find((item) => /^(package|make|terminal)$/iu.test(item))?.toLowerCase();
    const phase = rest
        .find((item) => /^(orientation|metadata|pre-runtime|selection|validate|prebuild|live-readiness)$/iu.test(item))
        ?.toLowerCase();
    const full = rest.some((item) => /^(full|all|completo|todos|--full|--all)$/iu.test(item));
    const commandFilters = {
        ...(surface === undefined ? {} : { surface }),
        ...(phase === undefined ? {} : { phase }),
    };
    const commands = listModelGatewayCanonicalCommands(commandFilters);
    const renderedLines = renderModelGatewayCanonicalCommandLines(commandFilters);
    const visibleCommands = full || surface || phase ? commands : commands.slice(0, 48);
    println('');
    println(terminalThemeHeadline('tool', 'Comandos canônicos BYOK'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `Faixa Y · escopo package + make + terminal · build em preparação · superfície ${surface ?? '-'} · fase ${phase ? renderModelGatewayCommandPhaseLabel(phase) : '-'} · comandos ${commands.length} · exibindo ${visibleCommands.length}/${renderedLines.length}`,
            { role: 'muted', columns: 112 },
        ),
    );
    for (const [index, command] of visibleCommands.entries()) {
        const fallbackSummary = renderedLines[index]?.split(' :: ')[1];
        const commandText = optionalScalarString(command['command']) ?? renderedLines[index]?.split(' :: ')[0] ?? '-';
        const commandSurface = optionalScalarString(command['surface']) ?? '-';
        const commandPhase = renderModelGatewayCommandPhaseLabel(optionalScalarString(command['phase']));
        println(
            terminalThemeWrappedRow('Comando', `${commandSurface} · ${commandPhase} · ${commandText}`, {
                role: 'command',
                columns: 112,
            }),
        );
        println(
            terminalThemeWrappedRow('Descrição', renderTerminalModelGatewayCommandSummary(command, fallbackSummary), {
                role: 'muted',
                columns: 112,
            }),
        );
    }
    if (visibleCommands.length < renderedLines.length) {
        println(
            terminalThemeWrappedRow(
                'Mais',
                '/byok gateway commands full mostra o inventário completo; filtros úteis: live-readiness, metadata, prebuild, package, make, terminal',
                { role: 'command', columns: 112 },
            ),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Build',
            'banco de metadados deve partir de npm run model-gateway:build ou make model-gateway-build',
            { role: 'command', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokGatewayAutoExplainIntro(println, rest) {
    const profile =
        rest.map((item) => item.match(/^profile[:=](.+)$/iu)?.[1]?.trim()).find((value) => value) ?? 'repo_agent';
    println('');
    println(terminalThemeHeadline('accent', 'Explicação BYOK auto', ['model-gateway']));
    println(
        terminalThemeWrappedRow(
            'Escopo',
            `perfil ${profile} · decisão atual + diagnóstico operacional · sem chamada a provedor`,
            { role: 'muted', columns: 112 },
        ),
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
    const latestLiveRun = optionalScalarString(diagnosticLatestLiveRun.summaryPath)
        ? diagnosticLatestLiveRun
        : (liveRuns[0] ?? {});
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
            detail: `ação ${renderByokTokenLabel(status.decision.action)} · bloqueios ${status.decision.blockers.length}`,
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
        `/byok auto plan profile:${status.args.profileId} ${limit}`,
        `npm run model-gateway:auto:standby -- --profile=${status.args.profileId} --limit=${limit} --write-sqlite`,
        ...standbyPlan.nextCommands,
        'npm run model-gateway:runtime-health:diff -- --write-snapshot --fail-on-regression',
    ];
    println('');
    println(terminalThemeHeadline('tool', 'BYOK operador pronto'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `perfil ${status.args.profileId} · ok ${yesNo(blockers.length === 0)} · checagens ${checks.length - blockers.length}/${checks.length} · standby ${standbyRows.length} · persistidos ${persistedStandbyRows} · provedores ${standbyProviderCount} · sem chamada a provedor`,
            { role: blockers.length === 0 ? 'success' : 'warn', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Política',
            `ativa ${yesNo(policy.enabled)} · preset ${renderByokAutoPresetLabel(optionalScalarString(policy.preset) ?? 'operator_manual')} · modo ${renderByokTokenLabel(policy.policy)} · modelo vivo ${yesNo(policy.allowLiveSetModel)} · nova sessão ${yesNo(policy.allowNewSession)} · local privado ${yesNo(policy.allowLocalPrivate)}`,
            { role: policy.enabled ? 'success' : 'warn', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Vivo',
            `${status.decision.currentBoundary.preset ?? '-'} · ${status.decision.currentBoundary.model ?? '-'}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Alvo',
            `${status.decision.targetBoundary.preset ?? '-'} · ${status.decision.targetBoundary.model ?? '-'} · ação ${renderByokTokenLabel(status.decision.action)}`,
            { role: status.decision.ok ? 'success' : 'warn', columns: 112 },
        ),
    );
    if (status.decision.fallbackFromSelectedRouteKey || status.decision.fallbackReason) {
        println(
            terminalThemeWrappedRow(
                'Alternativa',
                `de ${status.decision.fallbackFromSelectedRouteKey ?? '-'} · motivo ${renderByokTokenLabel(status.decision.fallbackReason)}`,
                { role: 'warn', columns: 112 },
            ),
        );
    }
    for (const check of checks) {
        println(
            terminalThemeWrappedRow(
                'Check',
                `${check.pass ? 'ok' : 'pendente'} · ${renderByokTokenLabel(check.id)} · ${check.detail}`,
                { role: check.pass ? 'success' : 'warn', columns: 112 },
            ),
        );
    }
    for (const [index, row] of standbyRows.slice(0, Math.min(limit, 5)).entries()) {
        println(
            terminalThemeWrappedRow(
                `Standby ${index + 1}`,
                `${row.providerId}:${row.providerModel} · ${renderByokSourceLabel(row.source)} · classe ${renderByokTokenLabel(row.standbyClass)} · sonda ${yesNo(row.needsProbe)} · prova ${yesNo(row.hasRuntimeProof)} · env ${renderByokTokenLabel(row.runtimeEnvStatus)}`,
                { role: row.needsProbe ? 'warn' : 'success', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow('Recomendado', row.recommendedCommand ?? '-', { role: 'command', columns: 112 }),
        );
        println(terminalThemeWrappedRow('Provar', row.commands.probeAgent ?? '-', { role: 'command', columns: 112 }));
        println(terminalThemeWrappedRow('Usar', row.commands.liveModel ?? '-', { role: 'command', columns: 112 }));
        println(terminalThemeWrappedRow('Novo boot', row.commands.provider ?? '-', { role: 'command', columns: 112 }));
        if (row.providerId && row.providerModel) {
            println(
                terminalThemeWrappedRow(
                    'Limpar',
                    `/byok health clear provider:${row.providerId} model:${row.providerModel} profile:${row.profileId ?? status.args.profileId}`,
                    { role: 'command', columns: 112 },
                ),
            );
        }
    }
    println(
        terminalThemeWrappedRow(
            'Banco standby',
            `linhas ${persistedStandbyRows} · mais recente ${latestPersistedStandby.standbyPlanId ?? '-'} · perfil ${latestPersistedStandby.routeProfile ?? '-'} · rotas ${latestPersistedStandby.routeCount ?? '-'}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Banco live',
            `linhas ${liveRunRows} · mais recente ${optionalScalarString(latestLiveRun['scenarioKind']) ?? '-'} · estado ${optionalScalarString(latestLiveRun['status']) ?? '-'} · resumo ${optionalScalarString(latestLiveRun['summaryPath']) ?? '-'}`,
            { role: 'muted', columns: 112 },
        ),
    );
    for (const [index, run] of liveRuns.slice(0, 3).entries()) {
        println(
            terminalThemeWrappedRow(
                `Live ${index + 1}`,
                `${optionalScalarString(run['scenarioKind']) ?? optionalScalarString(run['kind']) ?? '-'} · estado ${optionalScalarString(run['status']) ?? '-'} · ok ${run['ok'] === true ? 'sim' : run['ok'] === false ? 'não' : '-'} · resumo ${optionalScalarString(run['summaryPath']) ?? '-'}`,
                { role: run['ok'] === true ? 'success' : 'warn', columns: 112 },
            ),
        );
    }
    if (status.decision.blockers.length > 0) {
        println(
            terminalThemeWrappedRow('Bloqueios', renderByokTokenList(status.decision.blockers), {
                role: 'warn',
                columns: 112,
            }),
        );
    }
    println(terminalThemeWrappedRow('Operador', status.decision.operatorSummary, { role: 'muted', columns: 112 }));
    println(
        terminalThemeWrappedRow('Próximo', [...new Set(nextCommands)].slice(0, 5).join(' && '), {
            role: 'command',
            columns: 112,
        }),
    );
    println('');
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
              [importer.id, importer.providerId].some((value) =>
                  String(value ?? '')
                      .toLowerCase()
                      .includes(normalizedSelector),
              ),
          )
        : allImporters;
    const refreshContext = {
        source: 'terminal-byok',
        storePath: store.filePath,
        importerIds: importers.map((importer) => importer.id),
    };
    println('');
    println(terminalThemeHeadline('tool', 'BYOK refresh do catálogo'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · filtro ${normalizedSelector ?? '-'} · importers ${importers.map((importer) => importer.id).join(', ') || '-'} · schema OpenAI + x_model_gateway`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (importers.length === 0) {
        println(
            terminalThemeWrappedRow(
                'Estado',
                'nenhum importer habilitado para este seletor; configure rede/credenciais, remova o filtro ou use uma fonte pública disponível',
                { role: 'warn', columns: 112 },
            ),
        );
        println('');
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
                const shouldPrint =
                    event.phase === 'refresh_plan_ready' ||
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
                const importer =
                    event.importer && typeof event.importer === 'object' ? event.importer['importerId'] : null;
                /** @type {Record<string, string>} */
                const phaseLabels = {
                    refresh_plan_ready: 'plano pronto',
                    refresh_completed: 'refresh concluído',
                    eligibility_evaluated: 'elegibilidade recalculada',
                    snapshot_written: 'snapshot gravado',
                    snapshot_previewed: 'snapshot pré-visualizado',
                };
                const phase =
                    phaseLabels[event.phase] ??
                    event.phase
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
                    typeof event.eligibilityDecisionCount === 'number'
                        ? `decisões ${event.eligibilityDecisionCount}`
                        : '',
                    typeof event.eligibilityAddedCount === 'number'
                        ? `elegibilidade +${event.eligibilityAddedCount}`
                        : '',
                    typeof event.eligibilityRemovedCount === 'number'
                        ? `elegibilidade -${event.eligibilityRemovedCount}`
                        : '',
                    typeof event.eligibilityChangedCount === 'number'
                        ? `elegibilidade ~${event.eligibilityChangedCount}`
                        : '',
                    typeof event.addedCount === 'number' ? `novos ${event.addedCount}` : '',
                    typeof event.removedCount === 'number' ? `removidos ${event.removedCount}` : '',
                    typeof event.changedCount === 'number' ? `alterados ${event.changedCount}` : '',
                ]);
                println(
                    terminalThemeWrappedRow(
                        'Progresso',
                        `${String(progressPct).padStart(3)}% · ${phase}${importer ? ` · importer ${importer}` : ''}${counts ? ` · ${counts}` : ''}`,
                        { role: event.phase.endsWith(':importer_failed') ? 'error' : 'muted', columns: 112 },
                    ),
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
            terminalThemeWrappedRow(
                'Refresh concluído',
                `projeções ${result.snapshot.projections.length} · modelos OpenAI ${result.openai.data.length} · runs retidos ${result.snapshot.importRuns.length}`,
                { role: 'success', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Diferença do catálogo',
                `novos ${result.diff.added.length} · removidos ${result.diff.removed.length} · alterados ${result.diff.changed.length}`,
                {
                    role:
                        result.diff.added.length > 0 || result.diff.removed.length > 0 || result.diff.changed.length > 0
                            ? 'warn'
                            : 'success',
                    columns: 112,
                },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Persistência',
                `${renderByokTokenLabel(result.writePolicy.mode)} · commit ${yesNoPlain(result.writePolicy.committed)} · overlays ${result.overlayRefresh.total} · elegibilidade ${result.eligibilityRefresh.decisionCount} · runs retidos ${result.retention.importRuns.after}`,
                { role: result.writePolicy.committed ? 'success' : 'warn', columns: 112 },
            ),
        );
        const eligibilityDiffSummary = result.eligibilityRefresh.diffSummary;
        if (eligibilityDiffSummary) {
            println(
                terminalThemeWrappedRow(
                    'Diferença de elegibilidade',
                    `novas ${eligibilityDiffSummary.addedCount} · removidas ${eligibilityDiffSummary.removedCount} · alteradas ${eligibilityDiffSummary.changedCount} · ficaram elegíveis ${eligibilityDiffSummary.becameEligibleCount} · ficaram excluídas ${eligibilityDiffSummary.becameExcludedCount}`,
                    {
                        role:
                            eligibilityDiffSummary.addedCount > 0 ||
                            eligibilityDiffSummary.removedCount > 0 ||
                            eligibilityDiffSummary.changedCount > 0
                                ? 'warn'
                                : 'muted',
                        columns: 112,
                    },
                ),
            );
            if (eligibilityDiffSummary.changedKinds.length > 0) {
                println(
                    terminalThemeWrappedRow(
                        'Tipos de elegibilidade',
                        renderByokTokenList(eligibilityDiffSummary.changedKinds),
                        { role: 'muted', columns: 112 },
                    ),
                );
            }
        }
        if (refreshEvents.completedEvent.changedKinds.length > 0) {
            println(
                terminalThemeWrappedRow(
                    'Tipos de catálogo',
                    renderByokTokenList(refreshEvents.completedEvent.changedKinds),
                    { role: 'muted', columns: 112 },
                ),
            );
        }
        const probeRecommendations = recommendCatalogDiffProbes(
            buildByokProbeRecommendationInput(result.snapshot, result.diff, 5),
        );
        if (probeRecommendations.length > 0) {
            println(
                terminalThemeWrappedRow('Sugestões de prova runtime', String(probeRecommendations.length), {
                    role: 'warn',
                    columns: 112,
                }),
            );
            for (const recommendation of probeRecommendations) {
                println(
                    terminalThemeWrappedRow(
                        'Provar',
                        `${recommendation.key}: ${renderByokTokenList(recommendation.probeKinds)} · ${renderByokTokenLabel(recommendation.priority)} · ${renderByokTokenList(recommendation.reasons.slice(0, 4))}`,
                        { role: 'warn', columns: 112 },
                    ),
                );
                println(
                    terminalThemeWrappedRow('Comando', recommendation.commands[0] ?? '-', {
                        role: 'command',
                        columns: 112,
                    }),
                );
            }
        }
        for (const id of result.diff.added.slice(0, 5))
            println(terminalThemeWrappedRow('Novo', id, { role: 'success', columns: 112 }));
        for (const id of result.diff.removed.slice(0, 5))
            println(terminalThemeWrappedRow('Removido', id, { role: 'error', columns: 112 }));
        for (const item of result.diff.changed.slice(0, 5)) {
            const kinds =
                Array.isArray(item.changedKinds) && item.changedKinds.length > 0
                    ? ` · ${renderByokTokenList(item.changedKinds)}`
                    : '';
            println(
                terminalThemeWrappedRow('Alterado', `${item.key} (${item.changedFields.join(',')}${kinds})`, {
                    role: 'warn',
                    columns: 112,
                }),
            );
        }
        println(
            terminalThemeWrappedRow(
                'Fronteira',
                'saída interoperável disponível como OpenAI Models list em memória; snapshot interno ficou em data/copilot/model-gateway/catalog.json',
                { role: 'muted', columns: 112 },
            ),
        );
        println('');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        println(terminalThemeWrappedRow('Erro', `refresh falhou: ${message}`, { role: 'error', columns: 112 }));
        println('');
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
              [importer.id, importer.providerId].some((value) =>
                  String(value ?? '')
                      .toLowerCase()
                      .includes(normalizedSelector),
              ),
          )
        : allImporters;
    println('');
    println(terminalThemeHeadline('tool', 'BYOK plano de refresh'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · filtro ${normalizedSelector ?? '-'} · prévia local, sem rede e sem escrita`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (importers.length === 0) {
        println(
            terminalThemeWrappedRow('Estado', 'nenhum importer habilitado para este seletor', {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
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
        entries = (await terminalByokWorkspaceIo.listDirectoryNamesFresh(dir)).entries;
    } catch {
        return null;
    }
    /** @type {{ path: string; mtimeMs: number }[]} */
    const candidates = [];
    for (const entry of entries.filter((item) => item.endsWith('.jsonl'))) {
        const filePath = join(dir, entry);
        try {
            const metadata = (await terminalByokWorkspaceIo.statPath(filePath)).stats;
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK log de refresh'));
    const logPath = await findLatestModelGatewayRefreshLogPath();
    if (!logPath) {
        println(
            terminalThemeWrappedRow(
                'Estado',
                'nenhum log JSONL de refresh encontrado; rode /byok gateway catalog refresh primeiro',
                { role: 'warn', columns: 112 },
            ),
        );
        println('');
        return;
    }
    const text = (await terminalByokWorkspaceIo.readTextFresh(logPath, { includeHash: false })).content;
    const summary = summarizeModelGatewayRefreshLogText(text, { logPath });
    println(
        terminalThemeWrappedRow(
            'Log',
            `${logPath} · eventos ${summary.eventCount} · linhas inválidas ${summary.invalidLineCount}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Refresh completo',
            `${yesNoPlain(summary.completed)} · commit ${yesNoPlain(summary.committed)} · duração ${summary.elapsedMs ?? '-'}ms`,
            { role: summary.completed ? 'success' : 'warn', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Totais',
            `projeções ${summary.totals.projections ?? '-'} · modelos OpenAI ${summary.totals.openai ?? '-'} · overlays ${summary.totals.overlays ?? '-'} · novos ${summary.totals.added ?? '-'} · removidos ${summary.totals.removed ?? '-'} · alterados ${summary.totals.changed ?? '-'}`,
            { role: 'muted', columns: 112 },
        ),
    );
    const importerEntries = Object.entries(summary.importers);
    println(
        terminalThemeWrappedRow(
            'Importers',
            `com eventos ${importerEntries.length} · falhas ${summary.failures.length}`,
            { role: summary.failures.length === 0 ? 'success' : 'warn', columns: 112 },
        ),
    );
    for (const [importerId, importer] of importerEntries.slice(0, 12)) {
        println(
            terminalThemeWrappedRow(
                'Importer',
                `${importerId} · iniciados ${importer.started} · concluídos ${importer.completed} · falhas ${importer.failed} · linhas ${importer.rowCount} · evidências ${importer.evidenceCount}`,
                { role: importer.failed === 0 ? 'muted' : 'warn', columns: 112 },
            ),
        );
    }
    for (const failure of summary.failures.slice(0, 8)) {
        println(
            terminalThemeWrappedRow(
                'Falha',
                `${failure.phase} · importer ${failure.importerId ?? '-'} · ${failure.errors.join('; ')}`,
                { role: 'error', columns: 112 },
            ),
        );
    }
    println('');
}

/**
 * @param {ReturnType<InstanceType<typeof JsonModelGatewayCatalogStore>['readSnapshot']> extends Promise<infer T>
 *         ? T
 *         : never} snapshot
 * @returns {Record<string, unknown> | null}
 */
function findLatestCatalogRefreshRun(snapshot) {
    return (
        [...snapshot.importRuns]
            .reverse()
            .find(
                (run) => run['providerId'] === 'model-gateway' && run['sourceId'] === 'catalog-refresh' && run['diff'],
            ) ?? null
    );
}

/**
 * @param {unknown} value
 * @returns {{
 *     added: string[];
 *     removed: string[];
 *     changed: { key: string; changedFields: string[]; changedKinds: string[] }[];
 * }}
 */
function normalizeCatalogDiffForDisplay(value) {
    const record = asRecord(value);
    const changed = Array.isArray(record['changed'])
        ? record['changed']
              .filter((item) => item && typeof item === 'object')
              .map((item) => {
                  const changedRecord = asRecord(item);
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
 * @returns {{
 *     added: string[];
 *     removed: string[];
 *     changed: {
 *         key: string;
 *         changedFields: string[];
 *         changedKinds: string[];
 *         previousInclude?: boolean | null;
 *         nextInclude?: boolean | null;
 *     }[];
 * }}
 */
function normalizeEligibilityDiffForDisplay(value) {
    const record = asRecord(value);
    const changed = Array.isArray(record['changed'])
        ? record['changed']
              .filter((item) => item && typeof item === 'object')
              .map((item) => {
                  const changedRecord = asRecord(item);
                  return {
                      key: optionalScalarString(changedRecord['key']) ?? 'unknown',
                      changedFields: Array.isArray(changedRecord['changedFields'])
                          ? changedRecord['changedFields'].map(String)
                          : [],
                      changedKinds: Array.isArray(changedRecord['changedKinds'])
                          ? changedRecord['changedKinds'].map(String)
                          : [],
                      previousInclude:
                          typeof changedRecord['previousInclude'] === 'boolean'
                              ? changedRecord['previousInclude']
                              : null,
                      nextInclude:
                          typeof changedRecord['nextInclude'] === 'boolean' ? changedRecord['nextInclude'] : null,
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
 * @param {ReturnType<InstanceType<typeof JsonModelGatewayCatalogStore>['readSnapshot']> extends Promise<infer T>
 *         ? T
 *         : never} snapshot
 * @returns {Record<string, unknown> | null}
 */
function findLatestEligibilityRun(snapshot) {
    const runs = Array.isArray(snapshot.modelEligibilityRuns) ? snapshot.modelEligibilityRuns : [];
    return (
        [...runs].reverse().find((run) => run && typeof run === 'object' && (run['diff'] || run['diffSummary'])) ?? null
    );
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK runs de elegibilidade'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · runs persistidos ${allRuns.length} · exibindo ${runs.length}/${allRuns.length} · sem runtime`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (runs.length === 0) {
        println(
            terminalThemeWrappedRow(
                'Estado',
                'nenhum run de eligibility persistido; rode /byok gateway catalog refresh primeiro',
                {
                    role: 'warn',
                    columns: 112,
                },
            ),
        );
        println('');
        return;
    }
    for (const [index, run] of runs.entries()) {
        const summary = summarizeModelGatewayEligibilityDiff(normalizeEligibilityDiffForDisplay(run['diff']));
        println(
            terminalThemeWrappedRow(
                `${index + 1}. Run`,
                `${run['runId'] ?? '-'} · política ${renderByokTokenLabel(optionalScalarString(run['policyProfile']))} · tarefa ${renderByokTokenLabel(optionalScalarString(run['taskProfile']))} · conta ${renderByokTokenLabel(optionalScalarString(run['accountScope']))} · estado ${renderByokTokenLabel(optionalScalarString(run['status']))}`,
                { role: run['status'] === 'completed' ? 'success' : 'warn', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Contagem',
                `concluído ${run['completedAt'] ?? '-'} · modelos ${run['modelCount'] ?? 0} · elegíveis ${run['eligibleCount'] ?? 0} · desconhecidos ${run['unknownCount'] ?? 0} · excluídos ${run['excludedCount'] ?? 0}`,
                { role: 'muted', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Diferença',
                `novas ${summary.addedCount} · removidas ${summary.removedCount} · alteradas ${summary.changedCount} · ficaram elegíveis ${summary.becameEligibleCount} · ficaram excluídas ${summary.becameExcludedCount}`,
                {
                    role:
                        summary.addedCount > 0 || summary.removedCount > 0 || summary.changedCount > 0
                            ? 'warn'
                            : 'muted',
                    columns: 112,
                },
            ),
        );
        if (summary.changedKinds.length > 0) {
            println(
                terminalThemeWrappedRow('Tipos de mudança', renderByokTokenList(summary.changedKinds), {
                    role: 'muted',
                    columns: 112,
                }),
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK diff de elegibilidade'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · fonte último run de elegibilidade persistido · sem runtime`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (!run) {
        println(
            terminalThemeWrappedRow(
                'Estado',
                'nenhum diff de eligibility persistido; rode /byok gateway catalog refresh primeiro',
                {
                    role: 'warn',
                    columns: 112,
                },
            ),
        );
        println('');
        return;
    }
    const diff = normalizeEligibilityDiffForDisplay(run['diff']);
    const summary = summarizeModelGatewayEligibilityDiff(diff);
    println(
        terminalThemeWrappedRow(
            'Run',
            `${run['runId'] ?? '-'} · novas ${summary.addedCount} · removidas ${summary.removedCount} · alteradas ${summary.changedCount} · ficaram elegíveis ${summary.becameEligibleCount} · ficaram excluídas ${summary.becameExcludedCount}`,
            {
                role:
                    summary.addedCount > 0 || summary.removedCount > 0 || summary.changedCount > 0 ? 'warn' : 'success',
                columns: 112,
            },
        ),
    );
    if (summary.changedKinds.length > 0) {
        println(
            terminalThemeWrappedRow('Tipos de mudança', renderByokTokenList(summary.changedKinds), {
                role: 'muted',
                columns: 112,
            }),
        );
    }
    for (const id of diff.added.slice(0, 8))
        println(terminalThemeWrappedRow('Novo elegível', id, { role: 'success', columns: 112 }));
    for (const id of diff.removed.slice(0, 8))
        println(terminalThemeWrappedRow('Removido', id, { role: 'error', columns: 112 }));
    for (const item of diff.changed.slice(0, 8)) {
        const kinds = item.changedKinds.length > 0 ? ` · ${renderByokTokenList(item.changedKinds)}` : '';
        println(terminalThemeWrappedRow('Alterado', `${item.key}${kinds}`, { role: 'warn', columns: 112 }));
    }
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogDiff(println) {
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    println('');
    println(terminalThemeHeadline('tool', 'BYOK diff do catálogo'));
    println(
        terminalThemeWrappedRow('Resumo', `catálogo ${store.filePath} · fonte último refresh persistido · sem rede`, {
            role: 'muted',
            columns: 112,
        }),
    );
    const snapshot = await store.readSnapshot();
    const latestRun = findLatestCatalogRefreshRun(snapshot);
    if (!latestRun) {
        println(
            terminalThemeWrappedRow(
                'Estado',
                'nenhum diff persistido encontrado; rode /byok gateway catalog refresh primeiro',
                { role: 'warn', columns: 112 },
            ),
        );
        println('');
        return;
    }
    const diff = normalizeCatalogDiffForDisplay(latestRun['diff']);
    const summary = summarizeCanonicalModelProjectionDiff(diff);
    const recommendations = recommendCatalogDiffProbes(buildByokProbeRecommendationInput(snapshot, diff, 8));
    println(
        terminalThemeWrappedRow(
            'Run',
            `${latestRun['runId'] ?? '-'} · novos ${summary.addedCount} · removidos ${summary.removedCount} · alterados ${summary.changedCount} · conflitos ${snapshot.conflicts.length}`,
            {
                role:
                    summary.changedCount > 0 || summary.addedCount > 0 || summary.removedCount > 0 ? 'warn' : 'success',
                columns: 112,
            },
        ),
    );
    if (summary.changedKinds.length > 0) {
        println(
            terminalThemeWrappedRow('Tipos de mudança', summary.changedKinds.join(','), {
                role: 'muted',
                columns: 112,
            }),
        );
    }
    for (const id of diff.added.slice(0, 8))
        println(terminalThemeWrappedRow('Novo', id, { role: 'success', columns: 112 }));
    for (const id of diff.removed.slice(0, 8))
        println(terminalThemeWrappedRow('Removido', id, { role: 'error', columns: 112 }));
    for (const item of diff.changed.slice(0, 8)) {
        const kinds = item.changedKinds.length > 0 ? ` · ${item.changedKinds.join(',')}` : '';
        println(
            terminalThemeWrappedRow('Alterado', `${item.key} (${item.changedFields.join(',')}${kinds})`, {
                role: 'warn',
                columns: 112,
            }),
        );
    }
    if (recommendations.length > 0) {
        println(
            terminalThemeWrappedRow('Sugestões de prova runtime', String(recommendations.length), {
                role: 'warn',
                columns: 112,
            }),
        );
        for (const recommendation of recommendations.slice(0, 5)) {
            println(
                terminalThemeWrappedRow(
                    'Provar',
                    `${recommendation.key} · ${recommendation.probeKinds.join(',')} · ${recommendation.reasons.slice(0, 4).join(',')}`,
                    { role: 'warn', columns: 112 },
                ),
            );
            println(
                terminalThemeWrappedRow('Comando', recommendation.commands[0] ?? '-', {
                    role: 'command',
                    columns: 112,
                }),
            );
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK integridade do catálogo'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · integridade ${integrity.ok ? 'ok' : 'falha'} · identidades redigidas ${integrity.redactedIdentityCount} · sem rede`,
            { role: integrity.ok ? 'success' : 'error', columns: 112 },
        ),
    );
    for (const [field, check] of Object.entries(integrity.duplicateChecks)) {
        println(
            terminalThemeWrappedRow(
                'Duplicidade',
                `${renderByokTokenLabel(field)} · linhas ${check.rowCount} · únicas ${check.uniqueKeyCount} · chaves duplicadas ${check.duplicateKeyCount} · excedentes ${check.duplicateExtraRowCount}`,
                { role: check.duplicateExtraRowCount === 0 ? 'success' : 'error', columns: 112 },
            ),
        );
    }
    for (const sample of integrity.redactedIdentitySamples.slice(0, 8)) {
        println(
            terminalThemeWrappedRow(
                'Redigido',
                `${renderByokTokenLabel(sample.field)} · ${sample.id ?? sample.providerModel ?? sample.providerId ?? '-'}`,
                { role: 'error', columns: 112 },
            ),
        );
    }
    println('');
}

/**
 * @param {string[]} rest
 * @returns {{
 *     strict: boolean;
 *     effective: boolean;
 *     requireRuntimeProof: boolean;
 *     writeTrace: boolean;
 *     traceDir: string;
 *     traceId: string;
 *     selectionPolicy: string;
 *     profiles: string[];
 * }}
 */
function parseByokGatewaySelectionAuditArgs(rest) {
    const requireRuntimeProof = rest.some((item) =>
        /^(runtime-proof|proof|proved|provado|require-proof|--runtime-proof|--require-runtime-proof)$/iu.test(item),
    );
    const writeTrace = rest.some((item) =>
        /^(trace|write-trace|persist-trace|decision-trace|--write-trace|--persist-trace)$/iu.test(item),
    );
    const traceDir =
        rest.map((item) => item.match(/^--?trace-dir[:=](.+)$/iu)?.[1] ?? null).find((item) => item !== null) ??
        DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR;
    const traceId =
        rest
            .map(
                (item) => item.match(/^--?trace-id[:=](.+)$/iu)?.[1] ?? item.match(/^trace-id[:=](.+)$/iu)?.[1] ?? null,
            )
            .find((item) => item !== null) ?? '';
    const selectionPolicy =
        rest
            .map(
                (item) =>
                    item.match(/^--?selection-policy[:=](.+)$/iu)?.[1] ?? item.match(/^policy[:=](.+)$/iu)?.[1] ?? null,
            )
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
        .map(([key, count]) => `${renderByokTokenLabel(key)}:${count}`)
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
                  policyProfile: args.strict
                      ? 'terminal-effective-strict-no-runtime'
                      : 'terminal-effective-allow-probe-no-runtime',
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
    const selectionComparison = postRuntimeSelection
        ? compareModelGatewaySelectionAudits(selection, postRuntimeSelection)
        : null;
    const selectionComparisonExplanation = selectionComparison
        ? explainModelGatewaySelectionComparison(selectionComparison)
        : null;
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
    const persistedStatus = tracePersistence?.written === true ? 'sim' : args.writeTrace ? 'falha' : 'não';
    const modeLabel = `${renderByokTokenLabel(selection.mode)}${args.effective ? ' + efetivo' : ''}${args.requireRuntimeProof ? ' + prova obrigatória' : ''}`;
    println('');
    println(terminalThemeHeadline('tool', 'BYOK auditoria de seleção'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · integridade ${integrity.ok ? 'ok' : 'falha'} · modo ${modeLabel} · sem execução · persistido ${persistedStatus} · perfis ${selection.summary.selectedProfileCount}/${selection.summary.profileCount}`,
            { role: integrity.ok ? 'success' : 'error', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Snapshot',
            `projeções ${selection.snapshotContext['projectionCount']} · rotas ${selection.snapshotContext['routeOptionCount']} · overlays ${selection.snapshotContext['accountOverlayCount']} · elegibilidade ${selection.snapshotContext['eligibilityDecisionCount']} · candidatos ${selection.snapshotContext['candidateCount']}`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (args.effective) {
        println(
            terminalThemeWrappedRow(
                'Saúde observada',
                `registros ${healthRecords.length} · overlays de execução ${runtimeOverlays.length} · ativos ${runtimeOverlaySummary?.activeCount ?? 0} · expirados ${runtimeOverlaySummary?.expiredCount ?? 0} · falhas ${formatCountMap(runtimeOverlaySummary?.byFailureKind ?? {})} · provedores ${formatCountMap(runtimeOverlaySummary?.byProvider ?? {})} · elegibilidade efetiva ${effectiveEligibility?.decisions.length ?? 0}`,
                { role: (runtimeOverlaySummary?.activeCount ?? 0) > 0 ? 'warn' : 'muted', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Pós-execução',
                `perfis ${postRuntimeSelection?.summary.selectedProfileCount ?? 0}/${postRuntimeSelection?.summary.profileCount ?? 0} · saúde casada ${postRuntimeSelection?.summary.healthRecordCount ?? 0} · provas de saúde ${postRuntimeSelection?.summary.runtimeHealthProofCount ?? 0} · provas agente ${postRuntimeSelection?.summary.runtimeAgentProbeProofCount ?? 0} · provas de sonda ${postRuntimeSelection?.summary.runtimeProbeProofCount ?? 0} · provedores ${formatCountMap(postRuntimeSelection?.summary.selectedProviders ?? {})}`,
                { role: 'muted', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Comparação',
                `mudou ${selectionComparison?.summary.changedCount ?? 0}/${selectionComparison?.summary.profileCount ?? 0} · prova pós-runtime selecionada ${selectionComparison?.summary.postRuntimeProofSelectedCount ?? 0}/${selectionComparison?.summary.profileCount ?? 0}`,
                { role: (selectionComparison?.summary.changedCount ?? 0) > 0 ? 'warn' : 'success', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Razões',
                `${formatCountMap(selectionComparisonExplanation?.summary.reasonCounts ?? {})} · próximos ${renderByokTokenList(selectionComparisonExplanation?.summary.nextActions.slice(0, 4).map(String) ?? []) || '-'}`,
                { role: 'muted', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Política',
                `${renderByokTokenLabel(policyResolution?.mode ?? args.selectionPolicy)} · selecionados finais ${policyResolution?.summary.selectedCount ?? 0}/${policyResolution?.summary.profileCount ?? 0} · vencedores pós-execução ${policyResolution?.summary.postRuntimeWinnerCount ?? 0} · mudou do pré-runtime ${policyResolution?.summary.changedFromPreRuntimeCount ?? 0}`,
                { role: 'muted', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Seletor de execução',
                `${runtimeSelectorPlan?.ready ? 'pronto' : 'bloqueado'} · selecionados ${runtimeSelectorPlan?.summary.selectedProfileCount ?? 0}/${runtimeSelectorPlan?.summary.profileCount ?? 0} · bloqueados ${runtimeSelectorPlan?.summary.blockedProfileCount ?? 0} · env pronto ${runtimeSelectorPlan?.summary.runtimeEnvReadyCount ?? 0} · env bloqueado ${runtimeSelectorPlan?.summary.runtimeEnvBlockedCount ?? 0} · prova selecionada ${runtimeSelectorPlan?.summary.runtimeProofSelectedCount ?? 0}`,
                { role: runtimeSelectorPlan?.ready ? 'success' : 'warn', columns: 112 },
            ),
        );
        if (args.writeTrace) {
            println(
                terminalThemeWrappedRow(
                    'Trace',
                    `persistido ${tracePersistence?.written ? 'sim' : 'não'} · arquivo ${tracePersistence?.filePath ?? '-'} · mais recente ${tracePersistence?.latestPath ?? '-'} · erro ${tracePersistence?.error ?? '-'}`,
                    { role: tracePersistence?.written ? 'success' : 'warn', columns: 112 },
                ),
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
                terminalThemeWrappedRow(
                    'Perfil',
                    `${profile.profileId} · ${selected['providerId']}:${selected['providerModel']} · seletor ${renderByokTokenLabel(optionalScalarString(selected['selectorKind']))} · pontuação ${selected['score'] ?? '-'} · candidatos ${profile.candidateCount} · rejeitados ${profile.rejectedCount}`,
                    { role: 'success', columns: 112 },
                ),
            );
        } else {
            println(
                terminalThemeWrappedRow(
                    'Perfil',
                    `${profile.profileId} · sem selecionado · candidatos ${profile.candidateCount} · rejeitados ${profile.rejectedCount} · próxima ação ${renderByokTokenList(profile.nextActions.slice(0, 3).map(String)) || '-'}`,
                    { role: 'error', columns: 112 },
                ),
            );
            if (profile.topRejectedReasons.length > 0) {
                println(
                    terminalThemeWrappedRow(
                        'Rejeições',
                        renderByokTokenList(profile.topRejectedReasons.slice(0, 5).map(String)),
                        { role: 'warn', columns: 112 },
                    ),
                );
            }
        }
        if (supplyLine) println(terminalThemeWrappedRow('Supply', supplyLine, { role: 'muted', columns: 112 }));
        const comparisonRow = selectionComparison?.rows.find((row) => row.profileId === profile.profileId);
        const comparisonExplanation = selectionComparisonExplanation?.rows.find(
            (row) => row.profileId === profile.profileId,
        );
        if (comparisonRow?.changed || (args.effective && comparisonRow?.postSelected)) {
            const postSelected = comparisonRow.postSelected;
            const postLabel = postSelected
                ? `${postSelected['providerId']}:${postSelected['providerModel']} · seletor ${renderByokTokenLabel(optionalScalarString(postSelected['selectorKind']))} · pontuação ${postSelected['score'] ?? '-'}`
                : 'sem selecionado';
            println(
                terminalThemeWrappedRow(
                    'Pós-execução',
                    `${comparisonRow.changed ? 'mudou' : 'igual'} -> ${postLabel} · prova runtime ${yesNo(comparisonRow.postSelectedHasRuntimeProof)}`,
                    { role: comparisonRow.changed ? 'warn' : 'muted', columns: 112 },
                ),
            );
        }
        if (args.effective && comparisonExplanation) {
            println(
                terminalThemeWrappedRow(
                    'Comparação',
                    `${renderByokTokenLabel(comparisonExplanation.reason)} · próxima ação ${renderByokTokenList(comparisonExplanation.nextActions.slice(0, 3).map(String))}`,
                    { role: 'muted', columns: 112 },
                ),
            );
        }
        if (Array.isArray(profile.supplyWarnings) && profile.supplyWarnings.length > 0) {
            println(
                terminalThemeWrappedRow('Avisos', renderByokTokenList(profile.supplyWarnings.slice(0, 6).map(String)), {
                    role: 'warn',
                    columns: 112,
                }),
            );
        }
    }
    const localProviderBlocks = summarizeModelGatewayLocalProviderOptInBlocks(selection);
    if (localProviderBlocks.hasBlocks) {
        println(
            terminalThemeWrappedRow(
                'Local/Ollama',
                renderModelGatewayLocalProviderOptInGuidance({ profileIds: localProviderBlocks.blockedProfileIds }),
                { role: 'warn', columns: 112 },
            ),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Fronteira',
            `etapa ${args.effective ? 'efetiva sem novas sondas' : 'pré-runtime'} · ranking por metadados/overlays/política${args.effective ? ' e saúde já observada' : ''} · sondas live ficam para a fase seguinte`,
            { role: 'muted', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogSqliteMirror(println) {
    const jsonStore = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    const sqliteStore = new SqliteModelGatewayCatalogStore();
    println('');
    println(terminalThemeHeadline('tool', 'BYOK espelho SQLite do catálogo'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `JSON ${jsonStore.filePath} · SQLite copilot.sqlite · modo espelho redigido · sem rede`,
            { role: 'muted', columns: 112 },
        ),
    );
    const result = await mirrorModelGatewayCatalogSnapshotToSqlite({
        sourceStore: jsonStore,
        sqliteStore,
    });
    const diagnostics = await sqliteStore.readStorageDiagnostics();
    const counts = result.sqliteCounts;
    const parity = result.parity ?? { ok: true, snapshotIdMatches: true, countMismatches: [] };
    println(
        terminalThemeWrappedRow(
            'Snapshot',
            `fonte ${result.sqliteSnapshot.source} · projeções ${counts.projections} · evidências ${counts.evidences} · rotas ${counts.routeOptions} · overlays ${counts.accountOverlays} · elegibilidade ${counts.modelEligibilityDecisions}`,
            { role: 'success', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Camadas',
            `provedores ${counts.providerProjections} · evidências de provedor ${counts.providerEvidences} · refs brutas ${counts.rawPayloadRefs} · conflitos ${counts.conflicts} · runs de importação ${counts.importRuns}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'SQLite',
            `versão ${diagnostics.userVersion} · catálogo ${diagnostics.catalogRows} · histórico de conta ${diagnostics.accountHistoryRows} · execução ${diagnostics.runtimeRows} · decisões de rota ${diagnostics.routeDecisionRows}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Paridade',
            `${parity.ok ? 'ok' : 'divergente'} · snapshot ${parity.snapshotIdMatches ? 'ok' : 'diferente'} · divergências ${parity.countMismatches.length}`,
            { role: parity.ok ? 'success' : 'error', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Fronteira',
            'JSON permanece como export/debug; SQLite materializa camadas normalizadas para consultas futuras',
            { role: 'muted', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayHealthSqliteMirror(println) {
    const sqliteStore = new SqliteModelGatewayCatalogStore();
    println('');
    println(terminalThemeHeadline('tool', 'BYOK espelho SQLite da saúde runtime'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            'fonte byok-provider-health · destino copilot.sqlite · fatos de execução separados do catálogo',
            { role: 'muted', columns: 112 },
        ),
    );
    const result = await flushAndMirrorByokProviderHealthToSqlite({ sqliteStore });
    println(
        terminalThemeWrappedRow(
            'Saúde runtime',
            `flush ${result.flushed ? 'sim' : 'não'} · registros ${result.records} · observações ${result.healthObservations} · sondas ${result.probeResults} · run ${result.runId}`,
            { role: 'success', columns: 112 },
        ),
    );
    println('');
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK schema OpenAI normalizado'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `fonte ${useSqlite ? 'sqlite' : 'json'} · objeto ${openaiList.object} · modelos ${openaiList.data.length} · extensão x_model_gateway`,
            { role: 'muted', columns: 112 },
        ),
    );
    for (const model of openaiList.data.slice(0, 12)) {
        const gateway = asRecord(model.x_model_gateway);
        const providerId = optionalScalarString(gateway['provider_id']) ?? '-';
        const providerModel = optionalScalarString(gateway['provider_model']) ?? model.id;
        const eligibility = asRecord(gateway['eligibility']);
        const eligibilityStatus = renderByokTokenLabel(optionalScalarString(eligibility['status']));
        const routeOptionCount = Array.isArray(gateway['route_options']) ? gateway['route_options'].length : 0;
        println(
            terminalThemeWrappedRow(
                'Modelo',
                `${model.id} · provedor ${providerId} · modelo do provedor ${providerModel} · rotas ${routeOptionCount} · elegibilidade ${eligibilityStatus}`,
                { role: 'warn', columns: 112 },
            ),
        );
    }
    if (openaiList.data.length > 12) {
        println(
            terminalThemeWrappedRow(
                'Omitidos',
                `exibindo 12/${openaiList.data.length}; use JSON/SQLite store para export completo`,
                { role: 'muted', columns: 112 },
            ),
        );
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK explicação do catálogo'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · filtro ${normalizedSelector ?? '-'} · sem runtime novo`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (!normalizedSelector) {
        println(
            terminalThemeWrappedRow('Estado', 'informe um modelo, provedor:modelo ou trecho do nome exibido', {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }
    const snapshot = await store.readSnapshot();
    let explanation = explainModelGatewayCatalogEntry(snapshot, normalizedSelector);
    if (!explanation.found || !explanation.projection) {
        println(
            terminalThemeWrappedRow(
                'Estado',
                `modelo não encontrado no snapshot atual · próxima ação ${renderByokTokenList(explanation.nextActions.map(String)) || '-'}`,
                { role: 'warn', columns: 112 },
            ),
        );
        println('');
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
        println(
            terminalThemeWrappedRow('Estado', 'modelo não encontrado após juntar saúde runtime', {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }
    const eligibility = explanation.eligibility;
    println(terminalThemeWrappedRow('Modelo', explanation.key ?? normalizedSelector, { role: 'warn', columns: 112 }));
    println(
        terminalThemeWrappedRow(
            'Identidade',
            `nome ${optionalScalarString(projection['displayName']) ?? '-'} · lifecycle ${renderByokTokenLabel(optionalScalarString(projection['lifecycle']))} · família ${optionalScalarString(projection['family']) ?? '-'}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Camadas',
            `rotas ${explanation.routeOptions.length} · overlays ${explanation.accountOverlays.length} · elegibilidade ${renderByokTokenLabel(eligibility?.status)} · OpenAI id ${explanation.openai?.id ?? '-'}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Saúde runtime',
            `${renderByokTokenLabel(explanation.runtimeHealth?.status)} · sondas runtime ${explanation.runtimeProbes.length}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Metadados',
            `confiança ${explanation.metadataCoverage.confidenceFields} · proveniência ${explanation.metadataCoverage.provenanceFields} · parâmetros suportados ${explanation.metadataCoverage.supportedParameters} · não suportados ${explanation.metadataCoverage.unsupportedParameters}`,
            { role: 'muted', columns: 112 },
        ),
    );
    for (const route of explanation.routeOptions.slice(0, 4)) {
        const policy = asRecord(route['normalizedPolicy']);
        println(
            terminalThemeWrappedRow(
                'Rota',
                `${renderByokTokenLabel(optionalScalarString(route['selectorKind']))}:${optionalScalarString(route['selectorSyntax']) ?? '-'} · camada ${renderByokTokenLabel(optionalScalarString(policy['routeLayer']))} · protocolo ${renderByokWireLabel(optionalScalarString(policy['wireApi']))}`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    for (const overlay of explanation.accountOverlays.slice(0, 3)) {
        println(
            terminalThemeWrappedRow(
                'Overlay',
                `escopo ${renderByokTokenLabel(optionalScalarString(overlay['accountScope']) ?? 'default')} · segredo ${optionalScalarString(overlay['secretRef']) ?? '-'} · habilitados ${Array.isArray(overlay['enabledModels']) ? overlay['enabledModels'].length : 0} · bloqueados ${Array.isArray(overlay['blockedModels']) ? overlay['blockedModels'].length : 0}`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    if (eligibility) {
        println(
            terminalThemeWrappedRow(
                'Elegibilidade',
                `${eligibility.summary} · próxima ação ${renderByokTokenList(eligibility.nextActions.slice(0, 4).map(String)) || '-'}`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Próximo',
            renderByokTokenList(explanation.nextActions.slice(0, 6).map(String)) || '-',
            { role: 'command', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string | null} selector
 * @returns {Promise<void>}
 */
async function renderByokGatewayProviderExplain(println, selector) {
    const normalizedSelector = optionalScalarString(selector);
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    println('');
    println(terminalThemeHeadline('tool', 'BYOK explicação do provedor'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · filtro ${normalizedSelector ?? '-'} · sem runtime`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (!normalizedSelector) {
        println(
            terminalThemeWrappedRow('Estado', 'informe um id de provedor ou nome exibido', {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }
    const explanation = explainModelGatewayProviderEntry(await store.readSnapshot(), normalizedSelector);
    if (!explanation.found) {
        println(
            terminalThemeWrappedRow(
                'Estado',
                `provedor não encontrado · próxima ação ${renderByokTokenList(explanation.nextActions.map(String)) || '-'}`,
                { role: 'warn', columns: 112 },
            ),
        );
        println('');
        return;
    }
    println(
        terminalThemeWrappedRow('Provedor', explanation.providerId ?? normalizedSelector, {
            role: 'warn',
            columns: 112,
        }),
    );
    println(
        terminalThemeWrappedRow(
            'Camadas',
            `fontes ${explanation.sources.length} · evidências de provedor ${explanation.providerEvidences.length} · modelos ${explanation.projections.length} · rotas ${explanation.routeOptions.length} · overlays ${explanation.accountOverlays.length} · conflitos ${explanation.conflicts.length}`,
            { role: explanation.conflicts.length > 0 ? 'warn' : 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Frescor',
            `mais novo ${explanation.freshness.newestSourceAt ?? '-'} · mais antigo ${explanation.freshness.oldestSourceAt ?? '-'}`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (explanation.providerProjection) {
        println(
            terminalThemeWrappedRow(
                'Identidade',
                `nome ${optionalScalarString(explanation.providerProjection['displayName']) ?? '-'} · provedor descrito ${optionalScalarString(explanation.providerProjection['subjectProviderId']) ?? '-'}`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    for (const source of explanation.sources.slice(0, 4)) {
        println(
            terminalThemeWrappedRow(
                'Fonte',
                `${optionalScalarString(source['id']) ?? '-'} · tipo ${renderByokTokenLabel(optionalScalarString(source['kind']))} · autenticação ${renderByokTokenLabel(optionalScalarString(source['authMode']))} · atualização ${renderByokTokenLabel(optionalScalarString(source['refreshPolicy']))}`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    const firstConflict = explanation.conflicts[0] ?? null;
    if (firstConflict) {
        println(
            terminalThemeWrappedRow(
                'Conflito',
                `${optionalScalarString(firstConflict['projectionKey']) ?? '-'} · campo ${optionalScalarString(firstConflict['fieldPath']) ?? '-'}`,
                { role: 'warn', columns: 112 },
            ),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Próximo',
            renderByokTokenList(explanation.nextActions.slice(0, 6).map(String)) || '-',
            { role: 'command', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {string[]} rest
 * @returns {{
 *     query: string;
 *     providerId?: string;
 *     onlyEligible: boolean;
 *     requireTools: boolean;
 *     requireStreaming: boolean;
 *     requireReasoning: boolean;
 *     limit: number;
 * }}
 */
function parseByokGatewayCatalogSearchArgs(rest) {
    const numeric = rest.map((item) => Number(item)).find((value) => Number.isFinite(value) && value > 0);
    const providerToken = rest.find((item) => /^(?:provider|providerId)[:=]/iu.test(item));
    const providerId = providerToken
        ? providerToken.slice(providerToken.search(/[:=]/u) + 1).trim() || undefined
        : undefined;
    const query = rest
        .filter((item) => Number.isNaN(Number(item)))
        .filter((item) => !/^(eligible|tools|streaming|reasoning|provider[:=]|providerId[:=])/iu.test(item))
        .join(' ')
        .trim();
    return {
        query,
        ...(providerId === undefined ? {} : { providerId }),
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
 * @returns {{ selector: string | null; limit: number; hasExplicitLimit: boolean }}
 */
function parseGatewayCatalogListArgs(rest) {
    const numeric = rest.map((item) => Number(item)).find((value) => Number.isFinite(value) && value > 0);
    const selector = rest.map(optionalScalarString).find((item) => item && Number.isNaN(Number(item))) ?? null;
    return {
        selector,
        limit: Math.min(Math.floor(numeric ?? 30), 150),
        hasExplicitLimit: numeric !== undefined,
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
        runtimeSelectorPlan.routes.find((route) => route.profileId === args.profileId) ??
        runtimeSelectorPlan.routes[0] ??
        null;
    const alternativeSummary = activeRoute?.alternativeSummary ?? null;
    println('');
    println(terminalThemeHeadline('tool', 'BYOK automação do gateway'));
    println(
        terminalThemeWrappedRow(
            'Perfil',
            `${args.profileId} · seletor de execução ${runtimeSelectorPlan.ok ? 'ok' : 'bloqueado'} · selecionados ${runtimeSelectorPlan.summary.selectedProfileCount}/${runtimeSelectorPlan.summary.profileCount} · ação ${renderByokTokenLabel(decision.action)} · ok ${decision.ok ? 'sim' : 'não'}`,
            { role: decision.ok ? 'success' : 'warn', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Política',
            `troca viva ${yesNo(args.allowLiveSetModel)} · nova sessão ${yesNo(args.allowNewSession)} · local privado ${yesNo(args.allowLocalPrivate)}`,
            { role: 'warn', columns: 112 },
        ),
    );
    println(terminalThemeRow('Rota', decision.selectedRouteKey ?? '-', { role: 'warn' }));
    if (decision.fallbackFromSelectedRouteKey || decision.fallbackReason) {
        println(
            terminalThemeWrappedRow(
                'Alternativa',
                `origem ${decision.fallbackFromSelectedRouteKey ?? '-'} · motivo ${renderByokTokenLabel(decision.fallbackReason)}`,
                { role: 'warn', columns: 112 },
            ),
        );
    }
    println(
        terminalThemeRow('Alvo', `${decision.targetBoundary.preset ?? '-'} · ${decision.targetBoundary.model ?? '-'}`, {
            role: 'warn',
        }),
    );
    println(terminalThemeRow('Sessão viva', inventory.currentSessionId ?? '(sem sessão viva)', { role: 'warn' }));
    println(
        terminalThemeRow(
            'Atual',
            `${decision.currentBoundary.preset ?? '-'} · ${decision.currentBoundary.model ?? '-'}`,
            { role: 'warn' },
        ),
    );
    println(terminalThemeRow('Troca viva', yesNo(decision.canApplyLiveModel), { role: 'warn' }));
    println(terminalThemeRow('Nova sessão', yesNo(decision.requiresNewSession), { role: 'warn' }));
    if (decision.blockerClass && decision.blockerClass !== 'none') {
        println(terminalThemeRow('Classe', renderByokTokenLabel(decision.blockerClass), { role: 'warn' }));
    }
    if (decision.nonActionReason)
        println(terminalThemeRow('Sem ação', renderByokTokenLabel(decision.nonActionReason), { role: 'warn' }));
    if (decision.cooldown?.active === true) {
        println(
            terminalThemeWrappedRow(
                'Cooldown',
                `${renderByokTokenLabel(decision.cooldown.reason)} · reset ${decision.cooldown.resetAt ?? '-'} · nova tentativa ${decision.cooldown.retryAfterSeconds ?? '-'}s`,
                { role: 'warn', columns: 112 },
            ),
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
            terminalThemeWrappedRow(
                'Alternativas',
                `usáveis ${alternativeSummary.usableCount}/${alternativeSummary.evaluatedCount} · provedores ${alternativeSummary.providerCount}${topReasons ? ` · ${topReasons}` : ''}`,
                { role: 'warn', columns: 112 },
            ),
        );
        const topBlocked = Array.isArray(alternativeSummary.topBlockedRoutes)
            ? alternativeSummary.topBlockedRoutes.slice(0, 3)
            : [];
        for (const blocked of topBlocked) {
            const providerId = optionalScalarString(blocked?.providerId) ?? '-';
            const providerModel = optionalScalarString(blocked?.providerModel) ?? '-';
            const reasons = Array.isArray(blocked?.reasons)
                ? blocked.reasons
                      .map(optionalScalarString)
                      .filter((item) => item !== null)
                      .slice(0, 3)
                      .join('+')
                : '-';
            println(
                terminalThemeWrappedRow(
                    'Bloqueada',
                    `${providerId}:${providerModel} · ${renderByokTokenList((reasons || '-').split('+'))}`,
                    {
                        role: 'muted',
                        columns: 112,
                    },
                ),
            );
        }
        for (const proof of buildModelGatewayRuntimeProofCommands(alternativeSummary)) {
            println(terminalThemeWrappedRow('Provar', proof.command, { role: 'command', columns: 112 }));
        }
    }
    if (decision.blockers.length > 0)
        println(
            terminalThemeWrappedRow('Bloqueios', renderByokTokenList(decision.blockers), {
                role: 'warn',
                columns: 112,
            }),
        );
    if (persistence) {
        println(
            terminalThemeRow(
                'Persistência',
                `${countLabel(persistence.automationDecisions, 'decisão gravada', 'decisões gravadas')}`,
                { role: 'success' },
            ),
        );
    }
    if (controllerStep.effects.length > 0) {
        println(
            terminalThemeWrappedRow(
                'Efeitos',
                `${controllerStep.effects
                    .map((effect) => {
                        const kind = renderByokTokenLabel(optionalScalarString(effect['kind']));
                        const mode =
                            effect['execute'] === true
                                ? 'executar'
                                : renderByokTokenLabel(optionalScalarString(effect['authorization']) ?? 'simular');
                        const blockedReason = optionalScalarString(effect['blockedReason']);
                        return `${kind} · ${mode}${blockedReason ? ` · bloqueio ${renderByokTokenLabel(blockedReason)}` : ''}`;
                    })
                    .join(', ')}`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    println(terminalThemeWrappedRow('Resumo', decision.operatorSummary, { role: 'muted', columns: 112 }));
    println(terminalThemeWrappedRow('Próximo', decision.nextCommands.join(' && '), { role: 'command', columns: 112 }));
    println('');
    if (options.apply === true) {
        const application = await applyByokGatewayAutoEffects(println, controllerStep);
        const effectPersistence = await persistTerminalByokGatewayAutoEffectApplications(status, application, {
            source: 'terminal-byok-auto-apply',
        });
        if (effectPersistence) {
            println(
                terminalThemeWrappedRow(
                    'Trilha auto',
                    `${countLabel(effectPersistence.automationEffectApplications, 'efeito gravado', 'efeitos gravados')} · ${countLabel(effectPersistence.sdkSessionHandoffs, 'handoff gravado', 'handoffs gravados')} no SQLite`,
                    { role: 'muted', columns: 112 },
                ),
            );
            println('');
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
    const evaluated = status.runtimeSelectorPlan.routes.reduce(
        (sum, route) => sum + route.alternativeSummary.evaluatedCount,
        0,
    );
    const usable = status.runtimeSelectorPlan.routes.reduce(
        (sum, route) => sum + route.alternativeSummary.usableCount,
        0,
    );
    println('');
    println(terminalThemeHeadline('accent', 'Plano de provas BYOK', ['automação']));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `perfil ${status.args.profileId} · seletor de execução ${status.runtimeSelectorPlan.ok ? 'ok' : 'bloqueado'} · comandos ${rows.length} · alternativas ${usable}/${evaluated} · sem chamada a provedor`,
            { role: status.runtimeSelectorPlan.ok ? 'success' : 'warn', columns: 112 },
        ),
    );
    if (visibleRows.length === 0) {
        println(
            terminalThemeWrappedRow(
                'Estado',
                'nenhum comando de prova foi derivado das alternativas bloqueadas atuais',
                { role: 'muted', columns: 112 },
            ),
        );
        println('');
        return;
    }
    for (const [index, row] of visibleRows.entries()) {
        println(
            terminalThemeWrappedRow(`${index + 1}. Provar`, row.command, {
                role: 'command',
                columns: 112,
            }),
        );
        println(
            terminalThemeWrappedRow(
                'Contexto',
                `perfil ${row.profileId} · rota ${row.providerId}:${row.providerModel} · motivos ${renderByokTokenList(row.reasons.slice(0, 3)) || '-'}`,
                { role: row.status === 'selected' ? 'success' : 'muted', columns: 112 },
            ),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Garantia',
            'cada comando roda sessão SDK descartável e alimenta a saúde runtime usada pelo seletor; nada é aplicado automaticamente aqui',
            { role: 'muted', columns: 112 },
        ),
    );
    println('');
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
            rest.map((item) => item.match(/^profile[:=](.+)$/iu)?.[1]?.trim()).find((value) => value) ?? 'repo_agent';
        const plans = await new SqliteModelGatewayCatalogStore().readStandbyPlanRecords({ limit, profileId: profile });
        const latest = plans[0] ?? null;
        const latestSummary = asRecord(latest?.['summary']);
        const latestRoutes = Array.isArray(latest?.['routes']) ? latest['routes'] : [];
        println('');
        println(terminalThemeHeadline('accent', 'BYOK prontidão automática persistida'));
        println(
            terminalThemeWrappedRow(
                'Resumo',
                `perfil ${profile} · planos ${plans.length} · rotas mais recentes ${latestSummary['routeCount'] ?? latestRoutes.length} · sem chamada a provedor`,
                { role: 'muted', columns: 112 },
            ),
        );
        if (plans.length === 0) {
            println(
                terminalThemeWrappedRow(
                    'Estado',
                    `nenhum standby persistido; grave com npm run model-gateway:auto:standby -- --profile=${profile} --limit=${limit} --write-sqlite`,
                    { role: 'muted', columns: 112 },
                ),
            );
            println('');
            return;
        }
        for (const [index, plan] of plans.entries()) {
            const summary = asRecord(plan['summary']);
            const routes = Array.isArray(plan['routes']) ? plan['routes'] : [];
            println(
                terminalThemeWrappedRow(
                    `${index + 1}. Plano`,
                    `${plan['standbyPlanId'] ?? '-'} · estado ${renderByokTokenLabel(optionalScalarString(plan['status']))} · rotas ${summary['routeCount'] ?? routes.length} · provedores ${summary['providerCount'] ?? 0} · gerado ${plan['generatedAt'] ?? plan['generatedAtMs'] ?? '-'}`,
                    { role: 'muted', columns: 112 },
                ),
            );
        }
        println('');
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
    println('');
    println(terminalThemeHeadline('accent', 'BYOK prontidão automática'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `perfil ${status.args.profileId} · seletor de execução ${status.runtimeSelectorPlan.ok ? 'ok' : 'bloqueado'} · rotas ${rows.length} · provas ${proofCount} · provedores ${providerCount} · sem chamada a provedor`,
            { role: status.runtimeSelectorPlan.ok ? 'success' : 'warn', columns: 112 },
        ),
    );
    if (visibleRows.length === 0) {
        println(
            terminalThemeWrappedRow('Estado', 'nenhuma rota de prontidão foi derivada do seletor atual', {
                role: 'muted',
                columns: 112,
            }),
        );
        println('');
        return;
    }
    for (const [index, row] of visibleRows.entries()) {
        println(
            terminalThemeWrappedRow(
                `${index + 1}. Rota`,
                `${row.providerId}:${row.providerModel} · ${renderByokSourceLabel(row.source)} · classe ${renderByokTokenLabel(row.standbyClass)} · precisa sonda ${yesNo(row.needsProbe)} · perfil ${row.profileId} · prova ${yesNo(row.hasRuntimeProof)} · env ${renderByokTokenLabel(row.runtimeEnvStatus)} · pontuação ${row.score ?? '-'}`,
                { role: row.needsProbe ? 'warn' : 'success', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow('Recomendado', row.recommendedCommand ?? '-', { role: 'command', columns: 112 }),
        );
        println(terminalThemeWrappedRow('Provar', row.commands.probeAgent ?? '-', { role: 'command', columns: 112 }));
        println(
            terminalThemeWrappedRow('Mesmo provedor', row.commands.liveModel ?? '-', { role: 'command', columns: 112 }),
        );
        println(
            terminalThemeWrappedRow('Troca de rota', row.commands.provider ?? '-', {
                role: 'command',
                columns: 112,
            }),
        );
        println(
            terminalThemeWrappedRow('Persistir', row.commands.persistProvider ?? '-', {
                role: 'command',
                columns: 112,
            }),
        );
    }
    println(
        terminalThemeWrappedRow(
            'Garantia',
            'standby não aplica efeitos; ele mostra substitutos prontos e comandos explícitos para o operador escolher',
            { role: 'muted', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {string[]} rest
 * @returns {string}
 */
function resolveByokGatewayAutoOnPresetId(rest) {
    const presetToken = rest.find((item) =>
        /^(?:preset|policyPreset|policy-preset|autoPreset|auto-preset)[:=]/iu.test(item),
    );
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
    const autoOnRest = rest.some((item) =>
        /^(?:preset|policyPreset|policy-preset|autoPreset|auto-preset)[:=]/iu.test(item),
    )
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
        println('');
        println(terminalThemeHeadline('tool', 'BYOK automação ativada'));
        println(terminalThemeRow('Preset', args.presetId, { role: 'warn' }));
        println(
            terminalThemeWrappedRow('Validação', renderByokTokenList(policyValidation.issues), {
                role: 'error',
                columns: 112,
            }),
        );
        println(
            terminalThemeWrappedRow('Presets', policyValidation.allowedPresets.join(', '), {
                role: 'muted',
                columns: 112,
            }),
        );
        println('');
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK automação ativada'));
    println(
        terminalThemeWrappedRow(
            'Estado',
            'política segura persistida para o próximo boot; segredos não são gravados nesse arquivo',
            { role: 'success', columns: 112 },
        ),
    );
    println(terminalThemeRow('Arquivo', written.filePath, { role: 'command' }));
    println(terminalThemeRow('Perfil', args.profileId, { role: 'command' }));
    println(terminalThemeRow('Preset', written.policy.preset, { role: 'warn' }));
    println(terminalThemeRow('Política', written.policy.policy, { role: 'warn' }));
    println(
        terminalThemeWrappedRow(
            'Flags',
            `troca viva ${yesNo(args.allowLiveSetModel)} · nova sessão ${yesNo(args.allowNewSession)} · local privado ${yesNo(args.allowLocalPrivate)}`,
            { role: 'warn', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Preview',
            `ação ${renderByokTokenLabel(decision.action)} · rota ${decision.selectedRouteKey ?? '-'} · ok ${yesNo(decision.ok)}`,
            { role: decision.ok ? 'success' : 'warn', columns: 112 },
        ),
    );
    println(terminalThemeWrappedRow('Resumo', decision.operatorSummary, { role: 'muted', columns: 112 }));
    for (const line of exports) {
        println(terminalThemeWrappedRow('Ambiente', `export ${line}`, { role: 'command', columns: 112 }));
    }
    println(
        terminalThemeWrappedRow(
            'Próximo',
            'reinicie o terminal ou exporte as variáveis antes de iniciar a próxima sessão',
            { role: 'command', columns: 112 },
        ),
    );
    println('');
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
    println('');
    println(terminalThemeHeadline('accent', 'BYOK histórico da automação'));
    if (rows.length === 0) {
        println(
            terminalThemeWrappedRow(
                'Estado',
                'nenhuma decisão auto persistida ainda; use /byok auto record profile:<id> para gravar uma trilha',
                { role: 'muted', columns: 112 },
            ),
        );
        println('');
        return;
    }
    rows.slice(0, limit).forEach((row, index) => {
        const decidedAt = optionalScalarString(row['timestamp']) ?? optionalScalarString(row['generatedAt']) ?? '-';
        const action = optionalScalarString(row['action']) ?? '-';
        const route = optionalScalarString(row['selectedRouteKey']) ?? '-';
        const profile = optionalScalarString(row['routeProfile']) ?? '-';
        const ok =
            row['ok'] === true ? 'ok' : row['ok'] === false ? 'blocked' : (optionalScalarString(row['status']) ?? '-');
        println(
            terminalThemeWrappedRow(
                `${index + 1}. Decisão`,
                `${renderByokTokenLabel(action)} · rota ${route} · perfil ${profile} · estado ${renderByokTokenLabel(ok)} · decidido ${decidedAt}`,
                { role: ok === 'ok' ? 'success' : 'warn', columns: 112 },
            ),
        );
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
    println('');
    println(terminalThemeHeadline('accent', 'Handoffs BYOK', ['automação']));
    if (rows.length === 0) {
        println(terminalThemeRow('Estado', 'nenhum handoff SDK persistido ainda', { role: 'muted' }));
        println('');
        return;
    }
    rows.slice(0, limit).forEach((row, index) => {
        const status = optionalScalarString(row['status']) ?? '-';
        const model = optionalScalarString(row['targetModel']) ?? optionalScalarString(row['model']) ?? '-';
        const route = optionalScalarString(row['selectedRouteKey']) ?? '-';
        const sessionId = optionalScalarString(row['sessionId']) ?? '-';
        const operation =
            row['operation'] && typeof row['operation'] === 'object'
                ? /** @type {Record<string, unknown>} */ (row['operation'])
                : {};
        const targetRoute =
            operation['targetRoute'] && typeof operation['targetRoute'] === 'object'
                ? /** @type {Record<string, unknown>} */ (operation['targetRoute'])
                : {};
        const providerId =
            optionalScalarString(targetRoute['providerId']) ?? optionalScalarString(row['providerId']) ?? '-';
        const providerModel =
            optionalScalarString(targetRoute['providerModel']) ?? optionalScalarString(row['providerModel']) ?? '-';
        const authorization =
            operation['promotionAuthorization'] && typeof operation['promotionAuthorization'] === 'object'
                ? /** @type {Record<string, unknown>} */ (operation['promotionAuthorization'])
                : {};
        const authorizationLabel =
            authorization['authorized'] === true || row['promotionAuthorized'] === true
                ? 'autorizada'
                : authorization['authorized'] === false || row['promotionAuthorized'] === false
                  ? 'não autorizada'
                  : 'não informada';
        const expiresAt =
            optionalScalarString(authorization['expiresAt']) ?? optionalScalarString(row['expiresAt']) ?? '-';
        const requestedAt = optionalScalarString(row['requestedAt']) ?? optionalScalarString(row['timestamp']) ?? '-';
        println(
            terminalThemeWrappedRow(
                `${index + 1}. Handoff`,
                `${renderByokTokenLabel(status)} · modelo ${model} · rota ${route} · sessão ${sessionId} · provider ${providerId}:${providerModel} · promoção ${authorizationLabel} · expira ${expiresAt} · solicitado ${requestedAt}`,
                { role: status === 'completed' || status === 'confirmed' ? 'success' : 'muted', columns: 112 },
            ),
        );
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
    println('');
    println(terminalThemeHeadline('accent', 'Confirmações BYOK', ['automação']));
    if (rows.length === 0) {
        println(terminalThemeRow('Estado', 'nenhuma confirmação SDK persistida ainda', { role: 'muted' }));
        println('');
        return;
    }
    rows.slice(0, limit).forEach((row, index) => {
        const status = optionalScalarString(row['status']) ?? '-';
        const previousModel = optionalScalarString(row['previousModel']) ?? '-';
        const confirmedModel =
            optionalScalarString(row['confirmedModel']) ?? optionalScalarString(row['newModel']) ?? '-';
        const observedAt = optionalScalarString(row['observedAt']) ?? optionalScalarString(row['timestamp']) ?? '-';
        println(
            terminalThemeWrappedRow(
                `${index + 1}. Confirmação`,
                `${renderByokTokenLabel(status)} · ${previousModel} -> ${confirmedModel} · observado ${observedAt}`,
                { role: status === 'confirmed' ? 'success' : 'muted', columns: 112 },
            ),
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
    println('');
    println(terminalThemeHeadline('accent', 'Recuperações BYOK', ['automação']));
    if (rows.length === 0) {
        println(terminalThemeRow('Estado', 'nenhuma recuperação pós-falha persistida ainda', { role: 'muted' }));
        println('');
        return;
    }
    rows.slice(0, limit).forEach((row, index) => {
        const status = optionalScalarString(row['status']) ?? '-';
        const scope = optionalScalarString(row['recoveryScope']) ?? '-';
        const failureKind = optionalScalarString(row['failureKind']) ?? '-';
        const route = optionalScalarString(row['selectedRouteKey']) ?? '-';
        const observedAt = optionalScalarString(row['observedAt']) ?? optionalScalarString(row['timestamp']) ?? '-';
        println(
            terminalThemeWrappedRow(
                `${index + 1}. Recuperação`,
                `${renderByokTokenLabel(status)} · escopo ${renderByokTokenLabel(scope)} · falha ${renderByokTokenLabel(failureKind)} · rota ${route} · observado ${observedAt}`,
                { role: status === 'applied' ? 'success' : 'muted', columns: 112 },
            ),
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
                !/^(?:failure|kind|failureKind|failure-kind|provider|providerId|provider-id|model|providerModel|provider-model)[:=]/iu.test(
                    item,
                ),
        ),
    );
    const failureKindToken = rest.find((item) => /^(?:failure|kind|failureKind|failure-kind)[:=]/iu.test(item));
    const failureKind =
        optionalScalarString(failureKindToken?.replace(/^(?:failure|kind|failureKind|failure-kind)[:=]/iu, '')) ??
        'rate-limit';
    const providerToken = rest.find((item) => /^(?:provider|providerId|provider-id)[:=]/iu.test(item));
    const modelToken = rest.find((item) => /^(?:model|providerModel|provider-model)[:=]/iu.test(item));
    const providerId = optionalScalarString(providerToken?.replace(/^(?:provider|providerId|provider-id)[:=]/iu, ''));
    const providerModel = optionalScalarString(
        modelToken?.replace(/^(?:model|providerModel|provider-model)[:=]/iu, ''),
    );
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
    println('');
    println(terminalThemeHeadline('accent', 'Fixture de recuperação BYOK', ['automação']));
    println(
        terminalThemeRow(
            'Resumo',
            `perfil ${args.profileId} · falha ${renderByokTokenLabel(failureKind)} · executou ${result.ran ? 'sim' : 'não'} · sem chamada a provedor · saúde sintética ${writeRealHealth ? 'não' : 'sim'}`,
            { role: 'muted' },
        ),
    );
    if (result.ran !== true || !result.status) {
        println(
            terminalThemeWrappedRow('Estado', 'fixture não executou; verifique policy e snapshot ativo', {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }
    const applied = result.application?.applied ?? [];
    const skipped = result.application?.skipped ?? [];
    println(
        terminalThemeWrappedRow(
            'Decisão',
            `ação ${renderByokTokenLabel(result.status.decision.action)} · rota ${result.status.decision.selectedRouteKey ?? '-'}`,
            { role: result.status.decision.ok ? 'success' : 'warn', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Efeitos',
            `aplicados ${applied.length} · pulados ${skipped.length} · persistidos ${result.effectPersistence?.automationEffectApplications ?? 0}`,
            { role: applied.length > 0 ? 'success' : 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeRow('Recuperações', String(result.effectPersistence?.recoveryAttempts ?? 0), { role: 'muted' }),
    );
    const health = result.healthPersistence;
    if (health) {
        println(
            terminalThemeWrappedRow(
                'Saúde',
                `registrada ${yesNo(health.recorded)} · rota ${health.providerId ?? '-'}:${health.providerModel ?? '-'} · SQLite ${health.sqlite ? `${health.sqlite.healthObservations}/${health.sqlite.records}` : '-'}`,
                { role: health.recorded ? 'success' : 'warn', columns: 112 },
            ),
        );
    }
    const details = [...applied, ...skipped].map(describeTerminalByokGatewayAutoEffect).slice(0, 5);
    if (details.length > 0) {
        println(terminalThemeWrappedRow('Detalhe', details.join('; '), { role: 'muted', columns: 112 }));
    }
    println(
        terminalThemeWrappedRow('Próximo', 'use /byok auto recoveries 10 para ler o ledger persistido', {
            role: 'command',
            columns: 112,
        }),
    );
    println('');
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
    if (preset === 'auto_same_session_route') return 'auto: trocar rota na mesma sessão';
    if (preset === 'auto_prepare_new_session') return 'legado: trocar rota na mesma sessão';
    return preset || '-';
}

/**
 * @param {string | null | undefined} phase
 * @returns {string}
 */
function renderModelGatewayCommandPhaseLabel(phase) {
    const labels = /** @type {Record<string, string>} */ ({
        orientation: 'orientação',
        metadata: 'metadados',
        'pre-runtime': 'pré-runtime',
        selection: 'seleção',
        automation: 'automação',
        'runtime-probes': 'provas runtime',
        'live-readiness': 'pronto para live',
        validate: 'validação',
        prebuild: 'pré-build',
    });
    const normalized = String(phase ?? '').trim();
    return labels[normalized] ?? renderByokTokenLabel(normalized);
}

const TERMINAL_MODEL_GATEWAY_COMMAND_SUMMARIES = /** @type {Readonly<Record<string, string>>} */ (
    Object.freeze({
        'commands.text': 'Lista os comandos canônicos para operador humano e LLM.',
        'commands.json': 'Emite o inventário canônico como JSON estruturado.',
        'scripts.manifest': 'Mostra o manifesto dos runners e barrels do model-gateway.',
        'ops.status': 'Abre cockpit operacional read-only de banco, readiness, automação e comandos.',
        'operator.ready': 'Mostra readiness do operador com checks, rotas standby e próximos comandos seguros.',
        'lint.scoped': 'Roda ESLint no model-gateway, comando BYOK terminal e testes focados.',
        'typecheck.strict': 'Roda typecheck strict do escopo src/copilot.',
        'test.contracts': 'Roda a suíte unitária de contratos do model-gateway.',
        'test.terminal': 'Roda a suíte unitária do comando terminal BYOK.',
        'validate.prebuild': 'Roda validações canônicas escopadas antes do build do banco.',
        'refresh.incremental': 'Atualiza metadados incrementalmente com log JSONL vivo.',
        'refresh.provider': 'Atualiza apenas um provedor/família sem rebuild completo.',
        'refresh.preview': 'Simula refresh de provedor e grava log sem commitar snapshot.',
        'refresh.log': 'Resume o último log JSONL de refresh sem tocar no catálogo.',
        'refresh.log-sqlite': 'Espelha eventos operacionais de refresh no SQLite sem mutar metadados.',
        'refresh.plan': 'Planeja fontes selecionadas/puladas antes de buscar provedores.',
        'sqlite.diagnostics': 'Inspeciona tabelas SQLite e camadas operacionais sem buscar rede.',
        'runtime-health.mirror': 'Espelha saúde BYOK já observada para tabelas runtime no SQLite.',
        'sqlite.retention': 'Pré-visualiza retenção de quota, rate limit, gasto, rotas, refresh e saúde.',
        'sqlite.retention-apply': 'Aplica retenção operacional SQLite para histórico volátil.',
        'prebuild.all': 'Mostra inventário e roda validadores escopados de pré-build.',
        'prebuild.first-build': 'Roda pré-build e materializa o banco de metadados.',
        'metadata-build.plan': 'Planeja o build completo sem buscar provedores nem gravar stores.',
        'metadata-build.preview': 'Executa preview do build completo sem commitar JSON/SQLite.',
        'metadata-build.commit': 'Materializa catálogo, espelha SQLite e aplica retenção operacional.',
        'catalog.integrity': 'Audita duplicidades e identidades redigidas do catálogo persistido.',
        'redaction.audit': 'Audita JSON/SQLite contra vazamento de strings com aparência de segredo.',
        'selection.audit': 'Audita seleção metadata-first sem executar probes runtime.',
        'selection.audit.local-strict': 'Bloqueia remoto no perfil local/private estrito sem runtime.',
        'selection.effective': 'Avalia seleção efetiva usando overlays de conta e saúde já observada.',
        'selection.effective.supply-gate': 'Falha quando perfil local/private não tem oferta local suficiente.',
        'selection.effective.runtime-proof': 'Inspeciona seleção exigindo prova runtime já observada.',
        'selection.effective.trace': 'Persiste trace não-mutante de decisão para auditoria e handoff.',
        'selection.trace-diff': 'Compara os dois traces de seleção mais recentes.',
        'selection.trace-retention': 'Pré-visualiza retenção de traces de seleção sem apagar por padrão.',
        'runtime.selector': 'Monta plano final do seletor runtime sem chamar provider.',
        'automation.status': 'Calcula decisão pura de automação sem mutar terminal.',
        'automation.plan': 'Inspeciona a próxima ação automática por perfil de rota.',
        'automation.ready': 'Roda gate read-only antes de usar auto mode ao vivo.',
        'automation.doctor': 'Explica política auto, bloqueios, ledgers e próximos passos.',
        'automation.explain': 'Combina status e doctor em uma explicação read-only.',
        'automation.handoffs': 'Lê handoffs SDK persistidos pela automação.',
        'automation.confirmations': 'Lê confirmações de modelo correlacionadas à automação.',
        'automation.recoveries': 'Lê tentativas de recuperação pós-turno persistidas.',
        'automation.proof-plan': 'Cria fila read-only de comandos explícitos de prova runtime.',
        'automation.standby': 'Lista rotas standby com comandos seguros para o operador.',
        'automation.standby-write-sqlite': 'Persiste plano standby no SQLite sem chamar providers.',
        'automation.standby-read-sqlite': 'Lê planos standby persistidos sem recalcular selector.',
        'automation.scenarios': 'Monta roteiro canônico read-only para auto mode e live tests.',
        'runtime-health.diff': 'Snapshot/diff de saúde runtime já observada sem chamadas externas.',
        'runtime-health.clear': 'Limpa saúde operacional escopada após reset ou contaminação de fixture.',
        'live.readiness': 'Checa integridade, paridade SQLite e seleção antes de live tests.',
        'live.plan': 'Materializa plano de live test sem runtime adicional.',
        'live.plan.local-strict': 'Materializa plano live com pré-requisito local/private explícito.',
        'live.terminal.control-no-pr': 'Roda controle LLM-B sem abrir turno de modelo.',
        'live.terminal.byok-fixture': 'Roda controle BYOK contra fixture OpenAI-compatible local.',
        'live.terminal.auto-probe': 'Roda probe do cockpit auto sem turno de modelo nem providers.',
        'live.runs': 'Lê summaries de live persistidos no SQLite.',
    })
);

/**
 * @param {Record<string, unknown>} command
 * @param {string | undefined} fallbackSummary
 * @returns {string}
 */
function renderTerminalModelGatewayCommandSummary(command, fallbackSummary) {
    const id = optionalScalarString(command['id']);
    if (id && TERMINAL_MODEL_GATEWAY_COMMAND_SUMMARIES[id]) return TERMINAL_MODEL_GATEWAY_COMMAND_SUMMARIES[id];
    const summary = optionalScalarString(command['summary']) ?? fallbackSummary;
    return summary ?? 'comando operacional canônico do model-gateway';
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK política da automação'));
    println(terminalThemeRow('Arquivo', DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH, { role: 'command' }));
    println(
        terminalThemeRow('Arquivo cfg', fileConfigured ? 'sim' : 'não', { role: fileConfigured ? 'success' : 'muted' }),
    );
    println(terminalThemeRow('Env cfg', envConfigured ? 'sim' : 'não', { role: envConfigured ? 'warn' : 'muted' }));
    println(
        terminalThemeRow('Efetivo', enabledDisabled(effectivePolicy.enabled), {
            role: effectivePolicy.enabled ? 'success' : 'warn',
        }),
    );
    println(
        terminalThemeWrappedRow(
            'Política',
            `${renderByokAutoPresetLabel(effectivePolicy.preset)} · fonte ${renderByokTokenLabel(policySources['preset']?.source)}`,
            { role: 'warn', columns: 112 },
        ),
    );
    println(terminalThemeRow('Regra', renderByokTokenLabel(effectivePolicy.policy), { role: 'warn' }));
    println(terminalThemeRow('Perfis', effectivePolicy.profiles.join(', ') || '-', { role: 'command' }));
    println(
        terminalThemeWrappedRow(
            'Flags',
            `troca viva ${yesNo(effectivePolicy.allowLiveSetModel)} · nova sessão ${yesNo(effectivePolicy.allowNewSession)} · sondas de provedor ${yesNo(effectivePolicy.allowProviderProbes)} · local privado ${yesNo(effectivePolicy.allowLocalPrivate)}`,
            { role: 'warn', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Conta',
            `falhas globais ${renderByokTokenList(effectivePolicy.accountWideFailureKinds) || '-'}`,
            { role: 'warn', columns: 112 },
        ),
    );
    for (const preset of presets) {
        println(
            terminalThemeWrappedRow(
                'Preset',
                `${renderByokAutoPresetLabel(String(preset['preset']))} · código ${preset['preset']} · regra ${renderByokTokenLabel(optionalScalarString(preset['policy']))} · troca viva ${yesNo(preset['allowLiveSetModel'] === true)} · nova sessão ${yesNo(preset['allowNewSession'] === true)} · local privado ${yesNo(preset['allowLocalPrivate'] === true)}`,
                { role: 'muted', columns: 112 },
            ),
        );
    }
    if (envConfigured && envPolicy.enabled !== effectivePolicy.enabled) {
        println(
            terminalThemeWrappedRow(
                'Observação',
                'env explícito pode sobrescrever o arquivo persistente no próximo boot',
                { role: 'warn', columns: 112 },
            ),
        );
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK diagnóstico da automação'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `perfil ${status.args.profileId} · snapshot ativo ${activeSnapshot ? 'sim' : 'não'} · comandos ${commandCount} · avisos ${warnings.length}`,
            { role: warnings.length === 0 ? 'success' : 'warn', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Política',
            `ativa ${yesNo(effectivePolicy.enabled)} · arquivo ${yesNo(fileConfigured)} · modelo vivo ${yesNo(effectivePolicy.allowLiveSetModel)} · nova sessão ${yesNo(effectivePolicy.allowNewSession)}`,
            { role: effectivePolicy.enabled ? 'success' : 'warn', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Origem',
            `ativa ${policySources['enabled']?.source ?? '-'} · perfis ${policySources['profiles']?.source ?? '-'} · modelo vivo ${policySources['allowLiveSetModel']?.source ?? '-'} · nova sessão ${policySources['allowNewSession']?.source ?? '-'}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Decisão',
            `ok ${yesNo(decision.ok)} · ação ${renderByokTokenLabel(decision.action)} · rota ${decision.selectedRouteKey ?? '-'}`,
            { role: decision.ok ? 'success' : 'warn', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'Alvo',
            `${decision.targetBoundary.preset ?? '-'} · ${decision.targetBoundary.model ?? '-'}`,
            { role: 'warn', columns: 112 },
        ),
    );
    if (decision.cooldown?.active === true) {
        println(
            terminalThemeWrappedRow(
                'Cooldown',
                `${renderByokTokenLabel(decision.cooldown.reason)} · reset ${decision.cooldown.resetAt ?? '-'} · nova tentativa ${decision.cooldown.retryAfterSeconds ?? '-'}s`,
                { role: 'warn', columns: 112 },
            ),
        );
    }
    if (alternativeSummary) {
        const rejectionCounts = asRecord(alternativeSummary.rejectionReasonCounts);
        const topReasons = Object.entries(rejectionCounts)
            .sort((left, right) => Number(right[1] ?? 0) - Number(left[1] ?? 0))
            .slice(0, 4)
            .map(([reason, count]) => `${renderByokTokenLabel(reason)} ${count}`)
            .join(', ');
        println(
            terminalThemeWrappedRow(
                'Alternativas',
                `usáveis ${alternativeSummary.usableCount}/${alternativeSummary.evaluatedCount} · provedores ${alternativeSummary.providerCount}${topReasons ? ` · ${topReasons}` : ''}`,
                { role: 'warn', columns: 112 },
            ),
        );
        for (const proof of buildModelGatewayRuntimeProofCommands(alternativeSummary)) {
            println(terminalThemeWrappedRow('Provar', proof.command, { role: 'command', columns: 112 }));
        }
    }
    println(
        terminalThemeWrappedRow(
            'Registros',
            `decisões ${diagnostics.automationDecisionRows ?? 0} · políticas ${diagnostics.automationPolicySnapshotRows ?? 0} · efeitos ${effectsRows} · recuperações ${recoveryRows} · handoffs ${handoffRows} · confirmações ${confirmationRows} · testes vivos ${liveScenarioRunRows}`,
            { role: 'muted', columns: 112 },
        ),
    );
    println(
        terminalThemeWrappedRow(
            'SDK',
            `sessão ${status.inventory.currentSessionId ?? '-'} · sessão viva ${decision.currentBoundary.preset ?? '-'} · ${decision.currentBoundary.model ?? '-'}`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (decision.blockers.length > 0) {
        println(
            terminalThemeWrappedRow('Bloqueios', renderByokTokenList(decision.blockers), {
                role: 'warn',
                columns: 112,
            }),
        );
    }
    if (warnings.length > 0) {
        println(terminalThemeWrappedRow('Avisos', renderByokTokenList(warnings), { role: 'warn', columns: 112 }));
    }
    println(terminalThemeWrappedRow('Operador', decision.operatorSummary, { role: 'muted', columns: 112 }));
    println(
        terminalThemeWrappedRow(
            'Próximo',
            warnings.includes('policy_disabled')
                ? `/byok auto on profile:${status.args.profileId}`
                : decision.nextCommands.join(' && '),
            { role: 'command', columns: 112 },
        ),
    );
    println('');
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK automação desativada'));
    println(
        terminalThemeWrappedRow(
            'Estado',
            'policy persistente atualizada para desativado; segredos e catálogo não foram alterados',
            { role: 'success', columns: 112 },
        ),
    );
    println(terminalThemeRow('Arquivo', written.filePath, { role: 'command' }));
    println(
        terminalThemeWrappedRow(
            'Ambiente',
            'se COPILOT_BYOK_GATEWAY_AUTO=true continuar no ambiente, ele ainda sobrescreve o arquivo no próximo boot',
            { role: 'warn', columns: 112 },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {{ effects: Record<string, unknown>[] }} controllerStep
 * @returns {ReturnType<typeof applyTerminalByokGatewayAutoEffects>}
 */
async function applyByokGatewayAutoEffects(println, controllerStep) {
    const application = await applyTerminalByokGatewayAutoEffects(controllerStep);
    if (application.applied.length === 0 && application.skipped.length === 0) {
        println(
            terminalThemeRow(
                'Aplicação',
                'nenhum efeito terminal derivado para aplicar; revise bloqueios e próxima ação acima',
                { role: 'warn' },
            ),
        );
        println('');
        return application;
    }
    if (application.applied.length === 0 && application.skipped.length > 0) {
        const reasons = application.skipped
            .map((effect) => describeTerminalByokGatewayAutoEffect(effect))
            .slice(0, 4)
            .join('; ');
        println(
            terminalThemeRow(
                'Aplicação',
                `nenhum efeito aplicado · ${reasons || 'revise bloqueios e próxima ação acima'}`,
                { role: 'warn' },
            ),
        );
        println(
            terminalThemeRow('Próximo', 'use /byok auto status para revisar bloqueios, política e seleção atual', {
                role: 'muted',
            }),
        );
        println('');
        return application;
    }
    for (const effect of application.applied) {
        const description = describeTerminalByokGatewayAutoEffect(effect);
        println(terminalThemeRow('Aplicação', description, { role: 'success' }));
        if (effect['kind'] === 'set_live_model') {
            println(
                terminalThemeRow(
                    'Confirmação',
                    'aguarde confirmação do SDK ou próximo uso observado para confirmar o modelo efetivo',
                    { role: 'muted' },
                ),
            );
        }
    }
    for (const effect of application.skipped) {
        if (effect['skippedReason'] === 'effect_not_authorized') continue;
        println(terminalThemeRow('Aplicação', describeTerminalByokGatewayAutoEffect(effect), { role: 'warn' }));
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK busca no catálogo'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · busca ${args.query || '-'} · provider ${args.providerId ?? '-'} · só elegíveis ${yesNo(args.onlyEligible)} · exige tools ${yesNo(args.requireTools)} · resultados ${results.length}`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (results.length === 0) {
        println(
            terminalThemeWrappedRow('Resultado', 'nenhum modelo encontrado para os filtros informados', {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }
    for (const result of results) {
        println(
            terminalThemeWrappedRow(
                'Modelo',
                `${result.key} · score ${result.score} · elegibilidade ${renderByokTokenLabel(result.eligibilityStatus)}`,
                { role: 'warn', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Detalhe',
                `${result.displayName} · rotas ${result.routeOptionCount} · overlays ${result.accountOverlayCount} · campos encontrados ${result.matchedFields.slice(0, 4).join(',') || '-'}`,
                { role: 'muted', columns: 112 },
            ),
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
    println('');
    println(terminalThemeHeadline('accent', 'BYOK rotas do gateway'));
    println(
        terminalThemeRow(
            'Catálogo',
            `${formatTerminalToolPathForOperator(store.filePath)} · filtro ${args.selector ?? '-'} · rotas ${routes.length}/${snapshot.routeOptions.length}`,
            { role: 'muted' },
        ),
    );
    if (routes.length === 0) {
        println(terminalThemeRow('Resultado', 'nenhuma rota encontrada para o filtro informado.', { role: 'warn' }));
        println('');
        return;
    }
    const displayLimit = args.hasExplicitLimit ? args.limit : Math.min(args.limit, 12);
    for (const route of routes.slice(0, displayLimit)) {
        const policy = asRecord(route['normalizedPolicy']);
        const providerId = optionalScalarString(route['providerId']) ?? '-';
        const providerModel = optionalScalarString(route['providerModel']) ?? '-';
        const selectorKind = renderByokTokenLabel(optionalScalarString(route['selectorKind']));
        const selectorSyntax = optionalScalarString(route['selectorSyntax']) ?? '-';
        const wireApi = renderByokWireLabel(optionalScalarString(policy['wireApi']));
        const wireLabel = wireApi === '-' ? 'padrão' : wireApi;
        println(
            terminalThemeRow('Rota', `${providerId}:${providerModel}`, {
                role: 'accent',
            }),
        );
        println(
            terminalThemeRow(
                'Seleção',
                `perfil ${renderByokTokenLabel(optionalScalarString(route['routeProfile']) ?? 'default')} · seletor ${selectorKind} · sintaxe ${selectorSyntax}`,
                { role: 'muted' },
            ),
        );
        println(
            terminalThemeRow(
                'Política',
                `camada ${renderByokTokenLabel(optionalScalarString(policy['routeLayer']))} · protocolo ${wireLabel} · fonte ${renderByokSourceIdLabel(optionalScalarString(route['sourceId']))} · confiança ${renderByokTokenLabel(optionalScalarString(route['confidence']))}`,
                { role: 'muted' },
            ),
        );
    }
    if (routes.length > displayLimit) {
        println(
            terminalThemeRow('Mais', `exibindo ${displayLimit}/${routes.length}; use filtro ou limite numérico.`, {
                role: 'muted',
            }),
        );
    }
    println(
        terminalThemeRow('Nota', 'rotas são metadados de seleção; esta tela não executa modelo.', { role: 'muted' }),
    );
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
    println('');
    println(terminalThemeHeadline('accent', 'BYOK overlays de conta'));
    println(
        terminalThemeRow(
            'Catálogo',
            `${formatTerminalToolPathForOperator(store.filePath)} · filtro ${args.selector ?? '-'} · overlays ${overlays.length}/${snapshot.accountOverlays.length} · segredos protegidos sim`,
            { role: 'muted' },
        ),
    );
    if (overlays.length === 0) {
        println(
            terminalThemeRow('Resultado', 'nenhum overlay de conta encontrado para o filtro informado.', {
                role: 'warn',
            }),
        );
        println('');
        return;
    }
    for (const overlay of overlays.slice(0, args.limit)) {
        const enabled = Array.isArray(overlay['enabledModels']) ? overlay['enabledModels'].length : 0;
        const blocked = Array.isArray(overlay['blockedModels']) ? overlay['blockedModels'].length : 0;
        const providerId = optionalScalarString(overlay['providerId']) ?? '-';
        println(
            terminalThemeRow('Provedor', providerId, {
                role: blocked > 0 ? 'warn' : 'accent',
            }),
        );
        println(
            terminalThemeRow(
                'Conta',
                `escopo ${renderByokTokenLabel(optionalScalarString(overlay['accountScope']) ?? 'default')} · segredo ${optionalScalarString(overlay['secretRef']) ?? '-'}`,
                { role: 'muted' },
            ),
        );
        println(
            terminalThemeRow(
                'Fonte',
                `${renderByokSourceIdLabel(optionalScalarString(overlay['sourceId']))} · confiança ${renderByokTokenLabel(optionalScalarString(overlay['confidence']))}`,
                { role: 'muted' },
            ),
        );
        println(
            terminalThemeRow(
                'Modelos',
                `habilitados ${enabled} · bloqueados ${blocked} · redigido ${renderByokTokenLabel(optionalScalarString(overlay['redactionStatus']))}`,
                { role: blocked > 0 ? 'warn' : 'muted' },
            ),
        );
    }
    if (overlays.length > args.limit) {
        println(
            terminalThemeRow('Mais', `exibindo ${args.limit}/${overlays.length}; use filtro ou limite numérico.`, {
                role: 'muted',
            }),
        );
    }
    println(
        terminalThemeRow(
            'Nota',
            'overlays complementam o catálogo; a tela não executa modelo nem revela valores de segredo.',
            { role: 'muted' },
        ),
    );
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
    const accountSummary = summarizeModelGatewayAccountOverlays([...catalogOverlays, ...runtimeOverlays], {
        selector: args.selector,
    });
    println('');
    println(terminalThemeHeadline('accent', 'BYOK contas e chaves'));
    println(
        terminalThemeRow(
            'Catálogo',
            `${formatTerminalToolPathForOperator(store.filePath)} · filtro ${args.selector ?? '-'} · overlays ${accountSummary.summary.matched}/${accountSummary.summary.total} · sinais runtime ${runtimeOverlays.length} · provedores ${accountSummary.summary.providers}`,
            { role: 'muted' },
        ),
    );
    println(
        terminalThemeRow('Estados', renderGatewayCountMap(accountSummary.summary.statusCounts, renderByokTokenLabel), {
            role: 'muted',
        }),
    );
    if (accountSummary.rows.length === 0) {
        println(
            terminalThemeRow('Resultado', 'nenhuma conta/key overlay encontrada para o filtro informado.', {
                role: 'warn',
            }),
        );
        println('');
        return;
    }
    for (const row of accountSummary.rows.slice(0, args.limit)) {
        const retry = row.resetAt
            ? `reset ${row.resetAt}`
            : row.retryAfterSeconds
              ? `retentar em ${row.retryAfterSeconds}s`
              : 'reset -';
        const resetState =
            row.quotaResetExpired === true ? 'janela expirada' : row.quotaResetActive === true ? 'janela ativa' : null;
        const remaining = [
            row.remainingUsd !== null ? `USD restante ${row.remainingUsd}` : null,
            row.remainingCreditsUsd !== null ? `créditos USD ${row.remainingCreditsUsd}` : null,
            resetState,
        ]
            .filter(Boolean)
            .join(' · ');
        println(terminalThemeRow('Provedor', row.providerId, { role: row.limitStatus === 'ok' ? 'accent' : 'warn' }));
        println(
            terminalThemeRow(
                'Conta',
                `escopo ${renderByokTokenLabel(row.accountScope)} · segredo ${row.secretRef ?? '-'} · estado ${renderByokTokenLabel(row.limitStatus)} · ${retry}`,
                { role: row.limitStatus === 'ok' ? 'muted' : 'warn' },
            ),
        );
        println(
            terminalThemeRow(
                'Fonte',
                `${renderByokSourceIdLabel(row.sourceId)} · tipo ${renderByokTokenLabel(row.sourceKind)} · confiança ${renderByokTokenLabel(row.confidence)} · frescor ${renderByokTokenLabel(row.freshnessStatus)}`,
                { role: 'muted' },
            ),
        );
        println(
            terminalThemeRow(
                'Modelos',
                `habilitados ${row.enabledModelCount} · bloqueados ${row.blockedModelCount} · ${remaining || 'saldo -'}`,
                { role: 'muted' },
            ),
        );
    }
    if (accountSummary.rows.length > args.limit) {
        println(
            terminalThemeRow(
                'Mais',
                `exibindo ${args.limit}/${accountSummary.rows.length}; use filtro ou limite numérico.`,
                { role: 'muted' },
            ),
        );
    }
    println(
        terminalThemeRow(
            'Nota',
            'esta visão é da conta/key e não executa modelo; saúde runtime continua em /byok health.',
            { role: 'muted' },
        ),
    );
    println('');
}

/**
 * @param {Record<string, number>} counts
 * @param {(key: string) => string} [labeler]
 * @returns {string}
 */
function renderGatewayCountMap(counts, labeler = (key) => key) {
    return (
        Object.entries(counts)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, count]) => `${labeler(key)}:${count}`)
            .join(',') || '-'
    );
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
    const explanation = explainModelGatewayAccountLimitOverlays([...catalogOverlays, ...runtimeOverlays], {
        selector: args.selector,
    });
    println('');
    println(terminalThemeHeadline('accent', 'BYOK limites de conta'));
    println(
        terminalThemeRow(
            'Catálogo',
            `${formatTerminalToolPathForOperator(store.filePath)} · filtro ${args.selector ?? '-'} · overlays ${explanation.summary.matched}/${explanation.summary.total} · bloqueios ativos ${explanation.summary.activeBlockers} · sinais expirados ${explanation.summary.expiredSignals} · temporários ${explanation.summary.temporaryBlockers} · execução ${runtimeSummary.activeCount}/${runtimeSummary.total}`,
            { role: explanation.summary.activeBlockers > 0 ? 'warn' : 'muted' },
        ),
    );
    println(
        terminalThemeRow('Estados', renderGatewayCountMap(explanation.summary.byStatus, renderByokTokenLabel), {
            role: 'muted',
        }),
    );
    println(
        terminalThemeRow('Fontes', renderGatewayCountMap(explanation.summary.bySourceLayer, renderByokTokenLabel), {
            role: 'muted',
        }),
    );
    if (explanation.rows.length === 0) {
        println(
            terminalThemeRow('Resultado', 'nenhum limite account/key encontrado para o filtro informado.', {
                role: 'warn',
            }),
        );
        println('');
        return;
    }
    for (const row of explanation.rows.slice(0, args.limit)) {
        const state = row.activeBlocker ? 'ativo' : row.expiredSignal ? 'expirado' : 'livre';
        const reset = row.resetAt
            ? `reset ${row.resetAt}`
            : row.retryAfterSeconds
              ? `retentar em ${row.retryAfterSeconds}s`
              : 'reset -';
        const money = [
            row.remainingUsd !== null ? `USD restante ${row.remainingUsd}` : null,
            row.remainingCreditsUsd !== null ? `créditos USD ${row.remainingCreditsUsd}` : null,
        ]
            .filter(Boolean)
            .join(' · ');
        println(terminalThemeRow('Provedor', row.providerId, { role: row.activeBlocker ? 'warn' : 'accent' }));
        println(
            terminalThemeRow(
                'Limite',
                `escopo ${renderByokTokenLabel(row.accountScope)} · estado ${renderByokTokenLabel(row.limitStatus)} · sinal ${state} · frescor ${renderByokTokenLabel(row.freshnessStatus)} · janela ${renderByokTokenLabel(row.resetWindowClass)} · ${reset} · expira ${row.expiresAt ?? row.effectiveExpiresAt ?? '-'}`,
                { role: row.activeBlocker ? 'warn' : 'muted' },
            ),
        );
        println(
            terminalThemeRow(
                'Fonte',
                `${renderByokTokenLabel(row.sourceKind)} · fonte ${renderByokSourceIdLabel(row.sourceId)} · camada ${renderByokTokenLabel(row.sourceLayer)} · falha ${renderByokTokenLabel(row.failureKind)} · segredo ${row.secretRef ?? '-'} · próxima atualização ${row.nextRefreshAfter ?? '-'} · ${money || 'saldo -'}`,
                { role: 'muted' },
            ),
        );
        println(
            terminalThemeRow('Ação', renderByokTokenLabel(row.nextAction), {
                role: row.activeBlocker ? 'command' : 'muted',
            }),
        );
    }
    if (explanation.rows.length > args.limit) {
        println(
            terminalThemeRow(
                'Mais',
                `exibindo ${args.limit}/${explanation.rows.length}; use filtro ou limite numérico.`,
                { role: 'muted' },
            ),
        );
    }
    println(
        terminalThemeRow(
            'Nota',
            'limites provider/account podem bloquear pré-runtime; AssistantUsageQuotaSnapshot é quota SDK/Copilot e não substitui overlay BYOK externo.',
            { role: 'muted' },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} rest
 * @returns {void}
 */
function renderByokGatewayQuotaMatrix(println, rest) {
    const args = parseGatewayCatalogListArgs(rest);
    const matrix = summarizeModelGatewayProviderQuotaCapabilities({ selector: args.selector });
    println('');
    println(terminalThemeHeadline('accent', 'BYOK matriz de quotas dos provedores'));
    println(
        terminalThemeRow(
            'Resumo',
            `filtro ${args.selector ?? '-'} · provedores ${matrix.summary.providerCount}/${matrix.summary.total} · visibilidade de conta ${matrix.summary.accountVisibilityCount} · snapshots de quota ${matrix.summary.quotaSnapshotCount} · overlays runtime ${matrix.summary.runtimeFailureOverlayCount} · cobertura SDK/BYOK ${matrix.summary.sdkQuotaByokTruthCount}`,
            { role: 'muted' },
        ),
    );
    println(
        terminalThemeRow(
            'Tipos de quota',
            renderGatewayCountMap(matrix.summary.byQuotaSnapshot, renderByokTokenLabel),
            { role: 'muted' },
        ),
    );
    if (matrix.rows.length === 0) {
        println(terminalThemeRow('Resultado', 'nenhum provedor encontrado para o filtro informado.', { role: 'warn' }));
        println('');
        return;
    }
    for (const row of matrix.rows.slice(0, args.limit)) {
        println(
            terminalThemeRow(
                'Provedor',
                `${row.providerId} · visibilidade ${renderByokTokenLabel(row.accountVisibility)} · quota ${renderByokTokenLabel(row.quotaSnapshot)} · gasto ${renderByokTokenLabel(row.spendingLimit)} · limite de taxa ${renderByokTokenLabel(row.rateLimit)}`,
                { role: 'accent' },
            ),
        );
        println(
            terminalThemeRow(
                'Conta',
                `overlay runtime ${yesNo(row.runtimeFailureOverlay)} · quota SDK cobre BYOK ${yesNo(row.sdkQuotaAppliesToByok)} · env ${row.requiredEnv.join(',') || '-'}`,
                { role: 'muted' },
            ),
        );
        println(terminalThemeRow('Endpoints', row.endpoints.slice(0, 4).join(', ') || '-', { role: 'muted' }));
    }
    if (matrix.rows.length > args.limit) {
        println(
            terminalThemeRow('Mais', `exibindo ${args.limit}/${matrix.rows.length}; use filtro ou limite numérico.`, {
                role: 'muted',
            }),
        );
    }
    println(
        terminalThemeRow(
            'Nota',
            'a matriz descreve fontes pré-runtime possíveis; ela não prova acesso runtime nem altera catálogo.',
            { role: 'muted' },
        ),
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function renderByokGatewayCatalogConflicts(println) {
    const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
    println('');
    println(terminalThemeHeadline('tool', 'BYOK conflitos do catálogo'));
    println(
        terminalThemeWrappedRow('Resumo', `catálogo ${store.filePath} · fonte snapshot persistido · sem rede`, {
            role: 'muted',
            columns: 112,
        }),
    );
    const snapshot = await store.readSnapshot();
    if (snapshot.conflicts.length === 0) {
        println(
            terminalThemeWrappedRow('Resultado', 'nenhum conflito de evidência no snapshot atual', {
                role: 'success',
                columns: 112,
            }),
        );
        println('');
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
        println(
            terminalThemeWrappedRow(
                'Conflito',
                `${projectionKey} · campo ${fieldPath} · evidência selecionada ${selected} · conflitos ${conflicting}`,
                { role: 'warn', columns: 112 },
            ),
        );
    }
    if (snapshot.conflicts.length > 20) {
        println(
            terminalThemeWrappedRow(
                'Omitidos',
                `exibindo 20/${snapshot.conflicts.length}; refine depois com /models explain <provider:model>`,
                { role: 'muted', columns: 112 },
            ),
        );
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
    println('');
    println(terminalThemeHeadline('tool', 'BYOK frescor do catálogo'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · filtro ${args.selector ?? '-'} · fontes ${sources.length}/${snapshot.sources.length}`,
            { role: 'muted', columns: 112 },
        ),
    );
    if (sources.length === 0) {
        println(
            terminalThemeWrappedRow('Resultado', 'nenhuma source encontrada para o filtro informado', {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }
    for (const item of sources.slice(0, args.limit)) {
        const source = item.source;
        println(
            terminalThemeWrappedRow(
                'Fonte',
                `${optionalScalarString(source['id']) ?? '-'} · provedor ${optionalScalarString(source['providerId']) ?? '-'} · tipo ${renderByokTokenLabel(optionalScalarString(source['kind']))} · autenticação ${renderByokTokenLabel(optionalScalarString(source['authMode']))} · atualização ${renderByokTokenLabel(optionalScalarString(source['refreshPolicy']))} · atualizado ${item.at}`,
                { role: 'warn', columns: 112 },
            ),
        );
    }
    if (sources.length > args.limit)
        println(
            terminalThemeWrappedRow(
                'Omitidos',
                `exibindo ${args.limit}/${sources.length}; use filtro ou limite numérico`,
                { role: 'muted', columns: 112 },
            ),
        );
    println('');
}

/**
 * @param {Record<string, unknown>} projection
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

    println('');
    println(terminalThemeHeadline('tool', 'BYOK elegibilidade'));
    println(
        terminalThemeWrappedRow(
            'Resumo',
            `catálogo ${store.filePath} · filtro ${args.selector ?? '-'} · política ${args.strict ? renderByokTokenLabel('block_unknown') : renderByokTokenLabel('allow_probe_unknown')} · persistir ${yesNo(args.persist)} · total ${explained.length} · elegíveis ${eligibleCount} · desconhecidos ${unknownCount} · excluídos ${excludedCount}`,
            { role: excludedCount > 0 ? 'warn' : 'muted', columns: 112 },
        ),
    );
    if (snapshot.projections.length === 0) {
        println(
            terminalThemeWrappedRow(
                'Estado',
                'nenhum snapshot de catálogo encontrado; rode /byok gateway catalog refresh primeiro',
                { role: 'warn', columns: 112 },
            ),
        );
        println('');
        return;
    }
    if (explained.length === 0) {
        println(
            terminalThemeWrappedRow('Resultado', 'nenhum modelo encontrado para o filtro informado', {
                role: 'warn',
                columns: 112,
            }),
        );
        println('');
        return;
    }
    if (args.persist) {
        const run = asRecord(evaluated.run);
        println(
            terminalThemeWrappedRow(
                'Persistência',
                `elegibilidade persistida · run ${optionalScalarString(run['runId']) ?? '-'} · decisões ${evaluated.decisions.length}`,
                { role: 'success', columns: 112 },
            ),
        );
    }
    for (const item of explained.slice(0, args.limit)) {
        println(
            terminalThemeWrappedRow('Modelo', `${renderByokTokenLabel(item.status)} · ${item.key}`, {
                role: item.status === 'eligible' ? 'success' : item.status === 'unknown' ? 'warn' : 'error',
                columns: 112,
            }),
        );
        println(
            terminalThemeWrappedRow(
                'Decisão',
                `${renderByokTokenLabel(item.summary)} · disposição ${renderByokTokenLabel(item.disposition)}`,
                { role: 'muted', columns: 112 },
            ),
        );
        println(
            terminalThemeWrappedRow(
                'Ação',
                `dica ${renderByokTokenLabel(item.actionable?.operatorHint)} · dados necessários ${renderByokTokenList(item.actionable?.dataNeeded?.slice(0, 4).map(String) ?? []) || '-'} · probe seguro ${yesNo(item.actionable?.probeSafe === true)}`,
                { role: item.actionable?.probeSafe ? 'command' : 'muted', columns: 112 },
            ),
        );
        if (item.hardExclusions.length > 0)
            println(
                terminalThemeWrappedRow(
                    'Exclusões fortes',
                    renderByokTokenList(item.hardExclusions.slice(0, 4).map(String)),
                    { role: 'error', columns: 112 },
                ),
            );
        if (item.softPenalties.length > 0)
            println(
                terminalThemeWrappedRow(
                    'Penalidades leves',
                    renderByokTokenList(item.softPenalties.slice(0, 4).map(String)),
                    { role: 'warn', columns: 112 },
                ),
            );
        if (item.nextActions.length > 0)
            println(
                terminalThemeWrappedRow('Próximo', renderByokTokenList(item.nextActions.slice(0, 4).map(String)), {
                    role: 'command',
                    columns: 112,
                }),
            );
    }
    if (explained.length > args.limit) {
        println(
            terminalThemeWrappedRow(
                'Omitidos',
                `exibindo ${args.limit}/${explained.length}; use filtro ou limite numérico para reduzir`,
                { role: 'muted', columns: 112 },
            ),
        );
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
 * @param {string} value
 * @returns {string | null}
 */
function parseByokIdempotencyArg(value) {
    const normalized = normalizeArg(value);
    if (!/^(?:idempotency|idempotency-key|idempotencyKey|idem)[:=]/iu.test(normalized)) return null;
    const key = normalized.replace(/^(?:idempotency|idempotency-key|idempotencyKey|idem)[:=]/iu, '').trim();
    return key || null;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isByokProviderControlArg(value) {
    return (
        /^wire:/iu.test(value) ||
        /^(?:force-deferred|forceApplyDeferred|force-apply-deferred)$/iu.test(value) ||
        /^(?:idempotency|idempotency-key|idempotencyKey|idem)[:=]/iu.test(value)
    );
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
 * @returns {{
 *     env: Record<string, string | undefined>;
 *     model: string | null;
 *     profile: string | null;
 *     provider: string | null;
 *     baseUrl: string | null;
 *     wireApi: string | null;
 *     timeoutMs: number | undefined;
 * }}
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
            const value = Number.parseInt(item.slice(item.indexOf(lower.startsWith('timeout:') ? ':' : '=') + 1), 10);
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
    const providerAttempted = didConfiguredByokProbeAttemptProvider(probe);
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
            'Máquina',
            `probe=${mode} resultado: ${probe.ok ? 'ok' : renderByokTokenLabel(probe.status)} provider=${valueOrDash(probe.preset)} model=${valueOrDash(probe.model)}`,
            { role: 'muted' },
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
    const emitEvent = eventBus?.emit ? eventBus.emit.bind(eventBus) : null;
    const executed = await executeModelGatewayProbe({
        kind: mode,
        env: selection.env,
        model: selection.model,
        ...(selection.timeoutMs ? { timeoutMs: selection.timeoutMs } : {}),
        idempotencyKey: [
            'terminal',
            'probe',
            mode,
            selection.profile ?? selection.provider ?? 'active',
            selection.model ?? 'active',
            Date.now(),
        ].join(':'),
        source: 'terminal.byok.probe',
        deps: {
            runProbe: (options) =>
                probeRunner({
                    ...options,
                    deps: {
                        evaluateAdmission: evaluateTerminalByokProbeBudget,
                        classifyProviderFailure: classifyByokProviderFailure,
                    },
                }),
            recordHealth: (_kind, probe) => recordByokProbeHealth(mode, probe),
            buildEvent: (input) => buildProbeCompletedEvent(input),
            ...(emitEvent
                ? {
                      emit: (event) => emitEvent(/** @type {{ type: string; [key: string]: unknown }} */ (event)),
                  }
                : {}),
        },
    });
    const probe = executed.probe;
    if (!probe) {
        throw new Error(
            '[terminal/byok] replay de probe legado nao contem payload suficiente para renderizacao; execute a probe novamente',
        );
    }
    return {
        probe,
        providerAttempted: executed.providerAttempted,
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

/** @type {Promise<void>} */
let envLocalMutationQueue = Promise.resolve();

/**
 * @param {(text: string) => string} mutate
 * @returns {Promise<void>}
 */
function mutateEnvLocal(mutate) {
    const operation = envLocalMutationQueue
        .catch(() => undefined)
        .then(async () => {
            const path = '.env.local';
            let text = '';
            try {
                text = (await readTextFreshTrusted(path, { caller: 'terminal.commands.byok' })).content;
            } catch (error) {
                if (/** @type {{ code?: string }} */ (error).code !== 'ENOENT') throw error;
            }
            const next = mutate(text);
            const normalized = next.endsWith('\n') ? next : `${next}\n`;
            await writeFileAtomicTrusted(path, normalized, { caller: 'terminal.commands.byok', mode: 0o600 });
        });
    envLocalMutationQueue = operation.then(
        () => undefined,
        () => undefined,
    );
    return operation;
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
        return 'BYOK persistido como desativado; use /byok use sdk para aplicar o SDK Copilot na sessão atual.';
    }

    if (kind === 'profile' || kind === 'use') {
        const profileName = assertSafeEnvValue(values.join(' '));
        const profile = projection.profiles.find((candidate) => candidate.name === profileName);
        if (!profile) {
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
        clearRuntimeSelectors();
        activateModelGatewayByokProfileEnv(profileName);
        return `Perfil BYOK persistido: ${profileName}${profile.ready ? '' : ' · atenção: perfil ainda não está pronto'}.`;
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
            next = baseUrl
                ? setEnvLine(next, 'COPILOT_BYOK_BASE_URL', baseUrl)
                : deleteEnvLine(next, 'COPILOT_BYOK_BASE_URL');
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
        println(
            terminalThemeRows('Uso', ['/byok', '/byok providers', '/byok profiles', '/byok models', '/byok env'], {
                role: 'command',
                width: 12,
            }),
        );
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
            println('');
            println(
                terminalThemeWrappedRow(
                    'Saúde BYOK',
                    scoped
                        ? `limpa para provedor ${scope.providerId ?? '*'} · modelo ${scope.providerModel ?? '*'} · perfil ${scope.routeProfile ?? '*'}`
                        : 'limpa no processo atual e no arquivo persistente',
                    { role: 'success', columns: 112 },
                ),
            );
            println('');
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
            renderByokGatewayAutoExplainIntro(println, rest);
            await renderByokGatewayAutoStatus(println, rest);
            await renderByokGatewayAutoDoctor(println, rest);
            return;
        }
        if (rest.some((item) => /^(plan|plano|proof-plan|proofs|runtime-proofs|provas|plano-provas)$/iu.test(item))) {
            await renderByokGatewayAutoProofPlan(println, rest);
            return;
        }
        if (
            rest.some((item) =>
                /^(standby|alternatives|alternativas|substitutes|substitutos|prontidao|prontidão)$/iu.test(item),
            )
        ) {
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
        if (
            rest.some((item) => /^(confirmations|confirmation|confirmacoes|confirmações|model-changed)$/iu.test(item))
        ) {
            await renderByokGatewayAutoConfirmations(println, rest);
            return;
        }
        if (
            rest.some((item) => /^(recovery-fixture|fixture-recovery|simulate-recovery|simular-recovery)$/iu.test(item))
        ) {
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
            if (
                autoRest.some((item) =>
                    /^(doctor|diagnostic|diagnostico|diagnóstico|check|ready|readiness)$/iu.test(item),
                )
            ) {
                await renderByokGatewayAutoDoctor(println, autoRest);
                return;
            }
            if (autoRest.some((item) => /^(explain|explicar|why|porque|por-que)$/iu.test(item))) {
                renderByokGatewayAutoExplainIntro(println, autoRest);
                await renderByokGatewayAutoStatus(println, autoRest);
                await renderByokGatewayAutoDoctor(println, autoRest);
                return;
            }
            if (
                autoRest.some((item) =>
                    /^(plan|plano|proof-plan|proofs|runtime-proofs|provas|plano-provas)$/iu.test(item),
                )
            ) {
                await renderByokGatewayAutoProofPlan(println, autoRest);
                return;
            }
            if (
                autoRest.some((item) =>
                    /^(standby|alternatives|alternativas|substitutes|substitutos|prontidao|prontidão)$/iu.test(item),
                )
            ) {
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
            if (
                autoRest.some((item) =>
                    /^(confirmations|confirmation|confirmacoes|confirmações|model-changed)$/iu.test(item),
                )
            ) {
                await renderByokGatewayAutoConfirmations(println, autoRest);
                return;
            }
            if (
                autoRest.some((item) =>
                    /^(recovery-fixture|fixture-recovery|simulate-recovery|simular-recovery)$/iu.test(item),
                )
            ) {
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
        if (
            /^(catalog|catalogo)$/iu.test(rest[0] ?? '') &&
            /^(refresh-plan|plan|dry-run|dryrun)$/iu.test(rest[1] ?? '')
        ) {
            await renderByokGatewayCatalogRefreshPlan(println, rest[2] ?? null);
            return;
        }
        if (
            /^(catalog|catalogo)$/iu.test(rest[0] ?? '') &&
            /^(refresh-log|refreshlog|log|logs)$/iu.test(rest[1] ?? '')
        ) {
            await renderByokGatewayCatalogRefreshLog(println);
            return;
        }
        if (
            /^(catalog|catalogo)$/iu.test(rest[0] ?? '') &&
            /^(diff|changes|mudancas|mudanças)$/iu.test(rest[1] ?? '')
        ) {
            await renderByokGatewayCatalogDiff(println);
            return;
        }
        if (/^(catalog|catalogo)$/iu.test(rest[0] ?? '') && /^(conflicts|conflitos)$/iu.test(rest[1] ?? '')) {
            await renderByokGatewayCatalogConflicts(println);
            return;
        }
        if (
            /^(catalog|catalogo)$/iu.test(rest[0] ?? '') &&
            /^(freshness|fresh|fontes|sources)$/iu.test(rest[1] ?? '')
        ) {
            await renderByokGatewayCatalogFreshness(println, rest.slice(2));
            return;
        }
        if (
            /^(catalog|catalogo)$/iu.test(rest[0] ?? '') &&
            /^(integrity|integridade|audit|auditoria)$/iu.test(rest[1] ?? '')
        ) {
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
        if (
            /^(health|runtime-health|probes)$/iu.test(rest[0] ?? '') &&
            /^(sqlite|sql|mirror|sync)$/iu.test(rest[1] ?? '')
        ) {
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
            println(
                terminalThemeHeadline('tool', 'BYOK shortlist agent probe / BYOK shortlist com sonda agente', [
                    `${candidates.length}/${modelList.length}`,
                ]),
            );
            println(
                terminalThemeRow(
                    'Escopo',
                    `${filters.allProviders ? 'todos os perfis selecionados' : 'provider/perfil ativo'} + ranking do catálogo + filtros ${renderByokFilterLabel(filters) || 'safe'}; cada candidato roda sessão SDK descartável de /byok probe agent, sem trocar a conversa viva${timeoutMs ? ` · timeout ${timeoutMs}ms` : ''}`,
                ),
            );
            for (const error of discovered.errors.slice(0, 6)) {
                println(
                    terminalThemeRow('Aviso', `descoberta remota indisponível (${error}); usando catálogo disponível`, {
                        role: 'warn',
                    }),
                );
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
                println(
                    terminalThemeRow(
                        'Próximo',
                        'ajuste provider/filtros, remova safe para inspeção ou rode /byok models',
                        { role: 'command' },
                    ),
                );
                println('');
                renderEmptyByokFilterDiagnostics(println, modelList, filters, runtimeBudget);
                return;
            }
            let passed = 0;
            let attempted = 0;
            for (const [index, model] of candidates.entries()) {
                println(
                    terminalThemeWrappedRow(`${index + 1}. Modelo`, `${model.id} · ${renderModelTags(model)}`, {
                        role: 'warn',
                        columns: 112,
                    }),
                );
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
            println(
                terminalThemeRow(
                    'Máquina',
                    `Shortlist encerrada: ok=${passed}/${candidates.length} attempted=${attempted}/${candidates.length}`,
                    { role: 'muted' },
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
        const explicitMode =
            /^(chat|canary|agent|runtime|full|streaming|stream|delta|deltas|json|structured|vision|image|imagem|vlm)$/iu.test(
                rest[0] ?? '',
            );
        const selection = buildByokProbeSelection(explicitMode ? rest.slice(1) : rest);
        println('');
        println(terminalThemeHeadline('tool', `BYOK ${mode} probe / BYOK sonda ${renderByokTokenLabel(mode)}`));
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
        const skipStatus = rest.some((item) =>
            /^(quiet|--quiet|no-status|--no-status|statusless|--statusless)$/iu.test(item),
        );
        clearRuntimeSelectors();
        const result = loadDotenv({ path: '.env.local', override: true, quiet: true });
        if (result.error) {
            println(
                terminalThemeRow('BYOK', `não foi possível recarregar .env.local: ${result.error.message}`, {
                    role: 'error',
                }),
            );
            println('');
            return;
        }
        println(
            terminalThemeRow('BYOK', '.env.local recarregado no processo atual · segredos não exibidos', {
                role: 'success',
            }),
        );
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
        const readyProfileCount = profiles.filter(
            (profile) => classifyByokProfileReadiness(profile).label === 'pronto',
        ).length;
        const presetSummary = configuredPresets
            ? `${countLabel(configuredPresetEntries.length, 'tipo', 'tipos')} · ${configuredPresets}${omittedPresetCount > 0 ? ` · +${omittedPresetCount}` : ''}`
            : '-';
        println('');
        println(
            terminalThemeHeadline('tool', 'BYOK providers / BYOK provedores', [
                countLabel(profiles.length, 'perfil', 'perfis'),
            ]),
        );
        println(terminalThemeDivider(64));
        println(
            terminalThemeRow(
                'Resumo',
                `ativo ${summary.profile ?? summary.preset ?? 'sdk'} · prontos ${readyProfileCount}/${profiles.length} · presets ${presetSummary}`,
            ),
        );
        if (profiles.length === 0) {
            println(terminalThemeRow('Provedores', 'nenhum configurado', { role: 'warn' }));
            println(
                terminalThemeRow('Próximo', 'adicione perfis em COPILOT_BYOK_PROFILES_JSON no .env.local', {
                    role: 'command',
                }),
            );
            println('');
            return;
        }
        for (const profile of profiles) {
            const active = profile.name === summary.profile ? 'ativo' : 'disponível';
            const metadata = profile.metadataKeys.length ? ` · metadados ${profile.metadataKeys.join(',')}` : '';
            const cost = renderByokProfileCostTag(profile.name);
            const health = readHealthForByokProfile(profile);
            const healthLabel = ` · ${renderByokHealthTag(health)} · ${renderByokAgentProbeHealthTag(health)}`;
            const readiness = classifyByokProfileReadiness(profile);
            println(
                terminalThemeRow(profile.name, `${active} · ${readiness.label}`, { role: readiness.role, width: 24 }),
            );
            println(
                terminalThemeRow(
                    'Configuração',
                    `preset ${profile.preset ?? '-'} · provedor ${profile.providerType ?? '-'} · modelo ${profile.model ?? '-'} · autenticação ${renderProfileAuth(profile)} · prontidão ${readiness.detail}${metadata}${cost}${healthLabel}`,
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
        println(
            terminalThemeRow('Comparar', '/byok models all-providers free reasoning safe · filtro provider:<nome>', {
                role: 'command',
            }),
        );
        println(terminalThemeDivider(64));
        println('');
        return;
    }

    if (sub === 'profiles') {
        println('');
        println(terminalThemeHeadline('tool', 'BYOK perfis', [countLabel(profiles.length, 'perfil', 'perfis')]));
        println(terminalThemeDivider(60));
        if (profiles.length === 0) {
            println(
                terminalThemeRow('Perfis', 'nenhum configurado em COPILOT_BYOK_PROFILES_JSON no .env.local', {
                    role: 'warn',
                }),
            );
            println('');
            return;
        }
        for (const profile of profiles) {
            const active = profile.name === summary.profile ? 'ativo' : 'disponível';
            const metadata = profile.metadataKeys.length ? ` · metadados ${profile.metadataKeys.join(',')}` : '';
            const cost = renderByokProfileCostTag(profile.name);
            const readiness = classifyByokProfileReadiness(profile);
            println(
                terminalThemeRow(profile.name, `${active} · ${readiness.label}`, { role: readiness.role, width: 24 }),
            );
            println(
                terminalThemeRow(
                    'Configuração',
                    `preset ${profile.preset ?? '-'} · provedor ${profile.providerType ?? '-'} · modelo ${profile.model ?? '-'} · autenticação ${renderProfileAuth(profile)} · prontidão ${readiness.detail}${metadata}${cost}`,
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
        if (
            /^(catalog|catalogo)$/iu.test(rest[0] ?? '') &&
            /^(diff|changes|mudancas|mudanças)$/iu.test(rest[1] ?? '')
        ) {
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
        const forceRefresh = rest.some((item) =>
            ['refresh', 'force', '--refresh', '--force'].includes(item.toLowerCase()),
        );
        const showAll = rest.some((item) => ['all', '--all'].includes(item.toLowerCase()));
        const filters = parseRecommendArgs(rest);
        const limit = showAll
            ? Number.POSITIVE_INFINITY
            : filters.limit === DEFAULT_BYOK_RECOMMEND_DISPLAY_LIMIT
              ? DEFAULT_BYOK_MODELS_DISPLAY_LIMIT
              : filters.limit;
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
            terminalThemeHeadline('tool', 'BYOK models / BYOK modelos', [
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
        println(
            terminalThemeRow('Máquina', `filtros=${renderByokMachineFilterLabel(filters) || '-'}`, { role: 'muted' }),
        );
        for (const error of discovered.errors.slice(0, 6)) {
            println(
                terminalThemeRow('Aviso', `descoberta remota indisponível (${error}); usando catálogo disponível`, {
                    role: 'warn',
                }),
            );
        }
        if (discovered.errors.length > 6) {
            println(
                terminalThemeWrappedRow(
                    'Aviso',
                    `${countLabel(discovered.errors.length - 6, 'erro de descoberta omitido', 'erros de descoberta omitidos')} · use provider:<nome> para isolar`,
                    { role: 'warn', columns: 112 },
                ),
            );
        }
        renderByokCatalogWarnings(println, discovered.warnings);
        if (modelList.length === 0) {
            println(terminalThemeRow('Modelos', 'nenhum encontrado para os filtros atuais', { role: 'warn' }));
            println(
                terminalThemeRow(
                    'Próximo',
                    'remova filtros, use provider:<nome> ou rode /byok models all-providers refresh',
                    { role: 'command' },
                ),
            );
            println('');
            renderEmptyByokFilterDiagnostics(
                println,
                discovered.models.length > 0 ? discovered.models : models,
                filters,
                runtimeBudget,
            );
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
        const recommendedEntries = (
            filters.grouped
                ? groupByokModelVariants(rankedRecommended)
                : rankedRecommended.map((model) => ({ model, variants: [] }))
        ).slice(0, filters.limit);
        const filterLabel = renderByokFilterLabel(filters);
        println('');
        println(
            terminalThemeHeadline('tool', 'BYOK recommend / BYOK recomendação', [
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
            println(
                terminalThemeRow('Aviso', `descoberta remota indisponível (${error}); usando catálogo disponível`, {
                    role: 'warn',
                }),
            );
        }
        if (discovered.errors.length > 6) {
            println(
                terminalThemeWrappedRow(
                    'Aviso',
                    `${countLabel(discovered.errors.length - 6, 'erro de descoberta omitido', 'erros de descoberta omitidos')} · use provider:<nome> para isolar`,
                    { role: 'warn', columns: 112 },
                ),
            );
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
        println(
            terminalThemeRow(
                'Troca viva',
                '/byok use <perfil> troca provedor; /byok model <id> troca só modelo ativo',
                { role: 'command' },
            ),
        );
        println('');
        return;
    }

    if (sub === 'use') {
        const target = normalizeArg(rest.join(' '));
        if (!target) {
            println(terminalThemeRow('Uso', '/byok use <perfil|sdk>', { role: 'error' }));
            println('');
            return;
        }
        if (target === 'sdk' || target === 'off' || target === 'copilot') {
            const inventory = await listTerminalSdkSessionInventory().catch(() => null);
            process.env['COPILOT_BYOK_ENABLED'] = 'false';
            clearRuntimeSelectors();
            println('');
            println(
                terminalThemeRow('BYOK', 'desativado no processo atual; SDK Copilot será aplicado à sessão atual', {
                    role: 'success',
                }),
            );
            if (inventory?.currentSessionId) {
                try {
                    const request = await requestTerminalLiveByokRouteSwitch(
                        {
                            providerId: 'github-copilot-sdk',
                            providerModel: 'auto',
                            selectorSyntax: 'auto',
                            baseUrl: null,
                            openAICompatibleBaseUrl: null,
                            wireApi: null,
                            providerProfile: null,
                            routeProfile: null,
                            selectedRouteKey: 'github-copilot-sdk:auto',
                        },
                        {
                            source: 'terminal.byok_use_sdk',
                            reason: 'solicitação manual /byok use sdk',
                        },
                    );
                    println(terminalThemeRow('Rota viva', request.detail, { role: 'success' }));
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    println(
                        terminalThemeRow('Rota viva', `reattach falhou · ${message}; nenhuma sessão nova foi criada`, {
                            role: 'warn',
                        }),
                    );
                }
            }
            printByokSdkSessionBoundaryHint(println);
            println('');
            return;
        }
        if (!profiles.some((profile) => profile.name === target)) {
            println(
                terminalThemeRow('Perfil BYOK', `não encontrado: ${target} · veja /byok profiles`, { role: 'error' }),
            );
            println('');
            return;
        }
        clearRuntimeSelectors();
        activateModelGatewayByokProfileEnv(target);
        const nextProjection = readTerminalByokProjection();
        await renderStatus(nextProjection, println);
        if (nextProjection.summary.model) {
            await tryApplyLiveByokModelSwitch(nextProjection.summary, nextProjection.summary.model, println);
        }
        return;
    }

    if (sub === 'model') {
        const model = normalizeArg(rest.join(' '));
        if (!model) {
            println(terminalThemeRow('Uso', '/byok model <model-id>', { role: 'error' }));
            println('');
            return;
        }
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        clearRuntimeSelectors(['COPILOT_BYOK_PROFILE']);
        process.env['COPILOT_BYOK_MODEL'] = model;
        const nextProjection = readTerminalByokProjection();
        await renderByokModelSwitchSummary(nextProjection, println);
        await tryApplyLiveByokModelSwitch(nextProjection.summary, model, println);
        println('');
        return;
    }

    if (sub === 'provider') {
        const [preset, ...providerArgs] = rest;
        const wireApi = providerArgs
            .find((item) => /^wire:/iu.test(item))
            ?.replace(/^wire:/iu, '')
            .trim();
        const idempotencyKey = providerArgs.map(parseByokIdempotencyArg).find(Boolean);
        const forceApplyDeferred = providerArgs.some((item) =>
            /^(?:force-deferred|forceApplyDeferred|force-apply-deferred)$/iu.test(item),
        );
        const [model, baseUrl] = providerArgs.filter((item) => !isByokProviderControlArg(item));
        if (!preset) {
            println(
                terminalThemeRow('Uso', '/byok provider <preset> [model] [baseUrl] [wire:<completions|responses>]', {
                    role: 'error',
                }),
            );
            println('');
            return;
        }
        if (wireApi && wireApi !== 'completions' && wireApi !== 'responses') {
            println(
                terminalThemeRow('wireApi', 'inválido · use wire:completions ou wire:responses', { role: 'error' }),
            );
            println('');
            return;
        }
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        clearRuntimeSelectors();
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = preset;
        if (model) process.env['COPILOT_BYOK_MODEL'] = model;
        if (baseUrl) process.env['COPILOT_BYOK_BASE_URL'] = baseUrl;
        if (wireApi) process.env['COPILOT_BYOK_WIRE_API'] = wireApi;
        const nextProjection = readTerminalByokProjection();
        await renderStatus(nextProjection, println);
        if (nextProjection.summary.model) {
            await tryApplyLiveByokModelSwitch(nextProjection.summary, nextProjection.summary.model, println, {
                ...(idempotencyKey ? { idempotencyKey } : {}),
                ...(forceApplyDeferred ? { forceApplyDeferred: true } : {}),
            });
        }
        return;
    }

    await renderStatus(projection, println);
}
