// @ts-check
/**
 * tests/unit/copilot/test_terminal_dialog_engine.spec.js
 *
 * Contrato: terminal/dialog/engine.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/dialog/engine.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/engine.js');
        expect(mod).toBeTruthy();
    });

    it('exporta sendTurn', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/engine.js');
        expect(typeof mod.sendTurn).toBe('function');
    });

    it('exporta ensureDialogLoop', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/engine.js');
        expect(typeof mod.ensureDialogLoop).toBe('function');
    });

    it('exporta getTurnQueueDepth', async () => {
        const mod = await import('../../../src/copilot/terminal/dialog/engine.js');
        expect(typeof mod.getTurnQueueDepth).toBe('function');
    });
});
