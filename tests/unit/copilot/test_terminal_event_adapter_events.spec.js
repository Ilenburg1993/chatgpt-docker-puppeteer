// @ts-check
/**
 * tests/unit/copilot/test_terminal_event_adapter_events.spec.js
 *
 * Contrato: terminal/event-adapter-events.js
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listJsFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return listJsFiles(full);
        return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
    });
}

describe('terminal/event-adapter-events.js — contrato', () => {
    it('declara eventos tratados explicitamente e a janela residual de passthrough SSE', async () => {
        const {
            TERMINAL_EXPLICIT_AGENT_EVENTS,
            TERMINAL_AGENT_SSE_PASSTHROUGH_EVENTS,
            createTerminalHandledAgentEventsSet,
            createTerminalPassthroughAgentEventsSet,
            findTerminalPublicStreamSourcePolicyByEvent,
            listTerminalPublicStreamSourcePolicies,
            listTerminalIgnoredAgentEvents,
        } = await import('../../../src/copilot/terminal/events/event-adapter-events.js');

        const handled = createTerminalHandledAgentEventsSet();
        const passthrough = createTerminalPassthroughAgentEventsSet();
        const ignored = listTerminalIgnoredAgentEvents();

        expect(handled).not.toBe(TERMINAL_EXPLICIT_AGENT_EVENTS);
        expect(passthrough).not.toBe(TERMINAL_AGENT_SSE_PASSTHROUGH_EVENTS);
        expect(handled.has('tool.execution_start')).toBe(true);
        expect(handled.has('elicitation.pending')).toBe(true);
        expect(handled.has('permission.requested')).toBe(true);
        expect(handled.has('permission.mode_changed')).toBe(true);
        expect(handled.has('user_input.requested')).toBe(true);
        expect(handled.has('pending_messages.modified')).toBe(true);
        expect(handled.has('external_tool.completed')).toBe(true);
        expect(handled.has('session.title_changed')).toBe(true);
        expect(handled.has('llm.usage')).toBe(true);
        expect(handled.has('pr.consumed')).toBe(true);
        expect(handled.has('pr.fallback_model')).toBe(true);
        expect(handled.has('dialog.recovery')).toBe(true);
        expect(handled.has('dialog.turn_end')).toBe(true);
        expect(passthrough.has('dialog.turn_end')).toBe(false);
        expect(passthrough.has('dialog.turn_timeout')).toBe(true);
        expect(passthrough.has('dialog.recovery')).toBe(false);
        expect(passthrough.has('pr.consumed')).toBe(false);
        expect(passthrough.has('llm.usage')).toBe(false);
        expect(passthrough.has('pr.fallback_model')).toBe(false);
        expect(passthrough.has('permission.mode_changed')).toBe(false);
        expect([...handled].filter((event) => passthrough.has(event))).toEqual([]);
        expect(ignored).toContain('assistant.streaming_delta');
        expect(ignored).toContain('session.keepalive');

        const sourcePolicies = listTerminalPublicStreamSourcePolicies();
        expect(sourcePolicies.map((policy) => policy.id)).toEqual(
            expect.arrayContaining([
                'assistant.text.delta',
                'assistant.text.final',
                'ask_user.visible-question',
                'elicitation.visible-request',
                'permission.visible-request',
                'tool.lifecycle',
                'dialog.loop.state',
                'usage.telemetry',
                'session.error.diagnostic',
                'terminal.lifecycle',
            ]),
        );
        expect(new Set(sourcePolicies.map((policy) => policy.id)).size).toBe(sourcePolicies.length);
        for (const policy of sourcePolicies) {
            expect(policy.class).toMatch(/^(content|interaction|tool|state|telemetry|diagnostic|lifecycle)$/u);
            expect(policy.canonicalEmitter).toBeTruthy();
            expect(policy.owner).toBeTruthy();
            expect(policy.publicEvents.length).toBeGreaterThan(0);
            expect(policy.accepts.length).toBeGreaterThan(0);
            expect(policy.suppresses.length).toBeGreaterThan(0);
            expect(policy.fallback).toBeTruthy();
        }
        const publicEvents = sourcePolicies.flatMap((policy) => policy.publicEvents);
        expect(new Set(publicEvents).size).toBe(publicEvents.length);
        expect(sourcePolicies.find((policy) => policy.id === 'assistant.text.delta')).toEqual(
            expect.objectContaining({
                class: 'content',
                publicEvents: ['delta'],
                accepts: ['dialog.delta'],
                fallback: 'task.delta only when dialog loop is inactive',
            }),
        );
        expect(sourcePolicies.find((policy) => policy.id === 'ask_user.visible-question')).toEqual(
            expect.objectContaining({
                accepts: ['user_input.requested'],
                suppresses: ['question.pending visual duplicate'],
            }),
        );
        expect(findTerminalPublicStreamSourcePolicyByEvent('dialog.loop.changed')).toEqual(
            expect.objectContaining({
                id: 'dialog.loop.state',
                class: 'state',
            }),
        );
        expect(findTerminalPublicStreamSourcePolicyByEvent('session.usage')).toEqual(
            expect.objectContaining({
                id: 'usage.telemetry',
                fallback: 'usage is telemetry only; pr.consumed is the only public PR-consumption signal',
            }),
        );
        expect(findTerminalPublicStreamSourcePolicyByEvent('missing.event')).toBeNull();
    });

    it('impede bypass do fanout publico duravel fora de dialog/sse.js', () => {
        const terminalRoot = join(process.cwd(), 'src/copilot/terminal');
        const allowed = new Set([join(terminalRoot, 'dialog/sse.js'), join(terminalRoot, 'state/sse-event-archive.js')]);
        const offenders = listJsFiles(terminalRoot)
            .filter((file) => !allowed.has(file))
            .flatMap((file) => {
                const source = readFileSync(file, 'utf8');
                /** @type {string[]} */
                const reasons = [];
                if (/eventFanout\.publish\s*\(/u.test(source)) {
                    reasons.push('eventFanout.publish');
                }
                if (/recordTerminalSseEventArchive\s*\(/u.test(source)) {
                    reasons.push('recordTerminalSseEventArchive');
                }
                return reasons.map((reason) => `${relative(process.cwd(), file)}:${reason}`);
            });

        expect(offenders).toEqual([]);
    });
});
