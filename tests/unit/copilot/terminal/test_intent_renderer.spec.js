// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const dialogMocks = vi.hoisted(() => ({
    broadcastSse: vi.fn(),
    printlnBlock: vi.fn(),
}));

vi.mock('../../../../src/copilot/terminal/dialog/index.js', () => ({
    SEPARATOR: '---',
    broadcastSse: dialogMocks.broadcastSse,
    printlnBlock: dialogMocks.printlnBlock,
}));

vi.mock('../../../../src/copilot/terminal/dialog/io/index.js', () => ({
    SEPARATOR: '---',
    broadcastSse: dialogMocks.broadcastSse,
    printlnBlock: dialogMocks.printlnBlock,
}));

const {
    clearTerminalActivityHistory,
    clearTerminalIntentHistory,
    clearTerminalTranscriptTurns,
    readTerminalIntentHistory,
    readTerminalTranscriptTurns,
} = await import('../../../../src/copilot/terminal/state/index.js');
const { __test__, renderTerminalIntent } = await import('../../../../src/copilot/terminal/events/intent-renderer.js');

describe('terminal/events/intent-renderer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearTerminalActivityHistory();
        clearTerminalIntentHistory();
        clearTerminalTranscriptTurns();
        __test__.clearRecentIntentHashes();
    });

    it('renderiza intent ao vivo sem tool/call/id técnico na superfície padrão', () => {
        renderTerminalIntent({
            intent: 'Vou revisar a UX do terminal antes de editar.',
            tool: 'report_intent_local',
            risk: 'medium',
            source: 'tool/report_intent_local',
            toolCallId: 'toolu_bdrk_019v9X862pjamNysAemC1UAW',
        });

        expect(dialogMocks.printlnBlock).toHaveBeenCalledTimes(1);
        const output = dialogMocks.printlnBlock.mock.calls[0]?.[0]?.join('\n') ?? '';
        expect(output).toContain('Intenção capturada');
        expect(output).toContain('risco médio');
        expect(output).toContain('origem ferramenta de intenção');
        expect(output).toContain('Vou revisar a UX do terminal');
        expect(output).not.toContain('INTENÇÃO CAPTURADA');
        expect(output).not.toContain('INTENT');
        expect(output).not.toContain('fonte=');
        expect(output).not.toContain('tool=report_intent_local');
        expect(output).not.toContain('call=');
        expect(output).not.toContain('toolu_bdrk');

        expect(readTerminalIntentHistory(1)[0]?.toolCallId).toBe('toolu_bdrk_019v9X862pjamNysAemC1UAW');
        expect(readTerminalTranscriptTurns(1)[0]?.content).not.toContain('tool=report_intent_local');
        expect(dialogMocks.broadcastSse).toHaveBeenCalledWith(
            'assistant.intent',
            expect.objectContaining({ toolCallId: 'toolu_bdrk_019v9X862pjamNysAemC1UAW' }),
        );
    });
});
