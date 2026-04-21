// @ts-check
/**
 * src/copilot/terminal/commands/usage.js
 *
 * Comando `/usage [on|off|now]` do REPL terminal LLM-B.
 *
 * Controla a exibição de token usage e custo após cada turno.
 *
 * @module copilot/terminal/commands/usage
 * @see EventBus
 */

import { readTerminalConfigProjection, readTerminalUsageNowProjection } from '../frontend/index.js';
import { getShowUsage, setShowUsage } from '../state.js';
import { callWithRuntimeTarget, extractRuntimeTarget } from './runtime-target.js';

/**
 * @typedef {object} UsageContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * Comando `/usage [on|off|now]`.
 *
 * - Sem argumento: toggle do display pós-turno.
 * - `on`: ativa usage display pós-turno.
 * - `off`: desativa usage display pós-turno.
 * - `now`: mostra snapshot instantâneo da context window.
 *
 * @param {UsageContext} ctx
 * @param {string} [arg] - Argumento fornecido pelo usuário
 * @returns {void}
 */
export function cmdUsage({ println }, arg) {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const trimmed = cleanArg.trim().toLowerCase();

    if (trimmed === 'now') {
        const projection = callWithRuntimeTarget(readTerminalUsageNowProjection, runtimeId);
        const configProjection = callWithRuntimeTarget(readTerminalConfigProjection, runtimeId);
        const ctx = projection.contextWindow;
        if (ctx) {
            const pct = (ctx.utilization * 100).toFixed(0);
            const bar = _renderBar(ctx.utilization);
            println(`\n  📊  Context window: ${bar} ${pct}%`);
            println(`      Tokens: ${ctx.tokens.toLocaleString('pt-BR')} / ${ctx.tokenLimit.toLocaleString('pt-BR')}`);
        } else {
            println('\n  \x1b[33m⚠️  Dados de context window não disponíveis.\x1b[0m');
        }

        const pr = projection.pr;
        if (pr) {
            const model = pr['model'] ?? 'unknown';
            const cost = typeof pr['cost'] === 'number' ? pr['cost'].toFixed(4) : '?';
            println(`      Último turno: modelo=\x1b[36m${model}\x1b[0m · custo=\x1b[33m${cost}\x1b[0m`);
        }
        if (projection.runtimeSessionId || projection.binding.sdkSessionId || projection.binding.hubSessionId) {
            println(
                `      Binding: runtime=\x1b[90m${projection.runtimeSessionId ?? '-'}\x1b[0m · sdk=\x1b[90m${projection.binding.sdkSessionId ?? '-'}\x1b[0m · hub=\x1b[90m${projection.binding.hubSessionId ?? '-'}\x1b[0m`,
            );
        }
        println(
            `      Modo: sdk=\x1b[90m${configProjection.sdkSessionMode ?? 'interactive'}\x1b[0m · planFile=\x1b[90m${configProjection.sdkPlanOperation ?? '(sem alterações)'}\x1b[0m`,
        );
        println('');
        return;
    }

    let next;
    if (trimmed === 'on') {
        next = true;
    } else if (trimmed === 'off') {
        next = false;
    } else {
        next = !getShowUsage();
    }

    setShowUsage(next);
    const status = next ? '\x1b[32mon\x1b[0m' : '\x1b[31moff\x1b[0m';
    println(`\n  📊  Exibição de usage pós-turno: ${status}`);
    println('  \x1b[90mUso: /usage [on|off|now]\x1b[0m\n');
}

/**
 * Renderiza barra de progresso ASCII simples.
 *
 * @param {number} ratio - Utilização 0..1
 * @returns {string}
 */
function _renderBar(ratio) {
    const total = 20;
    const filled = Math.round(ratio * total);
    const empty = total - filled;
    const color = ratio > 0.8 ? '\x1b[31m' : ratio > 0.5 ? '\x1b[33m' : '\x1b[32m';
    return `${color}${'█'.repeat(filled)}${'░'.repeat(empty)}\x1b[0m`;
}
