// @ts-check
/**
 * tests/unit/copilot/test_terminal_server.spec.js
 *
 * Contrato: terminal/index.js
 */

import { describe, expect, it } from 'vitest';
describe('terminal/index.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/index.js');
        expect(mod).toBeTruthy();
    });

    it('exporta startTerminalServer', async () => {
        const mod = await import('../../../src/copilot/terminal/index.js');
        expect(typeof mod.startTerminalServer).toBe('function');
    });
});
