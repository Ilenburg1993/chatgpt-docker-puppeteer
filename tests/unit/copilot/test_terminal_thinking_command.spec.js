// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getShowThinking: vi.fn(() => true),
    setShowThinking: vi.fn(),
    getThinkingHistory: vi.fn(() => []),
    getThinkingHistoryEntry: vi.fn(() => null),
    getLatestThinkingHistoryEntry: vi.fn(() => null),
    clearThinkingHistory: vi.fn(),
}));

vi.mock('../../../src/copilot/presentation/runtime-ui-state-store.js', () => ({
    clearThinkingHistory: mocks.clearThinkingHistory,
    getLatestThinkingHistoryEntry: mocks.getLatestThinkingHistoryEntry,
    getShowThinking: mocks.getShowThinking,
    getThinkingHistory: mocks.getThinkingHistory,
    getThinkingHistoryEntry: mocks.getThinkingHistoryEntry,
    setShowThinking: mocks.setShowThinking,
}));

describe('terminal/commands/thinking.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getShowThinking.mockReturnValue(true);
        mocks.getThinkingHistory.mockReturnValue([]);
        mocks.getThinkingHistoryEntry.mockReturnValue(null);
        mocks.getLatestThinkingHistoryEntry.mockReturnValue(null);
    });

    it('lista thinkings capturados', async () => {
        const lines = [];
        mocks.getThinkingHistory.mockReturnValue([
            {
                id: 'dialog-abc123',
                source: 'dialog',
                title: 'LLM-B',
                content: 'um thinking de teste',
                chars: 19,
                durationMs: 1200,
                status: 'completed',
            },
        ]);
        const { cmdThinking } = await import('../../../src/copilot/terminal/commands/thinking.js');
        cmdThinking({ println: (text) => lines.push(text) }, 'list 5');
        expect(lines.join('\n')).toContain('dialog-abc123'.slice(-12));
        expect(lines.join('\n')).toContain('LLM-B');
    });

    it('abre o latest completo', async () => {
        const lines = [];
        mocks.getLatestThinkingHistoryEntry.mockReturnValue({
            id: 'dialog-latest',
            source: 'dialog',
            title: 'LLM-B',
            content: 'linha 1\nlinha 2',
            chars: 14,
            durationMs: 1800,
            status: 'completed',
        });
        const { cmdThinking } = await import('../../../src/copilot/terminal/commands/thinking.js');
        cmdThinking({ println: (text) => lines.push(text) }, 'latest');
        expect(lines.join('\n')).toContain('linha 1');
        expect(lines.join('\n')).toContain('linha 2');
    });
});
