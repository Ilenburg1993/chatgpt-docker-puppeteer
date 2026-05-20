// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/copilot/terminal/dialog/sse.js', () => ({
    broadcastSse: vi.fn(),
}));

const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const {
    createDeltaCallback,
    createDisplayState,
    createReasoningCallback,
    hasStreamingTranscriptMismatch,
    measureVisibleTerminalChars,
    renderStreamingFooter,
    releaseDisplayState,
    sanitizeTerminalRenderText,
} = await import('../../../../src/copilot/terminal/dialog/turn-display.js');
const { broadcastSse } = await import('../../../../src/copilot/terminal/dialog/sse.js');
const { endTerminalRenderLock, isTerminalRenderLocked } =
    await import('../../../../src/copilot/terminal/dialog/output.js');
const { beginTerminalTurnMaterialization, clearTerminalTurnMaterialization } = await import(
    '../../../../src/copilot/terminal/state/turn-materialization-state.js'
);

describe('terminal/dialog/turn-display', () => {
    beforeEach(() => {
        writeSpy.mockClear();
        vi.mocked(broadcastSse).mockClear();
        clearTerminalTurnMaterialization();
        while (isTerminalRenderLocked()) {
            endTerminalRenderLock();
        }
    });

    it('não entra em streaming visual quando showStreaming=false', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: false,
            showThinking: false,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('abc');

        expect(state.streamingStarted).toBe(false);
        expect(state.streamingChars).toBe(3);
        expect(state.streamingContent).toBe('abc');
        expect(state.firstChunkTime).toBeGreaterThan(0);
    });

    it('desconsidera ANSI e controles ao medir conteúdo visível', () => {
        expect(measureVisibleTerminalChars('\x1b[32mPONG\x1b[0m')).toBe(4);
        expect(measureVisibleTerminalChars('\r\x1b[2K   ')).toBe(0);
    });

    it('remove CSI, OSC e controles antes de renderizar texto não confiável', () => {
        expect(sanitizeTerminalRenderText('ok\x1b[2J\x1b]8;;https://evil.example\x07link\x1b]8;;\x07\u0007!')).toBe(
            'oklink!',
        );
    });

    it('não abre streaming visual apenas com chunks vazios/brancos; deixa fallback textual decidir', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: true,
            showThinking: false,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('');
        onDelta('   \n\n');
        renderStreamingFooter(state, 20);

        expect(state.streamingStarted).toBe(false);
        expect(state.streamingChars).toBe(5);
        expect(state.streamingContent).toBe('   \n\n');
        expect(state.streamingVisibleChars).toBe(0);
        expect(isTerminalRenderLocked()).toBe(false);
    });

    it('entra em streaming visual quando showStreaming=true', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: true,
            showThinking: false,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('abc');
        renderStreamingFooter(state, 20);

        expect(state.streamingStarted).toBe(true);
        expect(state.streamingChars).toBe(3);
        expect(state.streamingContent).toBe('abc');
        expect(isTerminalRenderLocked()).toBe(false);
    });

    it('sanitiza deltas antes de escrever no terminal, preservando o conteúdo textual', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: true,
            showThinking: false,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('Oi\x1b[2J mundo\x07.');
        renderStreamingFooter(state, 20);

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('Oi mundo.');
        expect(output).not.toContain('\x1b[2J');
        expect(output).not.toContain('\x07');
    });

    it('preserva chunks repetidos legítimos no display live', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: true,
            showThinking: false,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('PAR');
        onDelta('PAR');
        renderStreamingFooter(state, 20);

        expect(state.streamingChars).toBe(6);
        expect(state.streamingContent).toBe('PARPAR');
    });

    it('descarrega chunks curtos imediatamente quando streaming visual está ativo', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: true,
            showThinking: false,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('Oi');

        const outputBeforeFooter = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(state.streamingStarted).toBe(true);
        expect(outputBeforeFooter).toContain('Oi');
    });

    it('propaga traceId e turnId canônicos no SSE de delta', () => {
        beginTerminalTurnMaterialization({ turnId: 'turn-123', timestamp: 1000 });
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: false,
            showThinking: false,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('abc', { streamId: 'stream-1', chunkSeq: 1, eventId: 'event-1' });

        expect(broadcastSse).toHaveBeenCalledWith(
            'delta',
            expect.objectContaining({
                chunk: 'abc',
                traceId: 'turn:turn-123',
                turnId: 'turn-123',
                streamId: 'stream-1',
                chunkSeq: 1,
                eventId: 'event-1',
            }),
        );
    });

    it('detecta divergência entre stream acumulado e reply final', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: false,
            showThinking: false,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('PAR');
        expect(hasStreamingTranscriptMismatch(state, 'PARTE')).toBe(true);
        expect(hasStreamingTranscriptMismatch(state, 'PAR')).toBe(false);
    });

    it('mantém thinking de turno silencioso quando showThinking=false', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: false,
            showThinking: false,
        });

        const onReasoning = createReasoningCallback(state);
        onReasoning('pensando...', 'r1');
        renderStreamingFooter(state, 10);

        expect(state.reasoningStarted).toBe(true);
        expect(state.reasoningChars).toBe(11);
        expect(writeSpy).not.toHaveBeenCalled();
    });

    it('ativa lock durante reasoning e libera no footer', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: false,
            showThinking: false,
        });

        const onReasoning = createReasoningCallback(state);
        expect(isTerminalRenderLocked()).toBe(false);
        onReasoning('pensando...', 'r2');
        expect(isTerminalRenderLocked()).toBe(true);

        renderStreamingFooter(state, 10);
        expect(isTerminalRenderLocked()).toBe(false);
    });

    it('ativa lock durante streaming e libera no footer', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: true,
            showThinking: false,
        });

        const onDelta = createDeltaCallback(state);
        expect(isTerminalRenderLocked()).toBe(false);
        onDelta('abc');
        expect(isTerminalRenderLocked()).toBe(true);

        renderStreamingFooter(state, 20);
        expect(isTerminalRenderLocked()).toBe(false);
    });

    it('releaseDisplayState libera lock mesmo sem footer normal', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: true,
            showThinking: false,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('abc');
        expect(isTerminalRenderLocked()).toBe(true);

        releaseDisplayState(state);
        expect(isTerminalRenderLocked()).toBe(false);
    });

    it('não prefixa cada chunk de streaming no meio da mesma linha', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: true,
            showThinking: false,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('Olá ');
        onDelta('mundo.');
        renderStreamingFooter(state, 20);

        const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        const prefixCount = [...output.matchAll(/│/g)].length;
        expect(prefixCount).toBe(1);
        expect(output).toContain('Olá mundo.');
    });
});
