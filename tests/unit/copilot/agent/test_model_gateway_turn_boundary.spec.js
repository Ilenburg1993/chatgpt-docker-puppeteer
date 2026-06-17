// @ts-check

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { wireAgentModelGatewayTurnBoundaryPromotion } from '../../../../src/copilot/agent/lifecycle/model-gateway-turn-boundary.js';

class TestHost extends EventEmitter {
    switchRoute = vi.fn();
}

describe('wireAgentModelGatewayTurnBoundaryPromotion', () => {
    it('promove após dialog.turn_end sem exigir nova chamada da LLM-B', async () => {
        const host = new TestHost();
        const tracked = [];
        const ctx = {
            getSessionSnapshot: () => ({ sessionId: 'session-stable' }),
            trackBackgroundTask: async (task, meta) => {
                tracked.push({ task, meta });
                await task;
            },
        };
        const promote = vi.fn().mockImplementation(async ({ switchRoute }) => {
            await switchRoute(
                { providerId: 'ollama-cloud', providerModel: 'qwen3-coder-next' },
                null,
                {
                    idempotencyKey: 'route-key',
                    source: 'agent.dialog_turn_end.model_gateway_route_promotion',
                    allowActiveDialogLoopReattach: true,
                    forceApplyDeferred: true,
                },
            );
            return {
                sessionId: 'session-stable',
                scanned: 1,
                promoted: 1,
                superseded: 0,
                skipped: 0,
                errors: 0,
                records: [],
            };
        });
        host.switchRoute.mockResolvedValue({ operation: { state: 'committed', sessionId: 'session-stable' } });

        const dispose = wireAgentModelGatewayTurnBoundaryPromotion(ctx, host, { promote });
        expect(promote).not.toHaveBeenCalled();

        host.emit('dialog.turn_end', { durationMs: 100 });
        await vi.waitFor(() => expect(promote).toHaveBeenCalledTimes(1));
        await Promise.all(tracked.map((entry) => entry.task));

        expect(promote).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 'session-stable',
                source: 'agent.dialog_turn_end.model_gateway_route_promotion',
                switchRoute: expect.any(Function),
            }),
        );
        expect(host.switchRoute).toHaveBeenCalledWith(
            expect.objectContaining({ providerModel: 'qwen3-coder-next' }),
            expect.objectContaining({
                idempotencyKey: 'route-key',
                allowActiveDialogLoopReattach: true,
                forceApplyDeferred: true,
            }),
        );
        expect(tracked[0].meta).toMatchObject({ label: 'model-gateway.deferred-route-promotion' });
        dispose();
    });

    it('não consulta o ledger sem sessão SDK viva', async () => {
        const host = new TestHost();
        const tracked = [];
        const ctx = {
            getSessionSnapshot: () => null,
            trackBackgroundTask: async (task) => {
                tracked.push(task);
                await task;
            },
        };
        const promote = vi.fn();
        const dispose = wireAgentModelGatewayTurnBoundaryPromotion(ctx, host, { promote });

        host.emit('dialog.turn_end', {});
        await vi.waitFor(() => expect(tracked).toHaveLength(1));
        await Promise.all(tracked);

        expect(promote).not.toHaveBeenCalled();
        dispose();
    });

    it('adiar promoção quando o turn_end abre ask_user até o turno pós-resposta concluir', async () => {
        const host = new TestHost();
        const tracked = [];
        let pendingQuestion = false;
        const ctx = {
            getSessionSnapshot: () => ({ sessionId: 'session-stable' }),
            hasPendingQuestion: () => pendingQuestion,
            trackBackgroundTask: async (task) => {
                tracked.push(task);
                await task;
            },
        };
        const promote = vi.fn().mockResolvedValue({
            sessionId: 'session-stable',
            scanned: 1,
            promoted: 1,
            superseded: 0,
            skipped: 0,
            errors: 0,
            records: [],
        });
        const dispose = wireAgentModelGatewayTurnBoundaryPromotion(ctx, host, {
            promote,
            turnBoundarySettleMs: 20,
        });

        host.emit('dialog.turn_end', { durationMs: 100 });
        pendingQuestion = true;
        host.emit('question.pending', { question: 'continuar?' });
        pendingQuestion = false;
        host.emit('question.answered', { answer: 'SIM', hadPending: true });
        await vi.waitFor(() => expect(tracked).toHaveLength(1));
        await Promise.all(tracked.splice(0));

        expect(promote).not.toHaveBeenCalled();

        host.emit('dialog.turn_end', { durationMs: 20 });
        await vi.waitFor(() => expect(promote).toHaveBeenCalledTimes(1));
        await Promise.all(tracked);

        dispose();
    });

    it('remove o listener ao descartar o scheduler', async () => {
        const host = new TestHost();
        const ctx = {
            getSessionSnapshot: () => ({ sessionId: 'session-stable' }),
            trackBackgroundTask: async (task) => void (await task),
        };
        const promote = vi.fn();
        const dispose = wireAgentModelGatewayTurnBoundaryPromotion(ctx, host, { promote });
        dispose();

        host.emit('dialog.turn_end', {});
        await Promise.resolve();

        expect(promote).not.toHaveBeenCalled();
    });
});
