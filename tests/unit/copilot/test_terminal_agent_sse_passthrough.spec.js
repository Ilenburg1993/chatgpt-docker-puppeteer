// @ts-check
/**
 * tests/unit/copilot/test_terminal_agent_sse_passthrough.spec.js
 *
 * Contrato: terminal/agent-sse-passthrough.js
 */

import { describe, expect, it, vi } from 'vitest';

const broadcastSse = vi.fn();

vi.mock('../../../src/copilot/terminal/dialog/index.js', () => ({
    broadcastSse,
}));

describe('terminal/agent-sse-passthrough.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/events/agent-sse-passthrough.js');
        expect(mod).toBeTruthy();
    });

    it('exporta registerTerminalAgentSsePassthrough', async () => {
        const mod = await import('../../../src/copilot/terminal/events/agent-sse-passthrough.js');
        expect(typeof mod.registerTerminalAgentSsePassthrough).toBe('function');
    });

    it('só retransmite eventos explicitamente permitidos para passthrough', async () => {
        const { registerTerminalAgentSsePassthrough } =
            await import('../../../src/copilot/terminal/events/agent-sse-passthrough.js');

        /** @type {Map<string, Function[]>} */
        const listeners = new Map();
        const agent = {
            on(/** @type {string} */ event, /** @type {(...args: any[]) => void} */ handler) {
                const current = listeners.get(event) ?? [];
                current.push(handler);
                listeners.set(event, current);
            },
        };

        registerTerminalAgentSsePassthrough({
            agent: /** @type {any} */ (agent),
            handledEvents: new Set(['session.title_changed', 'pr.consumed', 'pr.fallback_model']),
            passthroughEvents: new Set(['dialog.turn_timeout']),
        });

        expect(listeners.has('dialog.turn_timeout')).toBe(true);
        expect(listeners.has('pr.consumed')).toBe(false);
        expect(listeners.has('pr.fallback_model')).toBe(false);
        expect(listeners.has('session.title_changed')).toBe(false);
        expect(listeners.has('assistant.streaming_delta')).toBe(false);

        listeners.get('dialog.turn_timeout')?.[0]?.({ phase: 'inject', timeoutMs: 15000 });

        expect(broadcastSse).toHaveBeenCalledWith(
            'dialog.turn_timeout',
            expect.objectContaining({
                phase: 'inject',
                timeoutMs: 15000,
                source: 'agent/passthrough/dialog.turn_timeout',
                timestamp: expect.any(Number),
            }),
        );
        expect(broadcastSse).toHaveBeenCalledTimes(1);
    });
});
