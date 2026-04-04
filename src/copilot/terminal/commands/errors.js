// @ts-check
/**
 * src/copilot/terminal/commands/errors.js
 *
 * Comando `/errors [n]` do REPL terminal LLM-B.
 *
 * Mostra os últimos N erros rastreados pelo error tracker.
 *
 * @module copilot/terminal/commands/errors
 */

import { defaultErrorTracker } from '../../observability/error-tracker.js';

/**
 * @typedef {object} ErrorsContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * Comando `/errors [n]`.
 *
 * - Sem argumento: mostra últimos 10 erros.
 * - Com número: mostra últimos N erros.
 *
 * @param {ErrorsContext} ctx
 * @param {string} [arg] - Número de erros a exibir
 * @returns {void}
 */
export function cmdErrors({ println }, arg) {
    const stats = defaultErrorTracker.getStats();
    const limit = Number(arg) || 10;
    const recent = defaultErrorTracker.getErrors(limit);

    println(`\n  \x1b[36m❌ Erros rastreados: ${stats.total} total (${stats.buffered} no buffer)\x1b[0m\n`);

    if (recent.length === 0) {
        println('  \x1b[32m✅ Nenhum erro recente.\x1b[0m\n');
        return;
    }

    for (const err of recent) {
        const ts = new Date(err.timestamp).toLocaleTimeString('pt-BR');
        const sevColor = '\x1b[31m';
        const type = err.errorType ?? 'Error';
        const src = err.source ? `\x1b[90m[${err.source}]\x1b[0m ` : '';
        println(`    ${sevColor}${type}\x1b[0m  \x1b[90m${ts}\x1b[0m  ${src}${err.message}`);
    }
    println('');
}
