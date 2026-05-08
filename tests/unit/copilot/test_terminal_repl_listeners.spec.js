// @ts-check
/**
 * tests/unit/copilot/test_terminal_repl_listeners.spec.js
 *
 * Contrato: terminal/repl-listeners.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/repl-listeners.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/repl/repl-listeners.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setupAgentListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/repl/repl-listeners.js');
        expect(typeof mod.setupAgentListeners).toBe('function');
    });
});
