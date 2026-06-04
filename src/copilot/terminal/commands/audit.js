// @ts-check
/**
 * src/copilot/terminal/commands/audit.js
 *
 * Comando `/audit` do REPL terminal LLM-B.
 *
 * Mostra resumo do audit log (últimas entradas e sumário de categorias).
 *
 * @module copilot/terminal/commands/audit
 * @see EventBus
 */

import { defaultAuditLog } from '#copilot/audit';
import { formatTerminalTimeLabel, terminalThemeHeadline, terminalThemeRow } from '../state/index.js';

/**
 * @typedef {object} AuditContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * Comando `/audit`.
 *
 * Exibe últimas entradas do audit log e sumário por tipo.
 *
 * @param {AuditContext} ctx
 * @param {string} [arg] - Número de entradas a exibir (default: 10)
 * @returns {Promise<void>}
 */
export async function cmdAudit({ println }, arg) {
    const limit = Number(arg) || 10;
    const entries = await defaultAuditLog.getAuditSummary(null, limit);

    println('');
    println(terminalThemeHeadline('command', 'Auditoria', [`últimas ${limit} entradas`]));
    println('');

    if (!entries || entries.length === 0) {
        println(terminalThemeRow('Aviso', 'nenhum dado de auditoria disponível', { role: 'warn' }));
        println('');
        return;
    }

    /** @type {Record<string, number>} */
    const categories = {};

    for (const entry of entries) {
        const e = /** @type {Record<string, unknown>} */ (entry);
        const type = typeof e['type'] === 'string' ? e['type'] : 'unknown';
        categories[type] = (categories[type] ?? 0) + 1;
        const ts = typeof e['ts'] === 'number' ? formatTerminalTimeLabel(e['ts'], { mode: 'dual' }) : 'sem horário';
        const desc = typeof e['description'] === 'string' ? e['description'] : type;
        println(terminalThemeRow(type, `${ts} · ${desc}`, { role: 'command', width: 18 }));
    }

    println('');
    println(terminalThemeHeadline('command', 'Resumo por tipo'));
    for (const [cat, count] of Object.entries(categories)) {
        println(terminalThemeRow(cat, String(count), { role: 'info', width: 18 }));
    }
    println('');
}
