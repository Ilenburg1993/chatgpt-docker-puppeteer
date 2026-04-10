// @ts-check
/**
 * @module copilot/agent/session/event-handlers/sdk-responses
 * F62.7: Handler de eventos de resposta do SDK (intent, reasoning, turns, lifecycle, subagents, etc.).
 */

import { log } from '#copilot/observability/logger';
import { SESSION_EVENTS } from '#copilot/sdk';

/**
 * @param {import('../event-wirer.js').CopilotSessionLike} session
 * @param {Pick<import('../event-wirer.js').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireSdkResponseEvents(session, { emit }) {
    return [
        session.on(SESSION_EVENTS.ASSISTANT_INTENT, (/** @type {any} */ evt) => {
            const { intent } = evt?.data ?? {};
            emit('assistant.intent', { intent: intent ?? 'unknown', ts: Date.now() });
        }),
        session.on(SESSION_EVENTS.ASSISTANT_REASONING, (/** @type {any} */ evt) => {
            const { reasoningId, content } = evt?.data ?? {};
            const len = typeof content === 'string' ? content.length : 0;
            emit('assistant.reasoning_complete', {
                reasoningId: reasoningId ?? null,
                contentLength: len,
                ts: Date.now(),
            });
        }),
        session.on(SESSION_EVENTS.ASSISTANT_TURN_START, (/** @type {any} */ evt) => {
            const { turnId } = evt?.data ?? {};
            emit('assistant.turn_start', { turnId: turnId ?? null, ts: Date.now() });
            log('DEBUG', `[session-event-wirer] assistant.turn_start turnId=${turnId ?? '?'}`);
        }),
        session.on(SESSION_EVENTS.ASSISTANT_TURN_END, (/** @type {any} */ evt) => {
            const { turnId } = evt?.data ?? {};
            emit('assistant.turn_end', { turnId: turnId ?? null, ts: Date.now() });
            log('DEBUG', `[session-event-wirer] assistant.turn_end turnId=${turnId ?? '?'}`);
        }),
        session.on(SESSION_EVENTS.SESSION_ERROR, (/** @type {any} */ evt) => {
            const data = evt?.data ?? {};
            const errorType = /** @type {string} */ (data['errorType'] ?? 'unknown');
            const message = /** @type {string} */ (data['message'] ?? 'Unknown error');
            emit('session.error', { errorType, message, ts: Date.now() });
            log('ERROR', `[session-event-wirer] session.error type=${errorType}: ${message}`);
        }),
        session.on(SESSION_EVENTS.SESSION_SHUTDOWN, (/** @type {any} */ evt) => {
            const data = evt?.data ?? {};
            emit('session.shutdown', { ...data, ts: Date.now() });
            log('INFO', `[session-event-wirer] session.shutdown type=${data['shutdownType'] ?? '?'}`);
        }),
        session.on(SESSION_EVENTS.SESSION_TASK_COMPLETE, (/** @type {any} */ evt) => {
            const { summary } = evt?.data ?? {};
            emit('session.task_complete', { summary: summary ?? null, ts: Date.now() });
            log('INFO', `[session-event-wirer] session.task_complete`);
        }),
        session.on(SESSION_EVENTS.SESSION_TITLE_CHANGED, (/** @type {any} */ evt) => {
            const { title } = evt?.data ?? {};
            emit('session.title_changed', { title: title ?? '', ts: Date.now() });
            log('DEBUG', `[session-event-wirer] session.title_changed: "${title ?? ''}"`);
        }),
        session.on(SESSION_EVENTS.SESSION_CONTEXT_CHANGED, (/** @type {any} */ evt) => {
            emit('session.context_changed', evt?.data ?? {});
            log('DEBUG', `[session-event-wirer] session.context_changed propagado para AGENT EventEmitter`);
        }),
        session.on(SESSION_EVENTS.ABORT, (/** @type {any} */ evt) => {
            emit('abort', { reason: evt?.data?.['reason'] ?? 'user_initiated', ts: Date.now() });
            log('INFO', '[session-event-wirer] abort propagado para AGENT EventEmitter');
        }),
        session.on(SESSION_EVENTS.SUBAGENT_STARTED, (/** @type {any} */ evt) => {
            const { agentName, agentId } = evt?.data ?? {};
            emit('subagent.started', { agentName, agentId, ts: Date.now() });
        }),
        session.on(SESSION_EVENTS.SUBAGENT_COMPLETED, (/** @type {any} */ evt) => {
            const { agentName, agentId } = evt?.data ?? {};
            emit('subagent.completed', { agentName, agentId, ts: Date.now() });
        }),
        session.on(SESSION_EVENTS.SUBAGENT_FAILED, (/** @type {any} */ evt) => {
            const { agentName, agentId, error } = evt?.data ?? {};
            emit('subagent.failed', { agentName, agentId, error: error ?? 'unknown', ts: Date.now() });
        }),
        session.on(SESSION_EVENTS.ELICITATION_REQUESTED, (/** @type {any} */ evt) => {
            const { requestId, schema, title, description } = evt?.data ?? {};
            emit('elicitation.pending', { requestId, schema, title, description, ts: Date.now() });
            log('INFO', `[session-event-wirer] elicitation.pending requestId=${requestId ?? '?'}`);
        }),
        session.on(SESSION_EVENTS.SESSION_TRUNCATION, (/** @type {any} */ evt) => {
            const { messageTruncatedCount, tokensTruncated, reason } = evt?.data ?? {};
            emit('session.truncation', {
                messageTruncatedCount: messageTruncatedCount ?? 0,
                tokensTruncated: tokensTruncated ?? 0,
                reason: reason ?? 'unknown',
                ts: Date.now(),
            });
            log(
                'WARN',
                `[session-event-wirer] session.truncation: ${messageTruncatedCount ?? '?'} msgs, ${tokensTruncated ?? '?'} tokens (reason: ${reason ?? '?'})`,
            );
        }),
        session.on(SESSION_EVENTS.SESSION_SNAPSHOT_REWIND, (/** @type {any} */ evt) => {
            const { snapshotId, reason } = evt?.data ?? {};
            emit('session.snapshot_rewind', {
                snapshotId: snapshotId ?? 'unknown',
                reason: reason ?? 'unknown',
                ts: Date.now(),
            });
            log(
                'INFO',
                `[session-event-wirer] session.snapshot_rewind: snapshot=${snapshotId ?? '?'}, reason=${reason ?? '?'}`,
            );
        }),
        session.on(SESSION_EVENTS.SESSION_HANDOFF, (/** @type {any} */ evt) => {
            const { fromAgent, toAgent, reason, context } = evt?.data ?? {};
            emit('session.handoff', {
                fromAgent: fromAgent ?? 'unknown',
                toAgent: toAgent ?? 'unknown',
                reason: reason ?? undefined,
                context: context ?? undefined,
                ts: Date.now(),
            });
            log(
                'INFO',
                `[session-event-wirer] session.handoff: ${fromAgent ?? '?'} → ${toAgent ?? '?'} (reason: ${reason ?? '?'})`,
            );
        }),
    ];
}
