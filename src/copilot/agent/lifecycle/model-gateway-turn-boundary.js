// @ts-check
/**
 * Agent-owned scheduler for Model Gateway route promotions at the semantic dialog-turn boundary.
 *
 * This is intentionally not terminal wiring. LLM-B route tools run inside the active dialog turn and can only arm a
 * deferred operation. Once `dialog.turn_end` is emitted, the Agent owns the continuation and reattaches the exact same
 * SDK session without requiring another LLM tool call.
 *
 * @module copilot/agent/lifecycle/model-gateway-turn-boundary
 */

import {
    EMITTER_QUESTION_ANSWERED,
    EMITTER_QUESTION_PENDING,
    EMITTER_USER_INPUT_COMPLETED,
    EMITTER_USER_INPUT_REQUESTED,
} from '#copilot/events';
import { promoteModelGatewayDeferredRouteSwitchAtTurnBoundary } from '#copilot/model-gateway';
import { log } from '../ports/logging/index.js';

/**
 * @typedef {{
 *     getSessionSnapshot: () => { sessionId: string } | null;
 *     trackBackgroundTask: (task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>;
 *     hasPendingQuestion?: () => boolean;
 *     getDialogTurnQueueDepth?: () => number;
 *     isProcessing?: () => boolean;
 * }} ModelGatewayTurnBoundaryContext
 *
 *
 * @typedef {import('node:events').EventEmitter & {
 *     switchRoute: (
 *         route: Record<string, unknown>,
 *         options?: {
 *             idempotencyKey?: string;
 *             source?: string;
 *             allowActiveDialogLoopReattach?: boolean;
 *             forceApplyDeferred?: boolean;
 *         },
 *     ) => Promise<Record<string, unknown>>;
 * }} ModelGatewayTurnBoundaryHost
 */

/**
 * @param {ModelGatewayTurnBoundaryContext} ctx
 * @param {ModelGatewayTurnBoundaryHost} host
 * @param {{
 *     promote?: typeof promoteModelGatewayDeferredRouteSwitchAtTurnBoundary;
 *     source?: string;
 *     turnBoundarySettleMs?: number;
 * }} [options]
 * @returns {() => void}
 */
export function wireAgentModelGatewayTurnBoundaryPromotion(ctx, host, options = {}) {
    const promote = options.promote ?? promoteModelGatewayDeferredRouteSwitchAtTurnBoundary;
    const source = options.source ?? 'agent.dialog_turn_end.model_gateway_route_promotion';
    const turnBoundarySettleMs = Math.max(0, Math.min(Math.floor(options.turnBoundarySettleMs ?? 3_000), 10_000));
    let running = false;
    let rerunRequested = false;
    let disposed = false;
    let humanQuestionOpen = false;
    let awaitingPostQuestionTurnEnd = false;

    const shouldDelayPromotion = () => {
        const queueDepth = ctx.getDialogTurnQueueDepth?.() ?? 0;
        return (
            humanQuestionOpen ||
            awaitingPostQuestionTurnEnd ||
            ctx.hasPendingQuestion?.() === true ||
            ctx.isProcessing?.() === true ||
            queueDepth > 0
        );
    };

    const schedule = () => {
        if (disposed) return;
        if (running) {
            rerunRequested = true;
            return;
        }
        running = true;
        const task = Promise.resolve()
            .then(async () => {
                if (turnBoundarySettleMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, turnBoundarySettleMs));
                }
                if (disposed || shouldDelayPromotion()) return null;
                const session = ctx.getSessionSnapshot();
                if (!session?.sessionId) return null;
                const result = await promote({
                    sessionId: session.sessionId,
                    source,
                    switchRoute: (route, _runtimeId, switchOptions) => host.switchRoute(route, switchOptions),
                });
                if (result.promoted > 0) {
                    log(
                        'INFO',
                        `[ModelGateway] Route switch diferido promovido após dialog.turn_end ` +
                            `(session=${session.sessionId}, superseded=${result.superseded}).`,
                    );
                } else if (result.errors > 0) {
                    const detail = result.records
                        .map((record) => String(record['error'] ?? record['skippedReason'] ?? 'unknown'))
                        .join('; ');
                    log(
                        'WARN',
                        `[ModelGateway] Promoção pós-turno não foi concluída ` +
                            `(session=${session.sessionId}): ${detail || 'unknown'}`,
                    );
                    throw new Error(`MODEL_GATEWAY_DEFERRED_ROUTE_PROMOTION_FAILED: ${detail || 'unknown'}`);
                }
                return result;
            })
            .catch((error) => {
                log(
                    'WARN',
                    `[ModelGateway] Scheduler pós-turno falhou: ${error instanceof Error ? error.message : String(error)}`,
                );
                throw error;
            })
            .finally(() => {
                running = false;
                if (rerunRequested && !disposed) {
                    rerunRequested = false;
                    schedule();
                }
            });
        void ctx.trackBackgroundTask(task, {
            label: 'model-gateway.deferred-route-promotion',
            description: 'Promote an authorized same-session route switch after dialog.turn_end',
        });
    };

    const onDialogTurnEnd = () => {
        if (awaitingPostQuestionTurnEnd) {
            awaitingPostQuestionTurnEnd = false;
        }
        schedule();
    };
    const onQuestionPending = () => {
        humanQuestionOpen = true;
    };
    const onQuestionAnswered = () => {
        humanQuestionOpen = false;
        awaitingPostQuestionTurnEnd = true;
    };
    host.on('dialog.turn_end', onDialogTurnEnd);
    host.on(EMITTER_QUESTION_PENDING, onQuestionPending);
    host.on(EMITTER_USER_INPUT_REQUESTED, onQuestionPending);
    host.on(EMITTER_QUESTION_ANSWERED, onQuestionAnswered);
    host.on(EMITTER_USER_INPUT_COMPLETED, onQuestionAnswered);
    return () => {
        disposed = true;
        host.off('dialog.turn_end', onDialogTurnEnd);
        host.off(EMITTER_QUESTION_PENDING, onQuestionPending);
        host.off(EMITTER_USER_INPUT_REQUESTED, onQuestionPending);
        host.off(EMITTER_QUESTION_ANSWERED, onQuestionAnswered);
        host.off(EMITTER_USER_INPUT_COMPLETED, onQuestionAnswered);
    };
}
