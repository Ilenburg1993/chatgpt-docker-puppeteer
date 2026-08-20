// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createModelGatewayIngressLocalApiKey,
    createModelGatewayIngressRoute,
    defaultModelGatewayIngressRouteRegistry,
} from '../../../../src/copilot/model-gateway/index.js';

const mocks = vi.hoisted(() => ({
    executeRouteSwitch: vi.fn(),
    persistState: vi.fn(async () => ({ ok: true })),
    readDirectEvidence: vi.fn(),
    readState: vi.fn(),
}));

vi.mock('#copilot/model-gateway', async () => ({
    ...(await vi.importActual('../../../../src/copilot/model-gateway/index.js')),
    executeModelGatewayRuntimeRouteSwitch: mocks.executeRouteSwitch,
    readModelGatewayDirectRebindEvidence: mocks.readDirectEvidence,
}));

vi.mock('../../../../src/copilot/agent/facades/agent-runtime-state.js', () => ({
    persistAgentRuntimeStatePartial: mocks.persistState,
    readAgentRuntimePersistedStateSync: mocks.readState,
}));

function createContext() {
    const session = {
        sessionId: 'session-stable',
        setModel: vi.fn(),
    };
    return {
        getSessionSnapshot: () => session,
        getModelSnapshot: () => 'old-model',
        isDialogLoopActive: () => false,
        setSession: vi.fn(),
        setModel: vi.fn(),
    };
}

/**
 * @param {Record<string, unknown>} route
 * @param {{ expectedRevision?: number | null; localApiKey?: string; now?: number }} [options]
 */
function registerIngressRoute(route, options = {}) {
    const ingressRoute = createModelGatewayIngressRoute({
        sessionId: 'session-stable',
        publicBaseUrl: 'http://127.0.0.1:4567',
        route,
        ...(typeof options.now === 'number' ? { now: options.now } : {}),
    });
    return defaultModelGatewayIngressRouteRegistry.register({
        ingressRoute,
        localApiKey: options.localApiKey ?? createModelGatewayIngressLocalApiKey(),
        expectedRevision: Object.prototype.hasOwnProperty.call(options, 'expectedRevision')
            ? (options.expectedRevision ?? null)
            : null,
        ...(typeof options.now === 'number' ? { now: options.now } : {}),
    });
}

describe('agent route binding strategy authority', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        defaultModelGatewayIngressRouteRegistry.clear();
        mocks.readDirectEvidence.mockResolvedValue({
            schemaVersion: 'model-gateway.direct-rebind-evidence.v1',
            directRebindReliability: 'unknown',
            directRebindOk: null,
            sampleSize: 0,
        });
        mocks.readState.mockReturnValue({
            modelGatewayActiveRoute: {
                providerId: 'openrouter',
                providerModel: 'old-model',
                baseUrl: 'https://openrouter.ai/api/v1',
                wireApi: 'completions',
                bindingStrategy: 'direct',
                directRebindReliable: true,
                updatedAt: Date.now(),
            },
        });
        mocks.executeRouteSwitch.mockImplementation(async (input) => ({
            schemaVersion: 'model-gateway.same-session-route-switch.v1',
            state: 'committed',
            sessionId: input.sessionId,
            targetRoute: input.targetRoute,
            requiresNewSession: false,
        }));
    });

    it('enriquece rota manual para ingress antes da transação quando direct é estruturalmente não confiável', async () => {
        const { switchAgentRouteTransactional } =
            await import('../../../../src/copilot/agent/facades/agent-route-config.js');
        const ctx = createContext();

        const result = await switchAgentRouteTransactional(
            /** @type {any} */ (ctx),
            {
                providerId: 'openrouter',
                providerModel: 'openai/gpt-oss-120b',
                baseUrl: 'https://openrouter.ai/api/v1',
                wireApi: 'completions',
                routeProfile: 'repo_agent',
                bindingCapabilities: {
                    directConfigRepresentability: 'lossy',
                    requiredDirectHeaders: ['x-required-provider-feature'],
                },
            },
            {
                idempotencyKey: 'agent-route-binding-ingress',
                source: 'unit.agent.binding-strategy',
                reattach: vi.fn(),
            },
        );

        expect(result).toMatchObject({ state: 'committed', requiresNewSession: false });
        expect(mocks.executeRouteSwitch).toHaveBeenCalledOnce();
        const input = mocks.executeRouteSwitch.mock.calls[0]?.[0];
        if (!input) throw new Error('executeRouteSwitch não recebeu a rota esperada.');
        expect(input.targetRoute).toMatchObject({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            bindingStrategy: 'ingress',
            requiresIngress: true,
            requiresNewSession: false,
            sdkVisibleModel: 'model-gateway-live',
            bindingDecision: {
                strategy: 'ingress',
                source: 'automatic_ingress_fallback',
                directRebindReliability: 'documented',
                directBindingViability: 'unreliable',
                directConfigRepresentability: 'lossy',
                requiresNonStandardHeaders: true,
            },
        });
        expect(String(input.targetRoute.sdkRouteKey)).toContain('session-stable:repo_agent:model-gateway');
    });

    it('verifica rota ingress pelo modelo visível ao SDK sem confundir com o modelo upstream', async () => {
        mocks.executeRouteSwitch.mockImplementationOnce(async (input) => {
            const candidate = await input.reattach(input.targetRoute);
            const verified = await input.verify(candidate, input.targetRoute);
            if (!verified) {
                return {
                    schemaVersion: 'model-gateway.same-session-route-switch.v1',
                    state: 'rolled_back',
                    sessionId: input.sessionId,
                    error: 'SAME_SESSION_ROUTE_SWITCH_NOT_VERIFIED',
                    requiresNewSession: false,
                };
            }
            await input.commit(candidate, input.targetRoute);
            return {
                schemaVersion: 'model-gateway.same-session-route-switch.v1',
                state: 'committed',
                sessionId: input.sessionId,
                targetRoute: input.targetRoute,
                requiresNewSession: false,
            };
        });
        const { switchAgentRouteTransactional } =
            await import('../../../../src/copilot/agent/facades/agent-route-config.js');

        const result = await switchAgentRouteTransactional(
            /** @type {any} */ (createContext()),
            {
                providerId: 'ollama-cloud',
                providerType: 'openai',
                providerModel: 'qwen3-coder-next',
                baseUrl: 'https://ollama.com/v1',
                openAICompatible: true,
                wireApi: 'completions',
                directRebindReliability: 'unreliable',
                routeProfile: 'live_minimal_provider_switch',
            },
            {
                idempotencyKey: 'agent-route-ingress-sdk-visible-model',
                source: 'unit.agent.ingress-verification',
                reattach: async (route) =>
                    /** @type {any} */ ({
                        sessionId: 'session-stable',
                        __copilotModelGatewayProviderId: route['providerId'],
                        __copilotConfiguredModel: route['sdkVisibleModel'],
                        __copilotEffectiveModel: route['sdkVisibleModel'],
                    }),
            },
        );

        expect(result).toMatchObject({
            state: 'committed',
            targetRoute: {
                providerId: 'ollama-cloud',
                providerModel: 'qwen3-coder-next',
                bindingStrategy: 'ingress',
                sdkVisibleModel: 'model-gateway-live',
            },
        });
    });

    it('aprende com falha direta recente e seleciona ingress para o mesmo par e wire API', async () => {
        mocks.readDirectEvidence.mockResolvedValueOnce({
            schemaVersion: 'model-gateway.direct-rebind-evidence.v1',
            providerId: 'groq',
            previousProviderId: 'openrouter',
            wireApi: 'completions',
            directRebindReliability: 'unreliable',
            directRebindOk: false,
            sameSessionReattachOk: false,
            sampleSize: 2,
            latestStatus: 'route_rollback_confirmed_same_session',
        });
        const { switchAgentRouteTransactional } =
            await import('../../../../src/copilot/agent/facades/agent-route-config.js');

        await switchAgentRouteTransactional(
            /** @type {any} */ (createContext()),
            {
                providerId: 'groq',
                providerModel: 'llama-3.3-70b-versatile',
                baseUrl: 'https://api.groq.com/openai/v1',
                wireApi: 'completions',
                routeProfile: 'repo_agent',
            },
            {
                idempotencyKey: 'agent-route-ledger-failure',
                source: 'unit.agent.binding-evidence',
                reattach: vi.fn(),
            },
        );

        const input = mocks.executeRouteSwitch.mock.calls[0]?.[0];
        if (!input) throw new Error('executeRouteSwitch não recebeu a rota esperada.');
        expect(mocks.readDirectEvidence).toHaveBeenCalledWith(
            expect.objectContaining({
                previousProviderId: 'openrouter',
                providerId: 'groq',
                wireApi: 'completions',
            }),
        );
        expect(input.targetRoute).toMatchObject({
            bindingStrategy: 'ingress',
            runtimeEvidence: expect.objectContaining({
                sampleSize: 2,
                directRebindOk: false,
            }),
            bindingDecision: expect.objectContaining({
                directRebindReliability: 'unreliable',
                directBindingViability: 'unreliable',
                source: 'automatic_ingress_fallback',
            }),
        });
    });

    it('mantém direct quando o ledger contém prova posterior de reattach bem-sucedido', async () => {
        mocks.readDirectEvidence.mockResolvedValueOnce({
            schemaVersion: 'model-gateway.direct-rebind-evidence.v1',
            providerId: 'groq',
            previousProviderId: 'openrouter',
            wireApi: 'completions',
            directRebindReliability: 'proven',
            directRebindOk: true,
            sameSessionReattachOk: true,
            sampleSize: 3,
            latestStatus: 'route_confirmed_same_session',
        });
        const { switchAgentRouteTransactional } =
            await import('../../../../src/copilot/agent/facades/agent-route-config.js');

        await switchAgentRouteTransactional(
            /** @type {any} */ (createContext()),
            {
                providerId: 'groq',
                providerModel: 'llama-3.3-70b-versatile',
                baseUrl: 'https://api.groq.com/openai/v1',
                wireApi: 'completions',
                routeProfile: 'repo_agent',
            },
            {
                idempotencyKey: 'agent-route-ledger-success',
                source: 'unit.agent.binding-evidence',
                reattach: vi.fn(),
            },
        );

        const input = mocks.executeRouteSwitch.mock.calls[0]?.[0];
        if (!input) throw new Error('executeRouteSwitch não recebeu a rota esperada.');
        expect(input.targetRoute).toMatchObject({
            bindingStrategy: 'direct',
            requiresIngress: false,
            bindingDecision: expect.objectContaining({
                directRebindReliability: 'proven',
                directBindingViability: 'proven',
                directRebindEvidenceSource: 'runtime_evidence',
            }),
        });
    });

    it('degrada para decisão estática e sinaliza warning quando o ledger está indisponível', async () => {
        mocks.readDirectEvidence.mockRejectedValueOnce(new Error('sqlite unavailable'));
        const { switchAgentRouteTransactional } =
            await import('../../../../src/copilot/agent/facades/agent-route-config.js');

        const result = await switchAgentRouteTransactional(
            /** @type {any} */ (createContext()),
            {
                providerId: 'groq',
                providerModel: 'llama-3.3-70b-versatile',
                baseUrl: 'https://api.groq.com/openai/v1',
                wireApi: 'completions',
            },
            {
                idempotencyKey: 'agent-route-ledger-unavailable',
                source: 'unit.agent.binding-evidence',
                reattach: vi.fn(),
            },
        );

        expect(mocks.executeRouteSwitch).toHaveBeenCalledOnce();
        expect(result).toMatchObject({
            state: 'committed',
            warnings: ['direct_rebind_evidence_unavailable'],
        });
    });

    it('remove binding ingress anterior após commit confirmado para direct', async () => {
        const previousRoute = {
            providerId: 'openrouter',
            providerModel: 'old-model',
            baseUrl: 'https://openrouter.ai/api/v1',
            wireApi: 'completions',
            bindingStrategy: 'ingress',
            sdkRouteKey: 'session-stable:repo_agent:model-gateway',
            sdkVisibleModel: 'model-gateway-live',
            updatedAt: Date.now(),
        };
        mocks.readState.mockReturnValueOnce({ modelGatewayActiveRoute: previousRoute });
        const previousEntry = registerIngressRoute(previousRoute, { expectedRevision: null });
        mocks.executeRouteSwitch.mockImplementationOnce(async (input) => {
            const candidate = await input.reattach(input.targetRoute);
            await input.commit(candidate, input.targetRoute);
            return {
                schemaVersion: 'model-gateway.same-session-route-switch.v1',
                state: 'committed',
                sessionId: input.sessionId,
                previousRoute: input.previousRoute,
                targetRoute: input.targetRoute,
                requiresNewSession: false,
                reconciliationRequired: false,
            };
        });
        const { switchAgentRouteTransactional } =
            await import('../../../../src/copilot/agent/facades/agent-route-config.js');

        const result = await switchAgentRouteTransactional(
            /** @type {any} */ (createContext()),
            {
                providerId: 'groq',
                providerModel: 'llama-3.3-70b-versatile',
                baseUrl: 'https://api.groq.com/openai/v1',
                wireApi: 'completions',
                bindingStrategy: 'direct',
                directRebindReliable: true,
            },
            {
                idempotencyKey: 'agent-route-ingress-to-direct-commit',
                source: 'unit.agent.registry-reconcile',
                reattach: async () => /** @type {any} */ ({ sessionId: 'session-stable' }),
            },
        );

        expect(defaultModelGatewayIngressRouteRegistry.get(previousEntry.ingressRoute.routeId)).toBeNull();
        expect(result).toMatchObject({
            state: 'committed',
            reconciliationRequired: false,
            registryReconciliation: {
                previousUsesIngress: true,
                targetUsesIngress: false,
                previousRevision: 1,
                verified: true,
            },
        });
    });

    it('remove target ingress órfão quando a troca faz rollback para direct', async () => {
        mocks.executeRouteSwitch.mockImplementationOnce(async (input) => {
            await input.reattach(input.targetRoute);
            const previous = await input.reattach(input.previousRoute);
            await input.commit(previous, input.previousRoute);
            return {
                schemaVersion: 'model-gateway.same-session-route-switch.v1',
                state: 'rolled_back',
                sessionId: input.sessionId,
                previousRoute: input.previousRoute,
                targetRoute: input.targetRoute,
                rollback: { verified: true },
                requiresNewSession: false,
                reconciliationRequired: false,
            };
        });
        const { switchAgentRouteTransactional } =
            await import('../../../../src/copilot/agent/facades/agent-route-config.js');

        const result = await switchAgentRouteTransactional(
            /** @type {any} */ (createContext()),
            {
                providerId: 'groq',
                providerModel: 'llama-3.3-70b-versatile',
                baseUrl: 'https://api.groq.com/openai/v1',
                wireApi: 'completions',
                bindingStrategy: 'ingress',
                routeProfile: 'repo_agent',
            },
            {
                idempotencyKey: 'agent-route-direct-to-ingress-rollback',
                source: 'unit.agent.registry-reconcile',
                reattach: async (route) => {
                    if (route['bindingStrategy'] === 'ingress') {
                        registerIngressRoute(route, { expectedRevision: null });
                    }
                    return /** @type {any} */ ({ sessionId: 'session-stable' });
                },
            },
        );

        expect(defaultModelGatewayIngressRouteRegistry.listRedacted()).toHaveLength(0);
        expect(result).toMatchObject({
            state: 'rolled_back',
            reconciliationRequired: false,
            registryReconciliation: {
                previousUsesIngress: false,
                targetUsesIngress: true,
                targetRevision: 1,
                verified: true,
            },
        });
    });

    it('verifica rollback ingress para ingress na revisão restaurada', async () => {
        const previousRoute = {
            providerId: 'openrouter',
            providerModel: 'old-model',
            baseUrl: 'https://openrouter.ai/api/v1',
            wireApi: 'completions',
            bindingStrategy: 'ingress',
            sdkRouteKey: 'session-stable:repo_agent:model-gateway',
            sdkVisibleModel: 'model-gateway-live',
            updatedAt: Date.now(),
        };
        mocks.readState.mockReturnValueOnce({ modelGatewayActiveRoute: previousRoute });
        registerIngressRoute(previousRoute, { expectedRevision: null });
        mocks.executeRouteSwitch.mockImplementationOnce(async (input) => {
            await input.reattach(input.targetRoute);
            const previous = await input.reattach(input.previousRoute);
            await input.commit(previous, input.previousRoute);
            return {
                schemaVersion: 'model-gateway.same-session-route-switch.v1',
                state: 'rolled_back',
                sessionId: input.sessionId,
                previousRoute: input.previousRoute,
                targetRoute: input.targetRoute,
                rollback: { verified: true },
                requiresNewSession: false,
                reconciliationRequired: false,
            };
        });
        const { switchAgentRouteTransactional } =
            await import('../../../../src/copilot/agent/facades/agent-route-config.js');

        const result = await switchAgentRouteTransactional(
            /** @type {any} */ (createContext()),
            {
                providerId: 'groq',
                providerModel: 'llama-3.3-70b-versatile',
                baseUrl: 'https://api.groq.com/openai/v1',
                wireApi: 'completions',
                bindingStrategy: 'ingress',
                routeProfile: 'repo_agent',
                sdkRouteKey: 'session-stable:repo_agent:model-gateway',
                sdkVisibleModel: 'model-gateway-live',
            },
            {
                idempotencyKey: 'agent-route-ingress-to-ingress-rollback',
                source: 'unit.agent.registry-reconcile',
                reattach: async (route) => {
                    const current = defaultModelGatewayIngressRouteRegistry.findBySdkRouteKey(
                        String(route['sdkRouteKey']),
                    );
                    registerIngressRoute(route, { expectedRevision: current?.revision ?? null });
                    return /** @type {any} */ ({ sessionId: 'session-stable' });
                },
            },
        );

        const restored = defaultModelGatewayIngressRouteRegistry.findBySdkRouteKey(
            'session-stable:repo_agent:model-gateway',
        );
        expect(restored).toMatchObject({
            revision: 3,
            ingressRoute: {
                providerId: 'openrouter',
                providerModel: 'old-model',
            },
        });
        expect(result).toMatchObject({
            state: 'rolled_back',
            reconciliationRequired: false,
            registryReconciliation: {
                previousUsesIngress: true,
                targetUsesIngress: true,
                targetRevision: 3,
                rollbackRevision: 3,
                previousRevision: 1,
                verified: true,
            },
        });
    });

    it('falha fechado diante de conflito CAS durante cleanup pós-commit', async () => {
        const previousRoute = {
            providerId: 'openrouter',
            providerModel: 'old-model',
            baseUrl: 'https://openrouter.ai/api/v1',
            wireApi: 'completions',
            bindingStrategy: 'ingress',
            sdkRouteKey: 'session-stable:repo_agent:model-gateway',
            sdkVisibleModel: 'model-gateway-live',
            updatedAt: Date.now(),
        };
        mocks.readState.mockReturnValueOnce({ modelGatewayActiveRoute: previousRoute });
        const previousEntry = registerIngressRoute(previousRoute, { expectedRevision: null });
        mocks.executeRouteSwitch.mockImplementationOnce(async (input) => {
            registerIngressRoute(
                {
                    ...previousRoute,
                    providerId: 'concurrent-provider',
                    providerModel: 'concurrent-model',
                },
                { expectedRevision: previousEntry.revision },
            );
            return {
                schemaVersion: 'model-gateway.same-session-route-switch.v1',
                state: 'committed',
                sessionId: input.sessionId,
                previousRoute: input.previousRoute,
                targetRoute: input.targetRoute,
                requiresNewSession: false,
                reconciliationRequired: false,
            };
        });
        const { switchAgentRouteTransactional } =
            await import('../../../../src/copilot/agent/facades/agent-route-config.js');

        const result = await switchAgentRouteTransactional(
            /** @type {any} */ (createContext()),
            {
                providerId: 'groq',
                providerModel: 'llama-3.3-70b-versatile',
                baseUrl: 'https://api.groq.com/openai/v1',
                wireApi: 'completions',
                bindingStrategy: 'direct',
                directRebindReliable: true,
            },
            {
                idempotencyKey: 'agent-route-cas-conflict',
                source: 'unit.agent.registry-reconcile',
                reattach: vi.fn(),
            },
        );

        expect(result).toMatchObject({
            state: 'committed',
            reconciliationRequired: true,
            warnings: expect.arrayContaining(['previous_ingress_registry_cleanup_revision_conflict']),
            registryReconciliation: {
                previousRevision: 1,
                verified: false,
            },
        });
        expect(defaultModelGatewayIngressRouteRegistry.findBySdkRouteKey(previousRoute.sdkRouteKey)).toMatchObject({
            revision: 2,
            ingressRoute: { providerId: 'concurrent-provider' },
        });
    });

    it('bloqueia rota incompatível antes do executor e sem persistir estado', async () => {
        const { switchAgentRouteTransactional } =
            await import('../../../../src/copilot/agent/facades/agent-route-config.js');
        const ctx = createContext();

        const result = await switchAgentRouteTransactional(
            /** @type {any} */ (ctx),
            {
                providerId: 'openai',
                providerModel: 'gpt-5.2-codex',
                providerType: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                wireApi: 'responses',
                directRebindReliable: false,
            },
            {
                idempotencyKey: 'agent-route-binding-blocked',
                source: 'unit.agent.binding-strategy',
                reattach: vi.fn(),
            },
        );

        expect(result).toMatchObject({
            state: 'failed',
            error: 'MODEL_GATEWAY_BINDING_STRATEGY_BLOCKED',
            requiresNewSession: false,
            bindingDecision: {
                strategy: 'blocked',
                ingressEligible: false,
            },
        });
        expect(mocks.executeRouteSwitch).not.toHaveBeenCalled();
        expect(mocks.persistState).not.toHaveBeenCalled();
    });
});
