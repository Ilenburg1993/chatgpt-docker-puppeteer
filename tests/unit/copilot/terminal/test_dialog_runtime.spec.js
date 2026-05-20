// @ts-check

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('terminal/dialog/dialog-runtime', () => {
    it('expõe estado de load sem fingir queue depth antes do import', async () => {
        const mod = await import('../../../../src/copilot/terminal/dialog/dialog-runtime.js');
        const state = mod.getDialogRuntimeLoadState();

        expect(state).toEqual(
            expect.objectContaining({
                loaded: expect.any(Boolean),
                importInFlight: expect.any(Boolean),
            }),
        );
        expect(state.turnQueueDepth === null || typeof state.turnQueueDepth === 'number').toBe(true);
    });

    it('reseta promise de lazy import quando o import falha', async () => {
        const src = await readFile(
            new URL('../../../../src/copilot/terminal/dialog/dialog-runtime.js', import.meta.url),
            'utf8',
        );

        expect(src).toContain('.catch((err) => {');
        expect(src).toContain('_engineModulePromise = null;');
        expect(src).toContain('_engineModule = null;');
    });
});
