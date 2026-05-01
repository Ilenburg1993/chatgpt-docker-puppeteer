// @ts-check
/**
 * tests/unit/copilot/test_terminal_event_adapter_events.spec.js
 *
 * Contrato: terminal/event-adapter-events.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/event-adapter-events.js — contrato', () => {
    it('declara eventos tratados explicitamente antes do fallback SSE', async () => {
        const { TERMINAL_EXPLICIT_AGENT_EVENTS, createTerminalHandledAgentEventsSet } =
            await import('../../../src/copilot/terminal/event-adapter-events.js');

        const handled = createTerminalHandledAgentEventsSet();

        expect(handled).not.toBe(TERMINAL_EXPLICIT_AGENT_EVENTS);
        expect(handled.has('tool.execution_start')).toBe(true);
        expect(handled.has('elicitation.pending')).toBe(true);
        expect(handled.has('permission.requested')).toBe(true);
        expect(handled.has('user_input.requested')).toBe(true);
        expect(handled.has('pending_messages.modified')).toBe(true);
        expect(handled.has('external_tool.completed')).toBe(true);
    });
});
