// @ts-check

import { describe, expect, it, vi } from 'vitest';

import { createSessionAutoModelResolver } from '../../../../src/copilot/sdk/models/session-resolution-adapter.js';

describe('sdk/models/session-resolution-adapter', () => {
    it('createSessionAutoModelResolver injeta dependências de catálogo e resolução', async () => {
        const listModelsFn = vi.fn(
            async () =>
                /** @type {import('@github/copilot-sdk').ModelInfo[]} */ ([
                    /** @type {any} */ ({ id: 'm1', name: 'Model 1', capabilities: { supports: {}, limits: {} } }),
                    /** @type {any} */ ({ id: 'm2', name: 'Model 2', capabilities: { supports: {}, limits: {} } }),
                ]),
        );
        const resolveModelIdAutoFn = vi.fn(async (models, preferred, fallback) => {
            expect(models).toHaveLength(2);
            expect(preferred).toBe('auto');
            return `chosen:${fallback}`;
        });

        const resolveAuto = createSessionAutoModelResolver({
            listModelsFn,
            resolveModelIdAutoFn,
        });

        await expect(resolveAuto('gpt-5-mini')).resolves.toBe('chosen:gpt-5-mini');
        expect(listModelsFn).toHaveBeenCalledTimes(1);
        expect(resolveModelIdAutoFn).toHaveBeenCalledTimes(1);
    });
});
