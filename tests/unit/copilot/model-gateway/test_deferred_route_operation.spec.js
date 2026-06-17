// @ts-check

import { describe, expect, it } from 'vitest';
import {
    MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_POLICY,
    classifyModelGatewayDeferredRouteOperation,
} from '../../../../src/copilot/model-gateway/control-plane/deferred-route-operation.js';

function operation(overrides = {}) {
    return {
        operationId: 'same-session-route-switch:test',
        idempotencyKey: 'deferred-route-test-key',
        sessionId: 'session-a',
        state: 'deferred_until_turn_boundary',
        requiresNewSession: false,
        retryable: true,
        deferReason: 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED',
        createdAt: '2026-06-16T12:00:00.000Z',
        promotionAuthorization: {
            authorized: true,
            policy: MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_POLICY.AUTHORIZED_AFTER_TURN_BOUNDARY,
            source: 'confirmed_model_gateway_route_switch_apply',
            expiresAt: '2026-06-16T12:10:00.000Z',
        },
        targetRoute: {
            providerId: 'ollama-cloud',
            providerModel: 'qwen3-coder-next',
        },
        ...overrides,
    };
}

describe('classifyModelGatewayDeferredRouteOperation', () => {
    it('autoriza promoção apenas para a mesma sessão dentro da janela persistida', () => {
        expect(
            classifyModelGatewayDeferredRouteOperation(operation(), {
                now: Date.parse('2026-06-16T12:01:00.000Z'),
                expectedSessionId: 'session-a',
            }),
        ).toMatchObject({
            classification: 'promotable',
            promotable: true,
            expired: false,
            requiresReview: false,
            sessionId: 'session-a',
        });
    });

    it('falha fechado quando a autorização automática não foi persistida', () => {
        const candidate = operation({
            promotionAuthorization: {
                authorized: false,
                policy: MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_POLICY.MANUAL_REVIEW,
                source: 'unknown',
            },
        });
        expect(
            classifyModelGatewayDeferredRouteOperation(candidate, {
                now: Date.parse('2026-06-16T12:01:00.000Z'),
                expectedSessionId: 'session-a',
            }),
        ).toMatchObject({
            classification: 'review_required',
            promotable: false,
            reason: 'automatic_promotion_not_authorized',
        });
    });

    it('classifica expiração antes de qualquer promoção', () => {
        expect(
            classifyModelGatewayDeferredRouteOperation(operation(), {
                now: Date.parse('2026-06-16T12:11:00.000Z'),
                expectedSessionId: 'session-a',
            }),
        ).toMatchObject({
            classification: 'expired',
            promotable: false,
            expired: true,
            requiresReview: true,
        });
    });

    it('bloqueia promoção cruzada entre sessões', () => {
        expect(
            classifyModelGatewayDeferredRouteOperation(operation(), {
                now: Date.parse('2026-06-16T12:01:00.000Z'),
                expectedSessionId: 'session-b',
            }),
        ).toMatchObject({
            classification: 'review_required',
            promotable: false,
            reason: 'deferred_operation_session_mismatch',
        });
    });

    it('não reativa operação cancelada', () => {
        expect(
            classifyModelGatewayDeferredRouteOperation(operation({ state: 'cancelled' }), {
                now: Date.parse('2026-06-16T12:01:00.000Z'),
                expectedSessionId: 'session-a',
            }),
        ).toMatchObject({ classification: 'cancelled', promotable: false, reason: 'operation_cancelled' });
    });
});
