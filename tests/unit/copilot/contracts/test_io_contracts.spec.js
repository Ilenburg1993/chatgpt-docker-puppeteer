// @ts-check

import { describe, expect, it } from 'vitest';

import { buildIoMeta, toIoError } from '#copilot/infra/public/operations/contracts';

describe('contracts/io-contracts', () => {
    it('toIoError normaliza erros nativos para códigos estáveis', () => {
        expect(toIoError(Object.assign(new Error('missing'), { code: 'ENOENT' })).code).toBe('NotFound');
        expect(toIoError(Object.assign(new Error('denied'), { code: 'EACCES' })).code).toBe('PathDenied');
        expect(toIoError(Object.assign(new Error('Destino já existe'), { code: 'EEXIST' })).code).toBe('LockConflict');
        expect(toIoError(new SyntaxError('bad json')).code).toBe('ParseFailed');
        expect(toIoError(new Error('Arquivo binário detectado')).code).toBe('BinaryDenied');
    });

    it('toIoError diferencia timeout genérico de timeout de lock', () => {
        const genericTimeout = Object.assign(new Error('request timed out'), {
            code: 'ETIMEDOUT',
            name: 'TimeoutError',
        });
        const lockTimeout = Object.assign(new Error('Timeout ao aguardar lock do recurso: file.txt'), {
            code: 'ETIMEDOUT',
            name: 'TimeoutError',
        });

        expect(toIoError(genericTimeout).code).toBe('Timeout');
        expect(toIoError(lockTimeout).code).toBe('LockTimeout');
    });

    it('buildIoMeta preserva policy version, cache e risco padrão', () => {
        const io = buildIoMeta({ operation: 'scan', target: '/tmp/workspace', targetKind: 'directory' });

        expect(io.operation).toBe('scan');
        expect(io.targetKind).toBe('directory');
        expect(io.cache).toBe('none');
        expect(io.riskClass).toBe('low');
        expect(io.policyVersion).toBe('2026-05-06.read-write-ultrafast.v1');
    });
});
