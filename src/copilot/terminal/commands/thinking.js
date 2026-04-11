// @ts-check
/**
 * src/copilot/terminal/commands/thinking.js
 *
 * Comando `/thinking [on|off|toggle]` do REPL terminal LLM-B.
 *
 * Controla a exibição em tempo real do extended thinking (reasoning) da LLM-B no stdout. Quando ativo, chunks de
 * `assistant.reasoning_delta` são renderizados inline com prefixo 💭.
 *
 * @module copilot/terminal/commands/thinking
 * @see EventBus
 */

import { getShowThinking, setShowThinking } from '../state.js';

/**
 * @typedef {object} ThinkingContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * Comando `/thinking [on|off|toggle]`.
 *
 * - Sem argumento ou `toggle`: alterna o estado.
 * - `on`: ativa exibição de thinking.
 * - `off`: desativa exibição de thinking.
 *
 * @param {ThinkingContext} ctx
 * @param {string} [arg] - Argumento fornecido pelo usuário
 * @returns {void}
 */
export function cmdThinking({ println }, arg) {
    const trimmed = (arg ?? '').trim().toLowerCase();
    let next;

    if (trimmed === 'on') {
        next = true;
    } else if (trimmed === 'off') {
        next = false;
    } else {
        // toggle
        next = !getShowThinking();
    }

    setShowThinking(next);
    const status = next ? '\x1b[32mon\x1b[0m' : '\x1b[31moff\x1b[0m';
    println(`\n  💭  Exibição de thinking: ${status}`);
    println('  \x1b[90mUso: /thinking [on|off|toggle]\x1b[0m\n');
}
