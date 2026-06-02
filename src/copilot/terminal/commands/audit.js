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
import {
    formatTerminalIsoTimestamp,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeText,
} from '../state/index.js';

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
    println(terminalThemeHeadline('command', 'Audit Log', [`últimas ${limit} entradas`]));
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
        const ts = typeof e['ts'] === 'number' ? formatTerminalIsoTimestamp(e['ts']) : 'sem horário';
        const desc = typeof e['description'] === 'string' ? e['description'] : type;
        println(`  ${terminalThemeText('muted', ts.padEnd(20))} ${terminalThemeText('command', type.padEnd(18))} ${desc}`);
    }

    println('');
    println(terminalThemeHeadline('command', 'Sumário por tipo'));
    for (const [cat, count] of Object.entries(categories)) {
        println(terminalThemeRow(cat, String(count), { role: 'info', width: 18 }));
    }
    println('');
}
