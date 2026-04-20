// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/copilot/terminal/dialog/sse.js', () => ({
    broadcastSse: vi.fn(),
}));

const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const { createDeltaCallback, createDisplayState } =
    await import('../../../../src/copilot/terminal/dialog/turn-display.js');

describe('terminal/dialog/turn-display', () => {
    beforeEach(() => {
        writeSpy.mockClear();
    });

    it('não entra em streaming visual quando showStreaming=false', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: false,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('abc');

        expect(state.streamingStarted).toBe(false);
        expect(state.streamingChars).toBe(3);
        expect(state.firstChunkTime).toBeGreaterThan(0);
    });

    it('entra em streaming visual quando showStreaming=true', () => {
        const state = createDisplayState({
            model: 'gpt-5-mini',
            effort: 'high',
            turnStartTime: Date.now(),
            showStreaming: true,
        });

        const onDelta = createDeltaCallback(state);
        onDelta('abc');

        expect(state.streamingStarted).toBe(true);
        expect(state.streamingChars).toBe(3);
    });
});
