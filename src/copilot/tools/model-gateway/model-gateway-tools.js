// @ts-check

import {
    classifyModelGatewayDeferredRouteOperation,
    collectModelGatewaySecretAuditEnvValues,
    DEFAULT_MODEL_GATEWAY_RUNTIME_PROOF_WEIGHTS,
    createModelGatewayCatalogControlPlane,
    createModelGatewayControlPlaneResult,
    createModelGatewayEnvProfileStore,
    createModelGatewayModelSwitchOperationId,
    createModelGatewayProbeOperationId,
    createModelGatewayReadControlPlane,
    createModelGatewaySameSessionRouteSwitchOperationId,
    executeModelGatewayProbe,
    materializeModelGatewayActiveByokProfileEnv,
    readModelGatewayProbeOperation,
    removeModelGatewayByokProfileEnv,
    redactModelGatewayAuditedValue,
    resolveModelGatewaySessionBinding,
    SqliteModelGatewayCatalogStore,
    upsertModelGatewayByokProfileEnv,
} from '#copilot/model-gateway';
import { buildTool } from '../infra/tool-factory.js';
import {
    MODEL_GATEWAY_CATALOG_SEARCH_INPUT_SCHEMA,
    MODEL_GATEWAY_CATALOG_REFRESH_INPUT_SCHEMA,
    MODEL_GATEWAY_CONTROL_PLANE_GUIDE_INPUT_SCHEMA,
    MODEL_GATEWAY_MODEL_EVALUATE_INPUT_SCHEMA,
    MODEL_GATEWAY_MAINTENANCE_INPUT_SCHEMA,
    MODEL_GATEWAY_OPERATION_STATUS_INPUT_SCHEMA,
    MODEL_GATEWAY_MODEL_SWITCH_INPUT_SCHEMA,
    MODEL_GATEWAY_OVERVIEW_INPUT_SCHEMA,
    MODEL_GATEWAY_PROFILE_MANAGE_INPUT_SCHEMA,
    MODEL_GATEWAY_POLICY_PROPOSE_INPUT_SCHEMA,
    MODEL_GATEWAY_PROBE_EXECUTE_INPUT_SCHEMA,
    MODEL_GATEWAY_PROBE_PLAN_INPUT_SCHEMA,
    MODEL_GATEWAY_ROUTE_PLAN_INPUT_SCHEMA,
    MODEL_GATEWAY_ROUTE_SWITCH_INPUT_SCHEMA,
    MODEL_GATEWAY_RUNTIME_RECONCILE_INPUT_SCHEMA,
    MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    MODEL_GATEWAY_WORKFLOW_PLAN_INPUT_SCHEMA,
} from './schemas.js';

const READ_ONLY_ANNOTATIONS = Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
});

const MUTATING_ANNOTATIONS = Object.freeze({
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
});

const MODEL_GATEWAY_CONTROL_PLANE_TOOL_MATRIX = Object.freeze([
    {
        phase: 'readiness',
        tools: ['model_gateway_control_plane_guide', 'model_gateway_overview', 'model_gateway_workflow_plan'],
        purpose: 'Entender o sistema, readiness, runtime efetivo, BYOK e próximo roteiro operacional.',
    },
    {
        phase: 'catalog',
        tools: ['model_gateway_catalog_search', 'model_gateway_catalog_refresh'],
        purpose: 'Buscar candidatos e planejar/aplicar refresh incremental do catálogo canônico.',
    },
    {
        phase: 'route',
        tools: ['model_gateway_route_plan', 'model_gateway_model_evaluate', 'model_gateway_policy_propose'],
        purpose: 'Separar ranking de qualidade/capacidade de ranking já certificado por prova runtime fresca.',
    },
    {
        phase: 'runtime-proof',
        tools: ['model_gateway_probe_plan', 'model_gateway_probe_execute'],
        purpose: 'Provar a melhor candidata atual em sessão descartável; recalcular o workflow após todo resultado.',
    },
    {
        phase: 'same-session-runtime',
        tools: ['model_gateway_model_switch', 'model_gateway_route_switch', 'model_gateway_runtime_reconcile'],
        purpose: 'Trocar modelo ou provider no runtime vivo preservando sessionId, com apply confirmado.',
    },
    {
        phase: 'byok-profile',
        tools: ['model_gateway_profile_manage'],
        purpose: 'Gerir perfis BYOK com segredos por referência de env, nunca inline.',
    },
    {
        phase: 'operations',
        tools: ['model_gateway_operation_status', 'model_gateway_maintenance'],
        purpose: 'Auditar operações persistidas e planejar retenção dos ledgers operacionais.',
    },
]);

/**
 * @typedef {{
 *     readCapabilities: (runtimeId?: string | null) => Record<string, unknown>;
 *     readStats: (runtimeId?: string | null) => { currentModel: string; stats: unknown };
 *     switchModel: (modelId: string, runtimeId?: string | null, options?: { idempotencyKey?: string; source?: string }) => Promise<Record<string, any>>;
 *     switchRoute: (route: Record<string, unknown>, runtimeId?: string | null, options?: { idempotencyKey?: string; timeoutMs?: number; source?: string; allowActiveDialogLoopReattach?: boolean; forceApplyDeferred?: boolean }) => Promise<Record<string, any>>;
 * }} ModelGatewayRuntimeControl
 */

/** @type {ModelGatewayRuntimeControl | null} */
let runtimeControl = null;

/**
 * @param {ModelGatewayRuntimeControl | null} control
 */
export function setModelGatewayRuntimeControl(control) {
    runtimeControl = control;
}

/**
 * @returns {ModelGatewayRuntimeControl}
 */
function requireRuntimeControl() {
    if (!runtimeControl) {
        throw new Error('MODEL_GATEWAY_RUNTIME_CONTROL_UNAVAILABLE: runtime composition has not injected model control');
    }
    return runtimeControl;
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {{ currentModel: string | null; available: boolean; warning: string | null }}
 */
function readOptionalRuntimeCurrentModel(runtimeId) {
    if (!runtimeControl) {
        return {
            currentModel: null,
            available: false,
            warning: 'runtime_control_unavailable_for_plan',
        };
    }
    const stats = runtimeControl.readStats(runtimeId ?? undefined);
    return {
        currentModel: stats.currentModel,
        available: true,
        warning: null,
    };
}

/**
 * @param {string} toolName
 * @param {{ idempotencyKey?: string | null; correlationId?: string | null; expectedResult?: string }} [input]
 */
function toolOperationMeta(toolName, input = {}) {
    return {
        actor: 'llm-b',
        source: `llm-b.${toolName}`,
        correlationId: input.correlationId ?? input.idempotencyKey ?? `${toolName}:${Date.now()}`,
        idempotencyKey: input.idempotencyKey ?? null,
        expectedResult: input.expectedResult ?? 'structured_result',
    };
}

/**
 * @param {Record<string, unknown>} result
 * @param {ReturnType<typeof toolOperationMeta>} operationMeta
 * @returns {Record<string, unknown>}
 */
function withOperationMeta(result, operationMeta) {
    const data = result['data'] && typeof result['data'] === 'object' && !Array.isArray(result['data'])
        ? /** @type {Record<string, unknown>} */ (result['data'])
        : {};
    return { ...result, data: { ...data, operationMeta } };
}

/**
 * @param {Record<string, unknown>} result
 * @returns {string}
 */
function serializeResult(result) {
    return JSON.stringify(
        redactModelGatewayAuditedValue(result, {
            additionalSecrets: collectModelGatewaySecretAuditEnvValues(),
        }),
    );
}

/**
 * @param {Record<string, unknown>} result
 * @param {Record<string, unknown>} runtime
 * @returns {Record<string, unknown>}
 */
function withRuntimeOverview(result, runtime) {
    const data = result['data'] && typeof result['data'] === 'object' && !Array.isArray(result['data'])
        ? /** @type {Record<string, unknown>} */ (result['data'])
        : {};
    return { ...result, data: { ...data, runtime } };
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
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalToolString(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const sentinel = text.toLowerCase();
    if (
        !text ||
        sentinel === '__unset__' ||
        sentinel === '__none__' ||
        sentinel === '__null__' ||
        sentinel === 'null' ||
        sentinel === 'undefined' ||
        sentinel === 'none' ||
        sentinel === 'n/a' ||
        sentinel === 'na'
    ) {
        return null;
    }
    return text;
}

/**
 * @param {Record<string, unknown>} operation
 * @returns {Record<string, unknown> | null}
 */
function routeSwitchTargetRoute(operation) {
    const route = asRecord(operation['targetRoute']);
    return Object.keys(route).length > 0 ? route : null;
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {{ safe: boolean; capability: Record<string, unknown> | null; reason: string }}
 */
function readRouteReattachApplySafety(runtimeId) {
    if (!runtimeControl) {
        return {
            safe: false,
            capability: null,
            reason: 'runtime_control_unavailable_for_route_promotion',
        };
    }
    const snapshot = asRecord(runtimeControl.readCapabilities(runtimeId ?? undefined));
    const capabilities = Array.isArray(snapshot['capabilities']) ? snapshot['capabilities'] : [];
    const capability =
        capabilities
            .map((item) => asRecord(item))
            .find((item) => item['id'] === 'sdk.same-session-route-reattach') ?? null;
    const details = asRecord(capability?.['details']);
    const deferredUntilTurnBoundary = details['deferredUntilTurnBoundary'] === true;
    const dialogLoopActive = details['dialogLoopActive'] === true;
    if (!capability) {
        return { safe: false, capability: null, reason: 'same_session_route_reattach_capability_missing' };
    }
    if (capability['available'] !== true) {
        return { safe: false, capability, reason: 'same_session_route_reattach_unavailable' };
    }
    if (deferredUntilTurnBoundary || dialogLoopActive || capability['state'] === 'degraded') {
        return {
            safe: false,
            capability,
            reason: 'same_session_route_reattach_deferred_until_turn_boundary',
        };
    }
    return { safe: true, capability, reason: 'same_session_route_reattach_safe_now' };
}

/**
 * @param {string} routeOperationId
 * @returns {Promise<{ handoff: Record<string, unknown> | null; operation: Record<string, unknown> | null }>}
 */
async function readRouteSwitchOperation(routeOperationId) {
    const store = new SqliteModelGatewayCatalogStore();
    const handoff = await store.readSdkSessionHandoffRecord(routeOperationId);
    const operation = asRecord(handoff?.['operation']);
    return {
        handoff,
        operation: Object.keys(operation).length > 0 ? operation : null,
    };
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function profileRecordInput(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return /** @type {Record<string, unknown>} */ (value);
    }
    if (typeof value !== 'string' || !value.trim()) return {};
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('MODEL_GATEWAY_PROFILE_BODY_INVALID_JSON: profile string deve representar um objeto JSON');
    }
    return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {Record<string, unknown>}
 */
function normalizeProfileWriteInput(profile) {
    const normalized = { ...profile };
    if (typeof normalized['apiKey'] === 'string' && normalized['apiKey'].trim()) {
        throw new Error('MODEL_GATEWAY_PROFILE_INLINE_SECRET_NOT_ALLOWED: use apiKeyEnv instead of apiKey');
    }
    if (typeof normalized['bearerToken'] === 'string' && normalized['bearerToken'].trim()) {
        throw new Error('MODEL_GATEWAY_PROFILE_INLINE_SECRET_NOT_ALLOWED: use bearerTokenEnv instead of bearerToken');
    }
    return normalized;
}

/**
 * @param {string} operation
 * @param {string} profileName
 * @param {Record<string, unknown> | null} profile
 * @param {Record<string, string | undefined>} env
 */
function simulateProfileWrite(operation, profileName, profile, env) {
    const simulatedEnv = { ...env };
    const store = createModelGatewayEnvProfileStore({ env: simulatedEnv });
    if (operation === 'remove') {
        store.remove(profileName);
    } else {
        store.upsert(profileName, asRecord(profile));
    }
    return {
        env: simulatedEnv,
        summaries: store.listTerminalSummaries(),
    };
}

/**
 * @param {{
 *     profileName: string;
 *     operation: string;
 *     operationMeta: Record<string, unknown>;
 *     error: unknown;
 * }} options
 */
function invalidProfileManageResult(options) {
    const message = options.error instanceof Error ? options.error.message : String(options.error);
    const secretRefFailure = message.includes('SECRET_REF_NOT_ALLOWED');
    return serializeResult(
        createModelGatewayControlPlaneResult({
            operation: 'profile.manage',
            ok: false,
            status: 'invalid_profile',
            data: {
                profileName: options.profileName,
                operation: options.operation,
                operationMeta: options.operationMeta,
            },
            errors: [
                {
                    code: secretRefFailure ? 'PROFILE_MANAGE_SECRET_REF_NOT_ALLOWED' : 'PROFILE_MANAGE_INVALID_PROFILE',
                    message,
                    retryable: true,
                },
            ],
            nextActions: secretRefFailure
                ? ['replace_secret_ref_with_allowed_provider_ref', 'inspect_secret_requirements']
                : ['replace_inline_secret_with_env_ref'],
        }),
    );
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalWorkflowString(value) {
    return optionalToolString(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanWorkflowKeyPart(value) {
    const cleaned = String(value ?? 'none')
        .replace(/[^A-Za-z0-9._:-]+/gu, '-')
        .replace(/-+/gu, '-')
        .replace(/^-|-$/gu, '');
    return cleaned || 'none';
}

/**
 * @param {string} prefix
 * @param {string} suffix
 * @returns {string}
 */
function workflowIdempotencyKey(prefix, suffix) {
    return `${prefix}:${cleanWorkflowKeyPart(suffix)}`.slice(0, 200);
}

/**
 * @param {Record<string, unknown>} result
 * @returns {Record<string, unknown>}
 */
function operationData(result) {
    return asRecord(result['data']);
}

/**
 * @param {Record<string, unknown>} result
 * @returns {string[]}
 */
function resultWarnings(result) {
    return Array.isArray(result['warnings']) ? result['warnings'].map(String) : [];
}

/**
 * @param {unknown} goal
 * @returns {Record<string, unknown>}
 */
function selectionGoalRouteOptions(goal) {
    switch (goal) {
        case 'quality_first':
            return {
                pricePenaltyWeight: 0,
                latencyPenaltyWeight: 0.2,
                runtimeProofWeights: {
                    ...DEFAULT_MODEL_GATEWAY_RUNTIME_PROOF_WEIGHTS,
                    chatHealthOk: 0,
                    agentProbeVerified: 0,
                    genericProbeVerified: 0,
                    preferredProbeVerified: 0,
                    preferredLiveProtocolProbeVerified: 0,
                    exactRouteProfileProof: 0,
                    runtimeProvedPreference: 0,
                },
            };
        case 'reliability_first':
            return { pricePenaltyWeight: 0.25, latencyPenaltyWeight: 0.35 };
        case 'latency_first':
            return { pricePenaltyWeight: 0.5, latencyPenaltyWeight: 2 };
        case 'cost_first':
            return { pricePenaltyWeight: 2, latencyPenaltyWeight: 0.5 };
        default:
            return { pricePenaltyWeight: 1, latencyPenaltyWeight: 1 };
    }
}

/**
 * @param {unknown} policy
 */
function routeProofPolicyOptions(policy) {
    if (policy === 'metadata_only') return { requireAgentProbeOk: false, requireRuntimeProof: false };
    if (policy === 'fresh_runtime_required') return { requireRuntimeProof: true };
    return {};
}

/**
 * @param {Record<string, unknown>} selectedRoute
 * @returns {Record<string, unknown> | null}
 */
function normalizeWorkflowRoute(selectedRoute) {
    const providerId = optionalWorkflowString(selectedRoute['providerId']);
    const providerModel = optionalWorkflowString(selectedRoute['providerModel']);
    if (!providerId || !providerModel) return null;
    return {
        providerId,
        providerModel,
        providerType: optionalWorkflowString(selectedRoute['providerType']),
        selectorSyntax: optionalWorkflowString(selectedRoute['selectorSyntax']),
        baseUrl: optionalWorkflowString(selectedRoute['baseUrl']),
        openAICompatibleBaseUrl: optionalWorkflowString(selectedRoute['openAICompatibleBaseUrl']),
        openAICompatible: selectedRoute['openAICompatible'] === true,
        wireApi: optionalWorkflowString(selectedRoute['wireApi']),
        providerProfile: optionalWorkflowString(selectedRoute['providerProfile']),
        routeProfile: optionalWorkflowString(selectedRoute['routeProfile']),
        selectedRouteKey: optionalWorkflowString(selectedRoute['selectedRouteKey']),
        bindingStrategy: optionalWorkflowString(selectedRoute['bindingStrategy']),
        sdkRouteKey: optionalWorkflowString(selectedRoute['sdkRouteKey']),
        sdkVisibleModel: optionalWorkflowString(selectedRoute['sdkVisibleModel']),
        directRebindReliability: optionalWorkflowString(selectedRoute['directRebindReliability']),
        directRebindSupported:
            typeof selectedRoute['directRebindSupported'] === 'boolean'
                ? selectedRoute['directRebindSupported']
                : null,
        directRebindReliable:
            typeof selectedRoute['directRebindReliable'] === 'boolean'
                ? selectedRoute['directRebindReliable']
                : null,
        bindingDecision: Object.keys(asRecord(selectedRoute['bindingDecision'])).length > 0
            ? asRecord(selectedRoute['bindingDecision'])
            : null,
    };
}

/**
 * @param {number} order
 * @param {string} id
 * @param {string} tool
 * @param {string} mode
 * @param {string} purpose
 * @param {Record<string, unknown>} args
 * @param {string[]} [requires]
 * @returns {Record<string, unknown>}
 */
function workflowStep(order, id, tool, mode, purpose, args, requires = []) {
    return {
        order,
        id,
        tool,
        mode,
        purpose,
        args,
        requires,
        confirmationRequired: mode === 'apply',
    };
}

/**
 * @param {Record<string, any>} candidate
 * @param {number} rank
 */
function normalizeWorkflowCandidate(candidate, rank) {
    const providerId = optionalWorkflowString(candidate['providerId']);
    const providerModel = optionalWorkflowString(candidate['providerModel']) ?? optionalWorkflowString(candidate['id']);
    if (!providerId || !providerModel) return null;
    const probes = asRecord(candidate['probes']);
    const freshProof = probes['freshProof'] === true;
    const historicalProof = probes['historicalProof'] === true;
    const stale = probes['stale'] === true;
    const failedProbes = Array.isArray(probes['failedProbes']) ? probes['failedProbes'].map(String) : [];
    return {
        rank,
        id: optionalWorkflowString(candidate['id']) ?? `${providerId}:${providerModel}`,
        providerId,
        providerModel,
        score: typeof candidate['score'] === 'number' ? candidate['score'] : null,
        proofState: freshProof ? 'fresh_proved' : stale ? 'historical_stale' : 'unproved',
        freshProof,
        historicalProof,
        stale,
        proofAgeMs: typeof probes['proofAgeMs'] === 'number' ? probes['proofAgeMs'] : null,
        failedProbes,
        positiveReasons: Array.isArray(candidate['positiveReasons']) ? candidate['positiveReasons'].map(String) : [],
        rejectedReasons: Array.isArray(candidate['rejectedReasons']) ? candidate['rejectedReasons'].map(String) : [],
    };
}

/**
 * @param {Record<string, any>} routeData
 * @param {{ candidateModelIds?: string[]; providerId?: string | null; maxCandidates: number; probeStrategy?: string }} input
 */
function buildWorkflowProbeCandidateChain(routeData, input) {
    const routeCandidates = Array.isArray(routeData['candidates'])
        ? routeData['candidates']
              .map((candidate, index) => normalizeWorkflowCandidate(asRecord(candidate), index + 1))
              .filter((candidate) => candidate !== null)
        : [];
    const explicitIds = Array.isArray(input.candidateModelIds) ? input.candidateModelIds.map(String) : [];
    /** @type {Record<string, any>[]} */
    let candidates = routeCandidates;
    if (explicitIds.length > 0) {
        const byId = new Map();
        for (const candidate of routeCandidates) {
            byId.set(String(candidate['id']), candidate);
            byId.set(String(candidate['providerModel']), candidate);
        }
        candidates = explicitIds
            .map((id, index) => {
                const matched = byId.get(id);
                if (matched) return { ...matched, rank: index + 1 };
                const providerId = optionalWorkflowString(input.providerId);
                return providerId
                    ? {
                          rank: index + 1,
                          id: `${providerId}:${id}`,
                          providerId,
                          providerModel: id,
                          score: null,
                          proofState: 'unproved',
                          freshProof: false,
                          historicalProof: false,
                          stale: false,
                          proofAgeMs: null,
                          failedProbes: [],
                          positiveReasons: ['explicit_candidate'],
                          rejectedReasons: [],
                      }
                    : null;
            })
            .filter((candidate) => candidate !== null);
    }
    const unique = [];
    const seen = new Set();
    for (const candidate of candidates) {
        const key = `${candidate['providerId']}:${candidate['providerModel']}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(candidate);
    }
    const strategyLimit = input.probeStrategy === 'minimal' ? 1 : input.probeStrategy === 'aggressive' ? 5 : 3;
    return unique.slice(0, Math.min(input.maxCandidates, strategyLimit));
}

/**
 * @param {{
 *   runtimeId?: string | null;
 *   taskProfile: string;
 *   selectionGoal: string;
 *   requireRuntimeProof: boolean;
 *   maxRuntimeProofAgeHours: number;
 *   currentModel: string | null;
 *   discoveryRoute: Record<string, any> | null;
 *   provedRoute: Record<string, any> | null;
 *   candidates: Record<string, any>[];
 * }} input
 */
function buildWorkflowSelectionDecision(input) {
    const discoveryCandidate = input.candidates[0] ?? null;
    const discoveryProvider = optionalWorkflowString(discoveryCandidate?.['providerId']);
    const discoveryModel = optionalWorkflowString(discoveryCandidate?.['providerModel']);
    const provedProvider = optionalWorkflowString(input.provedRoute?.['providerId']);
    const provedModel = optionalWorkflowString(input.provedRoute?.['providerModel']);
    const discoveryMatchesProved =
        discoveryProvider !== null &&
        discoveryModel !== null &&
        discoveryProvider === provedProvider &&
        discoveryModel === provedModel;
    const currentMatchesProved = provedModel !== null && input.currentModel === provedModel;
    const betterDiscoveryNeedsProof =
        input.requireRuntimeProof && discoveryCandidate !== null && !discoveryMatchesProved;
    const status = betterDiscoveryNeedsProof
        ? 'probe_required'
        : input.provedRoute
          ? currentMatchesProved
              ? 'use_current'
              : 'switch_recommended'
          : discoveryCandidate
            ? 'probe_required'
            : 'blocked';
    const confidence = status === 'use_current' || status === 'switch_recommended' ? 'high' : discoveryCandidate ? 'medium' : 'low';
    const nextAction =
        status === 'use_current'
            ? 'continue_with_current_route'
            : status === 'switch_recommended'
              ? 'plan_same_session_switch'
              : status === 'probe_required'
                ? 'probe_current_top_candidate_then_rerun_workflow'
                : 'refresh_catalog_or_relax_hard_constraints';
    const provedCandidate = input.candidates.find(
        (candidate) =>
            optionalWorkflowString(candidate?.['providerId']) === provedProvider &&
            optionalWorkflowString(candidate?.['providerModel']) === provedModel,
    ) ?? null;
    /** @param {Record<string, any> | null | undefined} candidate */
    const proofAgeHours = (candidate) => {
        const proofAgeMs = typeof candidate?.['proofAgeMs'] === 'number' ? candidate['proofAgeMs'] : null;
        return proofAgeMs === null ? null : Math.round((proofAgeMs / (60 * 60 * 1000)) * 10) / 10;
    };
    /** @param {Record<string, any> | null | undefined} candidate */
    const explainCandidate = (candidate) =>
        candidate
            ? {
                  rank: typeof candidate['rank'] === 'number' ? candidate['rank'] : null,
                  providerId: optionalWorkflowString(candidate['providerId']),
                  model: optionalWorkflowString(candidate['providerModel']),
                  score: typeof candidate['score'] === 'number' ? candidate['score'] : null,
                  proofState: optionalWorkflowString(candidate['proofState']) ?? 'unproved',
                  proofAgeHours: proofAgeHours(candidate),
                  recentFailedProbes: Array.isArray(candidate['failedProbes']) ? candidate['failedProbes'].map(String) : [],
              }
            : null;
    const headline =
        status === 'use_current'
            ? 'A rota atual já é a melhor opção com prova funcional fresca para esta tarefa.'
            : status === 'switch_recommended'
              ? 'Há uma rota melhor já comprovada; a próxima etapa é promover essa rota preservando a mesma sessão.'
              : status === 'probe_required'
                ? 'A melhor candidata por qualidade ainda precisa de prova funcional fresca antes de qualquer troca.'
                : 'Nenhuma rota elegível está pronta para uso; é necessário resolver o bloqueio antes de selecionar.';
    const why =
        status === 'probe_required'
            ? `O ranking ${input.selectionGoal} prefere ${discoveryProvider ?? 'provider desconhecido'}/${discoveryModel ?? 'modelo desconhecido'}, mas ela ainda não satisfaz o contrato de prova fresca de ${input.maxRuntimeProofAgeHours}h.`
            : status === 'switch_recommended'
              ? `${provedProvider ?? 'O provider vencedor'}/${provedModel ?? 'o modelo vencedor'} já satisfaz o contrato runtime e supera a rota atual para o perfil ${input.taskProfile}.`
              : status === 'use_current'
                ? `A rota atual ${provedProvider ?? 'provider atual'}/${provedModel ?? input.currentModel ?? 'modelo atual'} satisfaz o contrato runtime e continua no topo do ranking ${input.selectionGoal}.`
                : `O discovery ranking não encontrou candidata elegível para o perfil ${input.taskProfile} sob as restrições atuais.`;
    const operatorExplanation = {
        language: 'pt-BR',
        headline,
        current: {
            model: input.currentModel,
            alreadyBestFreshlyProved: currentMatchesProved,
        },
        discoveryBest: explainCandidate(discoveryCandidate),
        freshlyProvedBest: provedModel
            ? {
                  providerId: provedProvider,
                  model: provedModel,
                  proofState: optionalWorkflowString(provedCandidate?.['proofState']) ?? 'fresh_proved',
                  proofAgeHours: proofAgeHours(provedCandidate),
              }
            : null,
        why,
        next:
            status === 'use_current'
                ? 'Continue na rota atual; não há mutação a fazer.'
                : status === 'switch_recommended'
                  ? 'Planeje e aplique a troca same-session usando exatamente a rota retornada pelo workflow.'
                  : status === 'probe_required'
                    ? 'Sonde somente a candidata #1 atual; depois descarte este ranking e execute o workflow novamente, independentemente de sucesso ou falha.'
                    : 'Inspecione blockers, catálogo e credenciais; não enfraqueça restrições silenciosamente.',
        alternatives: input.candidates.slice(0, 4).map(explainCandidate).filter((candidate) => candidate !== null),
    };
    return {
        status,
        confidence,
        taskProfile: input.taskProfile,
        selectionGoal: input.selectionGoal,
        currentModel: input.currentModel,
        selectedRoute: input.provedRoute,
        discoveryBestRoute: input.discoveryRoute,
        nextCandidate: status === 'probe_required' ? discoveryCandidate : null,
        runtimeProofRequired: input.requireRuntimeProof,
        runtimeProofMaxAgeHours: input.maxRuntimeProofAgeHours,
        candidateChain: input.candidates,
        operatorExplanation,
        rationale: [
            input.selectionGoal === 'quality_first'
                ? 'quality_first:price_penalty_disabled'
                : `selection_goal:${input.selectionGoal}`,
            betterDiscoveryNeedsProof
                ? 'higher_ranked_discovery_candidate_requires_fresh_functional_proof'
                : input.provedRoute
                  ? 'best_discovery_candidate_has_fresh_functional_proof'
                  : discoveryCandidate
                    ? 'best_metadata_candidate_requires_fresh_functional_proof'
                    : 'no_eligible_discovery_candidate',
            currentMatchesProved ? 'current_route_already_best_proved' : 'same_session_continuity_required',
        ],
        nextAction,
    };
}

/**
 * @param {unknown} objective
 * @returns {string | null}
 */
function guideObjectivePhase(objective) {
    switch (objective) {
        case 'overview':
            return 'readiness';
        case 'catalog':
            return 'catalog';
        case 'route':
            return 'route';
        case 'probe':
            return 'runtime-proof';
        case 'same_session_switch':
        case 'runtime_reconcile':
            return 'same-session-runtime';
        case 'profile':
            return 'byok-profile';
        case 'live_validation':
            return 'operations';
        default:
            return null;
    }
}

export const modelGatewayOverviewTool = buildTool({
    name: 'model_gateway_overview',
    description:
        'Inspeciona rapidamente catálogo, BYOK, freshness, readiness, modelo efetivo e capabilities do runtime alvo. ' +
        'Use antes de planejar refresh ou troca. Não chama providers e não altera estado.',
    instructions:
        'Use esta tool como primeira etapa de gestão de modelos. Trate ok=false como atenção operacional, leia warnings ' +
        'e nextActions, e não assuma que readiness estrutural significa que uma troca live está autorizada. Informe ' +
        'runtimeId quando operar fora do runtime default.',
    parameters: MODEL_GATEWAY_OVERVIEW_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: false,
    handler: async (args) => {
        const targetRuntimeId = optionalToolString(args['runtimeId']);
        const overview = await createModelGatewayReadControlPlane().inspectOverview({
            ...args,
            runtimeId: targetRuntimeId,
        });
        const control = requireRuntimeControl();
        const runtime = control.readCapabilities(targetRuntimeId);
        const model = control.readStats(targetRuntimeId);
        return serializeResult(withRuntimeOverview(overview, { ...runtime, model }));
    },
});

export const modelGatewayControlPlaneGuideTool = buildTool({
    name: 'model_gateway_control_plane_guide',
    description:
        'Explica para a LLM-B como operar o control-plane local do model-gateway: tools por fase, invariantes BYOK, ' +
        'troca same-session, probes, catálogo, perfis e observação via terminal. Não lê provider e não altera estado.',
    instructions:
        'Use antes do primeiro workflow amplo ou quando estiver em dúvida sobre qual tool chamar. Depois use ' +
        'model_gateway_workflow_plan para gerar argumentos concretos. Esta guia é normativa para a superfície local: ' +
        'troca de modelo/provider deve preservar a sessão por padrão; nova sessão só com pedido humano explícito. ' +
        'Se uma troca retornar automaticContinuation.armed=true, encerre o turno sem novas tools de rota.',
    parameters: MODEL_GATEWAY_CONTROL_PLANE_GUIDE_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: false,
    handler: async (args) => {
        const includeAll = args.objective === 'all';
        const objectivePhase = guideObjectivePhase(args.objective);
        const phases = MODEL_GATEWAY_CONTROL_PLANE_TOOL_MATRIX.filter(
            (phase) => includeAll || phase.phase === objectivePhase || phase.phase === 'readiness',
        );
        const terminalCommands = args.includeTerminalCommands
            ? [
                  '/byok',
                  '/byok models',
                  '/byok models route',
                  '/byok probe chat',
                  '/byok probe streaming',
                  '/byok probe json',
                  '/byok probe agent',
                  '/byok probe shortlist',
                  '/session sdk',
                  '/sdk tools',
                  '/events 100 --json compact',
                  '/errors 10',
                  '/metrics',
              ]
            : [];
        const applyExamples = args.includeApplyExamples
            ? {
                  probeExecuteApply: {
                      tool: 'model_gateway_probe_execute',
                      args: {
                          mode: 'apply',
                          probeKind: 'agent',
                          providerId: '<provider-id>',
                          modelId: '<provider-model>',
                          profileId: null,
                          maxEstimatedCostUsd: 10,
                          unknownCostPolicy: 'allow',
                          timeoutMs: 60000,
                          idempotencyKey: '<stable-workflow-key>:probe-chat',
                          confirm: true,
                      },
                  },
                  routeSwitchApply: {
                      tool: 'model_gateway_route_switch',
                      args: {
                          mode: 'apply',
                          route: '<copy selectedRoute from model_gateway_route_plan or model_gateway_workflow_plan>',
                          runtimeId: null,
                          timeoutMs: 60000,
                          idempotencyKey: '<stable-workflow-key>:route-switch',
                          confirm: true,
                      },
                  },
                  modelSwitchApply: {
                      tool: 'model_gateway_model_switch',
                      args: {
                          mode: 'apply',
                          modelId: '<provider-model>',
                          runtimeId: null,
                          idempotencyKey: '<stable-workflow-key>:model-switch',
                          confirm: true,
                      },
                  },
              }
            : {};

        return serializeResult(
            createModelGatewayControlPlaneResult({
                operation: 'control-plane.guide',
                status: 'ready',
                dryRun: true,
                data: {
                    objective: args.objective,
                    recommendedEntryPoint: 'model_gateway_workflow_plan',
                    phases,
                    invariants: {
                        unifiedSurface: true,
                        sameSessionByDefault: true,
                        newSessionOnlyWhenExplicitlyRequested: true,
                        providerRouteSwitchUsesSameSessionReattach: true,
                        deferredRouteSwitchOwnedByAgentAfterDialogTurnEnd: true,
                        llmMustNotRetryArmedRouteSwitchInSameTurn: true,
                        applyRequiresConfirmTrue: true,
                        inlineSecretsForbidden: true,
                        catalogMetadataIsNotRuntimeProof: true,
                        stalePositiveProofIsNotCurrentProof: true,
                        recentFailureMayBlockButOldFailureIsReprobeable: true,
                        qualityFirstDoesNotPenalizePrice: true,
                        rerankAfterEveryProbeResult: true,
                    },
                    turnBoundaryProtocol: {
                        armedResultField: 'data.automaticContinuation.armed',
                        armedResultValue: true,
                        llmAction: 'finish_current_turn_without_additional_route_tools',
                        runtimeOwner: 'agent_runtime',
                        runtimeTrigger: 'dialog.turn_end',
                        nextTurnVerificationTool: 'model_gateway_operation_status',
                    },
                    defaultSequence: [
                        'model_gateway_control_plane_guide',
                        'model_gateway_overview',
                        'model_gateway_workflow_plan: read selectionDecision first',
                        'when probe_required: model_gateway_probe_execute:plan for current top candidate',
                        'model_gateway_probe_execute:apply',
                        'rerun model_gateway_workflow_plan after every probe result',
                        'continue automatically with the newly top-ranked candidate when still probe_required',
                        'only when switch_recommended: model_gateway_route_switch:plan or model_gateway_model_switch:plan',
                        'model_gateway_route_switch:apply or model_gateway_model_switch:apply',
                        'finish current turn when automaticContinuation.armed=true',
                        'model_gateway_operation_status on a later turn',
                    ],
                    terminalCommands,
                    applyExamples,
                    liveValidation: {
                        runner: 'node scripts/model-gateway/run.mjs llmBLiveTest',
                        byokRealNoPrProfile:
                            '--no-pr --byok-real --byok-real-route-execute --byok-real-route-allow-probe --reuse-sdk-session',
                        requiredObservation:
                            'mesmo sessionId, route/model switch committed, /metrics sem erros e /errors 10 vazio',
                    },
                },
                warnings: [],
                errors: [],
                nextActions: ['call_model_gateway_workflow_plan', 'keep_same_session_boundary', 'use_confirmed_apply_only_after_plan'],
            }),
        );
    },
});

export const modelGatewayWorkflowPlanTool = buildTool({
    name: 'model_gateway_workflow_plan',
    description:
        'É o cérebro read-only de seleção da LLM-B: separa ranking por capacidade/qualidade de certificação runtime, ' +
        'explica a decisão, prepara probes adaptativos em ordem e só planeja promoção same-session quando já existe prova fresca.',
    instructions:
        'Use como ponto de entrada de seleção e operação. Para máxima qualidade sem restrição de custo use ' +
        'selectionGoal=quality_first, probeStrategy=aggressive, requireRuntimeProof=true e agent entre preferredProbeKinds ' +
        'para perfis agente. A resposta é compacta por padrão; use includeDetailedEvidence=true somente para diagnóstico profundo. ' +
        'Se selectionDecision.status=probe_required, execute somente a candidata #1 atual e rode workflow_plan novamente após esse ' +
        'resultado antes de tocar na próxima candidata ou fazer switch. Calls mode=apply exigem confirm=true. Se uma troca retornar ' +
        'automaticContinuation.armed=true, encerre o turno e verifique em turno posterior. Nunca crie sessão nova por fallback.',
    parameters: MODEL_GATEWAY_WORKFLOW_PLAN_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: false,
    handler: async (args) => {
        const readPlane = createModelGatewayReadControlPlane();
        const overview = await readPlane.inspectOverview({
            maxSnapshotAgeHours: args.maxSnapshotAgeHours,
            operationLimit: 10,
        });
        const runtimeId = optionalWorkflowString(args.runtimeId);
        const preferredProviderId = optionalWorkflowString(args.providerId);
        const selectionGoal = optionalWorkflowString(args.selectionGoal) ?? 'balanced';
        const probeStrategy = optionalWorkflowString(args.probeStrategy) ?? 'balanced';
        const maxRuntimeProofAgeHours =
            typeof args.maxRuntimeProofAgeHours === 'number' ? args.maxRuntimeProofAgeHours : 24;
        const maxRuntimeProofAgeMs = maxRuntimeProofAgeHours * 60 * 60 * 1000;
        const rankingWeights = selectionGoalRouteOptions(selectionGoal);
        const discoveryRoutePlan = await readPlane.planRoute({
            taskProfile: args.taskProfile,
            maxCandidates: args.maxCandidates,
            evaluateEligibility: true,
            requireAgentProbeOk: false,
            requireRuntimeProof: false,
            maxRuntimeProofAgeMs,
            ...rankingWeights,
        });
        const provedRoutePlan = await readPlane.planRoute({
            taskProfile: args.taskProfile,
            maxCandidates: args.maxCandidates,
            evaluateEligibility: true,
            ...(args.requireRuntimeProof ? { requireRuntimeProof: true } : {}),
            maxRuntimeProofAgeMs,
            ...rankingWeights,
        });
        const routeData = operationData(discoveryRoutePlan);
        const provedRouteData = operationData(provedRoutePlan);
        const discoverySelectedRoute = normalizeWorkflowRoute(asRecord(routeData['selectedRoute']));
        const provedSelectedRoute = normalizeWorkflowRoute(asRecord(provedRouteData['selectedRoute']));
        const candidateModelIds = Array.isArray(args.candidateModelIds) ? args.candidateModelIds.map(String) : [];
        const probeCandidates = buildWorkflowProbeCandidateChain(routeData, {
            candidateModelIds,
            providerId: preferredProviderId,
            maxCandidates: args.maxCandidates,
            probeStrategy,
        });
        const currentRuntime = readOptionalRuntimeCurrentModel(runtimeId);
        const selectionDecision = buildWorkflowSelectionDecision({
            runtimeId,
            taskProfile: args.taskProfile,
            selectionGoal,
            requireRuntimeProof: args.requireRuntimeProof,
            maxRuntimeProofAgeHours,
            currentModel: currentRuntime.currentModel,
            discoveryRoute: discoverySelectedRoute,
            provedRoute: provedSelectedRoute,
            candidates: probeCandidates,
        });
        const selectedRoute = provedSelectedRoute ?? (args.requireRuntimeProof ? null : discoverySelectedRoute);
        const selectedProviderId = optionalWorkflowString(selectedRoute?.['providerId']);
        const selectedModelId = optionalWorkflowString(selectedRoute?.['providerModel']);
        const modelIds = probeCandidates.map((candidate) => String(candidate['providerModel']));
        const firstProbeCandidate = probeCandidates[0] ?? null;
        const providerForProbe = optionalWorkflowString(firstProbeCandidate?.['providerId']);
        const probeModelId = optionalWorkflowString(firstProbeCandidate?.['providerModel']);
        const shouldPlanCatalogRefresh = args.includeCatalogRefreshPlan || args.objective === 'catalog_refresh';
        const shouldPlanProbes =
            probeCandidates.length > 0 &&
            (selectionDecision.status === 'probe_required' ||
                args.objective === 'probe_shortlist' ||
                (!provedSelectedRoute &&
                    (args.objective === 'same_session_model_switch' ||
                        args.objective === 'same_session_route_switch' ||
                        args.objective === 'runtime_reconcile')));

        const modelEvaluation =
            modelIds.length > 0
                ? await readPlane.evaluateModels({
                      modelIds,
                      taskProfile: args.taskProfile,
                      maxResults: args.maxCandidates,
                  })
                : null;
        const probePlan =
            shouldPlanProbes && providerForProbe && probeModelId
                ? await readPlane.planProbes({
                      modelIds: [probeModelId],
                      providerId: providerForProbe,
                      allowedProbeKinds: args.preferredProbeKinds,
                      maxProbeCount: Math.min(args.maxProbeCount, args.preferredProbeKinds.length),
                      maxEstimatedCostUsd: args.maxEstimatedCostUsd,
                      unknownCostPolicy: selectionGoal === 'quality_first' ? 'allow' : 'skip',
                      recommendationLimit: args.maxCandidates,
                      probeFailureCooldownSeconds: 900,
                  })
                : null;
        const catalogRefreshPlan = shouldPlanCatalogRefresh
            ? await createModelGatewayCatalogControlPlane().planRefresh({
                  includePublic: true,
                  includeAuthenticated: false,
                  force: false,
                  sourceIds: [],
                  maxSourceResults: 10,
              })
            : null;

        /** @type {Record<string, unknown>[]} */
        const steps = [];
        let order = 1;
        steps.push(
            workflowStep(order++, 'overview', 'model_gateway_overview', 'read', 'Inspecionar readiness, BYOK, catálogo e runtime alvo.', {
                runtimeId,
                maxSnapshotAgeHours: args.maxSnapshotAgeHours,
                operationLimit: 10,
            }),
        );
        if (shouldPlanCatalogRefresh) {
            steps.push(
                workflowStep(
                    order++,
                    'catalog_refresh_plan',
                    'model_gateway_catalog_refresh',
                    'plan',
                    'Planejar coleta incremental do catálogo sem rede no planejamento.',
                    {
                        mode: 'plan',
                        includePublic: true,
                        includeAuthenticated: false,
                        force: false,
                        sourceIds: [],
                        refreshAccountOverlays: false,
                        maxSourceResults: 10,
                        idempotencyKey: workflowIdempotencyKey(args.idempotencyKeyPrefix, 'catalog-refresh'),
                        confirm: false,
                    },
                    ['overview'],
                ),
            );
        }
        steps.push(
            workflowStep(
                order++,
                'route_plan',
                'model_gateway_route_plan',
                'read',
                'Rankear as melhores candidatas por capacidade/qualidade sem confundir ausência de prova fresca com inelegibilidade.',
                {
                    taskProfile: args.taskProfile,
                    maxCandidates: args.maxCandidates,
                    evaluateEligibility: true,
                    selectionGoal,
                    proofPolicy: 'metadata_only',
                    maxRuntimeProofAgeHours,
                },
            ),
        );
        steps.push(
            workflowStep(
                order++,
                'route_proved_plan',
                'model_gateway_route_plan',
                'read',
                'Separar as rotas já certificadas pelo contrato funcional atual das candidatas que ainda precisam de probe.',
                {
                    taskProfile: args.taskProfile,
                    maxCandidates: args.maxCandidates,
                    evaluateEligibility: true,
                    selectionGoal,
                    proofPolicy: args.requireRuntimeProof ? 'fresh_runtime_required' : 'task_default',
                    maxRuntimeProofAgeHours,
                },
                ['route_plan'],
            ),
        );
        if (modelIds.length > 0) {
            steps.push(
                workflowStep(
                    order++,
                    'model_evaluate',
                    'model_gateway_model_evaluate',
                    'read',
                    'Comparar candidatos contra elegibilidade, custo e capacidades locais.',
                    {
                        modelIds,
                        taskProfile: args.taskProfile,
                        maxResults: args.maxCandidates,
                    },
                    ['route_plan'],
                ),
            );
        }
        if (shouldPlanProbes && providerForProbe) {
            steps.push(
                workflowStep(
                    order++,
                    'probe_plan',
                    'model_gateway_probe_plan',
                    'read',
                    'Planejar sondas descartáveis com orçamento e cooldown antes de qualquer promoção.',
                    {
                        modelIds: probeModelId ? [probeModelId] : [],
                        providerId: providerForProbe,
                        allowedProbeKinds: args.preferredProbeKinds,
                        maxProbeCount: Math.min(args.maxProbeCount, args.preferredProbeKinds.length),
                        maxEstimatedCostUsd: args.maxEstimatedCostUsd,
                        unknownCostPolicy: selectionGoal === 'quality_first' ? 'allow' : 'skip',
                        recommendationLimit: args.maxCandidates,
                        probeFailureCooldownSeconds: 900,
                    },
                    ['model_evaluate'],
                ),
            );
        }

        /** @type {string[]} */
        const runtimeProofStepIds = [];
        if (shouldPlanProbes && firstProbeCandidate) {
            const candidateRank = Number(firstProbeCandidate['rank'] ?? 1);
            const candidateProviderId = String(firstProbeCandidate['providerId']);
            const candidateModelId = String(firstProbeCandidate['providerModel']);
            const probeKinds = args.preferredProbeKinds.slice(0, args.maxProbeCount);
            for (const probeKind of probeKinds) {
                const suffix = `probe-r${candidateRank}-${probeKind}-${candidateProviderId}-${candidateModelId}`;
                const idSuffix = `r${candidateRank}_${cleanWorkflowKeyPart(probeKind)}`;
                const planId = `probe_execute_plan_${idSuffix}`;
                const applyId = `probe_execute_apply_${idSuffix}`;
                const commonProbeArgs = {
                    probeKind,
                    providerId: candidateProviderId,
                    modelId: candidateModelId,
                    maxEstimatedCostUsd: args.maxEstimatedCostUsd,
                    unknownCostPolicy: selectionGoal === 'quality_first' ? 'allow' : 'skip',
                    timeoutMs: 60000,
                    idempotencyKey: workflowIdempotencyKey(args.idempotencyKeyPrefix, suffix),
                };
                const planStep = workflowStep(
                    order++,
                    planId,
                    'model_gateway_probe_execute',
                    'plan',
                    `Planejar sonda ${probeKind} para a melhor candidata atual #${candidateRank} ${candidateProviderId}/${candidateModelId}.`,
                    { ...commonProbeArgs, mode: 'plan', confirm: false },
                    ['model_evaluate'],
                );
                planStep['adaptiveSelection'] = {
                    candidateRank,
                    candidateChainVisible: true,
                    recalculateAfterApply: true,
                };
                steps.push(planStep);
                const applyStep = workflowStep(
                    order++,
                    applyId,
                    'model_gateway_probe_execute',
                    'apply',
                    `Executar sonda ${probeKind}; depois do resultado, recalcular imediatamente o workflow antes de sondar outra candidata ou promover a rota.`,
                    { ...commonProbeArgs, mode: 'apply', confirm: true },
                    [planId],
                );
                applyStep['adaptiveSelection'] = {
                    candidateRank,
                    onSuccess: 'rerun_model_gateway_workflow_plan_before_switch',
                    onFailure: 'rerun_model_gateway_workflow_plan_and_continue_without_user_prompt',
                };
                steps.push(applyStep);
                runtimeProofStepIds.push(applyId);
            }
        }

        const switchRequires = ['route_proved_plan'];
        if ((args.includeRouteSwitchPlan || args.objective === 'same_session_route_switch') && selectedRoute) {
            const routeKey = workflowIdempotencyKey(
                args.idempotencyKeyPrefix,
                `route-switch-${selectedRoute['providerId']}-${selectedRoute['providerModel']}`,
            );
            steps.push(
                workflowStep(
                    order++,
                    'route_switch_plan',
                    'model_gateway_route_switch',
                    'plan',
                    'Planejar rebind de provider/model preservando o mesmo sessionId.',
                    {
                        mode: 'plan',
                        route: selectedRoute,
                        runtimeId,
                        timeoutMs: 60000,
                        idempotencyKey: routeKey,
                        confirm: false,
                    },
                    switchRequires,
                ),
            );
            steps.push(
                workflowStep(
                    order++,
                    'route_switch_apply',
                    'model_gateway_route_switch',
                    'apply',
                    'Aplicar rebind same-session apenas se o plano e as provas exigidas estiverem aprovados.',
                    {
                        mode: 'apply',
                        route: selectedRoute,
                        runtimeId,
                        timeoutMs: 60000,
                        idempotencyKey: routeKey,
                        confirm: true,
                    },
                    ['route_switch_plan'],
                ),
            );
            const postTurnStatusStep = workflowStep(
                order++,
                'route_switch_post_turn_status',
                'model_gateway_operation_status',
                'read',
                'Confirmar o resultado em um turno posterior; esta etapa não pertence ao mesmo turno do apply.',
                {
                    operationId: createModelGatewaySameSessionRouteSwitchOperationId(routeKey),
                    limit: 10,
                },
                ['route_switch_apply'],
            );
            postTurnStatusStep['notBefore'] = 'next_llm_turn_after_dialog.turn_end';
            postTurnStatusStep['sameTurnExecutionForbidden'] = true;
            postTurnStatusStep['automaticPredecessor'] = 'agent_runtime_turn_boundary_promotion';
            steps.push(postTurnStatusStep);
        }
        if (args.objective === 'same_session_model_switch' && selectedModelId) {
            const switchKey = workflowIdempotencyKey(args.idempotencyKeyPrefix, `model-switch-${selectedModelId}`);
            steps.push(
                workflowStep(
                    order++,
                    'model_switch_plan',
                    'model_gateway_model_switch',
                    'plan',
                    'Planejar troca transacional de modelo no runtime vivo sem nova sessão.',
                    {
                        mode: 'plan',
                        modelId: selectedModelId,
                        runtimeId,
                        idempotencyKey: switchKey,
                        confirm: false,
                    },
                    switchRequires,
                ),
            );
            steps.push(
                workflowStep(
                    order++,
                    'model_switch_apply',
                    'model_gateway_model_switch',
                    'apply',
                    'Aplicar troca same-session apenas depois da revisão e das provas exigidas.',
                    {
                        mode: 'apply',
                        modelId: selectedModelId,
                        runtimeId,
                        idempotencyKey: switchKey,
                        confirm: true,
                    },
                    ['model_switch_plan'],
                ),
            );
        }
        if (args.objective === 'runtime_reconcile' && selectedModelId) {
            const reconcileKey = workflowIdempotencyKey(args.idempotencyKeyPrefix, `runtime-reconcile-${selectedModelId}`);
            steps.push(
                workflowStep(
                    order++,
                    'runtime_reconcile_plan',
                    'model_gateway_runtime_reconcile',
                    'plan',
                    'Planejar convergência entre modelo efetivo e modelo esperado.',
                    {
                        mode: 'plan',
                        expectedModelId: selectedModelId,
                        runtimeId,
                        idempotencyKey: reconcileKey,
                        confirm: false,
                    },
                    switchRequires,
                ),
            );
            steps.push(
                workflowStep(
                    order++,
                    'runtime_reconcile_apply',
                    'model_gateway_runtime_reconcile',
                    'apply',
                    'Aplicar reconcile confirmado usando a operação transacional existente.',
                    {
                        mode: 'apply',
                        expectedModelId: selectedModelId,
                        runtimeId,
                        idempotencyKey: reconcileKey,
                        confirm: true,
                    },
                    ['runtime_reconcile_plan'],
                ),
            );
        }
        if (args.objective === 'profile_management') {
            steps.push(
                workflowStep(
                    order,
                    'profile_manage_template',
                    'model_gateway_profile_manage',
                    'plan',
                    'Template para gerir perfis BYOK com segredo sempre referenciado por env, nunca inline.',
                    {
                        mode: 'plan',
                        operation: 'upsert',
                        profileName: '<profile-name>',
                        profile: {
                            providerId: providerForProbe ?? '<provider-id>',
                            apiKeyEnv: '<ENV_VAR_NAME>',
                            baseUrl: '<optional-base-url>',
                        },
                        idempotencyKey: workflowIdempotencyKey(args.idempotencyKeyPrefix, 'profile-manage-profile-name'),
                        confirm: false,
                    },
                    ['overview'],
                ),
            );
        }

        const warnings = [
            ...resultWarnings(overview),
            ...resultWarnings(discoveryRoutePlan),
            ...resultWarnings(provedRoutePlan),
            ...(modelEvaluation ? resultWarnings(modelEvaluation) : []),
            ...(probePlan ? resultWarnings(probePlan) : []),
            ...(catalogRefreshPlan ? resultWarnings(catalogRefreshPlan) : []),
            ...(selectionDecision.status === 'probe_required' ? ['fresh_runtime_proof_required_before_promotion'] : []),
            ...(shouldPlanProbes && !providerForProbe ? ['probe_provider_missing'] : []),
            ...(selectionDecision.status === 'probe_required' && runtimeProofStepIds.length === 0
                ? ['runtime_proof_required_but_no_probe_apply_step_planned']
                : []),
        ];
        const compactEvidence = {
            detailLevel: 'compact',
            overview: {
                ok: overview['ok'] === true,
                status: optionalWorkflowString(overview['status']),
                warningCount: resultWarnings(overview).length,
            },
            discovery: {
                selectedRoute: discoverySelectedRoute,
                candidateCount: Array.isArray(routeData['candidates']) ? routeData['candidates'].length : 0,
                topCandidates: probeCandidates.slice(0, 4),
            },
            proved: {
                selectedRoute: provedSelectedRoute,
                candidateCount: Array.isArray(provedRouteData['candidates']) ? provedRouteData['candidates'].length : 0,
                available: Boolean(provedSelectedRoute),
            },
            modelEvaluation: modelEvaluation
                ? {
                      included: true,
                      status: optionalWorkflowString(modelEvaluation['status']),
                      warningCount: resultWarnings(modelEvaluation).length,
                  }
                : null,
            probePlan: probePlan
                ? {
                      included: true,
                      status: optionalWorkflowString(probePlan['status']),
                      warningCount: resultWarnings(probePlan).length,
                  }
                : null,
            catalogRefreshPlan: catalogRefreshPlan
                ? {
                      included: true,
                      status: optionalWorkflowString(catalogRefreshPlan['status']),
                      warningCount: resultWarnings(catalogRefreshPlan).length,
                  }
                : null,
        };
        const detailedEvidence = args.includeDetailedEvidence
            ? {
                  overview: operationData(overview),
                  discoveryRoutePlan: routeData,
                  provedRoutePlan: provedRouteData,
                  modelEvaluation: modelEvaluation ? operationData(modelEvaluation) : null,
                  probePlan: probePlan ? operationData(probePlan) : null,
                  catalogRefreshPlan: catalogRefreshPlan ? operationData(catalogRefreshPlan) : null,
              }
            : null;
        const switchingObjective = ['same_session_model_switch', 'same_session_route_switch', 'runtime_reconcile'].includes(
            args.objective,
        );
        const errors = [];
        if (switchingObjective && selectionDecision.status === 'blocked') {
            errors.push({
                code: 'MODEL_GATEWAY_WORKFLOW_TARGET_MODEL_MISSING',
                message: 'Nenhuma candidata elegível foi encontrada para provar e depois promover no runtime.',
                retryable: true,
            });
        }
        if (
            (args.includeRouteSwitchPlan || args.objective === 'same_session_route_switch') &&
            selectionDecision.status === 'blocked'
        ) {
            errors.push({
                code: 'MODEL_GATEWAY_WORKFLOW_TARGET_ROUTE_MISSING',
                message: 'Nenhuma rota estruturada elegível está disponível para model_gateway_route_switch.',
                retryable: true,
            });
        }

        return serializeResult(
            createModelGatewayControlPlaneResult({
                operation: 'workflow.plan',
                ok: errors.length === 0,
                status:
                    errors.length > 0
                        ? 'attention_required'
                        : selectionDecision.status === 'probe_required'
                          ? 'planned_probe_required'
                          : selectionDecision.status === 'switch_recommended'
                            ? 'planned_switch_recommended'
                            : selectionDecision.status === 'use_current'
                              ? 'planned_use_current'
                              : 'planned',
                dryRun: true,
                data: {
                    objective: args.objective,
                    taskProfile: args.taskProfile,
                    runtimeId,
                    selectionGoal,
                    probeStrategy,
                    maxRuntimeProofAgeHours,
                    selectionDecision,
                    selectedRoute,
                    selectedProviderId,
                    selectedModelId,
                    providerForProbe,
                    modelIds,
                    probeCandidates,
                    steps,
                    guardrails: {
                        sameSessionRequired: true,
                        requiresNewSession: false,
                        explicitNewSessionOnly: true,
                        applyStepsRequireConfirmTrue: true,
                        routeSwitchTool: 'model_gateway_route_switch',
                        modelSwitchTool: 'model_gateway_model_switch',
                    },
                    evidence: compactEvidence,
                    evidenceDetail: args.includeDetailedEvidence ? 'detailed' : 'compact',
                    detailedEvidence,
                },
                warnings,
                errors,
                nextActions:
                    errors.length > 0
                        ? ['refresh_catalog_or_adjust_candidates', 'rerun_workflow_plan']
                        : selectionDecision.status === 'probe_required'
                          ? [
                                'probe_current_top_ranked_candidate',
                                'rerun_workflow_plan_after_every_probe_result',
                                'continue_automatically_to_new_top_candidate_when_needed',
                                'do_not_create_new_session',
                            ]
                          : selectionDecision.status === 'switch_recommended'
                            ? ['review_same_session_switch_plan', 'apply_confirmed_switch', 'do_not_create_new_session']
                            : ['continue_with_current_route', 'do_not_create_new_session'],
            }),
        );
    },
});

export const modelGatewayCatalogSearchTool = buildTool({
    name: 'model_gateway_catalog_search',
    description:
        'Busca o catálogo canônico por provider, modelo, elegibilidade e capacidades. Use para formar uma shortlist; ' +
        'não prova saúde live, não chama rede e limita a resposta.',
    instructions:
        'Passe null em filtros textuais não usados e todos os booleanos explicitamente. Use os resultados como candidatos, ' +
        'não como autorização de troca; em seguida chame model_gateway_route_plan.',
    parameters: MODEL_GATEWAY_CATALOG_SEARCH_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: false,
    handler: async (args) => serializeResult(await createModelGatewayReadControlPlane().searchCatalog(args)),
});

export const modelGatewayRoutePlanTool = buildTool({
    name: 'model_gateway_route_plan',
    description:
        'Gera um ranking read-only explicável para um perfil de tarefa. Permite separar melhor candidato por metadata ' +
        'de melhor candidato já provado em runtime e escolher pesos quality/balanced/latency/cost. Não troca modelo nem executa probes.',
    instructions:
        'Use proofPolicy=metadata_only para descobrir o melhor candidato sem confundir falta de prova com inelegibilidade; ' +
        'use task_default ou fresh_runtime_required para certificação operacional. Quando custo não limitar a escolha, use ' +
        'selectionGoal=quality_first. Resultado dry-run nunca significa troca aplicada.',
    parameters: MODEL_GATEWAY_ROUTE_PLAN_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: false,
    handler: async (args) => {
        const selectionGoal = optionalWorkflowString(args.selectionGoal) ?? 'balanced';
        const proofPolicy = optionalWorkflowString(args.proofPolicy) ?? 'task_default';
        const maxRuntimeProofAgeHours =
            typeof args.maxRuntimeProofAgeHours === 'number' ? args.maxRuntimeProofAgeHours : 24;
        return serializeResult(
            await createModelGatewayReadControlPlane().planRoute({
                taskProfile: args.taskProfile,
                maxCandidates: args.maxCandidates,
                evaluateEligibility: args.evaluateEligibility,
                ...selectionGoalRouteOptions(selectionGoal),
                ...routeProofPolicyOptions(proofPolicy),
                maxRuntimeProofAgeMs: maxRuntimeProofAgeHours * 60 * 60 * 1000,
            }),
        );
    },
});

export const modelGatewayOperationStatusTool = buildTool({
    name: 'model_gateway_operation_status',
    description:
        'Consulta decisões, handoffs e confirmações persistidas por correlation id ou lista registros recentes. ' +
        'Use para verificar o que realmente ocorreu, sem alterar runtime.',
    instructions:
        'Passe operationId=null para histórico recente. Para uma operação específica, use o id exato retornado por outra ' +
        'superfície e trate status=not_found como ausência de evidência, não como sucesso.',
    parameters: MODEL_GATEWAY_OPERATION_STATUS_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: false,
    handler: async (args) =>
        serializeResult(
            await createModelGatewayReadControlPlane().inspectOperation({
                ...args,
                operationId: optionalToolString(args['operationId']),
            }),
        ),
});

export const modelGatewayModelEvaluateTool = buildTool({
    name: 'model_gateway_model_evaluate',
    description:
        'Avalia modelos específicos contra um perfil de tarefa usando catálogo, rota, elegibilidade, custo e capacidades. ' +
        'Não chama providers, não executa probes e não altera o runtime.',
    instructions:
        'Use ids retornados por catalog_search. Compare score, included, positiveReasons e rejectedReasons; depois use ' +
        'route_plan antes de qualquer troca.',
    parameters: MODEL_GATEWAY_MODEL_EVALUATE_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: false,
    handler: async (args) => serializeResult(await createModelGatewayReadControlPlane().evaluateModels(args)),
});

export const modelGatewayPolicyProposeTool = buildTool({
    name: 'model_gateway_policy_propose',
    description:
        'Propõe uma mudança revisável na política de automação usando política efetiva, rota e avaliação de modelos. ' +
        'É estritamente read-only: nunca grava policy, nunca troca modelo e não oferece modo apply.',
    instructions:
        'Use para formular uma proposta antes de qualquer mudança de política. Trate proposedPatch como recomendação ' +
        'consultiva, revise risks e validation, e nunca afirme que a política foi aplicada. application.supported é sempre false.',
    parameters: MODEL_GATEWAY_POLICY_PROPOSE_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: false,
    handler: async (args) => serializeResult(await createModelGatewayReadControlPlane().proposePolicy(args)),
});

export const modelGatewayProbePlanTool = buildTool({
    name: 'model_gateway_probe_plan',
    description:
        'Planeja probes descartáveis com orçamento de quantidade/custo e freios de rate-limit/cooldown. ' +
        'É read-only: nunca chama provider, nunca cria sessão e nunca grava health.',
    instructions:
        'Use modelIds para uma shortlist explícita ou array vazio para o último diff de catálogo. Prefira ' +
        'unknownCostPolicy=skip, revise backoff.deferred e budget.skipped, e não execute os comandos sem autorização humana.',
    parameters: MODEL_GATEWAY_PROBE_PLAN_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: false,
    handler: async (args) => serializeResult(await createModelGatewayReadControlPlane().planProbes(args)),
});

export const modelGatewayProbeExecuteTool = buildTool({
    name: 'model_gateway_probe_execute',
    description:
        'Planeja ou executa uma única sonda SDK descartável com orçamento, backoff, confirmação e idempotência. ' +
        'apply pode chamar provider e persiste prova redigida, mas nunca troca a sessão viva.',
    instructions:
        'Sempre use mode=plan primeiro. Para repo_agent/tool_agent prefira agent: ele valida geração, tool call, leitura sintética, ' +
        'ask_user e eventos streaming/final em sessão descartável. Só aplique quando o plano selecionar exatamente a sonda; ' +
        'reutilize a mesma idempotencyKey em retries. apply exige confirm=true e nunca é uma troca de modelo.',
    parameters: MODEL_GATEWAY_PROBE_EXECUTE_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: { ...MUTATING_ANNOTATIONS, openWorldHint: true },
    schemaFailurePolicy: 'throw',
    requiresApproval: true,
    handler: async (args) => {
        const operationId = createModelGatewayProbeOperationId(args.idempotencyKey);
        const operationMeta = toolOperationMeta('model_gateway_probe_execute', {
            idempotencyKey: args.idempotencyKey,
            correlationId: operationId,
            expectedResult: args.mode === 'plan' ? 'dry_run_plan' : 'persisted_runtime_probe',
        });
        const replay = args.mode === 'apply' && args.confirm
            ? await readModelGatewayProbeOperation(args.idempotencyKey)
            : null;
        if (replay) {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'probe.execute',
                    ok: replay.ok === true,
                    status: String(replay.status ?? 'failed'),
                    data: {
                        operationId,
                        replayed: true,
                        providerAttempted: replay.providerAttempted,
                        result: replay.result,
                        persistence: replay.persistence,
                        operationMeta,
                    },
                    warnings: replay.ok === true ? ['idempotent_replay'] : ['idempotent_replay_of_failed_probe'],
                    errors:
                        replay.ok === true
                            ? []
                            : [
                                  {
                                      code: 'MODEL_GATEWAY_PROBE_FAILED',
                                      message: String(replay.result?.['status'] ?? replay.status ?? 'unknown'),
                                      retryable: true,
                                  },
                              ],
                    nextActions: ['inspect_operation_status', 'inspect_route_plan'],
                }),
            );
        }
        const plan = await createModelGatewayReadControlPlane().planProbes({
            modelIds: [args.modelId],
            providerId: args.providerId,
            allowedProbeKinds: [args.probeKind],
            maxProbeCount: 1,
            maxEstimatedCostUsd: args.maxEstimatedCostUsd,
            unknownCostPolicy: args.unknownCostPolicy === 'allow' ? 'allow' : 'skip',
            recommendationLimit: 20,
            probeFailureCooldownSeconds: 900,
        });
        const planData = /** @type {Record<string, any>} */ (plan['data']);
        const selected = Array.isArray(planData['budget']?.['selected']) ? planData['budget']['selected'] : [];
        const authorizedByPlan = selected.some((item) => item['kind'] === args.probeKind);
        if (args.mode === 'plan' || !authorizedByPlan) {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'probe.execute',
                    ok: authorizedByPlan,
                    status: authorizedByPlan ? 'planned' : 'blocked_by_probe_plan',
                    dryRun: true,
                    data: {
                        operationId,
                        requested: args,
                        plan: planData,
                        authorizedByPlan,
                        operationMeta,
                    },
                    warnings: Array.isArray(plan['warnings']) ? plan['warnings'].map(String) : [],
                    errors: authorizedByPlan
                        ? []
                        : [
                              {
                                  code: 'MODEL_GATEWAY_PROBE_PLAN_BLOCKED',
                                  message: 'A sonda não passou pelos limites de custo, tipo ou backoff.',
                                  retryable: true,
                              },
                          ],
                    nextActions: authorizedByPlan
                        ? ['review_plan_then_apply_with_confirm_true']
                        : ['review_probe_plan_and_constraints'],
                }),
            );
        }
        if (!args.confirm) {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'probe.execute',
                    ok: false,
                    status: 'confirmation_required',
                    data: { operationId, authorizedByPlan, operationMeta },
                    errors: [
                        {
                            code: 'MODEL_GATEWAY_PROBE_CONFIRMATION_REQUIRED',
                            message: 'mode=apply exige confirm=true.',
                            retryable: true,
                        },
                    ],
                    nextActions: ['review_plan_then_apply_with_confirm_true'],
                }),
            );
        }
        const rawEnv = {
            ...process.env,
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_MODEL: args.modelId,
            ...(args.profileId
                ? { COPILOT_BYOK_PROFILE: args.profileId, COPILOT_BYOK_PROVIDER_PRESET: undefined }
                : { COPILOT_BYOK_PROFILE: undefined, COPILOT_BYOK_PROVIDER_PRESET: args.providerId }),
        };
        const env = materializeModelGatewayActiveByokProfileEnv(rawEnv).env;
        const binding = resolveModelGatewaySessionBinding(env, args.modelId);
        const boundProviderId = binding.gatewayBinding?.providerId ?? null;
        if (!binding.enabled || !binding.ready || boundProviderId !== args.providerId) {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'probe.execute',
                    ok: false,
                    status: 'provider_binding_mismatch',
                    data: {
                        operationId,
                        requestedProviderId: args.providerId,
                        boundProviderId,
                        operationMeta,
                    },
                    errors: [
                        {
                            code: 'MODEL_GATEWAY_PROBE_PROVIDER_BINDING_MISMATCH',
                            message: 'O binding efetivo não corresponde ao provider autorizado pelo plano.',
                            retryable: false,
                        },
                    ],
                    nextActions: ['review_profile_and_provider_binding'],
                }),
            );
        }
        const executed = await executeModelGatewayProbe({
            kind: args.probeKind,
            env,
            model: args.modelId,
            timeoutMs: args.timeoutMs,
            idempotencyKey: args.idempotencyKey,
            source: 'llm-b.model_gateway_probe_execute',
        });
        const actualProviderId = executed.result?.['providerId'] ?? null;
        const providerMatches = actualProviderId === args.providerId;
        const executionOk = executed.ok === true && providerMatches;
        return serializeResult(
            createModelGatewayControlPlaneResult({
                operation: 'probe.execute',
                ok: executionOk,
                status: providerMatches ? String(executed.status ?? 'failed') : 'provider_result_mismatch',
                data: {
                    operationId,
                    replayed: executed.replayed,
                    providerAttempted: executed.providerAttempted,
                    providerMatches,
                    result: executed.result,
                    persistence: executed.persistence,
                    operationMeta,
                },
                warnings: [
                    ...(executed.ok === true ? [] : ['probe_did_not_produce_positive_runtime_proof']),
                    ...(providerMatches ? [] : ['probe_result_provider_mismatch']),
                ],
                errors:
                    executionOk
                        ? []
                        : [
                              {
                                  code: providerMatches
                                      ? 'MODEL_GATEWAY_PROBE_FAILED'
                                      : 'MODEL_GATEWAY_PROBE_RESULT_PROVIDER_MISMATCH',
                                  message: providerMatches
                                      ? String(executed.result?.['status'] ?? executed.status ?? 'unknown')
                                      : `Esperado ${args.providerId}, observado ${String(actualProviderId ?? 'unknown')}.`,
                                  retryable: providerMatches,
                              },
                          ],
                nextActions: ['inspect_operation_status', 'inspect_route_plan'],
            }),
        );
    },
});

export const modelGatewayModelSwitchTool = buildTool({
    name: 'model_gateway_model_switch',
    description:
        'Planeja ou aplica uma troca transacional de modelo no runtime vivo. Use plan primeiro. apply só executa com ' +
        'confirm=true e idempotencyKey estável; a configuração só é commitada após verificação do SDK e falhas tentam rollback.',
    instructions:
        'Sempre chame mode=plan antes de apply. Reutilize exatamente a mesma idempotencyKey ao repetir uma solicitação. ' +
        'Nunca descreva state=rolled_back ou state=failed como sucesso, mesmo que a tool tenha conseguido reconciliar o runtime.',
    parameters: MODEL_GATEWAY_MODEL_SWITCH_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: MUTATING_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: true,
    handler: async (args) => {
        const targetRuntimeId = optionalToolString(args.runtimeId);
        const currentSnapshot = readOptionalRuntimeCurrentModel(targetRuntimeId);
        const current = currentSnapshot.currentModel;
        if (args.mode === 'plan') {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'model.switch',
                    status: 'planned',
                    dryRun: true,
                    data: {
                        runtimeId: targetRuntimeId,
                        previousModel: current,
                        targetModel: args.modelId,
                        sameSessionRequired: true,
                        newSessionFallbackAllowed: false,
                        idempotencyKey: args.idempotencyKey,
                        operationMeta: toolOperationMeta('model_gateway_model_switch', {
                            idempotencyKey: args.idempotencyKey,
                            correlationId: createModelGatewayModelSwitchOperationId(args.idempotencyKey),
                            expectedResult: 'dry_run_plan',
                        }),
                        confirmationRequired: true,
                    },
                    warnings: [
                        ...(args.confirm ? ['confirm_ignored_in_plan_mode'] : []),
                        ...(currentSnapshot.warning ? [currentSnapshot.warning] : []),
                    ],
                    nextActions: ['review_plan_then_apply_with_confirm_true'],
                }),
            );
        }
        if (!args.confirm) {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'model.switch',
                    ok: false,
                    status: 'confirmation_required',
                    data: {
                        runtimeId: targetRuntimeId,
                        previousModel: current,
                        targetModel: args.modelId,
                        sameSessionRequired: true,
                        newSessionFallbackAllowed: false,
                        idempotencyKey: args.idempotencyKey,
                        operationMeta: toolOperationMeta('model_gateway_model_switch', {
                            idempotencyKey: args.idempotencyKey,
                            correlationId: createModelGatewayModelSwitchOperationId(args.idempotencyKey),
                            expectedResult: 'confirmation_required',
                        }),
                    },
                    errors: [
                        {
                            code: 'MODEL_SWITCH_CONFIRMATION_REQUIRED',
                            message: 'mode=apply exige confirm=true.',
                            retryable: true,
                        },
                    ],
                    warnings: currentSnapshot.warning ? [currentSnapshot.warning] : [],
                    nextActions: ['review_plan_then_apply_with_confirm_true'],
                }),
            );
        }
        const control = requireRuntimeControl();
        const projection = await control.switchModel(args.modelId, targetRuntimeId ?? undefined, {
            idempotencyKey: args.idempotencyKey,
            source: 'llm-b.model_gateway_model_switch',
        });
        const operation = projection['operation'];
        const committed = operation['state'] === 'committed';
        return serializeResult(
            createModelGatewayControlPlaneResult({
                operation: 'model.switch',
                ok: committed,
                status: String(operation['state'] ?? 'failed'),
                data: {
                    runtimeId: projection['runtimeId'],
                    previousModel: projection['previousModel'],
                    currentModel: projection['currentModel'],
                    targetModel: args.modelId,
                    sameSessionRequired: true,
                    newSessionFallbackAllowed: false,
                    reasoningAdjusted: projection['reasoningAdjusted'],
                    operation,
                    operationMeta: toolOperationMeta('model_gateway_model_switch', {
                        idempotencyKey: args.idempotencyKey,
                        correlationId: String(operation['operationId'] ?? createModelGatewayModelSwitchOperationId(args.idempotencyKey)),
                        expectedResult: committed ? 'committed' : 'not_committed',
                    }),
                },
                warnings: committed ? [] : [String(operation['error'] ?? 'model_switch_not_committed')],
                errors: committed
                    ? []
                    : [
                          {
                              code: 'MODEL_SWITCH_NOT_COMMITTED',
                              message: String(operation['error'] ?? operation['state'] ?? 'unknown'),
                              retryable: operation['state'] !== 'rolled_back',
                          },
                      ],
                nextActions: committed ? ['inspect_operation_status'] : ['inspect_operation_status', 'review_runtime_state'],
            }),
        );
    },
});

export const modelGatewayRouteSwitchTool = buildTool({
    name: 'model_gateway_route_switch',
    description:
        'Planeja ou aplica troca de provider/rota preservando o mesmo sessionId. Use quando a rota alvo pertence a ' +
        'outro provider. A operação pode reconstruir o transporte e reanexar a sessão, mas nunca cria sessão substituta.',
    instructions:
        'Chame mode=plan antes de apply. Copie a rota estruturada de model_gateway_route_plan, reutilize a mesma ' +
        'idempotencyKey e só aplique com confirm=true. Sucesso pode ser state=committed ou status=accepted_for_turn_boundary. ' +
        'Quando automaticContinuation.armed=true, NÃO chame outra tool de route switch/reconcile no mesmo turno: finalize ' +
        'a resposta para liberar dialog.turn_end; o Agent fará o reattach automaticamente preservando sessionId. ' +
        'requiresNewSession deve permanecer false em qualquer resultado.',
    parameters: MODEL_GATEWAY_ROUTE_SWITCH_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: { ...MUTATING_ANNOTATIONS, openWorldHint: true },
    schemaFailurePolicy: 'throw',
    requiresApproval: true,
    handler: async (args) => {
        const targetRuntimeId = optionalToolString(args.runtimeId);
        const correlationId = createModelGatewaySameSessionRouteSwitchOperationId(args.idempotencyKey);
        if (args.mode === 'plan') {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'route.switch',
                    status: 'planned',
                    dryRun: true,
                    data: {
                        runtimeId: targetRuntimeId,
                        route: args.route,
                        sameSessionRequired: true,
                        requiresNewSession: false,
                        confirmationRequired: true,
                        timeoutMs: args.timeoutMs,
                        operationMeta: toolOperationMeta('model_gateway_route_switch', {
                            idempotencyKey: args.idempotencyKey,
                            correlationId,
                            expectedResult: 'dry_run_plan',
                        }),
                    },
                    warnings: args.confirm ? ['confirm_ignored_in_plan_mode'] : [],
                    nextActions: ['review_plan_then_apply_with_confirm_true'],
                }),
            );
        }
        if (!args.confirm) {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'route.switch',
                    ok: false,
                    status: 'confirmation_required',
                    data: {
                        runtimeId: targetRuntimeId,
                        route: args.route,
                        sameSessionRequired: true,
                        requiresNewSession: false,
                        operationMeta: toolOperationMeta('model_gateway_route_switch', {
                            idempotencyKey: args.idempotencyKey,
                            correlationId,
                            expectedResult: 'confirmation_required',
                        }),
                    },
                    errors: [
                        {
                            code: 'ROUTE_SWITCH_CONFIRMATION_REQUIRED',
                            message: 'mode=apply exige confirm=true.',
                            retryable: true,
                        },
                    ],
                    nextActions: ['review_plan_then_apply_with_confirm_true'],
                }),
            );
        }
        const control = requireRuntimeControl();
        const projection = await control.switchRoute(args.route, targetRuntimeId ?? undefined, {
            idempotencyKey: args.idempotencyKey,
            timeoutMs: args.timeoutMs,
            source: 'llm-b.model_gateway_route_switch',
        });
        const operation = projection['operation'];
        const committed = operation?.['state'] === 'committed';
        const deferred = operation?.['state'] === 'deferred_until_turn_boundary';
        return serializeResult(
            createModelGatewayControlPlaneResult({
                operation: 'route.switch',
                ok: committed || deferred,
                status: deferred ? 'accepted_for_turn_boundary' : String(operation?.['state'] ?? 'failed'),
                data: {
                    ...projection,
                    sameSessionRequired: true,
                    requiresNewSession: false,
                    automaticContinuation: deferred
                        ? {
                              armed: true,
                              owner: 'agent_runtime',
                              trigger: 'dialog.turn_end',
                              requiresFurtherToolCall: false,
                              instruction: 'finish_current_turn_without_retrying_route_tools',
                          }
                        : {
                              armed: false,
                              owner: null,
                              trigger: null,
                              requiresFurtherToolCall: false,
                          },
                    operationMeta: toolOperationMeta('model_gateway_route_switch', {
                        idempotencyKey: args.idempotencyKey,
                        correlationId: String(operation?.['operationId'] ?? correlationId),
                        expectedResult: committed ? 'committed' : deferred ? 'accepted_for_turn_boundary' : 'not_committed',
                    }),
                },
                warnings: committed
                    ? []
                    : deferred
                      ? [
                            'same_session_route_switch_armed_for_dialog_turn_end',
                            String(operation?.['deferReason'] ?? 'active_dialog_loop'),
                        ]
                      : [String(operation?.['error'] ?? 'same_session_route_switch_not_committed')],
                errors:
                    committed || deferred
                        ? []
                        : [
                              {
                                  code: 'SAME_SESSION_ROUTE_SWITCH_NOT_COMMITTED',
                                  message: String(operation?.['error'] ?? operation?.['state'] ?? 'unknown'),
                                  retryable: operation?.['state'] !== 'rolled_back',
                              },
                          ],
                nextActions: deferred
                    ? ['finish_current_turn_without_additional_route_tools', 'inspect_operation_status_on_next_turn']
                    : ['inspect_operation_status', 'inspect_overview'],
            }),
        );
    },
});

export const modelGatewayCatalogRefreshTool = buildTool({
    name: 'model_gateway_catalog_refresh',
    description:
        'Planeja ou aplica coleta incremental do catálogo. plan é local e sem rede; apply pode chamar fontes públicas ' +
        'e autenticadas, atualiza JSON, elegibilidade e mirror SQLite, e exige confirm=true.',
    instructions:
        'Sempre execute mode=plan primeiro. Prefira sourceIds explícitos para reduzir rede e duração. Só use ' +
        'includeAuthenticated=true quando metadados de conta forem necessários. apply exige aprovação e confirm=true.',
    parameters: MODEL_GATEWAY_CATALOG_REFRESH_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: {
        ...MUTATING_ANNOTATIONS,
        idempotentHint: false,
        openWorldHint: true,
    },
    schemaFailurePolicy: 'throw',
    requiresApproval: true,
    handler: async (args) => {
        const common = {
            includePublic: args.includePublic,
            includeAuthenticated: args.includeAuthenticated,
            force: args.force,
            sourceIds: args.sourceIds,
            maxSourceResults: args.maxSourceResults,
        };
        if (args.mode === 'plan') {
            return serializeResult(
                withOperationMeta(
                    await createModelGatewayCatalogControlPlane().planRefresh(common),
                    toolOperationMeta('model_gateway_catalog_refresh', {
                        idempotencyKey: args.idempotencyKey,
                        expectedResult: 'dry_run_plan',
                    }),
                ),
            );
        }
        if (!args.confirm) {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'catalog.refresh',
                    ok: false,
                    status: 'confirmation_required',
                    data: {
                        idempotencyKey: args.idempotencyKey,
                        sourceIds: args.sourceIds,
                        operationMeta: toolOperationMeta('model_gateway_catalog_refresh', {
                            idempotencyKey: args.idempotencyKey,
                            expectedResult: 'confirmation_required',
                        }),
                    },
                    errors: [
                        {
                            code: 'CATALOG_REFRESH_CONFIRMATION_REQUIRED',
                            message: 'mode=apply exige confirm=true.',
                            retryable: true,
                        },
                    ],
                    nextActions: ['review_plan_then_apply_with_confirm_true'],
                }),
            );
        }
        return serializeResult(
            withOperationMeta(
                await createModelGatewayCatalogControlPlane().applyRefresh({
                    ...common,
                    refreshAccountOverlays: args.refreshAccountOverlays,
                    idempotencyKey: args.idempotencyKey,
                }),
                toolOperationMeta('model_gateway_catalog_refresh', {
                    idempotencyKey: args.idempotencyKey,
                    expectedResult: 'committed_or_parity_failed',
                }),
            ),
        );
    },
});

export const modelGatewayRuntimeReconcileTool = buildTool({
    name: 'model_gateway_runtime_reconcile',
    description:
        'Reconcilia modelo efetivo ou uma operação de rota persistida. Para routeOperationId diferido, o apply pode ' +
        'armar a promoção automática no próximo dialog.turn_end, sempre preservando o mesmo sessionId.',
    instructions:
        'Use mode=plan primeiro. Se converged=true, não aplique. Em mismatch, revise o alvo e reutilize a mesma ' +
        'idempotencyKey no apply confirmado. Quando automaticContinuation.armed=true, finalize o turno; não tente ' +
        'reconcile novamente no mesmo tool-turn, pois o Agent executará a promoção pós-turno.',
    parameters: MODEL_GATEWAY_RUNTIME_RECONCILE_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: MUTATING_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: true,
    handler: async (args) => {
        const routeOperationId = optionalToolString(args.routeOperationId);
        if (routeOperationId) {
            const { handoff, operation } = await readRouteSwitchOperation(routeOperationId);
            const operationState = optionalToolString(operation?.['state']) ?? 'missing';
            const targetRoute = operation ? routeSwitchTargetRoute(operation) : null;
            const routeIdempotencyKey =
                optionalToolString(operation?.['idempotencyKey']) ?? args.idempotencyKey;
            const safety = readRouteReattachApplySafety(args.runtimeId);
            const deferred = operationState === 'deferred_until_turn_boundary';
            const committed = operationState === 'committed';
            const deferredClassification = operation
                ? classifyModelGatewayDeferredRouteOperation(operation, { now: Date.now() })
                : null;
            const promotable =
                deferred && targetRoute !== null && deferredClassification?.promotable === true;
            const operationMeta = toolOperationMeta('model_gateway_runtime_reconcile', {
                idempotencyKey: routeIdempotencyKey,
                correlationId: routeOperationId,
                expectedResult: committed
                    ? 'already_converged'
                    : promotable
                      ? 'same_session_route_promotion'
                      : 'route_operation_inspection',
            });

            if (!operation || !targetRoute) {
                return serializeResult(
                    createModelGatewayControlPlaneResult({
                        operation: 'runtime.reconcile',
                        ok: false,
                        status: operation ? 'route_operation_target_missing' : 'route_operation_not_found',
                        dryRun: args.mode === 'plan',
                        data: {
                            runtimeId: args.runtimeId,
                            routeOperationId,
                            handoff,
                            operation,
                            operationMeta,
                        },
                        errors: [
                            {
                                code: operation
                                    ? 'ROUTE_RECONCILE_TARGET_ROUTE_MISSING'
                                    : 'ROUTE_RECONCILE_OPERATION_NOT_FOUND',
                                message: operation
                                    ? 'Operação de route switch não possui targetRoute estruturado para promoção.'
                                    : 'Operação de route switch não encontrada no ledger.',
                                retryable: false,
                            },
                        ],
                        nextActions: ['inspect_operation_status', 'rerun_route_switch_plan'],
                    }),
                );
            }

            if (args.mode === 'plan' || committed || !promotable || (!safety.safe && args.confirm)) {
                const planning = args.mode === 'plan';
                const armedForTurnBoundary = !planning && args.confirm && !committed && promotable && !safety.safe;
                const status = committed
                    ? 'already_converged'
                    : armedForTurnBoundary
                      ? 'route_promotion_armed_for_turn_boundary'
                      : promotable
                        ? 'route_promotion_planned'
                        : 'route_operation_not_promotable';
                return serializeResult(
                    createModelGatewayControlPlaneResult({
                        operation: 'runtime.reconcile',
                        ok: committed || (planning && promotable) || armedForTurnBoundary,
                        status,
                        dryRun: planning,
                        data: {
                            runtimeId: args.runtimeId,
                            expectedModel: args.expectedModelId,
                            routeOperationId,
                            routeOperationState: operationState,
                            targetRoute,
                            routeIdempotencyKey,
                            promotion: {
                                safeNow: safety.safe,
                                reason: safety.reason,
                                requiresNewSession: false,
                                forceApplyDeferred: safety.safe && !planning,
                            },
                            automaticContinuation: armedForTurnBoundary
                                ? {
                                      armed: true,
                                      owner: 'agent_runtime',
                                      trigger: 'dialog.turn_end',
                                      requiresFurtherToolCall: false,
                                      instruction: 'finish_current_turn_without_retrying_route_tools',
                                  }
                                : {
                                      armed: false,
                                      owner: null,
                                      trigger: null,
                                      requiresFurtherToolCall: false,
                                  },
                            deferredClassification,
                            handoff,
                            operation,
                            operationMeta,
                        },
                        warnings: [
                            ...(committed ? ['route_switch_already_committed'] : []),
                            ...(armedForTurnBoundary ? ['route_promotion_owned_by_agent_after_dialog_turn_end'] : []),
                            ...(!committed && promotable && !safety.safe ? [safety.reason] : []),
                            ...(!promotable
                                ? [
                                      deferredClassification?.reason ??
                                          `route_operation_state_not_deferred:${operationState}`,
                                  ]
                                : []),
                        ],
                        errors:
                            args.mode === 'apply' && !committed && !promotable
                                ? [
                                      {
                                          code: 'ROUTE_RECONCILE_OPERATION_NOT_PROMOTABLE',
                                          message:
                                              deferredClassification?.reason ??
                                              `Operação no estado ${operationState} não pode ser promovida automaticamente.`,
                                          retryable: false,
                                      },
                                  ]
                                : [],
                        nextActions: committed
                            ? ['inspect_overview']
                            : armedForTurnBoundary
                              ? [
                                    'finish_current_turn_without_additional_route_tools',
                                    'inspect_operation_status_on_next_turn',
                                ]
                              : promotable
                                ? ['apply_with_confirm_true_to_arm_or_promote_route']
                                : ['inspect_operation_status', 'rerun_route_switch_plan'],
                    }),
                );
            }

            if (!args.confirm) {
                return serializeResult(
                    createModelGatewayControlPlaneResult({
                        operation: 'runtime.reconcile',
                        ok: false,
                        status: 'confirmation_required',
                        data: {
                            runtimeId: args.runtimeId,
                            routeOperationId,
                            routeIdempotencyKey,
                            targetRoute,
                            operationMeta,
                        },
                        errors: [
                            {
                                code: 'RUNTIME_RECONCILE_ROUTE_PROMOTION_CONFIRMATION_REQUIRED',
                                message: 'Promoção de route switch diferido exige mode=apply e confirm=true.',
                                retryable: true,
                            },
                        ],
                        nextActions: ['review_route_operation_then_apply_with_confirm_true'],
                    }),
                );
            }

            const control = requireRuntimeControl();
            const projection = await control.switchRoute(targetRoute, args.runtimeId ?? undefined, {
                idempotencyKey: routeIdempotencyKey,
                source: 'llm-b.model_gateway_runtime_reconcile.route',
                allowActiveDialogLoopReattach: true,
                forceApplyDeferred: true,
            });
            const promotedOperation = asRecord(projection['operation']);
            const routeCommitted = promotedOperation['state'] === 'committed';
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'runtime.reconcile',
                    ok: routeCommitted,
                    status: routeCommitted ? 'route_reconciled' : String(promotedOperation['state'] ?? 'failed'),
                    data: {
                        ...projection,
                        routeOperationId,
                        routeIdempotencyKey,
                        expectedModel: args.expectedModelId,
                        operationMeta,
                    },
                    warnings: routeCommitted ? [] : ['route_runtime_reconcile_not_committed'],
                    errors: routeCommitted
                        ? []
                        : [
                              {
                                  code: 'ROUTE_RUNTIME_RECONCILE_NOT_COMMITTED',
                                  message: String(promotedOperation['error'] ?? promotedOperation['state'] ?? 'unknown'),
                                  retryable: true,
                              },
                          ],
                    nextActions: ['inspect_operation_status', 'inspect_overview'],
                }),
            );
        }

        const currentSnapshot = readOptionalRuntimeCurrentModel(args.runtimeId);
        const current = currentSnapshot.currentModel;
        const converged = currentSnapshot.available && current === args.expectedModelId;
        if (args.mode === 'plan' || converged) {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'runtime.reconcile',
                    status: converged ? 'already_converged' : 'planned',
                    dryRun: args.mode === 'plan',
                    data: {
                        runtimeId: args.runtimeId,
                        currentModel: current,
                        expectedModel: args.expectedModelId,
                        converged,
                        idempotencyKey: args.idempotencyKey,
                        operationMeta: toolOperationMeta('model_gateway_runtime_reconcile', {
                            idempotencyKey: args.idempotencyKey,
                            correlationId: createModelGatewayModelSwitchOperationId(args.idempotencyKey),
                            expectedResult: converged ? 'already_converged' : 'dry_run_plan',
                        }),
                    },
                    warnings: [
                        ...(args.mode === 'apply' && converged ? ['no_effect_required'] : []),
                        ...(currentSnapshot.warning ? [currentSnapshot.warning] : []),
                    ],
                    nextActions: converged ? ['inspect_overview'] : ['review_plan_then_apply_with_confirm_true'],
                }),
            );
        }
        if (!args.confirm) {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'runtime.reconcile',
                    ok: false,
                    status: 'confirmation_required',
                    data: {
                        currentModel: current,
                        expectedModel: args.expectedModelId,
                        operationMeta: toolOperationMeta('model_gateway_runtime_reconcile', {
                            idempotencyKey: args.idempotencyKey,
                            correlationId: createModelGatewayModelSwitchOperationId(args.idempotencyKey),
                            expectedResult: 'confirmation_required',
                        }),
                    },
                    errors: [
                        {
                            code: 'RUNTIME_RECONCILE_CONFIRMATION_REQUIRED',
                            message: 'mode=apply exige confirm=true.',
                            retryable: true,
                        },
                    ],
                    warnings: currentSnapshot.warning ? [currentSnapshot.warning] : [],
                    nextActions: ['review_plan_then_apply_with_confirm_true'],
                }),
            );
        }
        const control = requireRuntimeControl();
        const projection = await control.switchModel(args.expectedModelId, args.runtimeId ?? undefined, {
            idempotencyKey: args.idempotencyKey,
            source: 'llm-b.model_gateway_runtime_reconcile',
        });
        const committed = projection['operation']['state'] === 'committed';
        return serializeResult(
            createModelGatewayControlPlaneResult({
                operation: 'runtime.reconcile',
                ok: committed,
                status: committed ? 'reconciled' : String(projection['operation']['state'] ?? 'failed'),
                data: {
                    ...projection,
                    expectedModel: args.expectedModelId,
                    operationMeta: toolOperationMeta('model_gateway_runtime_reconcile', {
                        idempotencyKey: args.idempotencyKey,
                        correlationId: String(
                            projection['operation']?.['operationId'] ??
                                createModelGatewayModelSwitchOperationId(args.idempotencyKey),
                        ),
                        expectedResult: committed ? 'reconciled' : 'not_committed',
                    }),
                },
                warnings: committed ? [] : ['runtime_reconcile_not_committed'],
                nextActions: ['inspect_operation_status', 'inspect_overview'],
            }),
        );
    },
});

export const modelGatewayMaintenanceTool = buildTool({
    name: 'model_gateway_maintenance',
    description:
        'Planeja ou aplica retenção limitada dos ledgers operacionais SQLite. Nunca remove projeções, evidências ou ' +
        'rotas do catálogo canônico; apply exige confirmação explícita.',
    instructions:
        'Execute plan, revise candidateDeleteRows por tabela e somente então use apply com confirm=true. Não use esta ' +
        'tool para refresh ou correção de catálogo.',
    parameters: MODEL_GATEWAY_MAINTENANCE_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: MUTATING_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: true,
    handler: async (args) => {
        if (args.mode === 'plan') {
            return serializeResult(
                withOperationMeta(
                    await createModelGatewayCatalogControlPlane().planMaintenance(args),
                    toolOperationMeta('model_gateway_maintenance', {
                        correlationId: `maintenance:${args.maxRowsPerLedger}`,
                        expectedResult: 'dry_run_plan',
                    }),
                ),
            );
        }
        if (!args.confirm) {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'maintenance.retention',
                    ok: false,
                    status: 'confirmation_required',
                    data: {
                        maxRowsPerLedger: args.maxRowsPerLedger,
                        operationMeta: toolOperationMeta('model_gateway_maintenance', {
                            correlationId: `maintenance:${args.maxRowsPerLedger}`,
                            expectedResult: 'confirmation_required',
                        }),
                    },
                    errors: [
                        {
                            code: 'MAINTENANCE_CONFIRMATION_REQUIRED',
                            message: 'mode=apply exige confirm=true.',
                            retryable: true,
                        },
                    ],
                    nextActions: ['review_plan_then_apply_with_confirm_true'],
                }),
            );
        }
        return serializeResult(
            withOperationMeta(
                await createModelGatewayCatalogControlPlane().applyMaintenance(args),
                toolOperationMeta('model_gateway_maintenance', {
                    correlationId: `maintenance:${args.maxRowsPerLedger}`,
                    expectedResult: 'committed',
                }),
            ),
        );
    },
});

export const modelGatewayProfileManageTool = buildTool({
    name: 'model_gateway_profile_manage',
    description:
        'Planeja ou aplica gestão estrutural de perfis BYOK no store canônico. upsert escreve um perfil no JSON de ' +
        'perfis; remove apaga um perfil do mesmo registro. A tool atua no processo local e exige confirm=true para apply.',
    instructions:
        'Use mode=plan para revisar o preview redigido antes de tocar o JSON de perfis. Nunca envie apiKey ou ' +
        'bearerToken inline; prefira refs do env. Reutilize a mesma idempotencyKey em retries e trate confirm=false ' +
        'como bloqueio.',
    parameters: MODEL_GATEWAY_PROFILE_MANAGE_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: MUTATING_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: true,
    handler: async (args) => {
        const profileName = String(args.profileName).trim();
        const operationMeta = toolOperationMeta('model_gateway_profile_manage', {
            idempotencyKey: args.idempotencyKey,
            correlationId: `profile:${args.operation}:${profileName}`,
            expectedResult: args.mode === 'plan' ? 'dry_run_plan' : 'committed',
        });
        /** @type {Record<string, unknown> | null} */
        let profile = null;
        try {
            if (args.operation === 'upsert') {
                const profileInput = profileRecordInput(args.profile);
                if (Object.keys(profileInput).length === 0) {
                    throw new Error('MODEL_GATEWAY_PROFILE_BODY_REQUIRED: operation=upsert exige profile não vazio');
                }
                profile = normalizeProfileWriteInput(profileInput);
            }
        } catch (error) {
            return invalidProfileManageResult({
                profileName,
                operation: args.operation,
                operationMeta,
                error,
            });
        }
        let preview;
        try {
            preview = simulateProfileWrite(args.operation, profileName, profile, process.env);
        } catch (error) {
            return invalidProfileManageResult({
                profileName,
                operation: args.operation,
                operationMeta,
                error,
            });
        }
        if (args.mode === 'plan') {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'profile.manage',
                    status: 'planned',
                    dryRun: true,
                    data: {
                        profileName,
                        operation: args.operation,
                        profile: preview.summaries.find((candidate) => candidate.name === profileName) ?? null,
                        profileCount: preview.summaries.length,
                        activeProfile: preview.env['COPILOT_BYOK_PROFILE'] ?? null,
                        bindingSource: preview.env['COPILOT_MODEL_GATEWAY_BINDING_SOURCE'] ?? null,
                        operationMeta,
                    },
                    warnings: [],
                    errors: [],
                    nextActions: ['review_plan_then_apply_with_confirm_true'],
                }),
            );
        }
        if (!args.confirm) {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'profile.manage',
                    ok: false,
                    status: 'confirmation_required',
                    data: {
                        profileName,
                        operation: args.operation,
                        operationMeta,
                    },
                    errors: [
                        {
                            code: 'PROFILE_MANAGE_CONFIRMATION_REQUIRED',
                            message: 'mode=apply exige confirm=true.',
                            retryable: true,
                        },
                    ],
                    nextActions: ['review_plan_then_apply_with_confirm_true'],
                }),
            );
        }
        try {
            if (args.operation === 'upsert') {
                upsertModelGatewayByokProfileEnv(profileName, profile ?? {}, process.env);
            } else {
                const removed = removeModelGatewayByokProfileEnv(profileName, process.env);
                if (removed && process.env['COPILOT_BYOK_PROFILE'] === profileName) {
                    delete process.env['COPILOT_BYOK_PROFILE'];
                    delete process.env['COPILOT_BYOK_MODEL'];
                    delete process.env['COPILOT_BYOK_PROVIDER_PRESET'];
                    delete process.env['COPILOT_BYOK_BASE_URL'];
                }
            }
        } catch (error) {
            return invalidProfileManageResult({
                profileName,
                operation: args.operation,
                operationMeta,
                error,
            });
        }
        const updatedStore = createModelGatewayEnvProfileStore({ env: process.env });
        const updatedSummaries = updatedStore.listTerminalSummaries();
        const updatedSummary = updatedSummaries.find((candidate) => candidate.name === profileName) ?? null;
        return serializeResult(
            createModelGatewayControlPlaneResult({
                operation: 'profile.manage',
                ok: true,
                status: 'committed',
                data: {
                    profileName,
                    operation: args.operation,
                    profile: updatedSummary,
                    profileCount: updatedSummaries.length,
                    activeProfile: process.env['COPILOT_BYOK_PROFILE'] ?? null,
                    bindingSource: process.env['COPILOT_MODEL_GATEWAY_BINDING_SOURCE'] ?? null,
                    operationMeta,
                },
                warnings:
                    args.operation === 'remove' && updatedSummary === null
                        ? ['profile_removed_from_live_process_env']
                        : [],
                errors: [],
                nextActions: ['inspect_overview', 'inspect_profiles'],
            }),
        );
    },
});

export const modelGatewayReadTools = [
    modelGatewayOverviewTool,
    modelGatewayControlPlaneGuideTool,
    modelGatewayWorkflowPlanTool,
    modelGatewayCatalogSearchTool,
    modelGatewayRoutePlanTool,
    modelGatewayOperationStatusTool,
    modelGatewayModelEvaluateTool,
    modelGatewayPolicyProposeTool,
    modelGatewayProbePlanTool,
];

export const modelGatewayWriteTools = [
    modelGatewayProbeExecuteTool,
    modelGatewayModelSwitchTool,
    modelGatewayRouteSwitchTool,
    modelGatewayCatalogRefreshTool,
    modelGatewayRuntimeReconcileTool,
    modelGatewayMaintenanceTool,
    modelGatewayProfileManageTool,
];

export const modelGatewayTools = [...modelGatewayReadTools, ...modelGatewayWriteTools];
