// @ts-check
/**
 * tests/unit/copilot/test_terminal_dialog_output.spec.js
 *
 * Contrato: terminal/dialog/output.js
 */

import { describe, expect, it } from 'vitest';
describe('terminal/dialog/output.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(mod).toBeTruthy();
    });

    it('exporta BOOT_PROMPT', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(mod.BOOT_PROMPT).toBeDefined();
    });

    it('exporta PROMPT_USER', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(mod.PROMPT_USER).toBeDefined();
    });

    it('exporta buildUserPrompt', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(typeof mod.buildUserPrompt).toBe('function');
    });

    it('exporta buildWaitingPrompt', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(typeof mod.buildWaitingPrompt).toBe('function');
    });

    it('exporta SEPARATOR', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/output.js');
        expect(mod.SEPARATOR).toBeDefined();
    });
});
