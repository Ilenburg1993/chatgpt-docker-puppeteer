// @ts-check

import { describe, expect, it, vi } from 'vitest';

const thinkingEntries = [
    {
        id: 'thinking-entry-1234567890',
        source: 'sdk/assistant.reasoning_delta',
        title: 'raciocínio do turno',
        status: 'completed',
        chars: 42,
        durationMs: 1250,
        content: 'primeira linha\nsegunda linha',
    },
];

const clearThinkingHistory = vi.fn(() => {
    thinkingEntries.length = 0;
});
const getLatestThinkingHistoryEntry = vi.fn(() => thinkingEntries.at(-1) ?? null);
const getShowThinking = vi.fn(() => false);
const getThinkingHistory = vi.fn(() => thinkingEntries.slice());
const getThinkingHistoryEntry = vi.fn((id) => thinkingEntries.find((entry) => entry.id === id) ?? null);
const setShowThinking = vi.fn();

vi.mock('../../../../src/copilot/presentation/state/index.js', () => ({
    clearThinkingHistory,
    getLatestThinkingHistoryEntry,
    getShowThinking,
    getThinkingHistory,
    getThinkingHistoryEntry,
    setShowThinking,
}));

vi.mock('../../../../src/copilot/terminal/state/events/index.js', () => ({
    formatTerminalThinkingRef: (id) => String(id).slice(0, 12),
    terminalThemeDivider: (width = 70) => `  ${'-'.repeat(width)}`,
    terminalThemeHeadline: (_role, title, details = []) =>
        `  ${title}${details.length > 0 ? ` · ${details.filter(Boolean).join(' · ')}` : ''}`,
    terminalThemeRow: (label, value) => `  ${label} ${value}`,
    terminalThemeText: (_role, text) => text,
}));

const { cmdThinking } = await import('../../../../src/copilot/terminal/commands/thinking.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    const printlnBlock = vi.fn((/** @type {string[]} */ block) => lines.push(block.join('\n')));
    return { println, printlnBlock, output: () => lines.join('\n') };
}

describe('terminal/commands/thinking', () => {
    it('lista e abre raciocínio capturado sem metadados key-value', () => {
        const listCtx = mockCtx();
        cmdThinking(listCtx, 'list');

        expect(listCtx.output()).toContain('Raciocínio capturado');
        expect(listCtx.output()).toContain('42 caracteres');

        const showCtx = mockCtx();
        cmdThinking(showCtx, 'latest');

        expect(showCtx.output()).toContain('Raciocínio thinking-en');
        expect(showCtx.output()).toContain('fonte sdk/assistant.reasoning_delta');
        expect(showCtx.output()).toContain('estado concluído');
        expect(showCtx.output()).toContain('42 caracteres');
        expect(showCtx.output()).not.toContain('fonte=');
        expect(showCtx.output()).not.toContain('status=');
        expect(showCtx.output()).not.toContain('chars=');
    });

    it('toggle usa rótulo humano em português', () => {
        const ctx = mockCtx();
        cmdThinking(ctx, 'on');

        expect(setShowThinking).toHaveBeenCalledWith(true);
        expect(ctx.output()).toContain('exibição expandida');
        expect(ctx.output()).toContain('ativa');
    });
});
