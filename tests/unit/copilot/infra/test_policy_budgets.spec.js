// @ts-check

import { describe, expect, it } from 'vitest';

import {
    DEFAULT_IO_SEARCH_MAX_BUFFER_BYTES,
    DEFAULT_IO_SEARCH_TIMEOUT_MS,
    DEFAULT_PROCESS_MAX_BUFFER_BYTES,
    MIN_BUFFER_BYTES,
    MIN_TIMEOUT_MS,
    normalizePositiveIntegerBudget,
    resolveIoSearchBudget,
    resolveProcessExecutionBudget,
} from '../../../../src/copilot/infra/policy/budgets.js';

describe('infra/policy/budgets', () => {
    it('normaliza budgets positivos com mínimo e máximo', () => {
        expect(normalizePositiveIntegerBudget(undefined, 10, { min: 3 })).toBe(10);
        expect(normalizePositiveIntegerBudget(-1, 10, { min: 3 })).toBe(10);
        expect(normalizePositiveIntegerBudget(2, 10, { min: 3 })).toBe(3);
        expect(normalizePositiveIntegerBudget(20.8, 10, { max: 12 })).toBe(12);
    });

    it('resolve budget de busca IO com limites defensivos', () => {
        expect(resolveIoSearchBudget({ timeoutMs: 1, maxBufferBytes: 8 })).toEqual({
            timeoutMs: MIN_TIMEOUT_MS,
            maxBufferBytes: MIN_BUFFER_BYTES,
        });
    });

    it('mantém defaults generosos para busca local da LLM-B', () => {
        expect(resolveIoSearchBudget()).toEqual({
            timeoutMs: DEFAULT_IO_SEARCH_TIMEOUT_MS,
            maxBufferBytes: DEFAULT_IO_SEARCH_MAX_BUFFER_BYTES,
        });
    });

    it('resolve budget de subprocesso permitindo timeout explicitamente desativado', () => {
        expect(resolveProcessExecutionBudget({ timeoutMs: null })).toEqual({
            timeoutMs: null,
            maxBufferBytes: DEFAULT_PROCESS_MAX_BUFFER_BYTES,
        });
        expect(resolveProcessExecutionBudget({ timeoutMs: 1, maxBufferBytes: 8 })).toEqual({
            timeoutMs: MIN_TIMEOUT_MS,
            maxBufferBytes: MIN_BUFFER_BYTES,
        });
    });
});
