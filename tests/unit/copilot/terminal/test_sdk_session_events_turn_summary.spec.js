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
});
