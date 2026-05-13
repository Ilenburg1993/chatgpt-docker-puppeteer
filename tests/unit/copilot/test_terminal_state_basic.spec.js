// @ts-check
/**
 * tests/unit/copilot/test_terminal_state_basic.spec.js
 *
 * Contrato: presentation/state/index.js
 */

import { describe, expect, it } from 'vitest';
describe('presentation/state/index.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/presentation/state/index.js');
        expect(mod).toBeTruthy();
    });

    it('exporta getBusy', async () => {
        const mod = await import('../../../src/copilot/presentation/state/index.js');
        expect(typeof mod.getBusy).toBe('function');
    });

    it('exporta setBusy', async () => {
        const mod = await import('../../../src/copilot/presentation/state/index.js');
        expect(typeof mod.setBusy).toBe('function');
    });

    it('exporta getSdkSessionMode', async () => {
        const mod = await import('../../../src/copilot/presentation/state/index.js');
        expect(typeof mod.getSdkSessionMode).toBe('function');
    });

    it('exporta setSdkSessionMode', async () => {
        const mod = await import('../../../src/copilot/presentation/state/index.js');
        expect(typeof mod.setSdkSessionMode).toBe('function');
    });

    it('exporta getLastSdkPlanOperation', async () => {
        const mod = await import('../../../src/copilot/presentation/state/index.js');
        expect(typeof mod.getLastSdkPlanOperation).toBe('function');
    });

    it('exporta getTerminalPhase', async () => {
        const mod = await import('../../../src/copilot/presentation/state/index.js');
        expect(typeof mod.getTerminalPhase).toBe('function');
    });

    it('exporta TerminalPhase', async () => {
        const mod = await import('../../../src/copilot/presentation/state/index.js');
        expect(mod.TerminalPhase).toBeTruthy();
    });
});
