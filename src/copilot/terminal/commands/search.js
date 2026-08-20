// @ts-check
/**
 * src/copilot/terminal/commands/search.js
 *
 * F37.5: Comando `/search <query>` do REPL terminal LLM-B.
 *
 * Busca em turnos anteriores via FTS5 (SQLite fulltext search) no ConversationHub store.
 *
 * @module copilot/terminal/commands/search
 * @see EventBus
 */

import { toError } from '#copilot/core';
import { searchTerminalTurnsProjection } from '../frontend/index.js';
import { formatTerminalTimeLabel, terminalThemeHeadline, terminalThemeRow, terminalThemeText } from '../state/index.js';

/**
 * @typedef {object} SearchContext
 * @property {(text: string) => void} println - Função de output do terminal.
 * @property {string | null} hubSessionId - ID da sessão atual do hub.
 */

/**
 * Comando `/search <query>`.
 *
 * @param {SearchContext} ctx
 * @param {string} [arg] - Query de busca
 * @returns {void}
 */
export function cmdSearch({ println, hubSessionId }, arg) {
    const query = (arg ?? '').trim();
    if (!query) {
        println('');
        println(terminalThemeRow('Uso', '/search <query>', { role: 'warn' }));
        println(terminalThemeRow('Busca', 'full-text nos turnos anteriores.'));
        println('');
        return;
    }

    const projection = searchTerminalTurnsProjection({ query, hubSessionId: hubSessionId ?? null, limit: 10 });
    if (!projection.available) {
        println('');
        println(terminalThemeRow('Erro', 'ConversationHub não está disponível.', { role: 'error' }));
        println('');
        return;
    }

    try {
        const results = projection.results;

        if (!results || results.length === 0) {
            println('');
            println(terminalThemeRow('Busca', `nenhum resultado para "${projection.query}"`, { role: 'warn' }));
            println('');
            return;
        }

        println('');
        println(
            terminalThemeHeadline('assistant', 'Resultados da busca', [`${results.length}`, `"${projection.query}"`]),
        );
        println('');
        for (const r of results) {
            const role = r['role'] ?? '?';
            const content = typeof r['content'] === 'string' ? r['content'] : String(r['content'] ?? '');
            const preview = content.length > 120 ? content.slice(0, 120) + '…' : content;
            const ts = r['created_at']
                ? formatTerminalTimeLabel(String(r['created_at']), { mode: 'dual' })
                : 'sem horário';
            println(
                `  ${terminalThemeText('muted', `[${ts}]`)} ${terminalThemeText('command', String(role))}: ${preview}`,
            );
        }
        println('');
    } catch (e) {
        println('');
        println(terminalThemeRow('Erro', `erro na busca: ${toError(e).message}`, { role: 'error' }));
        println('');
    }
}
