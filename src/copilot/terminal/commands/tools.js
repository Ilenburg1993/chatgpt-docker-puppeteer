// @ts-check
/**
 * src/copilot/terminal/commands/tools.js
 *
 * Comando `/tools` do REPL terminal LLM-B.
 *
 * Lista as tools observadas com estatísticas de uso (invocações, erros, latência).
 *
 * @module copilot/terminal/commands/tools
 * @see EventBus
 */

import { readTerminalToolStatsProjection } from '../frontend/index.js';

/**
 * @typedef {object} ToolsContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * Comando `/tools`.
 *
 * - Sem argumento: lista todas as tools com stats resumidas.
 *
 * @param {ToolsContext} ctx
 * @returns {void}
 */
export function cmdTools({ println }) {
    const { entries } = readTerminalToolStatsProjection();

    if (entries.length === 0) {
        println('\n  \x1b[33m⚠️  Nenhuma tool observada ainda.\x1b[0m\n');
        return;
    }

    println(`\n  \x1b[36m🔧 ${entries.length} tool(s) observada(s):\x1b[0m\n`);

    for (const [name, data] of entries) {
        const d = /** @type {{ calls?: number; errors?: number; avgLatencyMs?: number }} */ (data);
        const calls = d.calls ?? 0;
        const errors = d.errors ?? 0;
        const latency = typeof d.avgLatencyMs === 'number' ? `${d.avgLatencyMs.toFixed(0)}ms` : '?';
        const errorColor = errors > 0 ? '\x1b[31m' : '\x1b[32m';
        println(
            `    \x1b[33m${name}\x1b[0m  calls=\x1b[36m${calls}\x1b[0m  errors=${errorColor}${errors}\x1b[0m  avg=${latency}`,
        );
    }
    println('');
}
