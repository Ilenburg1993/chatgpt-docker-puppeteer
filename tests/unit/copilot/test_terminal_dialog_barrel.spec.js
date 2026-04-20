// @ts-check
/**
 * tests/unit/copilot/test_terminal_dialog_barrel.spec.js
 *
 * Contrato: terminal/dialog/index.js
 */

import { describe, expect, it } from 'vitest';
describe('terminal/dialog/index.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/index.js');
        expect(mod).toBeTruthy();
    });

    it('exporta BOOT_PROMPT', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/index.js');
        expect(mod.BOOT_PROMPT).toBeDefined();
    });

    it('exporta PROMPT_USER', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/index.js');
        expect(mod.PROMPT_USER).toBeDefined();
    });

    it('exporta buildUserPrompt', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/index.js');
        expect(typeof mod.buildUserPrompt).toBe('function');
    });

    it('exporta buildWaitingPrompt', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/index.js');
        expect(typeof mod.buildWaitingPrompt).toBe('function');
    });
});
