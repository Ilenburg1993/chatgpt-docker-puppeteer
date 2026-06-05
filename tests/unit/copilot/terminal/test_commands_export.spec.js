// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy fixture inference is intentionally outside the MCP strict hardening pass

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

const mkdir = vi.fn(async () => undefined);
const writeFile = vi.fn(async () => undefined);

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalTimelineProjection,
}));

vi.mock('node:fs/promises', () => ({
    mkdir,
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
        expect(mkdir).toHaveBeenCalledWith('/tmp', { recursive: true });
        const [, content] = writeFile.mock.calls[0];
        expect(String(content)).toContain('envelope=sdk/assistant.message');
        expect(String(content)).toContain('trace=trace-export-1');
        expect(String(content)).toContain('streaming=suffix/stream_suffix');
        expect(ctx.output()).toContain('Exportado');
    });

    it('escapa HTML bruto da LLM-B ao exportar Markdown', async () => {
        readTerminalTimelineProjection.mockReturnValueOnce({
            timelineSource: 'hub',
            reconciliationStatus: 'aligned',
            sync: { status: 'not_needed' },
            turns: [
                {
                    role: 'assistant',
                    rawRole: 'llm_b',
                    origin: 'hub',
                    persisted: true,
                    content: '<a href="https://x.example"><img src=x>oie</a>',
                    timestamp: 1710000001000,
                    metadata: {
                        assistantMessageEnvelope: {
                            source: 'sdk/assistant.message',
                            traceId: 'trace-html',
                            turnId: 'turn-html',
                            eventId: 'evt-html',
                        },
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdExport({ println: ctx.println }, '/tmp/conversa.md');

        const [, content] = writeFile.mock.calls[0];
        const markdown = String(content);
        expect(markdown).toContain('&lt;a href="https://x.example"&gt;&lt;img src=x&gt;oie&lt;/a&gt;');
        expect(markdown).not.toContain('<img src=x>');
    });

    it('remove ANSI/OSC e controles antes de exportar Markdown', async () => {
        const esc = String.fromCharCode(27);
        const bel = String.fromCharCode(7);
        readTerminalTimelineProjection.mockReturnValueOnce({
            timelineSource: 'hub',
            reconciliationStatus: 'aligned',
            sync: { status: 'not_needed' },
            turns: [
                {
                    role: 'assistant',
                    rawRole: 'llm_b',
                    origin: 'hub',
                    persisted: true,
                    content: `${esc}[31mvermelho${esc}[0m\n${esc}]8;;https://example.com${bel}link${esc}]8;;${bel}\u0001fim`,
                    timestamp: 1710000001000,
                    metadata: {
                        assistantMessageEnvelope: {
                            source: `${esc}[32msdk/assistant.message${esc}[0m`,
                            traceId: 'trace-ansi',
                            turnId: 'turn-ansi',
                            eventId: 'evt-ansi',
                        },
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdExport({ println: ctx.println }, '/tmp/conversa.md');

        const [, content] = writeFile.mock.calls[0];
        const markdown = String(content);
        expect(markdown).toContain('vermelho');
        expect(markdown).toContain('link');
        expect(markdown).toContain('fim');
        expect(markdown).toContain('envelope=sdk/assistant.message');
        expect(markdown).not.toContain(esc);
        expect(markdown).not.toContain(bel);
        expect(markdown).not.toContain('\u0001');
    });

    it('mostra path relativo ao workspace na saída humana quando exporta dentro do repo', async () => {
        const ctx = mockCtx();

        await cmdExport({ println: ctx.println }, 'artifacts/terminal-live/conversa.md');

        expect(writeFile).toHaveBeenCalledOnce();
        expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('artifacts/terminal-live'), { recursive: true });
        const [filePath] = writeFile.mock.calls[0];
        expect(String(filePath)).toContain(`${process.cwd()}/artifacts/terminal-live/conversa.md`);
        expect(ctx.output()).toContain('Exportado');
        expect(ctx.output()).toContain('artifacts/terminal-live/conversa.md');
        expect(ctx.output()).not.toContain(`${process.cwd()}/artifacts/terminal-live/conversa.md`);
    });

    it('usa terminalStreamingDiagnostics como envelope quando não há assistantMessageEnvelope', async () => {
        readTerminalTimelineProjection.mockReturnValueOnce({
            timelineSource: 'hub',
            reconciliationStatus: 'aligned',
            sync: {
                status: 'not_needed',
            },
            turns: [
                {
                    role: 'assistant',
                    rawRole: 'llm_b',
                    origin: 'hub',
                    persisted: true,
                    content: 'resposta via delta canônico',
                    timestamp: 1710000001000,
                    metadata: {
                        terminalStreamingDiagnostics: {
                            source: 'terminal.dialog.engine',
                            turnKey: 'terminal-turn-key-1',
                            turnId: 42,
                            materialization: {
                                source: 'stream_delta',
                                deltaSlices: 4,
                                deltaChars: 24,
                            },
                            finalReconciliation: {
                                mode: 'none',
                                reason: 'already_streamed',
                            },
                            publicStream: {
                                visibleChars: 24,
                            },
                        },
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdExport({ println: ctx.println }, '/tmp/conversa.md');

        const [, content] = writeFile.mock.calls[0];
        expect(String(content)).toContain('envelope=terminal.dialog.engine');
        expect(String(content)).toContain('trace=terminal-turn-key-1');
        expect(String(content)).toContain('turn=42');
        expect(String(content)).toContain('streaming=none/already_streamed');
    });

    it('preserva ask_user, resposta humana e continuação pós-ask com autoria correta', async () => {
        readTerminalTimelineProjection.mockReturnValueOnce({
            timelineSource: 'mixed',
            reconciliationStatus: 'diverged',
            sync: {
                status: 'blocked',
            },
            syncBlockedReason: 'diverged-no-overlap',
            turns: [
                {
                    role: 'system',
                    rawRole: 'ask_user',
                    origin: 'terminal',
                    persisted: false,
                    content: 'ask_user solicitou resposta humana:\nASK-CANONICAL: responda SIM para fechar o teste\nOpcoes: SIM',
                    timestamp: 1710000002000,
                    metadata: {
                        envelope: {
                            source: 'sdk/user_input.requested',
                            traceId: 'turn:1',
                            turnId: '1',
                            eventId: 253,
                        },
                    },
                },
                {
                    role: 'user',
                    rawRole: 'ask_user_answer',
                    origin: 'terminal',
                    persisted: false,
                    content: 'Resposta ao ask_user:\nSIM',
                    timestamp: 1710000002500,
                    metadata: {
                        envelope: {
                            source: 'sdk/user_input.completed',
                            traceId: 'turn:1',
                            turnId: '1',
                            eventId: 262,
                        },
                    },
                },
                {
                    role: 'assistant',
                    rawRole: 'llm_b',
                    origin: 'terminal',
                    persisted: false,
                    content: 'POST-ASK-CANONICAL-FINAL: usuário confirmou SIM',
                    timestamp: 1710000003000,
                    metadata: {
                        assistantMessageEnvelope: {
                            source: 'sdk/assistant.message',
                            traceId: 'turn:2',
                            turnId: '2',
                            eventId: 280,
                        },
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdExport({ println: ctx.println }, '/tmp/conversa.md');

        const [, content] = writeFile.mock.calls[0];
        const markdown = String(content);
        expect(markdown).toContain('timeline=mixed/diverged · sync=blocked:diverged-no-overlap');
        expect(markdown).toContain('## Sistema');
        expect(markdown).toContain('ASK-CANONICAL: responda SIM para fechar o teste');
        expect(markdown).toContain('## Usuário');
        expect(markdown).toContain('Resposta ao ask_user:\nSIM');
        expect(markdown).toContain('## LLM-B');
        expect(markdown).toContain('POST-ASK-CANONICAL-FINAL: usuário confirmou SIM');
        expect(markdown).toContain('envelope=sdk/user_input.requested');
        expect(markdown).toContain('envelope=sdk/user_input.completed');
    });

    it('redige segredos em conteúdo e envelope antes de escrever Markdown', async () => {
        readTerminalTimelineProjection.mockReturnValueOnce({
            timelineSource: 'hub',
            reconciliationStatus: 'aligned',
            sync: {
                status: 'not_needed',
            },
            turns: [
                {
                    role: 'assistant',
                    rawRole: 'llm_b',
                    origin: 'terminal',
                    persisted: false,
                    content:
                        'tool args: Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456 api_key=sk-testsecret123456789 ghp_exampletoken1234567890',
                    timestamp: 1710000003000,
                    metadata: {
                        assistantMessageEnvelope: {
                            source: 'sdk/assistant.message',
                            traceId: 'trace\nAuthorization: Bearer tokenvalue1234567890',
                            turnId: 'turn-export-secret',
                            eventId: 'evt-export-secret',
                        },
                        terminalStreamingDiagnostics: {
                            materialization: {
                                source: 'stream_delta',
                                deltaSlices: 1,
                                deltaChars: 12,
                            },
                            finalReconciliation: {
                                mode: 'suffix',
                                reason: 'secret=supersecretvalue',
                            },
                            publicStream: {
                                visibleChars: 12,
                            },
                        },
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdExport({ println: ctx.println }, '/tmp/conversa.md');

        const [, content] = writeFile.mock.calls[0];
        const markdown = String(content);
        expect(markdown).toContain('redaction=enabled');
        expect(markdown).toContain('Bearer [redacted]');
        expect(markdown).toContain('api_key=[redacted]');
        expect(markdown).toContain('[redacted]');
        expect(markdown).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
        expect(markdown).not.toContain('sk-testsecret123456789');
        expect(markdown).not.toContain('ghp_exampletoken1234567890');
        expect(markdown).not.toContain('supersecretvalue');
        expect(markdown).not.toContain('\nAuthorization: Bearer tokenvalue1234567890');
    });

    it('cria Markdown diagnóstico mínimo quando o frontend runtime não tem feed', async () => {
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

        expect(writeFile).toHaveBeenCalledOnce();
        const [, content] = writeFile.mock.calls[0];
        expect(String(content)).toContain('0 mensagens');
        expect(String(content)).toContain('diagnóstico mínimo');
        expect(ctx.output()).toContain('Exportado');
        expect(ctx.output()).toContain('0 salvas');
    });
});
