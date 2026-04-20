// @ts-check
/**
 * tests/unit/copilot/test_terminal_agent_runtime_events.spec.js
 *
 * Contrato: terminal/agent-runtime-events.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/agent-runtime-events.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/agent-runtime-events.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setupTerminalAgentRuntimeEventListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/agent-runtime-events.js');
        expect(typeof mod.setupTerminalAgentRuntimeEventListeners).toBe('function');
    });
});
