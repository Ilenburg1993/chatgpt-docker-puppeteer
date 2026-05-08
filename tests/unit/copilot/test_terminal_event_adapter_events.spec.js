// @ts-check
/**
 * tests/unit/copilot/test_terminal_event_adapter_events.spec.js
 *
 * Contrato: terminal/event-adapter-events.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/event-adapter-events.js — contrato', () => {
    it('declara eventos tratados explicitamente e a janela residual de passthrough SSE', async () => {
        const {
            TERMINAL_EXPLICIT_AGENT_EVENTS,
            TERMINAL_AGENT_SSE_PASSTHROUGH_EVENTS,
            createTerminalHandledAgentEventsSet,
            createTerminalPassthroughAgentEventsSet,
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
        expect(passthrough.has('dialog.turn_timeout')).toBe(true);
        expect(passthrough.has('pr.consumed')).toBe(true);
        expect(passthrough.has('permission.mode_changed')).toBe(false);
        expect([...handled].filter((event) => passthrough.has(event))).toEqual([]);
        expect(ignored).toContain('assistant.streaming_delta');
        expect(ignored).toContain('session.keepalive');
    });
});
