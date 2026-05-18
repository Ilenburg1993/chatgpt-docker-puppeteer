// @ts-check
/**
 * @module copilot/event-handlers/interaction-events
 * @see EventBus
 * Faixa B4: Handlers dedicados para skill, command, permission e subagent events.
 */

import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import {
    getSessionCapabilities,
    normalizePermissionCompletedEvent,
    normalizePermissionRequestedEvent,
    normalizeUserInputCompletedEvent,
    normalizeUserInputRequestedEvent,
    onSessionEvent,
} from '#copilot/sdk/session';
import { DialogProtocol } from '../dialog/protocol.js';

/**
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @param {Pick<import('./contracts.js').SessionWirerCallbacks, 'emit'>} cb
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

        // ── hook.start / hook.end ───────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.HOOK_START, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const hookInvocationId = /** @type {string | undefined} */ (data['hookInvocationId']);
            const hookType = /** @type {string | undefined} */ (data['hookType']);
            const input =
                data['input'] && typeof data['input'] === 'object'
                    ? /** @type {Record<string, unknown>} */ (data['input'])
                    : undefined;
            log('DEBUG', `[interaction-events] hook.start: ${hookType ?? '?'} (${hookInvocationId ?? '?'})`);
            emit('hook.start', {
                hookInvocationId,
                hookType,
                input,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        onSessionEvent(session, SESSION_EVENTS.HOOK_END, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const hookInvocationId = /** @type {string | undefined} */ (data['hookInvocationId']);
            const hookType = /** @type {string | undefined} */ (data['hookType']);
            const success = data['success'] === true;
            const output =
                data['output'] && typeof data['output'] === 'object'
                    ? /** @type {Record<string, unknown>} */ (data['output'])
                    : undefined;
            const error =
                data['error'] && typeof data['error'] === 'object'
                    ? /** @type {{ message?: string; stack?: string }} */ (data['error'])
                    : undefined;
            log(
                success ? 'DEBUG' : 'WARN',
                `[interaction-events] hook.end: ${hookType ?? '?'} (${hookInvocationId ?? '?'}) success=${String(success)}`,
            );
            emit('hook.end', {
                hookInvocationId,
                hookType,
                success,
                output,
                error,
                ts: evt?.timestamp ?? Date.now(),
            });
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

        // ── commands.changed / capabilities.changed ────────────────────
        onSessionEvent(session, SESSION_EVENTS.COMMANDS_CHANGED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const commands = Array.isArray(data['commands'])
                ? data['commands'].map((item) => {
                      const obj = item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {};
                      return {
                          name: typeof obj['name'] === 'string' ? obj['name'] : 'unknown',
                          ...(typeof obj['description'] === 'string' ? { description: obj['description'] } : {}),
                      };
                  })
                : [];
            log('INFO', `[interaction-events] commands.changed: ${commands.length} command(s)`);
            emit('commands.changed', {
                commands,
                count: commands.length,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        onSessionEvent(session, SESSION_EVENTS.CAPABILITIES_CHANGED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const uiChanges =
                data['ui'] && typeof data['ui'] === 'object' ? /** @type {Record<string, unknown>} */ (data['ui']) : {};
            const capabilities = getSessionCapabilities(
                /** @type {import('./contracts.js').CopilotSessionLike} */ (session),
            );
            log(
                'INFO',
                `[interaction-events] capabilities.changed: ui.elicitation=${String(capabilities.ui?.elicitation ?? false)}`,
            );
            emit('capabilities.changed', {
                capabilities,
                changes: {
                    ui: uiChanges,
                },
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        // ── permission.requested ─────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.PERMISSION_REQUESTED, (evt) => {
            const normalized = normalizePermissionRequestedEvent(evt);
            log('INFO', `[interaction-events] permission.requested: ${normalized.permissionType}`);
            emit('permission.requested', {
                requestId: normalized.requestId,
                permissionType: normalized.permissionType,
                runtimeId: normalized.runtimeId,
                data: normalized.data,
                ts: normalized.ts,
            });
        }),

        // ── permission.completed ─────────────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.PERMISSION_COMPLETED, (evt) => {
            const normalized = normalizePermissionCompletedEvent(evt);
            log('INFO', `[interaction-events] permission.completed: granted=${normalized.granted ?? '?'}`);
            emit('permission.completed', {
                requestId: normalized.requestId,
                permissionType: normalized.permissionType,
                runtimeId: normalized.runtimeId,
                result: normalized.resultKind,
                granted: normalized.granted,
                decision: normalized.decision,
                data: normalized.data,
                ts: normalized.ts,
            });
        }),

        // ── user_input.requested / completed ─────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.USER_INPUT_REQUESTED, (evt) => {
            const normalized = normalizeUserInputRequestedEvent(evt);
            const kind = DialogProtocol.classify(normalized.question);
            log(
                'DEBUG',
                `[interaction-events] user_input.requested: requestId=${normalized.requestId ?? '?'} kind=${kind}`,
            );
            emit('user_input.requested', {
                requestId: normalized.requestId,
                runtimeId: normalized.runtimeId,
                question: normalized.question,
                choices: normalized.choices,
                allowFreeform: normalized.allowFreeform,
                toolCallId: normalized.toolCallId,
                data: normalized.data,
                ts: normalized.ts,
            });
        }),

        onSessionEvent(session, SESSION_EVENTS.USER_INPUT_COMPLETED, (evt) => {
            const normalized = normalizeUserInputCompletedEvent(evt);
            log('DEBUG', `[interaction-events] user_input.completed: requestId=${normalized.requestId ?? '?'}`);
            emit('user_input.completed', {
                requestId: normalized.requestId,
                runtimeId: normalized.runtimeId,
                answer: normalized.answer,
                ...(normalized.wasFreeform !== null ? { wasFreeform: normalized.wasFreeform } : {}),
                data: normalized.data,
                ts: normalized.ts,
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

        // ── pending_messages.modified ───────────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.PENDING_MESSAGES_MODIFIED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const count = /** @type {number | undefined} */ (data['count']);
            log('DEBUG', `[interaction-events] pending_messages.modified count=${count ?? '?'}`);
            emit('pending_messages.modified', { count, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── sampling.requested / completed ─────────────────────────────
        onSessionEvent(session, SESSION_EVENTS.SAMPLING_REQUESTED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            const serverName = /** @type {string | undefined} */ (data['serverName']);
            const mcpRequestId = /** @type {string | number | undefined} */ (data['mcpRequestId']);
            log('INFO', `[interaction-events] sampling.requested: ${serverName ?? '?'} (${requestId ?? '?'})`);
            emit('sampling.requested', {
                requestId,
                serverName,
                mcpRequestId,
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        onSessionEvent(session, SESSION_EVENTS.SAMPLING_COMPLETED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('DEBUG', `[interaction-events] sampling.completed: ${requestId ?? '?'}`);
            emit('sampling.completed', { requestId, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── auto_mode_switch.requested / completed ─────────────────────
        onSessionEvent(session, SESSION_EVENTS.AUTO_MODE_SWITCH_REQUESTED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            const errorCode = /** @type {string | undefined} */ (data['errorCode']);
            log('WARN', `[interaction-events] auto_mode_switch.requested: ${requestId ?? '?'} (${errorCode ?? 'n/a'})`);
            emit('auto_mode_switch.requested', {
                requestId,
                errorCode,
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        onSessionEvent(session, SESSION_EVENTS.AUTO_MODE_SWITCH_COMPLETED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            const response = /** @type {string | undefined} */ (data['response']);
            log('INFO', `[interaction-events] auto_mode_switch.completed: ${requestId ?? '?'} → ${response ?? '?'}`);
            emit('auto_mode_switch.completed', { requestId, response, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── exit_plan_mode.requested / completed ───────────────────────
        onSessionEvent(session, SESSION_EVENTS.EXIT_PLAN_MODE_REQUESTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            const recommendedAction = /** @type {string | undefined} */ (data['recommendedAction']);
            const planContent = /** @type {string | undefined} */ (data['planContent']);
            const actions = Array.isArray(data['actions'])
                ? data['actions'].filter((item) => typeof item === 'string')
                : [];
            log(
                'INFO',
                `[interaction-events] exit_plan_mode.requested requestId=${requestId ?? '?'} recommended=${recommendedAction ?? '?'}`,
            );
            emit('exit_plan_mode.requested', {
                requestId,
                recommendedAction,
                actions,
                planContent,
                data,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),

        onSessionEvent(session, SESSION_EVENTS.EXIT_PLAN_MODE_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('INFO', `[interaction-events] exit_plan_mode.completed requestId=${requestId ?? '?'}`);
            emit('exit_plan_mode.completed', { requestId, data, ts: evt?.timestamp ?? Date.now() });
        }),
    ];
}
