// @ts-check

import { describe, expect, it } from 'vitest';

import { normalizePatchPlan, summarizePatchPlan } from '../../../../src/copilot/tools/file/write/patch-plan.js';

describe('patch-plan', () => {
    it('normaliza plano atômico com dryRun por padrão', () => {
        const result = normalizePatchPlan({
            operations: [
                {
                    path: 'src/a.js',
                    oldString: 'old',
                    newString: 'new',
                    expectedHash: 'abc',
                    expectedOccurrences: 1,
                },
                {
                    path: 'src/b.js',
                    oldString: 'x',
                    newString: 'y',
                    occurrenceIndex: 2,
                },
            ],
        });

        expect(result).toMatchObject({ ok: true });
        if (!result.ok) throw new Error('expected valid plan');
        expect(result.plan).toEqual({
            dryRun: true,
            atomic: true,
            operations: [
                {
                    path: 'src/a.js',
                    oldString: 'old',
                    newString: 'new',
                    expectedHash: 'abc',
                    expectedOccurrences: 1,
                },
                {
                    path: 'src/b.js',
                    oldString: 'x',
                    newString: 'y',
                    occurrenceIndex: 2,
                },
            ],
        });
        expect(summarizePatchPlan(result.plan)).toEqual({
            dryRun: true,
            atomic: true,
            operationCount: 2,
            fileCount: 2,
            files: ['src/a.js', 'src/b.js'],
            requiresAllPreconditions: true,
        });
    });

    it('rejeita plano inválido com erros estruturados', () => {
        const result = normalizePatchPlan({
            operations: [
                { path: '', oldString: '', newString: 'x', expectedOccurrences: 0 },
                null,
            ],
        });

        expect(result).toMatchObject({ ok: false });
        if (result.ok) throw new Error('expected invalid plan');
        expect(result.errors).toEqual(
            expect.arrayContaining([
                'operations[0].path is required',
                'operations[0].oldString is required',
                'operations[0].expectedOccurrences must be a positive integer',
                'operations[1] must be an object',
                'patch plan must contain at least one valid operation',
            ]),
        );
    });
});
