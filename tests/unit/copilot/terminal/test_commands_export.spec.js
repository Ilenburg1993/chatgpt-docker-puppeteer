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
        expect(markdown).toContain('## 🧭 Sistema');
        expect(markdown).toContain('ASK-CANONICAL: responda SIM para fechar o teste');
        expect(markdown).toContain('## 👤 Usuário');
        expect(markdown).toContain('Resposta ao ask_user:\nSIM');
        expect(markdown).toContain('## 🧠 LLM-B');
        expect(markdown).toContain('POST-ASK-CANONICAL-FINAL: usuário confirmou SIM');
        expect(markdown).toContain('envelope=sdk/user_input.requested');
        expect(markdown).toContain('envelope=sdk/user_input.completed');
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
