// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildToolFailureResult,
    buildToolSuccessResult,
    extractToolFailureCode,
    extractToolFailureTraceId,
    normalizeToolFailure,
} from '../../../../src/copilot/tools/infra/tool-operation-result.js';

describe('tool-operation-result', () => {
    it('monta envelope de sucesso com resumo terminal e metadados opcionais', () => {
        const result = buildToolSuccessResult(
            { value: 42 },
            { terminalSummary: 'feito', durationMs: 12, traceId: 'trace-1' },
        );

        expect(result).toEqual({
            success: true,
            ok: true,
            status: 'success',
            retryable: false,
            terminalSummary: 'feito',
            durationMs: 12,
            traceId: 'trace-1',
            value: 42,
        });
    });

    it('monta envelope de falha com categoria, retry e próxima ação', () => {
        const result = buildToolFailureResult({
            error: new Error('cursor inválido'),
            code: 'ERR_INVALID_CURSOR',
            category: 'validation',
            retryable: false,
            blockedReason: 'invalid_cursor',
            suggestedNextAction: 'Use o nextCursor retornado anteriormente.',
            durationMs: 5,
        });

        expect(result).toEqual({
            success: false,
            ok: false,
            status: 'failure',
            error: 'cursor inválido',
            category: 'validation',
            retryable: false,
            terminalSummary: 'Tool falhou: cursor inválido',
            code: 'ERR_INVALID_CURSOR',
            blockedReason: 'invalid_cursor',
            suggestedNextAction: 'Use o nextCursor retornado anteriormente.',
            durationMs: 5,
        });
    });

    it('normaliza erro desconhecido em falha estruturada', () => {
        expect(normalizeToolFailure('boom', { category: 'internal', retryable: true })).toMatchObject({
            success: false,
            ok: false,
            status: 'failure',
            error: 'boom',
            category: 'internal',
            retryable: true,
            blockedReason: 'internal_failure',
        });
    });

    it('extrai code e traceId de erros desconhecidos', () => {
        expect(extractToolFailureCode({ code: 'ERR_INVALID_CURSOR' })).toBe('ERR_INVALID_CURSOR');
        expect(extractToolFailureCode({ code: 7 })).toBe('7');
        expect(extractToolFailureTraceId({ traceId: 'trace-direct' })).toBe('trace-direct');
        expect(extractToolFailureTraceId({ io: { traceId: 'trace-io' } })).toBe('trace-io');
        expect(extractToolFailureTraceId({ io: {} })).toBeUndefined();
    });
});
