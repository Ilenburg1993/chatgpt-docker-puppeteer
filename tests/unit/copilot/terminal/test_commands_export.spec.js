// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const readTerminalTimelineProjection = vi.fn(() => ({
    timelineSource: 'hub',
    reconciliationStatus: 'aligned',
    sync: {
        status: 'not_needed',
    },
    turns: [
        {
            role: 'user',
            rawRole: 'user',
            origin: 'hub',
            persisted: true,
            content: 'olá',
            timestamp: 1710000000000,
        },
        {
            role: 'assistant',
            rawRole: 'llm_b',
            origin: 'hub',
            persisted: true,
            content: 'oi',
            timestamp: 1710000001000,
            metadata: {
                assistantMessageEnvelope: {
                    source: 'sdk/assistant.message',
                    traceId: 'trace-export-1',
                    turnId: 'turn-export-1',
                    eventId: 'evt-export-1',
                },
                terminalStreamingDiagnostics: {
                    materialization: {
                        source: 'stream_delta',
                        deltaSlices: 3,
                        deltaChars: 12,
                    },
                    finalReconciliation: {
                        mode: 'suffix',
                        reason: 'stream_suffix',
                    },
                    publicStream: {
                        visibleChars: 8,
                    },
                },
            },
        },
    ],
}));

const writeFile = vi.fn(async () => undefined);

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalTimelineProjection,
}));

vi.mock('node:fs/promises', () => ({
    writeFile,
}));

const { cmdExport } = await import('../../../../src/copilot/terminal/commands/export.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('terminal/commands/export', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exporta usando a seam canônica do frontend runtime', async () => {
        const ctx = mockCtx();

        await cmdExport({ println: ctx.println }, '/tmp/conversa.md');

        expect(readTerminalTimelineProjection).toHaveBeenCalled();
        expect(writeFile).toHaveBeenCalledOnce();
        const [, content] = writeFile.mock.calls[0];
        expect(String(content)).toContain('envelope=sdk/assistant.message');
        expect(String(content)).toContain('trace=trace-export-1');
        expect(String(content)).toContain('streaming=suffix/stream_suffix');
        expect(ctx.output()).toContain('Exportado');
    });

    it('reporta histórico vazio quando o frontend runtime não tem feed', async () => {
        readTerminalTimelineProjection.mockReturnValueOnce({
            timelineSource: 'empty',
            reconciliationStatus: 'empty',
            sync: {
                status: 'not_needed',
            },
            turns: [],
        });
        const ctx = mockCtx();

        await cmdExport({ println: ctx.println }, '/tmp/conversa.md');

        expect(writeFile).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('Histórico vazio');
    });
});
