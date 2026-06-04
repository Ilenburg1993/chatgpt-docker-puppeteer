// @ts-check

import { describe, expect, it } from 'vitest';

import {
    claimTerminalAssistantTranscript,
    isTerminalAssistantTranscriptCovered,
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
