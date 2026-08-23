// @ts-check
import { toError, toExecError } from '#copilot/infra/public/platform/error';
import { describe, expect, it } from 'vitest';

describe('infra/platform/error', () => {
    it('serializes structured objects without degrading to [object Object]', () => {
        const error = toError({ type: 'hook:error_occurred', recoverable: true, context: 'sdk-model-retry' });
        expect(error.message).toContain('"type":"hook:error_occurred"');
        expect(error.message).not.toBe('[object Object]');
    });
    it('preserves message, stack and code from structured throwable values', () => {
        const error = toError({ message: 'failure', stack: 'STACK', code: 'SDK_RETRY' });
        expect(error.message).toBe('failure');
        expect(error.stack).toBe('STACK');
        expect(error.code).toBe('SDK_RETRY');
    });
    it('handles cyclic objects deterministically without throwing during normalization', () => {
        const value = {};
        value.self = value;
        expect(() => toError(value)).not.toThrow();
        expect(toError(value).message).toBe('Erro recebido como objeto sem mensagem estruturada.');
    });
    it('preserves exec process fields', () => {
        const raw = Object.assign(new Error('exec failed'), { stdout: 'out', stderr: 'err', code: 7, status: 2 });
        expect(toExecError(raw)).toMatchObject({
            message: 'exec failed',
            stdout: 'out',
            stderr: 'err',
            code: 7,
            status: 2,
        });
    });
});
