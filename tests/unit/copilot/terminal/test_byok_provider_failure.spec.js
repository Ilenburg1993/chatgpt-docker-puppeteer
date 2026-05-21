import { describe, expect, it } from 'vitest';

import { classifyTerminalByokProviderFailure } from '../../../../src/copilot/terminal/byok/provider-failure.js';

describe('terminal BYOK provider failure taxonomy', () => {
    it('classifica 402 sem body como bloqueio externo de credito/cota', () => {
        const failure = classifyTerminalByokProviderFailure(new Error('402 402 status code (no body)'));

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
        expect(classifyTerminalByokProviderFailure(Object.assign(new Error('Forbidden'), { status: 403 })).kind).toBe(
            'auth',
        );
        expect(classifyTerminalByokProviderFailure('HTTP status code 404').kind).toBe('model-or-route');
        expect(
            classifyTerminalByokProviderFailure(Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })).kind,
        ).toBe('network');
    });
});
