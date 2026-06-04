// @ts-check

import { describe, expect, it } from 'vitest';

import { selectTerminalTurnTraceSummaryFiles } from '../../../../src/copilot/terminal/events/sdk-session-events.js';

describe('terminal/sdk-session-events turn summary', () => {
    it('colapsa arquivos equivalentes por caminho humano no resumo visual do turno', () => {
        const files = selectTerminalTurnTraceSummaryFiles(
            [
                {
                    path: 'package.json',
                    operation: 'read',
                    source: 'sdk',
                    count: 1,
                    updatedAt: 10,
                },
                {
                    path: '/workspaces/chatgpt-docker-puppeteer/package.json',
                    operation: 'read',
                    source: 'sdk',
                    count: 1,
                    updatedAt: 11,
                },
                {
                    path: 'src/copilot/terminal/repl/repl.js',
                    operation: 'read',
                    source: 'sdk',
                    count: 1,
                    updatedAt: 12,
                },
            ],
            3,
        );

        expect(files).toHaveLength(2);
        expect(files.map((file) => `${file.operation}:${file.path}`)).toEqual([
            'read:package.json',
            'read:src/copilot/terminal/repl/repl.js',
        ]);
    });

    it('prioriza diversidade de operações no resumo compacto do turno', () => {
        const files = selectTerminalTurnTraceSummaryFiles(
            [
                {
                    path: 'data/live/source.txt',
                    operation: 'write',
                    source: 'sdk',
                    count: 1,
                    updatedAt: 10,
                },
                {
                    path: 'data/live/source.txt',
                    operation: 'move',
                    source: 'sdk',
                    count: 1,
                    updatedAt: 11,
                },
                {
                    path: 'data/live/moved.txt',
                    operation: 'move',
                    source: 'sdk',
                    count: 1,
                    updatedAt: 12,
                },
                {
                    path: 'data/live/moved.txt',
                    operation: 'delete',
                    source: 'sdk',
                    count: 1,
                    updatedAt: 13,
                },
                {
                    path: 'data/live',
                    operation: 'write',
                    source: 'io',
                    count: 1,
                    updatedAt: 14,
                },
            ],
            3,
        );

        expect(files.map((file) => `${file.operation}:${file.path}`)).toEqual([
            'write:data/live/source.txt',
            'move:data/live/source.txt',
            'delete:data/live/moved.txt',
        ]);
    });
});
