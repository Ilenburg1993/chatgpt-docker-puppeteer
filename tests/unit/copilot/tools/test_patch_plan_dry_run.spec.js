// @ts-check

import { describe, expect, it } from 'vitest';

import { dryRunPatchPlan, normalizePatchPlan } from '../../../../src/copilot/tools/file/write/patch-plan.js';

describe('patch-plan dry run', () => {
    it('simula operações multi-arquivo e agrega preview por arquivo', () => {
        const normalized = normalizePatchPlan({
            operations: [
                { path: 'a.js', oldString: 'alpha', newString: 'beta', expectedOccurrences: 1 },
                { path: 'b.js', oldString: 'one', newString: 'two' },
            ],
        });
        if (!normalized.ok) throw new Error('expected valid plan');

        const result = dryRunPatchPlan(normalized.plan, {
            'a.js': 'const value = alpha;\n',
            'b.js': 'one one\n',
        });

        expect(result).toMatchObject({
            ok: true,
            dryRun: true,
            atomic: true,
            operationCount: 2,
            fileCount: 2,
            errors: [],
            wouldApply: true,
        });
        expect(result.operationResults).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ path: 'a.js', ok: true, occurrenceCount: 1, changedOccurrences: 1 }),
                expect.objectContaining({ path: 'b.js', ok: true, occurrenceCount: 2, changedOccurrences: 2 }),
            ]),
        );
        expect(result.files).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ path: 'a.js', changed: true }),
                expect.objectContaining({ path: 'b.js', changed: true }),
            ]),
        );
    });

    it('falha dry-run quando pré-condição de ocorrência não bate', () => {
        const normalized = normalizePatchPlan({
            operations: [{ path: 'a.js', oldString: 'alpha', newString: 'beta', expectedOccurrences: 2 }],
        });
        if (!normalized.ok) throw new Error('expected valid plan');

        const result = dryRunPatchPlan(normalized.plan, { 'a.js': 'alpha\n' });

        expect(result.ok).toBe(false);
        expect(result.wouldApply).toBe(false);
        expect(result.errors[0]).toContain('expectedOccurrences mismatch');
        expect(result.operationResults[0]).toMatchObject({
            path: 'a.js',
            ok: false,
            occurrenceCount: 1,
        });
    });
});
