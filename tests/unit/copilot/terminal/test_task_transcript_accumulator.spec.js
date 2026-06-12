// @ts-check

import { describe, expect, it, vi } from 'vitest';
import { createTaskTranscriptAccumulator } from '../../../../src/copilot/terminal/events/task-transcript-accumulator.js';

describe('terminal/task-transcript-accumulator bounds', () => {
    it('evicts abandoned task transcripts beyond the entry limit', () => {
        const renderTranscript = vi.fn(() => true);
        const accumulator = createTaskTranscriptAccumulator({
            maxEntries: 2,
            maxTotalChars: 100,
            isBusy: () => false,
            renderTranscript,
        });

        accumulator.record('a', 'alpha');
        accumulator.record('b', 'beta');
        accumulator.record('c', 'gamma');

        expect(accumulator.size()).toBe(2);
        expect(accumulator.flush('a', 'completed', 'test')).toBe(false);
        expect(accumulator.flush('b', 'completed', 'test')).toBe(true);
        expect(accumulator.flush('c', 'completed', 'test')).toBe(true);
    });

    it('bounds aggregate transcript content and marks truncation', () => {
        const renderTranscript = vi.fn(() => true);
        const accumulator = createTaskTranscriptAccumulator({
            maxEntries: 4,
            maxChars: 100,
            maxTotalChars: 5,
            isBusy: () => false,
            renderTranscript,
        });

        accumulator.record('a', '123456789');
        expect(accumulator.flush('a', 'completed', 'test')).toBe(true);
        expect(renderTranscript).toHaveBeenCalledWith(expect.objectContaining({ content: '12345', truncated: true }));
    });
});
