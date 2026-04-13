// @ts-check
/**
 * src/copilot/observability/collectors/interaction-handlers.js
 *
 * Handlers de eventos de interação, permissões, sub-agentes, MCP, external tools, comandos e sistema do EventCollector.
 *
 * @module copilot/observability/collectors/interaction-handlers
 * @see EventBus
 */

import { SESSION_EVENTS as SE } from '#copilot/events';
import { log } from '../logger.js';

/** @typedef {import('./context.js').CollectorContext} CollectorContext */

/**
 * Registra handlers de interaction/permission/subagent/mcp/command na sessão SDK.
 *
 * @param {CollectorContext} ctx
 * @returns {(() => void)[]}
 */
export function attachInteractionHandlers(ctx) {
    const { session, sessionId, metrics, persist, persistSet, persistEvent } = ctx;
    /** @type {(() => void)[]} */
    const unsubs = [];

    // ── permission.requested / completed ─────────────────────────────────
    unsubs.push(
        session.on(SE.PERMISSION_REQUESTED, (event) => {
            if (persist && persistSet.has('permission.requested')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }
        }),
    );
    unsubs.push(
        session.on(SE.PERMISSION_COMPLETED, (event) => {
            if (persist && persistSet.has('permission.completed')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }
        }),
    );

    // ── hook.start / hook.end ─────────────────────────────────────────────
    unsubs.push(
        session.on(SE.HOOK_START, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
        }),
    );
    unsubs.push(
        session.on(SE.HOOK_END, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
        }),
    );

    // ── skill.invoked ─────────────────────────────────────────────────────
    unsubs.push(
        session.on(SE.SKILL_INVOKED, (event) => {
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
        }),
    );

    // ── subagent.started / completed / failed / deselected / selected ────
    unsubs.push(
        session.on(SE.SUBAGENT_STARTED, (event) => {
            metrics?.recordCounter('subagent.started');
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            log('DEBUG', `[event-collector] subagent.started session=${sessionId}`);
        }),
    );
    unsubs.push(
        session.on(SE.SUBAGENT_COMPLETED, (event) => {
            metrics?.recordCounter('subagent.completed');
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
        }),
    );
    unsubs.push(
        session.on(SE.SUBAGENT_FAILED, (event) => {
            metrics?.recordCounter('subagent.failed');
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            log('WARN', `[event-collector] subagent.failed session=${sessionId}`);
        }),
    );
    unsubs.push(
        session.on(SE.SUBAGENT_DESELECTED, (event) => {
            metrics?.recordCounter('subagent.deselected');
            if (persist) persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
        }),
    );
    unsubs.push(
        session.on(SE.SUBAGENT_SELECTED, (event) => {
            metrics?.recordCounter('subagent.selected');
            if (persist && persistSet.has('subagent.selected')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }
        }),
    );

    // ── elicitation.requested / completed ────────────────────────────────
    unsubs.push(
        session.on(SE.ELICITATION_REQUESTED, (event) => {
            metrics?.recordCounter('elicitation.requested');
            if (persist && persistSet.has('elicitation.requested')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }
            log('DEBUG', `[event-collector] elicitation.requested session=${sessionId}`);
        }),
    );
    unsubs.push(
        session.on(SE.ELICITATION_COMPLETED, (event) => {
            metrics?.recordCounter('elicitation.completed');
            if (persist && persistSet.has('elicitation.completed')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }
        }),
    );

    // ── user_input.requested / completed ────────────────────────────────
    unsubs.push(
        session.on(SE.USER_INPUT_REQUESTED, (event) => {
            metrics?.recordCounter('user_input.requested');
            if (persist && persistSet.has('user_input.requested')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }
        }),
    );
    unsubs.push(
        session.on(SE.USER_INPUT_COMPLETED, (event) => {
            metrics?.recordCounter('user_input.completed');
            if (persist && persistSet.has('user_input.completed')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, data: event.data });
            }
        }),
    );

    // ── mcp.oauth_required / oauth_completed ─────────────────────────────
    unsubs.push(
        session.on(SE.MCP_OAUTH_REQUIRED, (event) => {
            const { serverName } = event.data;
            metrics?.recordCounter('mcp.oauth_required');
            if (persist && persistSet.has('mcp.oauth_required')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, serverName });
            }
            log('WARN', `[event-collector] mcp.oauth_required: ${serverName} session=${sessionId}`);
        }),
    );
    unsubs.push(
        session.on(SE.MCP_OAUTH_COMPLETED, (event) => {
            const { requestId } = event.data;
            metrics?.recordCounter('mcp.oauth_completed');
            if (persist && persistSet.has('mcp.oauth_completed')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
            }
        }),
    );

    // ── external_tool.requested / completed ──────────────────────────────
    unsubs.push(
        session.on(SE.EXTERNAL_TOOL_REQUESTED, (event) => {
            const { requestId, toolName, traceparent, tracestate } = event.data;
            metrics?.recordCounter('external_tool.requested');
            if (persist && persistSet.has('external_tool.requested')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    requestId,
                    toolName,
                    toolArgs: event.data.arguments ?? {},
                    traceparent: traceparent ?? null,
                    tracestate: tracestate ?? null,
                });
            }
            log('DEBUG', `[event-collector] external_tool.requested: ${toolName ?? requestId} session=${sessionId}`);
        }),
    );
    unsubs.push(
        session.on(SE.EXTERNAL_TOOL_COMPLETED, (event) => {
            const { requestId } = event.data;
            const extra = /** @type {{ toolName?: string; durationMs?: number }} */ (
                /** @type {unknown} */ (event.data)
            );
            const toolName = extra.toolName ?? null;
            const durationMs = extra.durationMs ?? null;
            metrics?.recordCounter('external_tool.completed');
            if (persist && persistSet.has('external_tool.completed')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    requestId,
                    toolName,
                    durationMs,
                });
            }
            log(
                'DEBUG',
                `[event-collector] external_tool.completed requestId=${requestId ?? '?'} tool=${toolName ?? '?'}`,
            );
        }),
    );

    // ── command.execute / queued / completed ─────────────────────────────
    unsubs.push(
        session.on(SE.COMMAND_EXECUTE, (event) => {
            const { commandName, args } = event.data;
            metrics?.recordCounter(`command.execute.${commandName ?? 'unknown'}`);
            if (persist && persistSet.has('command.execute')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, commandName, args });
            }
            log('DEBUG', `[event-collector] command.execute: /${commandName ?? '?'} session=${sessionId}`);
        }),
    );
    unsubs.push(
        session.on(SE.COMMAND_QUEUED, (event) => {
            const { requestId } = event.data;
            metrics?.recordCounter('command.queued');
            if (persist && persistSet.has('command.queued')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
            }
            log('DEBUG', `[event-collector] command.queued requestId=${requestId ?? '?'}`);
        }),
    );
    unsubs.push(
        session.on(SE.COMMAND_COMPLETED, (event) => {
            const { requestId } = event.data;
            metrics?.recordCounter('command.completed');
            if (persist && persistSet.has('command.completed')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
            }
            log('DEBUG', `[event-collector] command.completed requestId=${requestId ?? '?'}`);
        }),
    );

    // ── commands.changed ─────────────────────────────────────────────────
    unsubs.push(
        session.on(SE.COMMANDS_CHANGED, (event) => {
            const { commands } = event.data;
            const count = Array.isArray(commands) ? commands.length : 0;
            metrics?.recordCounter('commands.changed');
            log('DEBUG', `[event-collector] commands.changed count=${count}`);
        }),
    );

    // ── exit_plan_mode.requested / completed ─────────────────────────────
    unsubs.push(
        session.on(SE.EXIT_PLAN_MODE_REQUESTED, (event) => {
            const { summary, actions, recommendedAction } = event.data;
            metrics?.recordCounter('exit_plan_mode.requested');
            if (persist && persistSet.has('exit_plan_mode.requested')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    summaryLength: summary?.length ?? 0,
                    actions,
                    recommendedAction,
                });
            }
            log(
                'INFO',
                `[event-collector] exit_plan_mode.requested recommended=${recommendedAction ?? 'n/a'} session=${sessionId}`,
            );
        }),
    );
    unsubs.push(
        session.on(SE.EXIT_PLAN_MODE_COMPLETED, (event) => {
            const { requestId } = event.data;
            metrics?.recordCounter('exit_plan_mode.completed');
            if (persist && persistSet.has('exit_plan_mode.completed')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, requestId });
            }
            log('DEBUG', `[event-collector] exit_plan_mode.completed requestId=${requestId ?? '?'}`);
        }),
    );

    // ── system.message / notification ────────────────────────────────────
    unsubs.push(
        session.on(SE.SYSTEM_MESSAGE, (event) => {
            const { role, metadata } = event.data;
            const promptVersion = metadata?.promptVersion;
            metrics?.recordCounter('system.message');
            if (persist && persistSet.has('system.message')) {
                persistEvent({ type: event.type, sessionId, ts: event.timestamp, role, promptVersion });
            }
            log('DEBUG', `[event-collector] system.message role=${role ?? '?'} v=${promptVersion ?? '?'}`);
        }),
    );
    unsubs.push(
        session.on(SE.SYSTEM_NOTIFICATION, (event) => {
            const { kind } = event.data;
            metrics?.recordCounter(`system.notification.${kind.type}`);
            if (kind.type === 'agent_completed') {
                metrics?.recordCounter(`background_agent.${'status' in kind ? kind.status : 'unknown'}`);
            }
            if (persist && persistSet.has('system.notification')) {
                persistEvent({
                    type: event.type,
                    sessionId,
                    ts: event.timestamp,
                    notificationKind: kind.type,
                    status: 'status' in kind ? kind.status : undefined,
                });
            }
            log('INFO', `[event-collector] system.notification: ${kind.type} session=${sessionId}`);
        }),
    );

    // ── pending_messages.modified ─────────────────────────────────────────
    unsubs.push(
        session.on(SE.PENDING_MESSAGES_MODIFIED, () => {
            metrics?.recordCounter('pending_messages.modified');
        }),
    );

    return unsubs;
}
