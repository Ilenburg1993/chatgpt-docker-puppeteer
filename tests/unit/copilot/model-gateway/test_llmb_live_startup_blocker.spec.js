// @ts-check

import { describe, expect, it } from 'vitest';

import { classifyModelGatewayTerminalStartupBlocker } from '../../../../scripts/model-gateway/commands/model-gateway-terminal-live-blocker.mjs';

describe('LLM-B live startup blocker classifier', () => {
    it('classifies GitHub 503 token-validation outage as upstream unavailability, not bad credentials', () => {
        const plain = [
            'session.create falhou (attempt=1/2, kind=auth, retryable=false): Authentication failed: Failed to validate SDK token (503): GitHub returned: No server is currently available to service your request.',
            '[sdk auth] Authentication failed',
            'Detalhe Autenticação do SDK bloqueou o dialog loop; o host local continua vivo.',
            'LLM-B erro · Boot da conversa bloqueada',
        ].join('\n');

        expect(classifyModelGatewayTerminalStartupBlocker(plain)).toEqual({
            id: 'sdk-upstream-unavailable',
            detail: 'GitHub Copilot SDK upstream was unavailable during session bootstrap; scenario prompt was not dispatched',
        });
    });

    it('classifies terminal-declared auth bootstrap failure only after boot is known blocked', () => {
        expect(classifyModelGatewayTerminalStartupBlocker('[sdk auth] unauthorized')).toBeNull();
        expect(
            classifyModelGatewayTerminalStartupBlocker(
                '[sdk auth] unauthorized\nAutenticação do SDK bloqueou o dialog loop; o host local continua vivo.',
            ),
        ).toMatchObject({ id: 'sdk-auth-failed' });
    });

    it('classifies terminal-declared network bootstrap failure', () => {
        expect(
            classifyModelGatewayTerminalStartupBlocker(
                '[sdk rede] fetch failed\nFalha transitória do SDK; a política permite retry/backoff local.',
            ),
        ).toMatchObject({ id: 'sdk-network-unavailable' });
    });

    it('recognizes the final terminal boot-failure wording emitted after all SDK retries are exhausted', () => {
        const plain = [
            'ensureDialogLoop falhou após 3 tentativas: [sdk/session.create] falhou (network): Authentication failed: Failed to validate SDK token (503): GitHub returned: No server is currently available to service your request.',
            'Boot        falha ao iniciar conversa · [sdk/session.create] falhou (network): Authentication failed: Failed to validate SDK token (503).',
            'Dialog loop bootstrap error: [sdk/session.create] falhou (network): Failed to validate SDK token (503).',
        ].join('\n');

        expect(classifyModelGatewayTerminalStartupBlocker(plain)).toEqual({
            id: 'sdk-upstream-unavailable',
            detail: 'GitHub Copilot SDK upstream was unavailable during session bootstrap; scenario prompt was not dispatched',
        });
    });
});
