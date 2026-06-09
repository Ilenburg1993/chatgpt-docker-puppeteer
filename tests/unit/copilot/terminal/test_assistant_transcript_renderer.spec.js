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
                    title: 'Resposta da LLM-B',
                    source: 'sdk/assistant.message',
                    detail: 'Resposta da LLM-B',
                    content: 'POST-ASK-CANONICAL-FINAL: usuário confirmou SIM',
                }),
            ).toBe(true);
        } finally {
            writeSpy.mockRestore();
        }

        const output = writes.join('');
        expect(output).toContain('Resposta da LLM-B');
        expect(output).toContain('LLM-B via SDK');
        expect(output).not.toContain('pós-pergunta');
        expect(output).not.toContain('LLM-B via SDK · Resposta da LLM-B');
    });

    it('remove bloco inicial de thinking vazado do transcript público e do histórico exportável', () => {
        terminalAssistantTranscriptRendererTestHarness.clearRecentTranscriptHashes();
        const writes = [];
        const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            writes.push(String(chunk));
            return true;
        });
        try {
            expect(
                renderTerminalAssistantTranscript({
                    title: 'LLM-B',
                    source: 'sdk/assistant.message',
                    content: '<thinking>\nsegredo\n</thinking>\n\nDELTA-CANONICAL-1',
                }),
            ).toBe(true);
        } finally {
            writeSpy.mockRestore();
        }

        const output = writes.join('');
        expect(output).toContain('DELTA-CANONICAL-1');
        expect(output).not.toContain('segredo');
        expect(output).not.toContain('thinking');
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

    it('suprime sufixo tardio quando o transcript completo recente já cobriu o conteúdo', () => {
        terminalAssistantTranscriptRendererTestHarness.clearRecentTranscriptHashes();
        const writes = [];
        const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            writes.push(String(chunk));
            return true;
        });
        try {
            expect(
                renderTerminalAssistantTranscript({
                    title: 'Continuação da LLM-B',
                    source: 'dialog.turn_end',
                    content: 'POST-ASK-CANONICAL-FINAL: usuário confirmou SIM',
                }),
            ).toBe(true);
            expect(
                renderTerminalAssistantTranscript({
                    title: 'Complemento da LLM-B',
                    source: 'sdk/assistant.message',
                    content: 'SIM',
                    suppressIfCoveredByRecent: true,
                    coverageMinChars: 1,
                }),
            ).toBe(false);
        } finally {
            writeSpy.mockRestore();
        }

        const output = writes.join('');
        expect(output).toContain('POST-ASK-CANONICAL-FINAL: usuário confirmou SIM');
        expect(output).not.toContain('Complemento da LLM-B');
    });
});
