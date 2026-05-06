// @ts-check
/**
 * @module copilot/event-handlers/interaction-events
 * @see EventBus
 * Faixa B4: Handlers dedicados para skill, command, permission e subagent events.
 */

import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { DialogProtocol } from '../dialog/protocol.js';
import { onSessionEvent } from '../sdk/session/events.js';

/**
 * @param {import('#copilot/agent/session/wiring/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/wiring/event-wirer').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireInteractionEvents(session, { emit }) {
    return [
        // ── skill.invoked ────────────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SKILL_INVOKED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const skillName = /** @type {string | undefined} */ (data['skillName'] ?? data['name']);
            log('INFO', `[interaction-events] skill.invoked: ${skillName ?? '?'}`);
            emit('skill.invoked', { skillName, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── command.execute ──────────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.COMMAND_EXECUTE, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const commandName = /** @type {string | undefined} */ (data['commandName']);
            log('INFO', `[interaction-events] command.execute: /${commandName ?? '?'}`);
            emit('command.executed', { commandName, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── command.queued ───────────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.COMMAND_QUEUED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('DEBUG', `[interaction-events] command.queued: requestId=${requestId ?? '?'}`);
            emit('command.queued', { requestId, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── command.completed ────────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.COMMAND_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('DEBUG', `[interaction-events] command.completed: requestId=${requestId ?? '?'}`);
            emit('command.completed', { requestId, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── permission.requested ─────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.PERMISSION_REQUESTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const permissionType = /** @type {string | undefined} */ (data['permissionType'] ?? data['type']);
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('INFO', `[interaction-events] permission.requested: ${permissionType ?? '?'}`);
            emit('permission.requested', { requestId, permissionType, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── permission.completed ─────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.PERMISSION_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const granted = /** @type {boolean | undefined} */ (data['granted'] ?? data['approved']);
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            const permissionType = /** @type {string | undefined} */ (data['permissionType'] ?? data['type']);
            const result = /** @type {string | undefined} */ (data['result']);
            log('INFO', `[interaction-events] permission.completed: granted=${granted ?? '?'}`);
            emit('permission.completed', {
                requestId,
                permissionType,
                result,
                granted,
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── user_input.requested / completed ─────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.USER_INPUT_REQUESTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            const question = /** @type {string | undefined} */ (data['question']);
            const choices = Array.isArray(data['choices']) ? /** @type {string[]} */ (data['choices']) : undefined;
            const allowFreeform = data['allowFreeform'] !== false;
            const kind = DialogProtocol.classify(question ?? '');
            log('DEBUG', `[interaction-events] user_input.requested: requestId=${requestId ?? '?'} kind=${kind}`);
            emit('user_input.requested', {
                requestId,
                question: question ?? '',
                ...(choices !== undefined ? { choices } : {}),
                allowFreeform,
                toolCallId: data['toolCallId'] ?? null,
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        onSessionEvent(session, SESSION_EVENTS.USER_INPUT_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            const answer = /** @type {string | undefined} */ (data['answer']);
            const wasFreeform = typeof data['wasFreeform'] === 'boolean' ? data['wasFreeform'] : undefined;
            log('DEBUG', `[interaction-events] user_input.completed: requestId=${requestId ?? '?'}`);
            emit('user_input.completed', {
                requestId,
                answer: answer ?? '',
                ...(wasFreeform !== undefined ? { wasFreeform } : {}),
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── subagent.started ─────────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SUBAGENT_STARTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const agentName = /** @type {string | undefined} */ (data['agentName'] ?? data['name']);
            log('INFO', `[interaction-events] subagent.started: ${agentName ?? '?'}`);
            emit('subagent.started', { agentName, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── subagent.completed ───────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SUBAGENT_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const agentName = /** @type {string | undefined} */ (data['agentName'] ?? data['name']);
            log('DEBUG', `[interaction-events] subagent.completed: ${agentName ?? '?'}`);
            emit('subagent.completed', { agentName, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── subagent.failed ──────────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SUBAGENT_FAILED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const agentName = /** @type {string | undefined} */ (data['agentName'] ?? data['name']);
            const error = /** @type {string | undefined} */ (data['error'] ?? data['message']);
            log('WARN', `[interaction-events] subagent.failed: ${agentName ?? '?'} — ${error ?? '?'}`);
            emit('subagent.failed', { agentName, error, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── subagent.selected / deselected ───────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SUBAGENT_SELECTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const agentName = /** @type {string | undefined} */ (data['agentName'] ?? data['name']);
            log('INFO', `[interaction-events] subagent.selected: ${agentName ?? '?'}`);
            emit('subagent.selected', { agentName, data, ts: evt?.timestamp ?? Date.now() });
        }),

        onSessionEvent(session, SESSION_EVENTS.SUBAGENT_DESELECTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const agentName = /** @type {string | undefined} */ (data['agentName'] ?? data['name']);
            log('DEBUG', `[interaction-events] subagent.deselected: ${agentName ?? '?'}`);
            emit('subagent.deselected', { agentName, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── external_tool.requested / completed ────────────────────────
        onSessionEvent(session, SESSION_EVENTS.EXTERNAL_TOOL_REQUESTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const toolName = /** @type {string | undefined} */ (data['toolName'] ?? data['name']);
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log(
                'INFO',
                `[interaction-events] external_tool.requested: ${toolName ?? '?'} requestId=${requestId ?? '?'}`,
            );
            emit('external_tool.requested', { toolName, requestId, data, ts: evt?.timestamp ?? Date.now() });
        }),

        onSessionEvent(session, SESSION_EVENTS.EXTERNAL_TOOL_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const toolName = /** @type {string | undefined} */ (data['toolName'] ?? data['name']);
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            const success = /** @type {boolean | undefined} */ (data['success']);
            log(
                'DEBUG',
                `[interaction-events] external_tool.completed: ${toolName ?? '?'} requestId=${requestId ?? '?'}`,
            );
            emit('external_tool.completed', { toolName, requestId, success, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── pending_messages.modified ───────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.PENDING_MESSAGES_MODIFIED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const count = /** @type {number | undefined} */ (data['count']);
            log('DEBUG', `[interaction-events] pending_messages.modified count=${count ?? '?'}`);
            emit('pending_messages.modified', { count, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── exit_plan_mode.completed ───────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.EXIT_PLAN_MODE_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('INFO', `[interaction-events] exit_plan_mode.completed requestId=${requestId ?? '?'}`);
            emit('exit_plan_mode.completed', { requestId, data, ts: evt?.timestamp ?? Date.now() });
        }),
    ];
}
