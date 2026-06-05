// @ts-check

import { describe, expect, it } from 'vitest';

import { presentByokTurnFailure } from '../../../../src/copilot/terminal/dialog/byok-turn-error-presentation.js';

describe('terminal/dialog/byok-turn-error-presentation', () => {
    it('mantém a superfície humana sem contexto interno dialog.byok nem mensagem crua', () => {
        const presentation = presentByokTurnFailure({
            message: '402 402 status code (no body)',
            errorContext: 'dialog.byok_provider_credits',
            provider: 'kilo-code',
            profile: 'chutes-ai',
            model: 'Qwen/Qwen3.5',
            failure: {
                kind: 'credits',
                operatorLabel: 'provider BYOK recusou a chamada por credito, saldo ou cota (HTTP 402)',
                operatorAction: 'troque para modelo/perfil free ou com credito',
                statusCode: 402,
                retryAfterSeconds: null,
                resetAt: null,
            },
        });

        expect(presentation.title).toBe('Rota BYOK');
        expect(presentation.summary).toContain('rota BYOK recusou a chamada por crédito');
        expect(presentation.summary).toContain('sem Premium Request');
        expect(presentation.destination).toBe('perfil chutes-ai · provedor kilo-code · modelo Qwen/Qwen3.5');
        expect(`${presentation.summary}\n${presentation.destination}\n${presentation.action}`).not.toContain(
            'dialog.byok_provider_credits',
        );
        expect(`${presentation.summary}\n${presentation.destination}\n${presentation.action}`).not.toContain(
            '402 402 status code',
        );
        expect(presentation.technicalDetail).toContain('dialog.byok_provider_credits');
        expect(presentation.technicalDetail).toContain('402 402 status code');
    });

    it('expõe janela de retry/reset quando o provider informa limites dinâmicos', () => {
        const presentation = presentByokTurnFailure({
            message: 'rate limit',
            errorContext: 'dialog.byok_provider_rate_limit',
            provider: 'openrouter',
            profile: 'repo-agent',
            model: 'deepseek/free',
            failure: {
                kind: 'rate-limit',
                operatorLabel: 'provider BYOK aplicou rate limit (HTTP 429)',
                operatorAction: 'aguarde a janela do provider',
                statusCode: 429,
                retryAfterSeconds: 125,
                resetAt: '2026-06-05T12:30:00.000Z',
            },
        });

        expect(presentation.window).toBe('retry-after 3min · reset 2026-06-05T12:30:00.000Z');
    });
});
