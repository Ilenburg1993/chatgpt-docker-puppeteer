// @ts-check

import { describe, expect, it, vi } from 'vitest';

import {
    claimTerminalAssistantTranscript,
    isTerminalAssistantTranscriptCovered,
    renderTerminalAssistantTranscript,
    terminalAssistantTranscriptRendererTestHarness,
} from '../../../../src/copilot/terminal/events/index.js';

describe('terminal/events/assistant-transcript-renderer', () => {
    it('humaniza source técnico de assistant.message para a linha visual', () => {
        expect(
            terminalAssistantTranscriptRendererTestHarness.formatAssistantTranscriptSourceForOperator(
                'sdk/assistant.message',
            ),
        ).toBe('LLM-B via SDK');
        expect(
            terminalAssistantTranscriptRendererTestHarness.formatAssistantTranscriptSourceForOperator(
                'sdk.assistant.message_delta',
            ),
        ).toBe('streaming da LLM-B');
    });

    it('omite detalhe duplicado quando o título já explica a mensagem', () => {
        terminalAssistantTranscriptRendererTestHarness.clearRecentTranscriptHashes();
        const writes = [];
        const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            writes.push(String(chunk));
            return true;
        });
        try {
            expect(
                renderTerminalAssistantTranscript({
                    title: 'Resposta pós-pergunta',
                    source: 'sdk/assistant.message',
                    detail: 'Resposta pós-pergunta',
                    content: 'POST-ASK-CANONICAL-FINAL: usuário confirmou SIM',
                }),
            ).toBe(true);
        } finally {
            writeSpy.mockRestore();
        }

        const output = writes.join('');
        expect(output).toContain('Resposta pós-pergunta');
        expect(output).toContain('LLM-B via SDK');
        expect(output).not.toContain('LLM-B via SDK · Resposta pós-pergunta');
    });

    it('reconhece prefixo truncado como coberto por transcript recente completo', () => {
        terminalAssistantTranscriptRendererTestHarness.clearRecentTranscriptHashes();

        expect(
            claimTerminalAssistantTranscript(
                'DELTA-CANONICAL-1: resposta completa já exibida no terminal. DELTA-CANONICAL-2: continuação final.',
            ),
        ).toBe(true);
        expect(
            isTerminalAssistantTranscriptCovered('DELTA-CANONICAL-1: resposta completa já exibida no terminal.'),
        ).toBe(true);
        expect(
            claimTerminalAssistantTranscript('DELTA-CANONICAL-1: resposta completa já exibida no terminal.', {
                suppressIfCoveredByRecent: true,
            }),
        ).toBe(false);
    });
});
