// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    appendTerminalIntent,
    clearTerminalIntentHistory,
    readTerminalIntentStats,
    terminalThemeBadge,
    terminalThemeText,
} = await import('../../../../src/copilot/terminal/state/index.js');
const { cmdIntent } = await import('../../../../src/copilot/terminal/commands/intent.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    const printlnBlock = vi.fn((/** @type {string[]} */ blockLines) => lines.push(blockLines.join('\n')));
    return { println, printlnBlock, output: () => lines.join('\n') };
}

describe('terminal/commands/intent', () => {
    beforeEach(() => {
        clearTerminalIntentHistory();
    });

    it('lista intents persistidos com tool, risco e origem', () => {
        appendTerminalIntent({
            intent: 'Vou aplicar patch incremental.',
            tool: 'patch_file',
            risk: 'medium',
            source: 'tool/report_intent_local',
            toolCallId: 'call-1',
            timestamp: 1_700_000_000_000,
        });
        const ctx = mockCtx();

        cmdIntent(ctx, '5');

        expect(ctx.printlnBlock).toHaveBeenCalledTimes(1);
        expect(ctx.output()).toContain('Vou aplicar patch incremental');
        expect(ctx.output()).toContain('tool=patch_file');
        expect(ctx.output()).toContain('risk=medium');
        expect(readTerminalIntentStats().entries).toBe(1);
    });

    it('limpa histórico em memória', () => {
        appendTerminalIntent({ intent: 'Intent temporário', source: 'sdk/assistant.intent' });
        const ctx = mockCtx();

        cmdIntent(ctx, 'clear');

        expect(ctx.output()).toContain('Histórico de intents limpo');
        expect(readTerminalIntentStats().entries).toBe(0);
    });

    it('renderiza estado vazio', () => {
        const ctx = mockCtx();

        cmdIntent(ctx);

        expect(ctx.output()).toContain('Nenhum intent capturado ainda');
        expect(terminalThemeBadge).toBeTypeOf('function');
        expect(terminalThemeText).toBeTypeOf('function');
    });
});
