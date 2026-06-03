// @ts-check
/**
 * @module copilot/terminal/repl/free-text-delivery
 * @file Resolução de rota de entrega para mensagens de texto livre do REPL Terminal LLM-B.
 *
 *   Determina se uma entrada de texto livre do operador deve ser entregue como:
 *
 *   - `'turn'` → novo turno canônico na fila do dialog loop (pode consumir PR)
 *   - `'intervene'`→ intervenção na fila de intervenção (sem consumo de PR, aplicada em ask_user)
 *   - `'steer'` → intervenção SDK immediate no turno ativo (/steer)
 *
 *   A rota pode ser determinada por:
 *
 *   1. Diretiva `!!token: mensagem` (ex: `!!turn: oi`, `!!mailbox: responda isso`)
 *   2. Prefixo `[token] mensagem` (ex: `[turn] oi`, `[intervene] responda isso`)
 *   3. Política padrão da sessão (`TERMINAL_INTERVENTION_DEFAULT_MODE`)
 *
 *   Esta função é pura (sem efeitos colaterais) e não depende de estado de closure.
 * @see module:copilot/terminal/repl/repl-lifecycle (consumer principal)
 * @see module:copilot/config (getTerminalInterventionPolicy)
 */

import { getTerminalInterventionPolicy } from '#copilot/config';

/**
 * Resultado da resolução de rota para uma mensagem de texto livre.
 *
 * @typedef {{
 *     mode: 'turn' | 'intervene' | 'steer';
 *     message: string;
 * }} FreeTextDeliveryResolution
 */

/**
 * Resolve a rota de entrega de uma mensagem de texto livre do operador.
 *
 * Analisa diretivas explícitas (`!!token` ou `[token]`) antes de usar a política padrão. Sempre retorna a mensagem sem
 * o prefixo da diretiva.
 *
 * @example
 *     resolveFreeTextDelivery('!!turn: oi'); // → { mode: 'turn', message: 'oi' }
 *     resolveFreeTextDelivery('[fila] responda'); // → { mode: 'intervene', message: 'responda' }
 *     resolveFreeTextDelivery('mensagem simples'); // → depende da política de intervenção
 *
 * @param {string} input - Entrada bruta do operador (pode conter diretivas de rota).
 * @returns {FreeTextDeliveryResolution}
 */
export function resolveFreeTextDelivery(input) {
    const trimmed = input.trim();
    const policy = getTerminalInterventionPolicy();

    if (policy.allowTextDirectives) {
        // Diretiva bang: !!token: mensagem  ou  !!token mensagem
        const bangDirective = trimmed.match(/^!!([a-z_-]+)(?::|\s+)([\s\S]*)$/i);
        if (bangDirective && typeof bangDirective[1] === 'string') {
            const token = bangDirective[1].toLowerCase();
            const mode =
                token === 'immediate' || token === 'imediato' || token === 'steer'
                    ? /** @type {'steer'} */ ('steer')
                    : token === 'turn' || token === 'dialog'
                      ? /** @type {'turn'} */ ('turn')
                      : token === 'queue' || token === 'fila' || token === 'mailbox' || token === 'intervene'
                        ? /** @type {'intervene'} */ ('intervene')
                        : null;
            if (mode !== null) {
                return { mode, message: String(bangDirective[2] ?? '').trim() };
            }
        }

        // Prefixo colchete: [token] mensagem  ou  [token]: mensagem
        const bracket = trimmed.match(
            /^\[(queue|fila|mailbox|turn|dialog|immediate|imediato|intervene|steer)\](?::|\s*)/i,
        );
        if (bracket && typeof bracket[1] === 'string') {
            const token = bracket[1].toLowerCase();
            const mode =
                token === 'turn' || token === 'dialog'
                    ? /** @type {'turn'} */ ('turn')
                    : token === 'queue' || token === 'fila' || token === 'mailbox' || token === 'intervene'
                      ? /** @type {'intervene'} */ ('intervene')
                      : /** @type {'steer'} */ ('steer');
            return { mode, message: trimmed.slice(bracket[0].length).trim() };
        }
    }

    // Política padrão: zero-pr → intervene; caso contrário → turn
    return {
        mode: policy.defaultMode === 'zero-pr' ? 'intervene' : 'turn',
        message: trimmed,
    };
}
