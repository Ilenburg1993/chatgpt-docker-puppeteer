// @ts-check

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalActivityProjection: vi.fn(() => ({
        current: {
            phase: 'tool',
            label: 'Executando tool',
            detail: 'web_fetch · 50%',
            source: 'sdk',
            severity: 'info',
            progress: 50,
            toolName: 'web_fetch',
            startedAt: 1,
            updatedAt: 2,
            ageMs: 1200,
        },
        history: [
            {
                phase: 'tool',
                label: 'Executando tool',
                detail: 'web_fetch · 50%',
                source: 'sdk',
                severity: 'info',
                progress: 50,
                toolName: 'web_fetch',
                startedAt: 1,
                updatedAt: 2,
                ageMs: 1200,
                ts: 2,
            },
        ],
        turnTrace: {
            current: {
                traceId: 'turn:turn-1',
                turnId: 'turn-1',
                source: 'assistant',
                status: 'active',
                startedAt: 1,
                updatedAt: 2,
                finishedAt: null,
                toolCount: 1,
                fileCount: 1,
                tools: [
                    {
                        toolName: 'workspace.read_file',
                        operation: 'read',
                        path: 'src/copilot/terminal/repl.js',
                        target: 'src/copilot/terminal/repl.js',
                        source: 'sdk',
                        status: 'completed',
                        success: true,
                        count: 2,
                        updatedAt: 2,
                    },
                ],
                files: [
                    {
                        path: 'src/copilot/terminal/repl.js',
                        operation: 'read',
                        source: 'sdk',
                        count: 2,
                        updatedAt: 2,
                    },
                ],
            },
            recent: [
                {
                    traceId: 'turn:turn-0',
                    turnId: 'turn-0',
                    source: 'assistant',
                    status: 'completed',
                    startedAt: 1,
                    updatedAt: 2,
                    finishedAt: 3,
                    toolCount: 1,
                    fileCount: 1,
                    tools: [
                        {
                            toolName: 'view',
                            operation: 'read',
                            path: '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/commands/activity.js',
                            target: '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/commands/activity.js',
                            source: 'sdk',
                            status: 'completed',
                            success: true,
                            count: 1,
                            updatedAt: 2,
                        },
                    ],
                    files: [
                        {
                            path: '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/commands/activity.js',
                            operation: 'read',
                            source: 'sdk',
                            count: 1,
                            updatedAt: 2,
                        },
                    ],
                },
            ],
        },
    })),
}));

const { cmdActivity } = await import('../../../../src/copilot/terminal/commands/activity.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('terminal/commands/activity', () => {
    it('exibe atividade atual e timeline recente', () => {
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '5');

        expect(ctx.output()).toContain('Atividade Atual da LLM-B');
        expect(ctx.output()).toContain('Executando tool');
        expect(ctx.output()).toContain('web_fetch');
        expect(ctx.output()).toContain('Timeline recente');
        expect(ctx.output()).toContain('Resumo do turno atual');
        expect(ctx.output()).toContain('Último turno concluído');
        expect(ctx.output()).toContain('arquivos tocados');
        expect(ctx.output()).toContain('workspace.read_file');
        expect(ctx.output()).toContain('turn:turn-1');
        expect(ctx.output()).toContain(
            '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/commands/activity.js',
        );
    });
});
