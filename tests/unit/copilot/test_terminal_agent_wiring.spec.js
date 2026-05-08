// @ts-check
/**
 * tests/unit/copilot/test_terminal_agent_wiring.spec.js
 *
 * Contrato: terminal/wiring/terminal-agent-wiring.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/wiring/terminal-agent-wiring.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');
        expect(mod).toBeTruthy();
    });

    it('exporta registerAgentEventListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');
        expect(typeof mod.registerAgentEventListeners).toBe('function');
    });

    it('restringe restart automático a razões operacionais excepcionais', async () => {
        const mod = await import('../../../src/copilot/terminal/wiring/terminal-agent-wiring.js');

        expect(mod.shouldAutoRestartStoppedDialog('watchdog_restart')).toBe(true);
        expect(mod.shouldAutoRestartStoppedDialog('model_stopped')).toBe(true);
        expect(mod.shouldAutoRestartStoppedDialog('recovery_restart')).toBe(false);
        expect(mod.shouldAutoRestartStoppedDialog('unknown')).toBe(false);
    });
});
