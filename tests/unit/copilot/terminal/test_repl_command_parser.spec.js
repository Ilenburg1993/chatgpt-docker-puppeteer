// @ts-check

import { describe, expect, it } from 'vitest';

import { parseTerminalReplCommand } from '../../../../src/copilot/terminal/repl/repl-command-parser.js';

describe('terminal/repl-command-parser', () => {
    it('ignora input humano comum', () => {
        expect(parseTerminalReplCommand('mensagem comum')).toBeNull();
    });

    it('parseia comando, argumento agregado e rest preservando comportamento atual', () => {
        expect(parseTerminalReplCommand('/status --runtime alt')).toEqual({
            resolved: '/status --runtime alt',
            command: 'status',
            arg: '--runtime alt',
            rest: ['--runtime', 'alt'],
        });
    });

    it('aplica resolver de alias antes do split', () => {
        const parsed = parseTerminalReplCommand('/s', () => '/status --runtime alt');

        expect(parsed).toEqual({
            resolved: '/status --runtime alt',
            command: 'status',
            arg: '--runtime alt',
            rest: ['--runtime', 'alt'],
        });
    });
});
