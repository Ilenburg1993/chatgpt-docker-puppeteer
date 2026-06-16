// @ts-check
import { describe, expect, it } from 'vitest';

import {
    formatTerminalQueuedTurnNotice,
    isTerminalEscapeCommand,
    isTerminalImmediateCommand,
} from '../../../../src/copilot/terminal/repl/repl-input-routing.js';

describe('terminal/repl/repl-input-routing.js', () => {
    it('classifica comandos de escape que furam qualquer fila', () => {
        expect(isTerminalEscapeCommand('quit')).toBe(true);
        expect(isTerminalEscapeCommand('restart')).toBe(true);
        expect(isTerminalEscapeCommand('conversation-restart')).toBe(true);
        expect(isTerminalEscapeCommand('status')).toBe(false);
    });

    it('classifica comandos operacionais seguros para execucao imediata durante turno ativo', () => {
        expect(isTerminalImmediateCommand('answer')).toBe(true);
        expect(isTerminalImmediateCommand('abort')).toBe(true);
        expect(isTerminalImmediateCommand('interrupt')).toBe(true);
        expect(isTerminalImmediateCommand('steer')).toBe(true);
        expect(isTerminalImmediateCommand('status')).toBe(true);
        expect(isTerminalImmediateCommand('elicitation')).toBe(true);
        expect(isTerminalImmediateCommand('restart')).toBe(false);
    });

    it('formata aviso de fila com posicao humana minima', () => {
        expect(formatTerminalQueuedTurnNotice({ queueDepth: 0 })).toContain('posição 1');
        expect(formatTerminalQueuedTurnNotice({ queueDepth: 3 })).toContain('posição 3');
        expect(formatTerminalQueuedTurnNotice({ queueDepth: 3 })).toContain('Fila');
        expect(formatTerminalQueuedTurnNotice({ queueDepth: 3 })).not.toContain('[fila]');
        expect(formatTerminalQueuedTurnNotice({ queueDepth: 3 })).not.toContain('\\x1b[');
    });
});
