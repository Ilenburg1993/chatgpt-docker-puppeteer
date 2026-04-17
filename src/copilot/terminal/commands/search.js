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
        println('\n  \x1b[33m⚠️  Uso: /search <query>\x1b[0m');
        println('  \x1b[90mBusca full-text nos turnos anteriores.\x1b[0m\n');
        return;
    }

    const projection = searchTerminalTurnsProjection({ query, hubSessionId: hubSessionId ?? null, limit: 10 });
    if (!projection.available) {
        println('\n  \x1b[31m❌  ConversationHub não está disponível.\x1b[0m\n');
        return;
    }

    try {
        const results = projection.results;

        if (!results || results.length === 0) {
            println(`\n  \x1b[33m🔍 Nenhum resultado para "${projection.query}"\x1b[0m\n`);
            return;
        }

        println(`\n  \x1b[36m🔍 ${results.length} resultado(s) para "${projection.query}":\x1b[0m\n`);
        for (const r of results) {
            const role = r['role'] ?? '?';
            const content = typeof r['content'] === 'string' ? r['content'] : String(r['content'] ?? '');
            const preview = content.length > 120 ? content.slice(0, 120) + '…' : content;
            const ts = r['created_at'] ? new Date(String(r['created_at'])).toLocaleTimeString('pt-BR') : '';
            println(`  \x1b[90m[${ts}]\x1b[0m \x1b[33m${role}\x1b[0m: ${preview}`);
        }
        println('');
    } catch (e) {
        println(`\n  \x1b[31m❌ Erro na busca: ${toError(e).message}\x1b[0m\n`);
    }
}
