// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildAttemptedReadThroughReport,
    buildSkippedReadThroughReport,
    buildTimedOutReadThroughReport,
    normalizeReadThroughMode,
    planReadThrough,
} from '../../../../src/copilot/tools/file/read/read-through-policy.js';

describe('read-through-policy', () => {
    it('normaliza boolean legado e enum explícito', () => {
        expect(normalizeReadThroughMode(undefined)).toBe('auto');
        expect(normalizeReadThroughMode(true)).toBe('auto');
        expect(normalizeReadThroughMode(false)).toBe('off');
        expect(normalizeReadThroughMode('off')).toBe('off');
        expect(normalizeReadThroughMode('auto')).toBe('auto');
        expect(normalizeReadThroughMode('force')).toBe('force');
    });

    it('planeja skip com motivos explícitos', () => {
        expect(planReadThrough({ mode: 'off', readStrategy: 'cached', fileSize: 9999, minBytes: 1024 })).toEqual({
            attempted: false,
            mode: 'off',
            skippedReason: 'disabled',
        });
        expect(planReadThrough({ mode: 'auto', readStrategy: 'stream', fileSize: 9999, minBytes: 1024 })).toEqual({
            attempted: false,
            mode: 'auto',
            skippedReason: 'non_cached_read_strategy',
        });
        expect(planReadThrough({ mode: 'auto', readStrategy: 'cached', fileSize: 10, minBytes: 1024 })).toEqual({
            attempted: false,
            mode: 'auto',
            skippedReason: 'file_below_threshold',
        });
    });

    it('planeja tentativa em auto acima do limiar e force abaixo do limiar', () => {
        expect(planReadThrough({ mode: 'auto', readStrategy: 'cached', fileSize: 2048, minBytes: 1024 })).toEqual({
            attempted: true,
            mode: 'auto',
            skippedReason: null,
        });
        expect(planReadThrough({ mode: 'force', readStrategy: 'cached', fileSize: 10, minBytes: 1024 })).toEqual({
            attempted: true,
            mode: 'force',
            skippedReason: null,
        });
    });

    it('monta relatório de skip e tentativa com schema estável', () => {
        expect(buildSkippedReadThroughReport({ mode: 'off', skippedReason: 'disabled' })).toEqual({
            attempted: false,
            mode: 'off',
            skippedReason: 'disabled',
            durationMs: 0,
            indexed: false,
            relatedPaths: [],
        });

        const report = buildAttemptedReadThroughReport('force', Date.now(), { relatedPaths: ['a.js'] });
        expect(report).toMatchObject({
            attempted: true,
            mode: 'force',
            skippedReason: null,
            timedOut: false,
            indexed: true,
            relatedPaths: ['a.js'],
        });
        expect(typeof report.durationMs).toBe('number');
    });

    it('monta relatório de timeout com orçamento explícito', () => {
        const report = buildTimedOutReadThroughReport('auto', Date.now(), 750);
        expect(report).toMatchObject({
            attempted: true,
            mode: 'auto',
            skippedReason: 'duration_budget_exceeded',
            timedOut: true,
            timeoutMs: 750,
            indexed: false,
            relatedPaths: [],
        });
        expect(typeof report.durationMs).toBe('number');
    });
});
