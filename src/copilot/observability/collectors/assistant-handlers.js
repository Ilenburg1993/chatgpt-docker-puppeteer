// @ts-check
/**
 * src/copilot/observability/collectors/assistant-handlers.js
 *
 * Handlers de eventos de assistant/user do EventCollector.
 *
 * @module copilot/observability/collectors/assistant-handlers
 * @see EventBus
 */

import { SESSION_EVENTS as SE } from '#copilot/sdk';
import { log } from '../logger.js';

/** @typedef {import('./context.js').CollectorContext} CollectorContext */

/**
 * Referência mutável para quotaSnapshots (compartilhada com event-collector.js).
 *
 * @type {{ snapshots: Record<string, unknown>; ts: number }}
 */
export const quotaState = { snapshots: {}, ts: 0 };

/** TTL para entradas _turnStart em milissegundos (10 min). */
const _TURN_TTL_MS = 10 * 60 * 1000;

/**
 * Registra handlers de assistant.* e user.* na sessão SDK.
 *
 * @param {CollectorContext} ctx
 * @returns {(() => void)[]}
 */
export function attachAssistantHandlers(ctx) {
    const {
        session,
        sessionId,
        metrics,
        hookBus,
        persist,
        persistSet,
        persistEvent,
        turnStart,
        captureUserContent,
        captureAssistantContent,
    } = ctx;
    /** @type {(() => void)[]} */
    const unsubs = [];

    // ── assistant.usage (tokens + quota + cost) ──────────────────────────
    unsubs.push(
        session.on(SE.ASSISTANT_USAGE, (event) => {
            const {
                model,
                inputTokens,
                outputTokens,
                cacheReadTokens,
                cacheWriteTokens,
                duration,
                cost,
                reasoningEffort,
                initiator,
                apiCallId,
                providerCallId,
                parentToolCallId,
                quotaSnapshots,
                copilotUsage,
            } = event.data;

            metrics?.recordUsage(
                model ?? 'unknown',
                inputTokens ?? 0,
                outputTokens ?? 0,
                cacheReadTokens ?? 0,
                cacheWriteTokens ?? 0,
            );

            if (reasoningEffort) {
                metrics?.recordCounter(`reasoning.effort.${reasoningEffort}`);
            }

            if (quotaSnapshots) {
                quotaState.snapshots = /** @type {Record<string, unknown>} */ (quotaSnapshots);
                quotaState.ts = Date.now();
                for (const [quotaId, snapshot] of Object.entries(quotaSnapshots)) {
                    const snap = /** @type {{ remainingPercentage: number; resetDate?: string }} */ (snapshot);
                    if (snap.remainingPercentage < 0.1) {
                        metrics?.recordCounter('quota.low_warning');
                        log(
                            'WARN',
                            `[event-collector] quota baixa: quotaId=${quotaId} remaining=${(snap.remainingPercentage * 100).toFixed(1)}% resetDate=${snap.resetDate ?? 'n/a'} session=${sessionId}`,
                        );
                    }
                }
            }

            if (persist && persistSet.has('assistant.usage')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    model,
                    inputTokens,
                    outputTokens,
                    cacheReadTokens,
                    cacheWriteTokens,
                    duration,
                    cost,
                    reasoningEffort,
                    initiator,
                    apiCallId,
                    providerCallId,
                    parentToolCallId,
                    quotaSnapshots,
                    totalNanoAiu: copilotUsage?.totalNanoAiu ?? null,
                });
            }
            hookBus?.emitHook(
                'post_tool_use',
                sessionId,
                {
                    _eventType: 'assistant.usage',
                    model,
                    inputTokens,
                    outputTokens,
                    cacheReadTokens,
                    cacheWriteTokens,
                },
                null,
            );
            log(
                'DEBUG',
                `[event-collector] assistant.usage: model=${model} in=${inputTokens ?? 0} out=${outputTokens ?? 0} cacheR=${cacheReadTokens ?? 0} cacheW=${cacheWriteTokens ?? 0} cost=${cost ?? 'n/a'} effort=${reasoningEffort ?? 'n/a'} session=${sessionId}`,
            );
        }),
    );

    // ── assistant.turn_start / turn_end ──────────────────────────────────
    unsubs.push(
        session.on(SE.ASSISTANT_TURN_START, (event) => {
            const { turnId } = event.data;
            if (turnId) {
                const _nowTs = Date.now();
                for (const [id, startTs] of turnStart) {
                    if (_nowTs - startTs > _TURN_TTL_MS) turnStart.delete(id);
                }
                turnStart.set(turnId, _nowTs);
            }
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
        }),
    );

    unsubs.push(
        session.on(SE.ASSISTANT_TURN_END, (event) => {
            const { turnId } = event.data;
            const startTs = turnId ? turnStart.get(turnId) : undefined;
            if (turnId) turnStart.delete(turnId);
            const durationMs = startTs ? Date.now() - startTs : 0;
            metrics?.recordDialogTurn(durationMs, true);
            if (persist && persistSet.has('assistant.turn_end')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, turnId, durationMs });
            }
            log('DEBUG', `[event-collector] turn_end: ${turnId ?? 'n/a'} (${durationMs}ms) session=${sessionId}`);
        }),
    );

    // ── assistant.message / intent ───────────────────────────────────────
    unsubs.push(
        session.on(SE.ASSISTANT_MESSAGE, (event) => {
            const { messageId, content } = event.data;
            metrics?.recordCounter('assistant.message');
            if (persist && persistSet.has('assistant.message')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    messageId,
                    ...(captureAssistantContent ? { content } : { contentLength: content?.length ?? 0 }),
                });
            }
        }),
    );

    unsubs.push(
        session.on(SE.ASSISTANT_INTENT, (event) => {
            const { intent } = event.data;
            metrics?.recordCounter(`assistant.intent.${intent ?? 'unknown'}`);
            if (persist && persistSet.has('assistant.intent')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, intent });
            }
        }),
    );

    // ── assistant.reasoning ──────────────────────────────────────────────
    unsubs.push(
        session.on(SE.ASSISTANT_REASONING, (event) => {
            const { reasoningId, content } = event.data;
            metrics?.recordCounter('assistant.reasoning');
            if (persist && persistSet.has('assistant.reasoning')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    reasoningId,
                    contentLength: content?.length ?? 0,
                });
            }
            log('DEBUG', `[event-collector] assistant.reasoning id=${reasoningId ?? '?'} len=${content?.length ?? 0}`);
        }),
    );

    // ── assistant.message_delta — inter-token latency histogram ──────────
    {
        /** @type {number} */
        let _lastDeltaTs = 0;
        unsubs.push(
            session.on(SE.ASSISTANT_MESSAGE_DELTA, () => {
                const now = performance.now();
                if (_lastDeltaTs > 0) {
                    const gap = Math.round(now - _lastDeltaTs);
                    /** @type {string} */
                    let bucket;
                    if (gap <= 50) bucket = '0_50';
                    else if (gap <= 100) bucket = '50_100';
                    else if (gap <= 250) bucket = '100_250';
                    else if (gap <= 500) bucket = '250_500';
                    else bucket = '500_plus';
                    metrics?.recordCounter(`inter_token_latency.bucket.${bucket}`);
                    metrics?.recordGauge('inter_token_latency.last_ms', gap);
                }
                _lastDeltaTs = now;
            }),
        );
        unsubs.push(
            session.on(SE.ASSISTANT_TURN_END, () => {
                _lastDeltaTs = 0;
            }),
        );
    }

    // ── assistant.streaming_delta (ephemeral) ────────────────────────────
    unsubs.push(
        session.on(SE.ASSISTANT_STREAMING_DELTA, (event) => {
            metrics?.recordCounter('assistant.streaming_delta');
            const total = /** @type {number | undefined} */ (event.data?.totalResponseSizeBytes);
            if (typeof total === 'number') {
                metrics?.recordCounter(`streaming.response_size.bucket_${Math.floor(total / 102400)}`);
            }
        }),
    );

    // ── user.message ─────────────────────────────────────────────────────
    unsubs.push(
        session.on(SE.USER_MESSAGE, (event) => {
            const { content, attachments } = event.data;
            metrics?.recordCounter('user.message');
            if ((attachments?.length ?? 0) > 0) {
                metrics?.recordCounter('user.message.with_attachments');
            }
            if (persist && persistSet.has('user.message')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    ...(captureUserContent ? { content } : { contentLength: content?.length ?? 0 }),
                    attachmentCount: attachments?.length ?? 0,
                    attachmentTypes:
                        attachments?.map((/** @type {{ type?: string }} */ a) => a.type ?? 'unknown') ?? [],
                });
            }
        }),
    );

    // ── abort ─────────────────────────────────────────────────────────────
    unsubs.push(
        session.on(SE.ABORT, (event) => {
            metrics?.recordCounter('turn.aborted');
            metrics?.recordSessionError();
            if (persist && persistSet.has('abort')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, reason: event.data.reason });
            }
            log('WARN', `[event-collector] turn aborted: ${event.data.reason ?? 'unknown'} session=${sessionId}`);
        }),
    );

    return unsubs;
}
