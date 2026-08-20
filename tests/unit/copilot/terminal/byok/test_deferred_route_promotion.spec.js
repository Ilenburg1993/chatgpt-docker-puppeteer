// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordTerminalActivity, requestTerminalLiveByokRouteSwitch } = vi.hoisted(() => ({
    recordTerminalActivity: vi.fn(),
    requestTerminalLiveByokRouteSwitch: vi.fn(),
}));

vi.mock('../../../../../src/copilot/terminal/state/index.js', () => ({
    recordTerminalActivity,
}));

vi.mock('../../../../../src/copilot/terminal/byok/live-model-switch.js', () => ({
    requestTerminalLiveByokRouteSwitch,
}));

vi.mock('#copilot/model-gateway', async () => ({
    ...(await vi.importActual('../../../../../src/copilot/model-gateway/control-plane/deferred-route-operation.js')),
    SqliteModelGatewayCatalogStore: class {},
}));

const { promoteTerminalDeferredByokRouteSwitchesAtTurnBoundary } =
    await import('../../../../../src/copilot/terminal/byok/deferred-route-promotion.js');

function deferredOperation() {
    return {
        handoffId: 'same-session-route-switch:abc',
        operation: {
            operationId: 'same-session-route-switch:abc',
            idempotencyKey: 'route-promotion-key-20260616',
            state: 'deferred_until_turn_boundary',
            requiresNewSession: false,
            retryable: true,
            deferReason: 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED',
            createdAt: '2026-06-16T12:00:00.000Z',
            sessionId: 'session-stable',
            promotionAuthorization: {
                authorized: true,
                policy: 'authorized_after_turn_boundary',
                source: 'confirmed_model_gateway_route_switch_apply',
                expiresAt: '2026-06-16T12:10:00.000Z',
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
    };
}

describe('promoteTerminalDeferredByokRouteSwitchesAtTurnBoundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requestTerminalLiveByokRouteSwitch.mockResolvedValue({
            operation: { state: 'committed', sessionId: 'session-stable' },
            detail: 'rota viva confirmada na mesma sessão: ollama-cloud/qwen3-coder-next',
        });
    });

    it('promove route switch diferido recente com a mesma idempotency key e sem nova sessão', async () => {
        const store = {
            readDeferredSdkSessionHandoffRecords: vi.fn().mockResolvedValue([deferredOperation()]),
        };

        const result = await promoteTerminalDeferredByokRouteSwitchesAtTurnBoundary({
            store,
            sessionId: 'session-stable',
            now: Date.parse('2026-06-16T12:01:00.000Z'),
        });

        expect(result).toMatchObject({ scanned: 1, promoted: 1, skipped: 0, errors: 0 });
        expect(requestTerminalLiveByokRouteSwitch).toHaveBeenCalledWith(
            expect.objectContaining({
                providerId: 'ollama-cloud',
                providerModel: 'qwen3-coder-next',
            }),
            expect.objectContaining({
                idempotencyKey: 'route-promotion-key-20260616',
                forceApplyDeferred: true,
                source: 'terminal.byok_route_deferred_turn_end',
            }),
        );
        expect(recordTerminalActivity).toHaveBeenCalledWith(
            'model',
            'Rotas diferidas promovidas no fim do turno',
            expect.objectContaining({
                severity: 'info',
                recordHistory: true,
            }),
        );
    });

    it('não promove deferimento sem motivo automático de active dialog loop', async () => {
        const row = deferredOperation();
        row.operation.deferReason = 'MANUAL_DEFERRED_FOR_REVIEW';
        const store = {
            readDeferredSdkSessionHandoffRecords: vi.fn().mockResolvedValue([row]),
        };

        const result = await promoteTerminalDeferredByokRouteSwitchesAtTurnBoundary({
            store,
            sessionId: 'session-stable',
            now: Date.parse('2026-06-16T12:01:00.000Z'),
        });

        expect(result).toMatchObject({ scanned: 1, promoted: 0, skipped: 1, errors: 0 });
        expect(result.records[0]).toMatchObject({
            promoted: false,
            skippedReason: 'defer_reason_not_auto_promotable',
        });
        expect(requestTerminalLiveByokRouteSwitch).not.toHaveBeenCalled();
    });
});
