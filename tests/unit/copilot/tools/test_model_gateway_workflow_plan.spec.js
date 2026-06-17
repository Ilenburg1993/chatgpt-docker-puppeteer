// @ts-check

import { afterEach, describe, expect, it, vi } from 'vitest';

const inspectOverview = vi.fn();
const planRoute = vi.fn();
const evaluateModels = vi.fn();
const planProbes = vi.fn();
const planRefresh = vi.fn();
const readSdkSessionHandoffRecord = vi.fn();
const readCapabilities = vi.fn();
const readStats = vi.fn();
const switchModel = vi.fn();
const switchRoute = vi.fn();

/**
 * @param {Record<string, unknown>} input
 * @returns {Record<string, unknown>}
 */
function result(input) {
    return {
        schemaVersion: 'model-gateway.tool-result.v1',
        operation: String(input.operation ?? 'test.operation'),
        ok: input.ok !== false,
        status: String(input.status ?? 'ok'),
        dryRun: input.dryRun === true,
        data: input.data && typeof input.data === 'object' && !Array.isArray(input.data) ? input.data : {},
        warnings: Array.isArray(input.warnings) ? input.warnings.map(String) : [],
        errors: Array.isArray(input.errors) ? input.errors : [],
        nextActions: Array.isArray(input.nextActions) ? input.nextActions.map(String) : [],
        observedAt: '2026-06-16T00:00:00.000Z',
    };
}

function classifyDeferredOperation(operation) {
    const auth = operation?.promotionAuthorization;
    const promotable =
        auth?.authorized === true &&
        auth?.policy === 'authorized_after_turn_boundary' &&
        operation?.state === 'deferred_until_turn_boundary';
    return {
        classification: promotable ? 'promotable' : 'review_required',
        promotable,
        expired: false,
        requiresReview: !promotable,
        reason: promotable ? 'authorized_for_safe_turn_boundary_promotion' : 'automatic_promotion_not_authorized',
        nextActions: promotable
            ? ['promote_same_session_route_switch', 'inspect_operation_status']
            : ['review_target_route'],
        operationId: operation?.operationId ?? null,
        sessionId: operation?.sessionId ?? null,
        idempotencyKey: operation?.idempotencyKey ?? null,
        route: operation?.targetRoute ?? null,
        promotionPolicy: auth?.policy ?? 'manual_review',
        authorizationSource: auth?.source ?? null,
        expiresAt: auth?.expiresAt ?? null,
    };
}

vi.mock('#copilot/model-gateway', () => ({
    classifyModelGatewayDeferredRouteOperation: classifyDeferredOperation,
    collectModelGatewaySecretAuditEnvValues: () => [],
    createModelGatewayCatalogControlPlane: () => ({ planRefresh }),
    createModelGatewayControlPlaneResult: result,
    createModelGatewayEnvProfileStore: () => ({
        listTerminalSummaries: () => [],
        remove: vi.fn(),
        upsert: vi.fn(),
    }),
    createModelGatewayModelSwitchOperationId: (key) => `model-switch:${key}`,
    createModelGatewayProbeOperationId: (key) => `probe:${key}`,
    createModelGatewayReadControlPlane: () => ({
        evaluateModels,
        inspectOperation: vi.fn(),
        inspectOverview,
        planProbes,
        planRoute,
        proposePolicy: vi.fn(),
        searchCatalog: vi.fn(),
    }),
    createModelGatewaySameSessionRouteSwitchOperationId: (key) => `route-switch:${key}`,
    executeModelGatewayProbe: vi.fn(),
    materializeModelGatewayActiveByokProfileEnv: (env) => ({ env }),
    readModelGatewayProbeOperation: vi.fn(() => null),
    redactModelGatewayAuditedValue: (value) => value,
    removeModelGatewayByokProfileEnv: vi.fn(),
    resolveModelGatewaySessionBinding: () => ({
        enabled: true,
        ready: true,
        gatewayBinding: { providerId: 'kilo-code' },
    }),
    SqliteModelGatewayCatalogStore: class {
        readSdkSessionHandoffRecord = readSdkSessionHandoffRecord;
    },
    upsertModelGatewayByokProfileEnv: vi.fn(),
}));

const {
    modelGatewayControlPlaneGuideTool,
    modelGatewayReadTools,
    modelGatewayRuntimeReconcileTool,
    modelGatewayTools,
    modelGatewayWorkflowPlanTool,
    setModelGatewayRuntimeControl,
} = await import('../../../../src/copilot/tools/model-gateway/index.js');

describe('model_gateway_workflow_plan', () => {
    afterEach(() => {
        setModelGatewayRuntimeControl(null);
        readSdkSessionHandoffRecord.mockReset();
        readCapabilities.mockReset();
        readStats.mockReset();
        switchModel.mockReset();
        switchRoute.mockReset();
    });

    it('expõe guia operacional same-session para a LLM-B', async () => {
        const raw = await modelGatewayControlPlaneGuideTool.handler({
            objective: 'same_session_switch',
            includeTerminalCommands: true,
            includeApplyExamples: true,
        });
        const parsed = JSON.parse(String(raw));

        expect(modelGatewayReadTools.map((tool) => tool.name)).toEqual(
            expect.arrayContaining(['model_gateway_control_plane_guide', 'model_gateway_workflow_plan']),
        );
        expect(modelGatewayTools).toHaveLength(16);
        expect(parsed).toMatchObject({
            ok: true,
            operation: 'control-plane.guide',
            status: 'ready',
            dryRun: true,
            data: {
                recommendedEntryPoint: 'model_gateway_workflow_plan',
                invariants: {
                    unifiedSurface: true,
                    sameSessionByDefault: true,
                    newSessionOnlyWhenExplicitlyRequested: true,
                    providerRouteSwitchUsesSameSessionReattach: true,
                    applyRequiresConfirmTrue: true,
                    inlineSecretsForbidden: true,
                },
                applyExamples: {
                    routeSwitchApply: {
                        args: {
                            mode: 'apply',
                            confirm: true,
                        },
                    },
                },
            },
            errors: [],
        });
        expect(parsed.data.terminalCommands).toContain('/session sdk');
        expect(JSON.stringify(parsed)).not.toContain('"apiKey":');
        expect(JSON.stringify(parsed)).not.toContain('"requiresNewSession":true');
    });

    it('gera DAG same-session com probes antes de route switch confirmado', async () => {
        inspectOverview.mockResolvedValue(
            result({
                operation: 'overview',
                data: { readiness: { ok: true } },
            }),
        );
        planRoute.mockResolvedValue(
            result({
                operation: 'route.plan',
                data: {
                    selectedId: 'kilo-code:kilo-auto/free',
                    selectedRoute: {
                        providerId: 'kilo-code',
                        providerModel: 'kilo-auto/free',
                        providerType: 'openai',
                        selectorSyntax: 'kilo-auto/free',
                        baseUrl: null,
                        openAICompatibleBaseUrl: null,
                        openAICompatible: true,
                        wireApi: 'openai_responses',
                        providerProfile: null,
                        routeProfile: 'repo_agent',
                        selectedRouteKey: 'kilo-code:kilo-auto/free:repo_agent',
                        bindingStrategy: 'direct',
                        directRebindReliability: 'documented',
                        bindingDecision: {
                            schemaVersion: 'model-gateway.binding-strategy-decision.v1',
                            strategy: 'direct',
                            requestedStrategy: 'auto',
                            directRebindReliability: 'documented',
                            ingressEligible: false,
                            sameSessionRequired: true,
                            requiresNewSession: false,
                            source: 'sdk_provider_config',
                            reasons: ['sdk_provider_config_documented:openai'],
                            warnings: ['direct_rebind_documented_but_not_runtime_proven'],
                            nextActions: ['observe_or_probe_same_session_rebind', 'apply_same_session_route_switch'],
                        },
                    },
                },
            }),
        );
        evaluateModels.mockResolvedValue(
            result({
                operation: 'model.evaluate',
                data: { evaluated: [{ id: 'kilo-auto/free', included: true }] },
            }),
        );
        planProbes.mockResolvedValue(
            result({
                operation: 'probe.plan',
                data: { budget: { selected: [{ kind: 'chat' }, { kind: 'agent' }] } },
            }),
        );
        planRefresh.mockResolvedValue(
            result({
                operation: 'catalog.refresh',
                data: { planned: true },
            }),
        );

        const raw = await modelGatewayWorkflowPlanTool.handler({
            objective: 'same_session_route_switch',
            taskProfile: 'repo_agent',
            runtimeId: null,
            providerId: null,
            candidateModelIds: [],
            preferredProbeKinds: ['chat', 'agent'],
            maxSnapshotAgeHours: 720,
            maxCandidates: 5,
            maxProbeCount: 2,
            maxEstimatedCostUsd: 0,
            idempotencyKeyPrefix: 'workflow-test-20260616',
            includeCatalogRefreshPlan: true,
            includeRouteSwitchPlan: true,
            requireRuntimeProof: true,
        });
        const parsed = JSON.parse(String(raw));
        const steps = /** @type {Array<Record<string, any>>} */ (parsed.data.steps);
        const routeSwitchPlan = steps.find((step) => step.id === 'route_switch_plan');
        const routeSwitchApply = steps.find((step) => step.id === 'route_switch_apply');

        expect(modelGatewayReadTools.map((tool) => tool.name)).toContain('model_gateway_workflow_plan');
        expect(modelGatewayTools).toHaveLength(16);
        expect(parsed).toMatchObject({
            ok: true,
            operation: 'workflow.plan',
            status: 'planned',
            dryRun: true,
            data: {
                selectedProviderId: 'kilo-code',
                selectedModelId: 'kilo-auto/free',
                guardrails: {
                    sameSessionRequired: true,
                    requiresNewSession: false,
                    explicitNewSessionOnly: true,
                    applyStepsRequireConfirmTrue: true,
                },
            },
            errors: [],
        });
        expect(routeSwitchPlan).toMatchObject({
            tool: 'model_gateway_route_switch',
            mode: 'plan',
            confirmationRequired: false,
            requires: expect.arrayContaining([
                'route_plan',
                'probe_execute_apply_chat',
                'probe_execute_apply_agent',
            ]),
            args: {
                mode: 'plan',
                confirm: false,
                route: expect.objectContaining({
                    providerId: 'kilo-code',
                    providerModel: 'kilo-auto/free',
                    providerType: 'openai',
                    openAICompatible: true,
                    bindingStrategy: 'direct',
                    directRebindReliability: 'documented',
                    bindingDecision: expect.objectContaining({
                        strategy: 'direct',
                        requestedStrategy: 'auto',
                        ingressEligible: false,
                        requiresNewSession: false,
                    }),
                }),
            },
        });
        expect(routeSwitchApply).toMatchObject({
            tool: 'model_gateway_route_switch',
            mode: 'apply',
            confirmationRequired: true,
            requires: ['route_switch_plan'],
            args: {
                mode: 'apply',
                confirm: true,
                idempotencyKey: 'workflow-test-20260616:route-switch-kilo-code-kilo-auto-free',
            },
        });
        expect(JSON.stringify(parsed)).not.toContain('"requiresNewSession":true');
        expect(JSON.stringify(parsed)).not.toContain('"apiKey":');
    });

    it('reconhece route switch diferido e evita promoção insegura durante tool-turn ativo', async () => {
        readSdkSessionHandoffRecord.mockResolvedValue({
            handoffId: 'same-session-route-switch:deferred',
            operation: {
                operationId: 'same-session-route-switch:deferred',
                idempotencyKey: 'route-reconcile-deferred-key',
                state: 'deferred_until_turn_boundary',
                sessionId: 'session-stable',
                requiresNewSession: false,
                retryable: true,
                deferReason: 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED',
                createdAt: '2099-06-16T12:00:00.000Z',
                promotionAuthorization: {
                    authorized: true,
                    policy: 'authorized_after_turn_boundary',
                    source: 'confirmed_model_gateway_route_switch_apply',
                    expiresAt: '2099-06-16T12:10:00.000Z',
                },
                targetRoute: {
                    providerId: 'ollama-cloud',
                    providerModel: 'qwen3-coder-next',
                    selectorSyntax: 'qwen3-coder-next',
                    baseUrl: 'https://ollama.com/v1',
                    openAICompatibleBaseUrl: 'https://ollama.com/v1',
                    wireApi: 'completions',
                    providerProfile: 'ollama-cloud',
                    routeProfile: 'repo_agent',
                    selectedRouteKey: 'ollama-cloud:qwen3-coder-next:repo_agent',
                },
            },
        });
        readCapabilities.mockReturnValue({
            capabilities: [
                {
                    id: 'sdk.same-session-route-reattach',
                    available: true,
                    state: 'degraded',
                    details: {
                        dialogLoopActive: true,
                        deferredUntilTurnBoundary: true,
                        implicitNewSessionAllowed: false,
                    },
                },
            ],
        });
        readStats.mockReturnValue({ currentModel: 'nex-agi/nex-n2-pro:free', stats: {} });
        setModelGatewayRuntimeControl({ readCapabilities, readStats, switchModel, switchRoute });

        const raw = await modelGatewayRuntimeReconcileTool.handler({
            mode: 'plan',
            expectedModelId: 'qwen3-coder-next',
            runtimeId: null,
            routeOperationId: 'same-session-route-switch:deferred',
            idempotencyKey: 'route-reconcile-deferred-key',
            confirm: false,
        });
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

        expect(parsed).toMatchObject({
            ok: true,
            operation: 'runtime.reconcile',
            status: 'route_promotion_planned',
            dryRun: true,
            data: {
                routeOperationId: 'same-session-route-switch:deferred',
                routeOperationState: 'deferred_until_turn_boundary',
                promotion: {
                    safeNow: false,
                    reason: 'same_session_route_reattach_deferred_until_turn_boundary',
                    requiresNewSession: false,
                    forceApplyDeferred: false,
                },
            },
            errors: [],
        });
        expect(parsed.nextActions).toContain('apply_with_confirm_true_to_arm_or_promote_route');
        expect(switchRoute).not.toHaveBeenCalled();
    });
});
