// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readTerminalToolStatsProjection, readTerminalStatusProjection, readTerminalToolRegistrySnapshot } = vi.hoisted(() => ({
    readTerminalToolStatsProjection: vi.fn(),
    readTerminalStatusProjection: vi.fn(() => ({
        runtimeId: 'default',
        runtimeHealth: 'ok',
        toolLoad: {
            hasCanonicalLocalFsTools: true,
            hasCanonicalLocalExecTools: true,
            hasSdkWorkspaceTooling: false,
            hasLegacySdkShellToolsLoaded: false,
            disabled: [],
            toolContract: {
                ok: true,
                errorCount: 0,
                warningCount: 0,
                metadataCoverage: {
                    descriptionPct: 100,
                    parametersPct: 100,
                    categoryPct: 100,
                    tagsPct: 100,
                    instructionsPct: 100,
                },
            },
        },
    })),
    readTerminalToolRegistrySnapshot: vi.fn(() => ({
        toolContract: {
            issues: [],
        },
    })),
}));

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalToolStatsProjection,
    readTerminalStatusProjection,
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/index.js', () => ({
    readTerminalToolRegistrySnapshot,
}));

const { cmdTools } = await import('../../../../src/copilot/terminal/commands/tools.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('commands/tools', () => {
    beforeEach(() => {
        readTerminalToolStatsProjection.mockReset();
        readTerminalToolStatsProjection.mockReturnValue({
            stats: {
                'tool.fast': { calls: 3, errors: 0, avgLatencyMs: 12 },
                'tool.slow': { calls: 2, errors: 1, avgLatencyMs: 140 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['tool.fast', { calls: 3, errors: 0, avgLatencyMs: 12 }],
                ['tool.slow', { calls: 2, errors: 1, avgLatencyMs: 140 }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['tool.fast', { calls: 3, errors: 0, avgLatencyMs: 12 }],
                ['tool.slow', { calls: 2, errors: 1, avgLatencyMs: 140 }],
            ]),
            tools: [],
            byCategory: {},
            toolCount: 2,
            lifecycle: {
                active: [],
                recent: [],
                summary: { active: 0, recent: 0, waitingUser: 0, failedRecent: 0 },
            },
        });
    });

    it('renderiza estatísticas a partir da projection do terminal frontend', () => {
        const ctx = mockCtx();

        cmdTools({ println: ctx.println });

        expect(readTerminalToolStatsProjection).toHaveBeenCalledTimes(1);
        expect(ctx.output()).toContain('2 tool(s)');
        expect(ctx.output()).toContain('tool.fast');
        expect(ctx.output()).toContain('calls=');
        expect(ctx.output()).toContain('errors=');
        expect(ctx.output()).toContain('140ms');
    });

    it('renderiza estado vazio sem acessar observability diretamente', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {},
            canonicalEntries: [],
            entries: [],
            tools: [],
            byCategory: {},
            toolCount: 0,
            lifecycle: {
                active: [],
                recent: [],
                summary: { active: 0, recent: 0, waitingUser: 0, failedRecent: 0 },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println });

        expect(ctx.output()).toContain('Nenhuma tool observada');
    });

    it('renderiza lifecycle compacto em modo diag', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {
                read_file_content: { calls: 1, errors: 0, avgLatencyMs: 25 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 1, errors: 0, avgLatencyMs: 25, kind: 'file' }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 1, errors: 0, avgLatencyMs: 25, kind: 'file' }],
            ]),
            tools: [],
            byCategory: {
                file: { totalCalls: 1, totalErrors: 0, totalBlocked: 0, avgLatencyMs: 25 },
            },
            toolCount: 1,
            lifecycle: {
                active: [
                    {
                        key: 'call-123456789012345',
                        type: 'start',
                        status: 'active',
                        source: 'sdk',
                        toolName: 'read_file_content',
                        rawToolName: null,
                        operation: 'read',
                        toolCallId: 'call-123456789012345',
                        requestId: 'req-123456789012345',
                        traceId: 'turn:123456789012345',
                        turnId: '1',
                        target: 'src/copilot/file.js',
                        path: 'src/copilot/file.js',
                        progress: 50,
                        progressMessage: 'metade',
                        success: null,
                        durationMs: null,
                        startedAt: 1,
                        updatedAt: 2,
                        completedAt: null,
                    },
                ],
                recent: [
                    {
                        key: 'call-done',
                        type: 'complete',
                        status: 'completed',
                        source: 'sdk',
                        toolName: 'report_intent_local',
                        rawToolName: 'report_intent',
                        operation: 'inspect',
                        toolCallId: 'call-done',
                        requestId: null,
                        traceId: 'turn:1',
                        turnId: '1',
                        target: null,
                        path: null,
                        progress: null,
                        progressMessage: null,
                        success: true,
                        durationMs: 31,
                        startedAt: 1,
                        updatedAt: 3,
                        completedAt: 3,
                    },
                ],
                summary: { active: 1, recent: 1, waitingUser: 0, failedRecent: 0 },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println }, 'diag');

        const output = ctx.output();
        expect(output).toContain('Lifecycle recente');
        expect(output).toContain('active=1');
        expect(output).toContain('read_file_content');
        expect(output).toContain('call=call-1234567…');
        expect(output).toContain('req=req-12345678…');
        expect(output).toContain('report_intent_local');
        expect(output).toContain('completed');
    });
});
