// @ts-check

import { describe, expect, it, vi } from 'vitest';
import { promoteModelGatewayDeferredRouteSwitchAtTurnBoundary } from '../../../../src/copilot/model-gateway/control-plane/deferred-route-promotion.js';

function handoff(id, providerModel, requestedAt) {
    return {
        handoffId: id,
        status: 'deferred_until_turn_boundary',
        requestedAt,
        operation: {
            operationId: id,
            idempotencyKey: `${id}:key`,
            sessionId: 'session-stable',
            state: 'deferred_until_turn_boundary',
            requiresNewSession: false,
            retryable: true,
            deferReason: 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED',
            createdAt: requestedAt,
            promotionAuthorization: {
                authorized: true,
                policy: 'authorized_after_turn_boundary',
                source: 'confirmed_model_gateway_route_switch_apply',
                expiresAt: '2026-06-16T12:10:00.000Z',
            },
            targetRoute: {
                providerId: 'ollama-cloud',
                providerModel,
                selectorSyntax: providerModel,
            },
        },
    };
}

describe('promoteModelGatewayDeferredRouteSwitchAtTurnBoundary', () => {
    it('promove apenas a intenção mais recente da sessão e supersede as anteriores', async () => {
        const newest = handoff(
            'same-session-route-switch:newest',
            'qwen3-coder-next',
            '2026-06-16T12:00:02.000Z',
        );
        const older = handoff(
            'same-session-route-switch:older',
            'deepseek-r1',
            '2026-06-16T12:00:01.000Z',
        );
        const store = {
            readDeferredSdkSessionHandoffRecords: vi.fn().mockResolvedValue([newest, older]),
            supersedeDeferredSdkSessionHandoffRecords: vi.fn().mockResolvedValue({ superseded: 1 }),
        };
        const switchRoute = vi.fn().mockResolvedValue({
            operation: {
                operationId: 'same-session-route-switch:newest',
                sessionId: 'session-stable',
                state: 'committed',
            },
        });

        const result = await promoteModelGatewayDeferredRouteSwitchAtTurnBoundary({
            store,
            sessionId: 'session-stable',
            now: Date.parse('2026-06-16T12:01:00.000Z'),
            switchRoute,
        });

        expect(result).toMatchObject({
            sessionId: 'session-stable',
            scanned: 2,
            promoted: 1,
            superseded: 1,
            skipped: 0,
            errors: 0,
        });
        expect(store.supersedeDeferredSdkSessionHandoffRecords).toHaveBeenCalledWith({
            sessionId: 'session-stable',
            exceptHandoffId: 'same-session-route-switch:newest',
            supersededBy: 'same-session-route-switch:newest',
            observedAt: Date.parse('2026-06-16T12:01:00.000Z'),
        });
        expect(switchRoute).toHaveBeenCalledTimes(1);
        expect(switchRoute).toHaveBeenCalledWith(
            expect.objectContaining({ providerModel: 'qwen3-coder-next' }),
            null,
            expect.objectContaining({
                idempotencyKey: 'same-session-route-switch:newest:key',
                allowActiveDialogLoopReattach: true,
                forceApplyDeferred: true,
            }),
        );
    });

    it('não promove operação de outra sessão nem sem autorização persistida', async () => {
        const candidate = handoff(
            'same-session-route-switch:unauthorized',
            'qwen3-coder-next',
            '2026-06-16T12:00:02.000Z',
        );
        candidate.operation.promotionAuthorization.authorized = false;
        candidate.operation.promotionAuthorization.policy = 'manual_review';
        const store = {
            readDeferredSdkSessionHandoffRecords: vi.fn().mockResolvedValue([candidate]),
            supersedeDeferredSdkSessionHandoffRecords: vi.fn(),
        };
        const switchRoute = vi.fn();

        const result = await promoteModelGatewayDeferredRouteSwitchAtTurnBoundary({
            store,
            sessionId: 'session-stable',
            now: Date.parse('2026-06-16T12:01:00.000Z'),
            switchRoute,
        });

        expect(result).toMatchObject({ promoted: 0, skipped: 1, errors: 0 });
        expect(result.records[0]).toMatchObject({
            promoted: false,
            skippedReason: 'automatic_promotion_not_authorized',
        });
        expect(switchRoute).not.toHaveBeenCalled();
    });

    it('não promove operação expirada', async () => {
        const store = {
            readDeferredSdkSessionHandoffRecords: vi.fn().mockResolvedValue([
                handoff(
                    'same-session-route-switch:expired',
                    'qwen3-coder-next',
                    '2026-06-16T12:00:00.000Z',
                ),
            ]),
            supersedeDeferredSdkSessionHandoffRecords: vi.fn(),
        };
        const switchRoute = vi.fn();

        const result = await promoteModelGatewayDeferredRouteSwitchAtTurnBoundary({
            store,
            sessionId: 'session-stable',
            now: Date.parse('2026-06-16T12:11:00.000Z'),
            switchRoute,
        });

        expect(result).toMatchObject({ promoted: 0, skipped: 1, errors: 0 });
        expect(result.records[0]).toMatchObject({ classification: 'expired', skippedReason: 'deferred_operation_expired' });
        expect(switchRoute).not.toHaveBeenCalled();
    });
});
