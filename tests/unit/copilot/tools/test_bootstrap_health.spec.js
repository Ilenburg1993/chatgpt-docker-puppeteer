// @ts-check

import { describe, expect, it, vi } from 'vitest';

import {
    assertPrimaryToolCategoriesHealthy,
    buildToolBootstrapHealth,
    findFailedPrimaryToolCategories,
    registerToolGroupsCollectFailures,
} from '../../../../src/copilot/tools/bootstrap.js';

describe('tools/bootstrap health', () => {
    it('registra categoria quebrada e monta health degradado', () => {
        const registry = /** @type {any} */ ({ entries: new Map() });
        const groups = [
            {
                category: 'code',
                tags: ['lint'],
                tools: [/** @type {any} */ ({ name: 'lint_check', description: 'lint', handler: () => ({}) })],
                readOnly: true,
            },
            {
                category: 'search',
                tags: ['search'],
                tools: [/** @type {any} */ ({ name: 'search_in_files', description: 'search', handler: () => ({}) })],
                readOnly: true,
            },
        ];
        const registerFn = vi.fn((_, __, options) => {
            if (options.category === 'search') throw new Error('registry unavailable');
        });

        const failures = registerToolGroupsCollectFailures(registry, groups, registerFn);
        const health = buildToolBootstrapHealth(failures, 123);

        expect(registerFn).toHaveBeenCalledTimes(2);
        expect(failures).toEqual([{ category: 'search', error: 'registry unavailable', toolCount: 1 }]);
        expect(health).toEqual({
            generatedAt: 123,
            bootstrapDegraded: true,
            failedToolCategories: failures,
            failedToolCategoryNames: ['search'],
        });
    });

    it('mantém health não degradado quando todos os grupos registram', () => {
        const registry = /** @type {any} */ ({ entries: new Map() });
        const groups = [
            {
                category: 'code',
                tags: ['lint'],
                tools: [/** @type {any} */ ({ name: 'lint_check', description: 'lint', handler: () => ({}) })],
                readOnly: true,
            },
        ];

        const failures = registerToolGroupsCollectFailures(registry, groups, vi.fn());
        const health = buildToolBootstrapHealth(failures, 456);

        expect(failures).toEqual([]);
        expect(health).toEqual({
            generatedAt: 456,
            bootstrapDegraded: false,
            failedToolCategories: [],
            failedToolCategoryNames: [],
        });
    });

    it('falha em modo estrito quando categoria primária não registra', () => {
        const failures = [
            { category: 'search', error: 'registry unavailable', toolCount: 1 },
            { category: 'custom', error: 'custom ignored', toolCount: 1 },
        ];

        expect(findFailedPrimaryToolCategories(failures)).toEqual([
            { category: 'search', error: 'registry unavailable', toolCount: 1 },
        ]);
        expect(() => assertPrimaryToolCategoriesHealthy(failures, { strict: true })).toThrow(
            'Categorias primárias de tools falharam no bootstrap',
        );
    });
});
