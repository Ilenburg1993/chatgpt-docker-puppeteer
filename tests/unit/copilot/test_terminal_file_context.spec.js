// @ts-check
/**
 * tests/unit/copilot/test_terminal_file_context.spec.js
 *
 * Contrato: presentation/files/context.js
 */

import { describe, expect, it } from 'vitest';

describe('presentation/files/context.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/presentation/files/context.js');
        expect(mod).toBeTruthy();
    });

    it('exporta getFileCacheStats', async () => {
        const mod = await import('../../../src/copilot/presentation/files/context.js');
        expect(typeof mod.getFileCacheStats).toBe('function');
    });

    it('exporta clearFileCache', async () => {
        const mod = await import('../../../src/copilot/presentation/files/context.js');
        expect(typeof mod.clearFileCache).toBe('function');
    });
});
