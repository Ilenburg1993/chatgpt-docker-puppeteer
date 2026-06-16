// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordTerminalActivity, switchTerminalRouteProjection } = vi.hoisted(() => ({
    recordTerminalActivity: vi.fn(),
    switchTerminalRouteProjection: vi.fn(),
}));

vi.mock('../../../../../src/copilot/terminal/frontend/projections/model-selection/index.js', () => ({
    switchTerminalRouteProjection,
}));

vi.mock('../../../../../src/copilot/terminal/events/presenters/model/index.js', () => ({
    buildTerminalModelTransitionPresentation: vi.fn(() => ({ detail: 'modelo vivo solicitado' })),
}));

vi.mock('../../../../../src/copilot/terminal/state/index.js', () => ({
    recordTerminalActivity,
}));

describe('terminal BYOK live model switch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        switchTerminalRouteProjection.mockResolvedValue({
            runtimeId: 'default',
            previousModel: 'kilo-auto/free',
            currentModel: 'qwen3-coder-next',
            operation: {
                state: 'committed',
                sessionId: 'sdk-session-1',
            },
        });
    });

    it('conclui route switch diferido com reattach explícito no terminal sem nova sessão', async () => {
        const { requestTerminalLiveByokRouteSwitch } = await import(
            '../../../../../src/copilot/terminal/byok/live-model-switch.js'
        );

        const result = await requestTerminalLiveByokRouteSwitch(
            {
                providerId: 'ollama-cloud',
                providerModel: 'qwen3-coder-next',
                selectorSyntax: 'qwen3-coder-next',
                baseUrl: 'https://ollama.com/v1',
                openAICompatibleBaseUrl: 'https://ollama.com/v1',
                wireApi: 'completions',
                providerProfile: 'ollama-cloud',
                routeProfile: 'repo_agent',
                selectedRouteKey: 'live-route-minimal:ollama-cloud:qwen3-coder-next',
            },
            {
                runtimeId: null,
                source: 'terminal.byok_route',
                idempotencyKey: 'live-route-minimal-20260616:route-switch-ollama-cloud',
                forceApplyDeferred: true,
                timeoutMs: 60_000,
            },
        );

        expect(switchTerminalRouteProjection).toHaveBeenCalledWith(
            expect.objectContaining({
                providerId: 'ollama-cloud',
                providerModel: 'qwen3-coder-next',
            }),
            null,
            expect.objectContaining({
                idempotencyKey: 'live-route-minimal-20260616:route-switch-ollama-cloud',
                timeoutMs: 60_000,
                source: 'terminal.byok_route',
                allowActiveDialogLoopReattach: true,
                forceApplyDeferred: true,
            }),
        );
        expect(result.operation).toMatchObject({
            state: 'committed',
            sessionId: 'sdk-session-1',
        });
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'model',
            'Troca de rota confirmada',
            expect.objectContaining({
                source: 'terminal.byok_route',
                updateCurrent: true,
            }),
        );
    });
});
