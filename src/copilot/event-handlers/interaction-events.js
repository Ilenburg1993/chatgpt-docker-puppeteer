// @ts-check
/**
 * @module copilot/event-handlers/interaction-events
 * @see EventBus
 * Faixa B4: Handlers dedicados para skill, command, permission e subagent events.
 */

import { log } from '#copilot/observability';
import { SESSION_EVENTS } from '#copilot/sdk';

/**
 * @param {import('#copilot/agent/session/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/event-wirer').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireInteractionEvents(session, { emit }) {
    return [
        // ── skill.invoked ────────────────────────────────────────────────
        session.on(SESSION_EVENTS.SKILL_INVOKED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const skillName = /** @type {string | undefined} */ (data['skillName'] ?? data['name']);
            log('INFO', `[interaction-events] skill.invoked: ${skillName ?? '?'}`);
            emit('skill.invoked', { skillName, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── command.execute ──────────────────────────────────────────────
        session.on(SESSION_EVENTS.COMMAND_EXECUTE, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const commandName = /** @type {string | undefined} */ (data['commandName']);
            log('INFO', `[interaction-events] command.execute: /${commandName ?? '?'}`);
            emit('command.executed', { commandName, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── command.queued ───────────────────────────────────────────────
        session.on(SESSION_EVENTS.COMMAND_QUEUED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('DEBUG', `[interaction-events] command.queued: requestId=${requestId ?? '?'}`);
            emit('command.queued', { requestId, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── command.completed ────────────────────────────────────────────
        session.on(SESSION_EVENTS.COMMAND_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('DEBUG', `[interaction-events] command.completed: requestId=${requestId ?? '?'}`);
            emit('command.completed', { requestId, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── permission.requested ─────────────────────────────────────────
        session.on(SESSION_EVENTS.PERMISSION_REQUESTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const permissionType = /** @type {string | undefined} */ (data['permissionType'] ?? data['type']);
            log('INFO', `[interaction-events] permission.requested: ${permissionType ?? '?'}`);
            emit('permission.requested', { permissionType, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── permission.completed ─────────────────────────────────────────
        session.on(SESSION_EVENTS.PERMISSION_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const granted = /** @type {boolean | undefined} */ (data['granted'] ?? data['approved']);
            log('INFO', `[interaction-events] permission.completed: granted=${granted ?? '?'}`);
            emit('permission.completed', { granted, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── subagent.started ─────────────────────────────────────────────
        session.on(SESSION_EVENTS.SUBAGENT_STARTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const agentName = /** @type {string | undefined} */ (data['agentName'] ?? data['name']);
            log('INFO', `[interaction-events] subagent.started: ${agentName ?? '?'}`);
            emit('subagent.started', { agentName, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── subagent.completed ───────────────────────────────────────────
        session.on(SESSION_EVENTS.SUBAGENT_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const agentName = /** @type {string | undefined} */ (data['agentName'] ?? data['name']);
            log('DEBUG', `[interaction-events] subagent.completed: ${agentName ?? '?'}`);
            emit('subagent.completed', { agentName, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── subagent.failed ──────────────────────────────────────────────
        session.on(SESSION_EVENTS.SUBAGENT_FAILED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const agentName = /** @type {string | undefined} */ (data['agentName'] ?? data['name']);
            const error = /** @type {string | undefined} */ (data['error'] ?? data['message']);
            log('WARN', `[interaction-events] subagent.failed: ${agentName ?? '?'} — ${error ?? '?'}`);
            emit('subagent.failed', { agentName, error, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── subagent.selected / deselected ───────────────────────────────
        session.on(SESSION_EVENTS.SUBAGENT_SELECTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const agentName = /** @type {string | undefined} */ (data['agentName'] ?? data['name']);
            log('INFO', `[interaction-events] subagent.selected: ${agentName ?? '?'}`);
            emit('subagent.selected', { agentName, data, ts: evt?.timestamp ?? Date.now() });
        }),

        session.on(SESSION_EVENTS.SUBAGENT_DESELECTED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const agentName = /** @type {string | undefined} */ (data['agentName'] ?? data['name']);
            log('DEBUG', `[interaction-events] subagent.deselected: ${agentName ?? '?'}`);
            emit('subagent.deselected', { agentName, data, ts: evt?.timestamp ?? Date.now() });
        }),

        // ── exit_plan_mode.completed ───────────────────────────────────
        session.on(SESSION_EVENTS.EXIT_PLAN_MODE_COMPLETED, (evt) => {
            const raw = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (evt));
            const data = /** @type {Record<string, unknown>} */ (raw['data'] ?? {});
            const requestId = /** @type {string | undefined} */ (data['requestId']);
            log('INFO', `[interaction-events] exit_plan_mode.completed requestId=${requestId ?? '?'}`);
            emit('exit_plan_mode.completed', { requestId, data, ts: evt?.timestamp ?? Date.now() });
        }),
    ];
}
