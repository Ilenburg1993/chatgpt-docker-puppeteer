// @ts-check
/**
 * @module copilot/event-handlers/sdk-responses
 * @see EventBus
 * F62.7: Handler de eventos de resposta do SDK (intent, reasoning, turns, lifecycle, subagents, etc.).
 */

import { log } from '#copilot/observability';
import { SESSION_EVENTS } from '#copilot/sdk';

/**
 * @param {import('#copilot/agent/session/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/event-wirer').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireSdkResponseEvents(session, { emit }) {
    return [
        session.on(SESSION_EVENTS.ASSISTANT_INTENT, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const intent = /** @type {string | undefined} */ (data['intent']);
            emit('assistant.intent', { intent: intent ?? 'unknown', ts: Date.now() });
        }),
        session.on(SESSION_EVENTS.ASSISTANT_MESSAGE, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const messageId = /** @type {string | undefined} */ (data['messageId']);
            const content = /** @type {string | undefined} */ (data['content']);
            emit('assistant.message', {
                messageId: messageId ?? null,
                content: content ?? '',
                ts: Date.now(),
            });
        }),
        session.on(SESSION_EVENTS.ASSISTANT_REASONING, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const reasoningId = /** @type {string | undefined} */ (data['reasoningId']);
            const content = data['content'];
            const len = typeof content === 'string' ? content.length : 0;
            emit('assistant.reasoning_complete', {
                reasoningId: reasoningId ?? null,
                contentLength: len,
                ts: Date.now(),
            });
        }),
        session.on(SESSION_EVENTS.ASSISTANT_TURN_START, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const turnId = data['turnId'];
            emit('assistant.turn_start', { turnId: turnId ?? null, ts: Date.now() });
            log('DEBUG', `[session-event-wirer] assistant.turn_start turnId=${turnId ?? '?'}`);
        }),
        session.on(SESSION_EVENTS.ASSISTANT_TURN_END, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const turnId = data['turnId'];
            emit('assistant.turn_end', { turnId: turnId ?? null, ts: Date.now() });
            log('DEBUG', `[session-event-wirer] assistant.turn_end turnId=${turnId ?? '?'}`);
        }),
        session.on(SESSION_EVENTS.SESSION_ERROR, (evt) => {
            const data = evt?.data ?? {};
            const errorType = /** @type {string} */ (data['errorType'] ?? 'unknown');
            const message = /** @type {string} */ (data['message'] ?? 'Unknown error');
            emit('session.error', { errorType, message, ts: Date.now() });
            log('ERROR', `[session-event-wirer] session.error type=${errorType}: ${message}`);
        }),
        session.on(SESSION_EVENTS.SESSION_SHUTDOWN, (evt) => {
            const data = evt?.data ?? {};
            emit('session.shutdown', { ...data, ts: Date.now() });
            log('INFO', `[session-event-wirer] session.shutdown type=${data['shutdownType'] ?? '?'}`);
        }),
        session.on(SESSION_EVENTS.SESSION_TASK_COMPLETE, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const summary = data['summary'];
            emit('session.task_complete', { summary: summary ?? null, ts: Date.now() });
            log('INFO', `[session-event-wirer] session.task_complete`);
        }),
        session.on(SESSION_EVENTS.SESSION_TITLE_CHANGED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const title = data['title'];
            emit('session.title_changed', { title: title ?? '', ts: Date.now() });
            log('DEBUG', `[session-event-wirer] session.title_changed: "${title ?? ''}"`);
        }),
        session.on(SESSION_EVENTS.SESSION_CONTEXT_CHANGED, (evt) => {
            emit('session.context_changed', evt?.data ?? {});
            log('DEBUG', `[session-event-wirer] session.context_changed propagado para AGENT EventEmitter`);
        }),
        session.on(SESSION_EVENTS.ABORT, (evt) => {
            emit('abort', { reason: evt?.data?.['reason'] ?? 'user_initiated', ts: Date.now() });
            log('INFO', '[session-event-wirer] abort propagado para AGENT EventEmitter');
        }),
        session.on(SESSION_EVENTS.SUBAGENT_STARTED, (evt) => {
            const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            emit('subagent.started', { agentName: d['agentName'], agentId: d['agentId'], ts: Date.now() });
        }),
        session.on(SESSION_EVENTS.SUBAGENT_COMPLETED, (evt) => {
            const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            emit('subagent.completed', { agentName: d['agentName'], agentId: d['agentId'], ts: Date.now() });
        }),
        session.on(SESSION_EVENTS.SUBAGENT_FAILED, (evt) => {
            const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            emit('subagent.failed', {
                agentName: d['agentName'],
                agentId: d['agentId'],
                error: d['error'] ?? 'unknown',
                ts: Date.now(),
            });
        }),
        session.on(SESSION_EVENTS.ELICITATION_REQUESTED, (evt) => {
            const { requestId, schema, title, description } = evt?.data ?? {};
            emit('elicitation.pending', { requestId, schema, title, description, ts: Date.now() });
            log('INFO', `[session-event-wirer] elicitation.pending requestId=${requestId ?? '?'}`);
        }),
        session.on(SESSION_EVENTS.SESSION_TRUNCATION, (evt) => {
            const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            emit('session.truncation', {
                messageTruncatedCount: d['messageTruncatedCount'] ?? d['messagesRemovedDuringTruncation'] ?? 0,
                tokensTruncated: d['tokensTruncated'] ?? d['tokensRemovedDuringTruncation'] ?? 0,
                reason: d['reason'] ?? d['performedBy'] ?? 'unknown',
                ts: Date.now(),
            });
            log(
                'WARN',
                `[session-event-wirer] session.truncation: ${d['messageTruncatedCount'] ?? d['messagesRemovedDuringTruncation'] ?? '?'} msgs, ${d['tokensTruncated'] ?? d['tokensRemovedDuringTruncation'] ?? '?'} tokens (reason: ${d['reason'] ?? d['performedBy'] ?? '?'})`,
            );
        }),
        session.on(SESSION_EVENTS.SESSION_SNAPSHOT_REWIND, (evt) => {
            const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            emit('session.snapshot_rewind', {
                snapshotId: d['snapshotId'] ?? d['upToEventId'] ?? 'unknown',
                reason: d['reason'] ?? 'unknown',
                ts: Date.now(),
            });
            log(
                'INFO',
                `[session-event-wirer] session.snapshot_rewind: snapshot=${d['snapshotId'] ?? d['upToEventId'] ?? '?'}, reason=${d['reason'] ?? '?'}`,
            );
        }),
        session.on(SESSION_EVENTS.SESSION_HANDOFF, (evt) => {
            const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            emit('session.handoff', {
                fromAgent: d['fromAgent'] ?? 'unknown',
                toAgent: d['toAgent'] ?? 'unknown',
                reason: d['reason'] ?? undefined,
                context: d['context'] ?? undefined,
                ts: Date.now(),
            });
            log(
                'INFO',
                `[session-event-wirer] session.handoff: ${d['fromAgent'] ?? '?'} → ${d['toAgent'] ?? '?'} (reason: ${d['reason'] ?? '?'})`,
            );
        }),
        session.on(SESSION_EVENTS.SESSION_WORKSPACE_FILE_CHANGED, (evt) => {
            const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            emit('session.workspace_file_changed', {
                path: d['path'] ?? null,
                operation: d['operation'] ?? 'unknown',
                ts: Date.now(),
            });
            log(
                'INFO',
                `[session-event-wirer] session.workspace_file_changed: ${d['operation'] ?? '?'} ${d['path'] ?? '?'}`,
            );
        }),
    ];
}
