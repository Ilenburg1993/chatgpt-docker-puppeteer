// @ts-check
/**
 * tests/unit/copilot/test_terminal_alias_store.spec.js
 *
 * Contrato: terminal/alias-store.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/alias-store.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/alias-store.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setAlias', async () => {
        const mod = await import('../../../src/copilot/terminal/alias-store.js');
        expect(typeof mod.setAlias).toBe('function');
    });

    it('exporta getAliases', async () => {
        const mod = await import('../../../src/copilot/terminal/alias-store.js');
        expect(typeof mod.getAliases).toBe('function');
    });

    it('exporta resolve', async () => {
        const mod = await import('../../../src/copilot/terminal/alias-store.js');
        expect(typeof mod.resolve).toBe('function');
    });

    it('exporta resetAliases', async () => {
        const mod = await import('../../../src/copilot/terminal/alias-store.js');
        expect(typeof mod.resetAliases).toBe('function');
    });
});
