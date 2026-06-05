// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
    access: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({ size: 1024 })),
}));

const stateMocks = vi.hoisted(() => ({
    addAttachment: vi.fn(),
    clearAttachments: vi.fn(),
    getShowIntentActivity: vi.fn(() => true),
    getShowSessionActivity: vi.fn(() => true),
    getShowStreaming: vi.fn(() => true),
    getShowThinking: vi.fn(() => true),
    getShowToolActivity: vi.fn(() => true),
    getShowUsage: vi.fn(() => true),
    getAttachmentQueue: vi.fn(() => /** @type {(string | Record<string, unknown>)[]} */ ([])),
    setShowIntentActivity: vi.fn(),
    setShowSessionActivity: vi.fn(),
    setShowStreaming: vi.fn(),
    setShowThinking: vi.fn(),
    setShowToolActivity: vi.fn(),
    setShowUsage: vi.fn(),
}));

vi.mock('node:fs/promises', () => fsMocks);
vi.mock('../../../../src/copilot/presentation/state/index.js', () => stateMocks);

import { cmdAttach } from '../../../../src/copilot/terminal/commands/attach.js';

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    return {
        println: (/** @type {string} */ line) => lines.push(line),
        output: () => lines.join('\n'),
    };
}

describe('terminal/commands/attach', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        stateMocks.getAttachmentQueue.mockReturnValue([]);
    });

    it('/attach blob adiciona attachment inline sem roundtrip por disco', async () => {
        stateMocks.getAttachmentQueue.mockReturnValue(
            /** @type {(string | Record<string, unknown>)[]} */ ([
                {
                    type: 'blob',
                    data: 'Y29udGV1ZG8=',
                    mimeType: 'text/plain',
                    displayName: 'memo.txt',
                },
            ]),
        );
        const ctx = mockCtx();

        await cmdAttach({ println: ctx.println }, 'blob text/plain Y29udGV1ZG8= --name memo.txt');

        expect(stateMocks.addAttachment).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'blob',
                data: 'Y29udGV1ZG8=',
                mimeType: 'text/plain',
                displayName: 'memo.txt',
            }),
        );
        expect(fsMocks.access).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('Adicionado');
        expect(ctx.output()).toContain('memo.txt');
        expect(ctx.output()).toContain('text/plain');
        expect(ctx.output()).toContain('1 item na fila · será embutido no próximo turno');
        expect(ctx.output()).not.toContain('Fila:');
    });

    it('/attach lista fila com entries tipadas', async () => {
        stateMocks.getAttachmentQueue.mockReturnValue(
            /** @type {(string | Record<string, unknown>)[]} */ ([
                '/tmp/a.js',
                {
                    type: 'blob',
                    data: 'Y29udGV1ZG8=',
                    mimeType: 'image/png',
                    displayName: 'screenshot.png',
                },
            ]),
        );
        const ctx = mockCtx();

        await cmdAttach({ println: ctx.println }, '');

        expect(ctx.output()).toContain('Fila de anexos');
        expect(ctx.output()).toContain('2 itens');
        expect(ctx.output()).toContain('/tmp/a.js');
        expect(ctx.output()).toContain('screenshot.png [blob:image/png]');
        expect(ctx.output()).toContain('Serão embutidos no próximo turno');
    });
});
