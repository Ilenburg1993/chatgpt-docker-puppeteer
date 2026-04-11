// @ts-check
/**
 * src/copilot/terminal/commands/plan.js
 *
 * Comando `/plan` — ativa/desativa o modo de planejamento.
 *
 * Quando ativo, todas as mensagens são prefaçadas com uma instrução de plano detalhado antes de serem enviadas à LLM-B.
 *
 * Sintaxe:
 *
 * - `/plan` → exibe estado atual
 * - `/plan on` → ativa
 * - `/plan off` → desativa
 *
 * @module copilot/terminal/commands/plan
 * @see EventBus
 */

import { getPlanMode, setPlanMode } from '../state.js';

/**
 * Handler do comando `/plan`.
 *
 * @param {{ println: (text: string) => void }} ctx
 * @param {string} arg
 * @returns {void}
 */
export function cmdPlan({ println }, arg) {
    const trimmed = (arg ?? '').trim().toLowerCase();

    if (!trimmed) {
        const active = getPlanMode();
        println(
            `\x1b[36m  /plan\x1b[0m → modo de planejamento está \x1b[1m${active ? '\x1b[32mATIVO\x1b[0m\x1b[1m' : '\x1b[90mINATIVO\x1b[0m\x1b[1m'}\x1b[0m`,
        );
        if (!active) {
            println(
                '\x1b[90m  Use /plan on para ativar. Mensagens serão prefaçadas com instrução de planejamento.\x1b[0m',
            );
        } else {
            println('\x1b[90m  Use /plan off para desativar.\x1b[0m');
        }
        return;
    }

    if (trimmed === 'on') {
        setPlanMode(true);
        println('\x1b[32m  ✓ Modo planejamento ATIVO.\x1b[0m');
        println('\x1b[90m  Todas as mensagens serão prefaçadas com instrução de elaborar plano detalhado.\x1b[0m');
        return;
    }

    if (trimmed === 'off') {
        setPlanMode(false);
        println('\x1b[90m  Modo planejamento DESATIVADO.\x1b[0m');
        return;
    }

    println(`\x1b[33m  Argumento inválido: "${arg}". Use /plan, /plan on ou /plan off.\x1b[0m`);
}
