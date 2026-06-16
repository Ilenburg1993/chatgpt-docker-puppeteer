// @ts-check

import {
    collectModelGatewaySecretAuditEnvValues,
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
        purpose: 'Selecionar rota explicável, comparar modelos e propor política sem mutação.',
    },
    {
        phase: 'runtime-proof',
        tools: ['model_gateway_probe_plan', 'model_gateway_probe_execute'],
        purpose: 'Planejar e executar probes descartáveis antes de promover rota/modelo.',
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
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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
        selectorSyntax: optionalWorkflowString(selectedRoute['selectorSyntax']),
        baseUrl: optionalWorkflowString(selectedRoute['baseUrl']),
        openAICompatibleBaseUrl: optionalWorkflowString(selectedRoute['openAICompatibleBaseUrl']),
        wireApi: optionalWorkflowString(selectedRoute['wireApi']),
        providerProfile: optionalWorkflowString(selectedRoute['providerProfile']),
        routeProfile: optionalWorkflowString(selectedRoute['routeProfile']),
        selectedRouteKey: optionalWorkflowString(selectedRoute['selectedRouteKey']),
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
        const overview = await createModelGatewayReadControlPlane().inspectOverview(args);
        const targetRuntimeId = typeof args['runtimeId'] === 'string' ? args['runtimeId'] : null;
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
        'troca de modelo/provider deve preservar a sessão por padrão; nova sessão só com pedido humano explícito.',
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
                          probeKind: 'chat',
                          providerId: '<provider-id>',
                          modelId: '<provider-model>',
                          profileId: null,
                          maxEstimatedCostUsd: 0,
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
                        applyRequiresConfirmTrue: true,
                        inlineSecretsForbidden: true,
                        catalogMetadataIsNotRuntimeProof: true,
                    },
                    defaultSequence: [
                        'model_gateway_control_plane_guide',
                        'model_gateway_overview',
                        'model_gateway_workflow_plan',
                        'model_gateway_probe_execute:plan',
                        'model_gateway_probe_execute:apply',
                        'model_gateway_route_switch:plan or model_gateway_model_switch:plan',
                        'model_gateway_route_switch:apply or model_gateway_model_switch:apply',
                        'model_gateway_operation_status',
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
        'Monta um roteiro read-only para a LLM-B operar o model-gateway: overview, refresh, rota, avaliação, probes ' +
        'e troca/reconcile preservando a mesma sessão quando aplicável. Não chama providers, não troca modelo e não grava estado.',
    instructions:
        'Use como ponto de entrada de orquestração. Execute as etapas na ordem retornada; chamadas mode=apply exigem ' +
        'uma chamada separada da tool indicada com confirm=true e a mesma idempotencyKey. Nunca crie sessão nova por ' +
        'fallback: switches planejados aqui são same-session e nova sessão só pode ser decisão humana explícita fora deste plano.',
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
        const routePlan = await readPlane.planRoute({
            taskProfile: args.taskProfile,
            maxCandidates: args.maxCandidates,
            evaluateEligibility: true,
        });
        const routeData = operationData(routePlan);
        const selectedRoute = normalizeWorkflowRoute(asRecord(routeData['selectedRoute']));
        const selectedProviderId = optionalWorkflowString(selectedRoute?.['providerId']);
        const selectedModelId = optionalWorkflowString(selectedRoute?.['providerModel']);
        const candidateModelIds = Array.isArray(args.candidateModelIds) ? args.candidateModelIds.map(String) : [];
        const modelIds = candidateModelIds.length > 0 ? candidateModelIds : selectedModelId ? [selectedModelId] : [];
        const providerForProbe = optionalWorkflowString(args.providerId) ?? selectedProviderId;
        const probeModelId = selectedModelId ?? modelIds[0] ?? null;
        const shouldPlanCatalogRefresh = args.includeCatalogRefreshPlan || args.objective === 'catalog_refresh';
        const shouldPlanProbes =
            modelIds.length > 0 &&
            (args.objective === 'probe_shortlist' ||
                args.objective === 'same_session_model_switch' ||
                args.objective === 'same_session_route_switch' ||
                args.objective === 'runtime_reconcile' ||
                args.requireRuntimeProof);

        const modelEvaluation =
            modelIds.length > 0
                ? await readPlane.evaluateModels({
                      modelIds,
                      taskProfile: args.taskProfile,
                      maxResults: args.maxCandidates,
                  })
                : null;
        const probePlan =
            shouldPlanProbes && providerForProbe
                ? await readPlane.planProbes({
                      modelIds,
                      providerId: providerForProbe,
                      allowedProbeKinds: args.preferredProbeKinds,
                      maxProbeCount: args.maxProbeCount,
                      maxEstimatedCostUsd: args.maxEstimatedCostUsd,
                      unknownCostPolicy: 'skip',
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
                runtimeId: args.runtimeId,
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
            workflowStep(order++, 'route_plan', 'model_gateway_route_plan', 'read', 'Selecionar rota local explicável para o perfil de tarefa.', {
                taskProfile: args.taskProfile,
                maxCandidates: args.maxCandidates,
                evaluateEligibility: true,
            }),
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
                        modelIds,
                        providerId: providerForProbe,
                        allowedProbeKinds: args.preferredProbeKinds,
                        maxProbeCount: args.maxProbeCount,
                        maxEstimatedCostUsd: args.maxEstimatedCostUsd,
                        unknownCostPolicy: 'skip',
                        recommendationLimit: args.maxCandidates,
                        probeFailureCooldownSeconds: 900,
                    },
                    ['model_evaluate'],
                ),
            );
        }

        /** @type {string[]} */
        const runtimeProofStepIds = [];
        if (shouldPlanProbes && providerForProbe && probeModelId) {
            for (const probeKind of args.preferredProbeKinds.slice(0, args.maxProbeCount)) {
                const suffix = `probe-${probeKind}-${providerForProbe}-${probeModelId}`;
                const planId = `probe_execute_plan_${cleanWorkflowKeyPart(probeKind)}`;
                const applyId = `probe_execute_apply_${cleanWorkflowKeyPart(probeKind)}`;
                const commonProbeArgs = {
                    probeKind,
                    providerId: providerForProbe,
                    modelId: probeModelId,
                    profileId: null,
                    maxEstimatedCostUsd: args.maxEstimatedCostUsd,
                    timeoutMs: 60000,
                    idempotencyKey: workflowIdempotencyKey(args.idempotencyKeyPrefix, suffix),
                };
                steps.push(
                    workflowStep(
                        order++,
                        planId,
                        'model_gateway_probe_execute',
                        'plan',
                        `Planejar sonda ${probeKind} para prova runtime descartável.`,
                        { ...commonProbeArgs, mode: 'plan', confirm: false },
                        ['probe_plan'],
                    ),
                );
                steps.push(
                    workflowStep(
                        order++,
                        applyId,
                        'model_gateway_probe_execute',
                        'apply',
                        `Executar sonda ${probeKind} somente após revisão do plano.`,
                        { ...commonProbeArgs, mode: 'apply', confirm: true },
                        [planId],
                    ),
                );
                runtimeProofStepIds.push(applyId);
            }
        }

        const switchRequires = [
            'route_plan',
            ...(args.requireRuntimeProof ? runtimeProofStepIds : []),
        ];
        if ((args.includeRouteSwitchPlan || args.objective === 'same_session_route_switch') && selectedRoute) {
            const routeKey = workflowIdempotencyKey(
                args.idempotencyKeyPrefix,
                `route-switch-${selectedRoute.providerId}-${selectedRoute.providerModel}`,
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
                        runtimeId: args.runtimeId,
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
                        runtimeId: args.runtimeId,
                        timeoutMs: 60000,
                        idempotencyKey: routeKey,
                        confirm: true,
                    },
                    ['route_switch_plan'],
                ),
            );
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
                        runtimeId: args.runtimeId,
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
                        runtimeId: args.runtimeId,
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
                        runtimeId: args.runtimeId,
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
                        runtimeId: args.runtimeId,
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
            ...resultWarnings(routePlan),
            ...(modelEvaluation ? resultWarnings(modelEvaluation) : []),
            ...(probePlan ? resultWarnings(probePlan) : []),
            ...(catalogRefreshPlan ? resultWarnings(catalogRefreshPlan) : []),
            ...(selectedRoute ? [] : ['route_plan_selected_route_missing']),
            ...(shouldPlanProbes && !providerForProbe ? ['probe_provider_missing'] : []),
            ...(args.requireRuntimeProof && runtimeProofStepIds.length === 0
                ? ['runtime_proof_required_but_no_probe_apply_step_planned']
                : []),
        ];
        const switchingObjective = ['same_session_model_switch', 'same_session_route_switch', 'runtime_reconcile'].includes(
            args.objective,
        );
        const errors = [];
        if (switchingObjective && !selectedModelId) {
            errors.push({
                code: 'MODEL_GATEWAY_WORKFLOW_TARGET_MODEL_MISSING',
                message: 'O plano de rota não retornou modelo alvo suficiente para planejar switch/reconcile.',
                retryable: true,
            });
        }
        if ((args.includeRouteSwitchPlan || args.objective === 'same_session_route_switch') && !selectedRoute) {
            errors.push({
                code: 'MODEL_GATEWAY_WORKFLOW_TARGET_ROUTE_MISSING',
                message: 'O plano de rota não retornou rota estruturada suficiente para model_gateway_route_switch.',
                retryable: true,
            });
        }

        return serializeResult(
            createModelGatewayControlPlaneResult({
                operation: 'workflow.plan',
                ok: errors.length === 0,
                status: errors.length === 0 ? 'planned' : 'attention_required',
                dryRun: true,
                data: {
                    objective: args.objective,
                    taskProfile: args.taskProfile,
                    runtimeId: args.runtimeId,
                    selectedRoute,
                    selectedProviderId,
                    selectedModelId,
                    providerForProbe,
                    modelIds,
                    steps,
                    guardrails: {
                        sameSessionRequired: true,
                        requiresNewSession: false,
                        explicitNewSessionOnly: true,
                        applyStepsRequireConfirmTrue: true,
                        routeSwitchTool: 'model_gateway_route_switch',
                        modelSwitchTool: 'model_gateway_model_switch',
                    },
                    evidence: {
                        overview: operationData(overview),
                        routePlan: routeData,
                        modelEvaluation: modelEvaluation ? operationData(modelEvaluation) : null,
                        probePlan: probePlan ? operationData(probePlan) : null,
                        catalogRefreshPlan: catalogRefreshPlan ? operationData(catalogRefreshPlan) : null,
                    },
                },
                warnings,
                errors,
                nextActions:
                    errors.length === 0
                        ? ['execute_ordered_plan_steps', 'reuse_idempotency_keys', 'do_not_create_new_session']
                        : ['refresh_catalog_or_adjust_candidates', 'rerun_workflow_plan'],
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
        'Gera um plano read-only explicável para um perfil de tarefa, com candidato selecionado, fallback e exclusões. ' +
        'Não troca modelo, não cria sessão e não executa probes.',
    instructions:
        'Use depois de overview ou catalog_search. Verifique selectedId, warnings, rejectedReasonCounts e fallbackChain. ' +
        'O resultado é dry-run e nunca deve ser descrito como uma troca aplicada.',
    parameters: MODEL_GATEWAY_ROUTE_PLAN_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
    schemaFailurePolicy: 'throw',
    requiresApproval: false,
    handler: async (args) => serializeResult(await createModelGatewayReadControlPlane().planRoute(args)),
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
    handler: async (args) => serializeResult(await createModelGatewayReadControlPlane().inspectOperation(args)),
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
        'Sempre use mode=plan primeiro. Só aplique quando o plano selecionar exatamente a sonda desejada; reutilize a ' +
        'mesma idempotencyKey em retries. apply exige confirm=true e nunca deve ser tratado como troca de modelo.',
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
            unknownCostPolicy: 'skip',
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
        const currentSnapshot = readOptionalRuntimeCurrentModel(args.runtimeId);
        const current = currentSnapshot.currentModel;
        if (args.mode === 'plan') {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'model.switch',
                    status: 'planned',
                    dryRun: true,
                    data: {
                        runtimeId: args.runtimeId,
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
                        runtimeId: args.runtimeId,
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
        const projection = await control.switchModel(args.modelId, args.runtimeId ?? undefined, {
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
        'idempotencyKey e só aplique com confirm=true. Considere sucesso apenas state=committed. ' +
        'requiresNewSession deve permanecer false em qualquer resultado.',
    parameters: MODEL_GATEWAY_ROUTE_SWITCH_INPUT_SCHEMA,
    outputSchema: MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA,
    annotations: { ...MUTATING_ANNOTATIONS, openWorldHint: true },
    schemaFailurePolicy: 'throw',
    requiresApproval: true,
    handler: async (args) => {
        const correlationId = createModelGatewaySameSessionRouteSwitchOperationId(args.idempotencyKey);
        if (args.mode === 'plan') {
            return serializeResult(
                createModelGatewayControlPlaneResult({
                    operation: 'route.switch',
                    status: 'planned',
                    dryRun: true,
                    data: {
                        runtimeId: args.runtimeId,
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
                        runtimeId: args.runtimeId,
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
        const projection = await control.switchRoute(args.route, args.runtimeId ?? undefined, {
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
                ok: committed,
                status: String(operation?.['state'] ?? 'failed'),
                data: {
                    ...projection,
                    sameSessionRequired: true,
                    requiresNewSession: false,
                    operationMeta: toolOperationMeta('model_gateway_route_switch', {
                        idempotencyKey: args.idempotencyKey,
                        correlationId: String(operation?.['operationId'] ?? correlationId),
                        expectedResult: committed ? 'committed' : 'not_committed',
                    }),
                },
                warnings: committed
                    ? []
                    : deferred
                      ? [
                            'same_session_route_switch_deferred_until_turn_boundary',
                            String(operation?.['deferReason'] ?? 'active_dialog_loop'),
                        ]
                      : [String(operation?.['error'] ?? 'same_session_route_switch_not_committed')],
                errors: committed
                    ? []
                    : [
                          {
                              code: deferred
                                  ? 'ROUTE_SWITCH_DEFERRED_UNTIL_TURN_BOUNDARY'
                                  : 'SAME_SESSION_ROUTE_SWITCH_NOT_COMMITTED',
                              message: deferred
                                  ? 'Provider reattach foi adiado porque o dialog loop/tool turn ainda está ativo; nenhuma rota foi mutada.'
                                  : String(operation?.['error'] ?? operation?.['state'] ?? 'unknown'),
                              retryable: operation?.['state'] !== 'rolled_back',
                          },
                      ],
                nextActions: deferred
                    ? ['inspect_operation_status', 'retry_route_switch_after_current_turn_or_use_terminal_runtime_apply']
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
        'Compara o modelo efetivo do runtime com o modelo esperado e, em apply confirmado, converge usando a mesma ' +
        'operação transacional de troca com verificação e rollback.',
    instructions:
        'Use mode=plan primeiro. Se converged=true, não aplique. Em mismatch, revise o modelo esperado e reutilize a ' +
        'mesma idempotencyKey no apply confirmado.',
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
            const promotable = deferred && targetRoute !== null;
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

            if (args.mode === 'plan' || committed || !promotable || !safety.safe) {
                const planning = args.mode === 'plan';
                const status = committed
                    ? 'already_converged'
                    : promotable
                      ? safety.safe
                          ? 'route_promotion_planned'
                          : 'route_promotion_deferred_until_turn_boundary'
                      : 'route_operation_not_promotable';
                return serializeResult(
                    createModelGatewayControlPlaneResult({
                        operation: 'runtime.reconcile',
                        ok: committed || (planning && promotable),
                        status,
                        dryRun: args.mode === 'plan',
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
                                forceApplyDeferred: safety.safe,
                            },
                            handoff,
                            operation,
                            operationMeta,
                        },
                        warnings: [
                            ...(committed ? ['route_switch_already_committed'] : []),
                            ...(!committed && promotable && !safety.safe ? [safety.reason] : []),
                            ...(!promotable ? [`route_operation_state_not_deferred:${operationState}`] : []),
                        ],
                        errors:
                            args.mode === 'apply' && promotable && !safety.safe
                                ? [
                                      {
                                          code: 'ROUTE_RECONCILE_PROMOTION_DEFERRED_UNTIL_TURN_BOUNDARY',
                                          message:
                                              'A operação diferida foi reconhecida, mas o reattach imediato ainda não é seguro no tool-turn ativo.',
                                          retryable: true,
                                      },
                                  ]
                                : [],
                        nextActions: committed
                            ? ['inspect_overview']
                            : promotable && safety.safe
                              ? ['apply_with_confirm_true_to_promote_route']
                              : ['wait_for_turn_boundary_or_use_terminal_force_deferred', 'inspect_operation_status'],
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
