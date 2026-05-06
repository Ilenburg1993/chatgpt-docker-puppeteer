// @ts-check
/**
 * @module copilot/event-handlers/sdk-responses
 * @see EventBus
 * F62.7: Handler de eventos de resposta do SDK (intent, reasoning, turns, lifecycle, subagents, etc.).
 */

import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { normalizeElicitationCompletedEvent, normalizeElicitationPendingEvent } from '#copilot/sdk';
import { onSessionEvents } from '../sdk/session/events.js';

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeSdkMessage(raw) {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (raw);
        const nestedError = rec['error'];
        if (typeof rec['message'] === 'string' && rec['message']) return rec['message'];
        if (nestedError && typeof nestedError === 'object') {
            const errRec = /** @type {Record<string, unknown>} */ (nestedError);
            if (typeof errRec['message'] === 'string' && errRec['message']) return errRec['message'];
        }
        try {
            return JSON.stringify(raw);
        } catch {
            return String(raw);
        }
    }
    return String(raw ?? 'Unknown error');
}

/**
 * @param {import('#copilot/agent/session/wiring/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/wiring/event-wirer').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireSdkResponseEvents(session, { emit }) {
    return [
        onSessionEvents(session, {
            [SESSION_EVENTS.ASSISTANT_INTENT]: (evt) => {
                const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                const intent = /** @type {string | undefined} */ (data['intent']);
                emit('assistant.intent', { intent: intent ?? 'unknown', ts: Date.now() });
            },
            [SESSION_EVENTS.ASSISTANT_MESSAGE]: (evt) => {
                const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                const messageId = /** @type {string | undefined} */ (data['messageId']);
                const content = /** @type {string | undefined} */ (data['content']);
                emit('assistant.message', {
                    messageId: messageId ?? null,
                    content: content ?? '',
                    ts: Date.now(),
                });
            },
            [SESSION_EVENTS.ASSISTANT_REASONING]: (evt) => {
                const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                const reasoningId = /** @type {string | undefined} */ (data['reasoningId']);
                const content = data['content'];
                const len = typeof content === 'string' ? content.length : 0;
                emit('assistant.reasoning_complete', {
                    reasoningId: reasoningId ?? null,
                    contentLength: len,
                    ts: Date.now(),
                });
            },
            [SESSION_EVENTS.ASSISTANT_TURN_START]: (evt) => {
                const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                const turnId = data['turnId'];
                emit('assistant.turn_start', { turnId: turnId ?? null, ts: Date.now() });
                log('DEBUG', `[session-event-wirer] assistant.turn_start turnId=${turnId ?? '?'}`);
            },
            [SESSION_EVENTS.ASSISTANT_TURN_END]: (evt) => {
                const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                const turnId = data['turnId'];
                emit('assistant.turn_end', { turnId: turnId ?? null, ts: Date.now() });
                log('DEBUG', `[session-event-wirer] assistant.turn_end turnId=${turnId ?? '?'}`);
            },
            [SESSION_EVENTS.SESSION_ERROR]: (evt) => {
                const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                const errorType = /** @type {string} */ (data['errorType'] ?? 'unknown');
                const message = normalizeSdkMessage(data['message']);
                emit('session.error', { errorType, message, ts: Date.now() });
                log('ERROR', `[session-event-wirer] session.error type=${errorType}: ${message}`);
            },
            [SESSION_EVENTS.SESSION_SHUTDOWN]: (evt) => {
                const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                emit('session.shutdown', { ...data, ts: Date.now() });
                log('INFO', `[session-event-wirer] session.shutdown type=${data['shutdownType'] ?? '?'}`);
            },
            [SESSION_EVENTS.SESSION_TASK_COMPLETE]: (evt) => {
                const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                const summary = data['summary'];
                emit('session.task_complete', { summary: summary ?? null, ts: Date.now() });
                log('INFO', `[session-event-wirer] session.task_complete`);
            },
            [SESSION_EVENTS.SESSION_TITLE_CHANGED]: (evt) => {
                const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                const title = data['title'];
                emit('session.title_changed', { title: title ?? '', ts: Date.now() });
                log('DEBUG', `[session-event-wirer] session.title_changed: "${title ?? ''}"`);
            },
            [SESSION_EVENTS.SESSION_CONTEXT_CHANGED]: (evt) => {
                emit('session.context_changed', evt?.data ?? {});
                log('DEBUG', `[session-event-wirer] session.context_changed propagado para AGENT EventEmitter`);
            },
            [SESSION_EVENTS.ABORT]: (evt) => {
                const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                emit('abort', { reason: data['reason'] ?? 'user_initiated', ts: Date.now() });
                log('INFO', '[session-event-wirer] abort propagado para AGENT EventEmitter');
            },
            [SESSION_EVENTS.SUBAGENT_STARTED]: (evt) => {
                const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                emit('subagent.started', { agentName: d['agentName'], agentId: d['agentId'], ts: Date.now() });
            },
            [SESSION_EVENTS.SUBAGENT_COMPLETED]: (evt) => {
                const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                emit('subagent.completed', { agentName: d['agentName'], agentId: d['agentId'], ts: Date.now() });
            },
            [SESSION_EVENTS.SUBAGENT_FAILED]: (evt) => {
                const d = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
                emit('subagent.failed', {
                    agentName: d['agentName'],
                    agentId: d['agentId'],
                    error: d['error'] ?? 'unknown',
                    ts: Date.now(),
                });
            },
            [SESSION_EVENTS.ELICITATION_REQUESTED]: (evt) => {
                const normalized = normalizeElicitationPendingEvent(evt);
                emit('elicitation.pending', {
                    requestId: normalized.requestId,
                    sessionId: normalized.sessionId,
                    runtimeId: normalized.runtimeId,
                    message: normalized.message,
                    mode: normalized.mode,
                    requestedSchema: normalized.requestedSchema,
                    url: normalized.url,
                    toolCallId: normalized.toolCallId,
                    elicitationSource: normalized.elicitationSource,
                    actionable: normalized.actionable,
                    providerRequest: normalized.providerRequest,
                    data: normalized.data,
                    ts: normalized.ts,
                });
                log('INFO', `[session-event-wirer] elicitation.pending requestId=${normalized.requestId ?? '?'}`);
            },
            [SESSION_EVENTS.ELICITATION_COMPLETED]: (evt) => {
                const normalized = normalizeElicitationCompletedEvent(evt);
                emit('elicitation.completed', {
                    requestId: normalized.requestId,
                    sessionId: normalized.sessionId,
                    runtimeId: normalized.runtimeId,
                    action: normalized.action,
                    content: normalized.content,
                    actionable: normalized.actionable,
                    providerRequest: normalized.providerRequest,
                    data: normalized.data,
                    ts: normalized.ts,
                });
                log('DEBUG', `[session-event-wirer] elicitation.completed requestId=${normalized.requestId ?? '?'}`);
            },
            [SESSION_EVENTS.SESSION_TRUNCATION]: (evt) => {
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
            },
            [SESSION_EVENTS.SESSION_SNAPSHOT_REWIND]: (evt) => {
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
            },
            [SESSION_EVENTS.SESSION_HANDOFF]: (evt) => {
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
            },
            [SESSION_EVENTS.SESSION_WORKSPACE_FILE_CHANGED]: (evt) => {
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
            },
        }),
    ];
}
