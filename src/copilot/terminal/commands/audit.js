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

    println(`\n  \x1b[36m📋 Audit Log — últimas ${limit} entradas\x1b[0m\n`);

    if (!entries || entries.length === 0) {
        println('  \x1b[33m⚠️  Nenhum dado de auditoria disponível.\x1b[0m\n');
        return;
    }

    /** @type {Record<string, number>} */
    const categories = {};

    for (const entry of entries) {
        const e = /** @type {Record<string, unknown>} */ (entry);
        const type = typeof e['type'] === 'string' ? e['type'] : 'unknown';
        categories[type] = (categories[type] ?? 0) + 1;
        const ts = typeof e['ts'] === 'number' ? new Date(e['ts']).toLocaleTimeString('pt-BR') : '?';
        const desc = typeof e['description'] === 'string' ? e['description'] : type;
        println(`    \x1b[90m${ts}\x1b[0m  \x1b[33m${type}\x1b[0m  ${desc}`);
    }

    println(`\n  \x1b[36mSumário por tipo:\x1b[0m`);
    for (const [cat, count] of Object.entries(categories)) {
        println(`    \x1b[33m${cat}\x1b[0m: ${count}`);
    }
    println('');
}
