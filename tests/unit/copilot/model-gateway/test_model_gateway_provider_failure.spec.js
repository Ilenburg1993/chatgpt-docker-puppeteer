import { describe, expect, it } from 'vitest';

import { classifyByokProviderFailure } from '../../../../src/copilot/model-gateway/health/provider-failure.js';

describe('model-gateway BYOK provider failure taxonomy', () => {
    it('classifica 402 sem body como bloqueio externo de credito/cota', () => {
        const failure = classifyByokProviderFailure(new Error('402 402 status code (no body)'));

        expect(failure).toEqual(
            expect.objectContaining({
                kind: 'credits',
                statusCode: 402,
                errorContext: 'provider.credits',
                external: true,
            }),
        );
        expect(failure.operatorLabel).toContain('credito');
        expect(failure.operatorAction).toContain('/byok probe agent');
    });

    it('preserva classes diferentes para auth, modelo/rota e rede', () => {
        expect(classifyByokProviderFailure(Object.assign(new Error('Forbidden'), { status: 403 })).kind).toBe(
            'auth',
        );
        expect(classifyByokProviderFailure('HTTP status code 404').kind).toBe('model-or-route');
        expect(
            classifyByokProviderFailure(Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })).kind,
        ).toBe('network');
    });

    it('classifica rate-limit, timeout, upstream e desconhecido sem colapsar em fallback unico', () => {
        expect(classifyByokProviderFailure(Object.assign(new Error('too many requests'), { status: 429 })).kind).toBe(
            'rate-limit',
        );
        expect(classifyByokProviderFailure(new Error('provider timed out without progress')).kind).toBe('timeout');
        expect(classifyByokProviderFailure(Object.assign(new Error('bad gateway'), { statusCode: 502 })).kind).toBe(
            'upstream',
        );
        expect(classifyByokProviderFailure(new Error('unexpected provider envelope')).kind).toBe('unknown');
    });
});
