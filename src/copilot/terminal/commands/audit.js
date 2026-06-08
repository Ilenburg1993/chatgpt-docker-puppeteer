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
import { getTerminalHumanToolName } from '../events/presenters/tools/index.js';

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
        const typeLabel = renderAuditTypeLabel(type);
        categories[typeLabel] = (categories[typeLabel] ?? 0) + 1;
        const ts = renderAuditTimestamp(e);
        const desc = renderAuditDescription(e, typeLabel);
        println(terminalThemeRow(typeLabel, `${ts} · ${desc}`, { role: 'command', width: 22 }));
    }

    println('');
    println(terminalThemeHeadline('command', 'Resumo por tipo'));
    for (const [cat, count] of Object.entries(categories)) {
        println(terminalThemeRow(cat, String(count), { role: 'info', width: 22 }));
    }
    println('');
}

/**
 * @param {string} type
 * @returns {string}
 */
function renderAuditTypeLabel(type) {
    if (type === 'tool.execution' || type === 'tool.executed') return 'Execução de ferramenta';
    if (type === 'hook.fired') return 'Rotina executada';
    if (type === 'permission.decision') return 'Permissão decidida';
    if (type === 'session.lifecycle') return 'Ciclo da sessão';
    if (type === 'unknown') return 'Registro';
    return type.replace(/[._-]+/gu, ' ');
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {string}
 */
function renderAuditTimestamp(entry) {
    const value = entry['ts'] ?? entry['timestamp'] ?? entry['time'];
    if (typeof value === 'number' && Number.isFinite(value)) return formatTerminalTimeLabel(value, { mode: 'dual' });
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return formatTerminalTimeLabel(parsed, { mode: 'dual' });
    }
    return 'horário indisponível';
}

/**
 * @param {Record<string, unknown>} entry
 * @param {string} typeLabel
 * @returns {string}
 */
function renderAuditDescription(entry, typeLabel) {
    const data = entry['data'] && typeof entry['data'] === 'object' ? /** @type {Record<string, unknown>} */ (entry['data']) : {};
    const toolName = firstString(entry['toolName'], data['toolName']);
    if (toolName) {
        const parts = [getTerminalHumanToolName(toolName)];
        const success = typeof entry['success'] === 'boolean' ? entry['success'] : data['success'];
        if (typeof success === 'boolean') parts.push(success ? 'concluída' : 'falhou');
        const durationMs = typeof entry['durationMs'] === 'number' ? entry['durationMs'] : data['durationMs'];
        if (typeof durationMs === 'number' && Number.isFinite(durationMs)) parts.push(`${Math.round(durationMs)}ms`);
        return parts.join(' · ');
    }
    const description = firstString(entry['description'], data['summary'], data['hookName']);
    if (description && description !== typeLabel) return description.replace(/[._-]+/gu, ' ');
    return 'registro arquivado';
}

/**
 * @param {...unknown} values
 * @returns {string}
 */
function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}
