// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_types.spec.js
 *
 * Testes para src/copilot/sdk/types.js — verifica que o barrel de tipos é importável e não contém runtime exports
 * acidentais.
 */

import { describe, expect, it } from 'vitest';

describe('sdk/types.js', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../../src/copilot/sdk/types.js');
        expect(mod).toBeDefined();
    });

    it('não exporta runtime values (apenas JSDoc typedefs)', async () => {
        const mod = await import('../../../../src/copilot/sdk/types.js');
        // types.js exporta `export {}` — não deve ter named exports runtime
        const keys = Object.keys(mod);
        expect(keys).toEqual([]);
    });

    it('módulo é resolvível como ESM', async () => {
        // Garante que o import dinâmico funciona (path válido, sem syntax errors)
        await expect(import('../../../../src/copilot/sdk/types.js')).resolves.toBeDefined();
    });
});
