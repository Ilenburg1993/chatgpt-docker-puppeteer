// @ts-check

import { describe, expect, it } from 'vitest';

import { decideFinalTranscriptRender } from '../../../../src/copilot/terminal/dialog/turn-reconciliation.js';

describe('terminal/dialog/turn-reconciliation', () => {
    it('não renderiza final quando stream já cobre a resposta', () => {
        const decision = decideFinalTranscriptRender({
            reply: 'olá mundo',
            streamedContent: 'olá mundo',
            streamingStarted: true,
            streamingVisibleChars: 8,
        });

        expect(decision).toEqual(expect.objectContaining({ mode: 'none', reason: 'already_streamed' }));
    });

    it('renderiza apenas sufixo quando final completa stream parcial', () => {
        const decision = decideFinalTranscriptRender({
            reply: 'olá mundo completo',
            streamedContent: 'olá mundo',
            streamingStarted: true,
            streamingVisibleChars: 8,
        });

        expect(decision).toEqual(
            expect.objectContaining({
                mode: 'suffix',
                reason: 'stream_suffix',
                content: ' completo',
            }),
        );
    });

    it('preserva formatação original do sufixo quando final completa stream parcial', () => {
        const decision = decideFinalTranscriptRender({
            reply: 'olá mundo\n\n```js\nconsole.log("ok");\n```',
            streamedContent: 'olá mundo',
            streamingStarted: true,
            streamingVisibleChars: 8,
        });

        expect(decision).toEqual(
            expect.objectContaining({
                mode: 'suffix',
                reason: 'stream_suffix',
                content: '\n\n```js\nconsole.log("ok");\n```',
            }),
        );
    });

    it('renderiza final completo quando não houve stream visível', () => {
        const decision = decideFinalTranscriptRender({
            reply: 'resposta final',
            streamedContent: '',
            streamingStarted: false,
            streamingVisibleChars: 0,
        });

        expect(decision).toEqual(
            expect.objectContaining({ mode: 'full', reason: 'no_visible_stream', content: 'resposta final' }),
        );
    });

    it('renderiza final completo com warning quando stream diverge semanticamente', () => {
        const decision = decideFinalTranscriptRender({
            reply: 'resposta final correta',
            streamedContent: 'rascunho divergente',
            streamingStarted: true,
            streamingVisibleChars: 18,
        });

        expect(decision).toEqual(
            expect.objectContaining({
                mode: 'full',
                reason: 'stream_mismatch',
                severity: 'warn',
            }),
        );
    });
});
