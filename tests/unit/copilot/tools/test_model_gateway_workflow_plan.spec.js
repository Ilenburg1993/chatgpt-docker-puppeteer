// @ts-check

import { describe, expect, it, vi } from 'vitest';

const inspectOverview = vi.fn();
const planRoute = vi.fn();
const evaluateModels = vi.fn();
const planProbes = vi.fn();
const planRefresh = vi.fn();

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

vi.mock('#copilot/model-gateway', () => ({
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
    upsertModelGatewayByokProfileEnv: vi.fn(),
}));

const {
    modelGatewayControlPlaneGuideTool,
    modelGatewayReadTools,
    modelGatewayTools,
    modelGatewayWorkflowPlanTool,
} = await import('../../../../src/copilot/tools/model-gateway/index.js');

describe('model_gateway_workflow_plan', () => {
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
                        selectorSyntax: 'kilo-auto/free',
                        baseUrl: null,
                        openAICompatibleBaseUrl: null,
                        wireApi: 'openai_responses',
                        providerProfile: null,
                        routeProfile: 'repo_agent',
                        selectedRouteKey: 'kilo-code:kilo-auto/free:repo_agent',
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
});
