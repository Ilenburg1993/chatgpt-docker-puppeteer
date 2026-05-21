// @ts-check

import { describe, expect, it } from 'vitest';

import {
    parseTerminalReplCommand,
    parseTerminalSubcommand,
} from '../../../../src/copilot/terminal/repl/repl-command-parser.js';

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

    it('preserva subcomando e argumentos tokenizados para dispatchers compostos', () => {
        expect(parseTerminalSubcommand('sdk next new', ['sdk', 'next', 'new'])).toEqual({
            subcommand: 'sdk',
            rest: ['next', 'new'],
        });
        expect(parseTerminalSubcommand('sdk next resume #1')).toEqual({
            subcommand: 'sdk',
            rest: ['next', 'resume', '#1'],
        });
    });
});
