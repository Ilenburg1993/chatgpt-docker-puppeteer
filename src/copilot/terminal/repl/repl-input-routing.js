// @ts-check
/**
 * Policy de roteamento de input do REPL enquanto a LLM-B esta ocupada.
 *
 * O objetivo e separar comandos que precisam furar a fila de turnos de mensagens normais, que podem ser serializadas
 * pelo dialog loop. Isso evita deadlock quando o modelo pede input humano durante um turno ja em andamento.
 *
 * @module copilot/terminal/repl-input-routing
 */

import { terminalThemeRow } from '../state/dialog/index.js';

const TERMINAL_ESCAPE_COMMANDS = new Set(['quit', 'exit', 'restart', 'emergency-reset', 'ereset']);

const TERMINAL_IMMEDIATE_COMMANDS = new Set([
    'abort',
    'answer',
    'status',
    'now',
    'activity',
    'errors',
    'live',
    'usage',
    'metrics',
    'tools',
    'menu',
    'elicitation',
    'interrupt',
    'permission',
    'steer',
]);

/**
 * @param {string} command
 * @returns {boolean}
 */
export function isTerminalEscapeCommand(command) {
    return TERMINAL_ESCAPE_COMMANDS.has(command.toLowerCase());
}

/**
 * @param {string} command
 * @returns {boolean}
 */
export function isTerminalImmediateCommand(command) {
    return TERMINAL_IMMEDIATE_COMMANDS.has(command.toLowerCase());
}

/**
 * @param {{ queueDepth: number }} input
 * @returns {string}
 */
export function formatTerminalQueuedTurnNotice({ queueDepth }) {
    const position = Math.max(1, queueDepth);
    return terminalThemeRow('Fila', `mensagem enviada para a LLM-B · posição ${position}`, { role: 'muted' });
}
