// @ts-check
/**
 * src/copilot/terminal/commands/errors.js
 *
 * Comando `/errors [n]` do REPL terminal LLM-B.
 *
 * Mostra os últimos N erros rastreados pelo error tracker.
 *
 * @module copilot/terminal/commands/errors
 * @see EventBus
 */

import { readTerminalErrorsProjection } from '../frontend/index.js';
import { formatTerminalIsoTimestamp, terminalThemeHeadline, terminalThemeRow } from '../state/index.js';

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
    const limit = Number(arg) || 10;
    const { stats, recent } = readTerminalErrorsProjection(limit);

    println('');
    println(
        terminalThemeHeadline('error', 'Erros rastreados', [`${stats.total} total`, `${stats.buffered} no buffer`]),
    );
    println('');

    if (recent.length === 0) {
        println(terminalThemeRow('Estado', 'nenhum erro recente', { role: 'success' }));
        println('');
        return;
    }

    for (const err of recent) {
        const ts = formatTerminalIsoTimestamp(err.timestamp);
        const type = err.errorType ?? 'Error';
        const src = err.source ? ` · fonte ${err.source}` : '';
        println(terminalThemeRow(type, `${ts}${src} · ${err.message}`, { role: 'error', width: 18 }));
    }
    println('');
}
