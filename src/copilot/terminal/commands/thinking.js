// @ts-check
/**
 * src/copilot/terminal/commands/thinking.js
 *
 * Comando `/thinking [on|off|toggle]` do REPL terminal LLM-B.
 *
 * Controla a exibição em tempo real do extended thinking (reasoning) da LLM-B no stdout. Quando ativo, chunks de
 * `assistant.reasoning_delta` são renderizados inline com prefixo 💭.
 *
 * @module copilot/terminal/commands/thinking
 * @see EventBus
 */

import {
    clearThinkingHistory,
    getLatestThinkingHistoryEntry,
    getShowThinking,
    getThinkingHistory,
    getThinkingHistoryEntry,
    setShowThinking,
} from '../../presentation/state/index.js';

/**
 * @typedef {object} ThinkingContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * Comando `/thinking [on|off|toggle]`.
 *
 * - Sem argumento ou `toggle`: alterna o estado.
 * - `on`: ativa exibição de thinking.
 * - `off`: desativa exibição de thinking.
 * - `list [n]`: lista thinkings capturados.
 * - `show <id|latest>`: abre o conteúdo completo.
 * - `clear`: limpa o histórico de thinkings.
 *
 * @param {ThinkingContext} ctx
 * @param {string} [arg] - Argumento fornecido pelo usuário
 * @returns {void}
 */
export function cmdThinking({ println }, arg) {
    const trimmed = (arg ?? '').trim().toLowerCase();
    const [command = '', extra = ''] = trimmed.split(/\s+/, 2);

    if (command === 'list') {
        const requested = Number.parseInt(extra || '10', 10);
        const entries = getThinkingHistory(Number.isFinite(requested) ? requested : 10);
        if (entries.length === 0) {
            println('\n  \x1b[90mNenhum thinking capturado ainda.\x1b[0m\n');
            return;
        }
        println(`\n  \x1b[35mThinking capturado (${entries.length})\x1b[0m`);
        for (const entry of entries) {
            const shortId = entry.id.slice(-12);
            const preview = entry.content.replace(/\s+/g, ' ').trim().slice(0, 72);
            println(
                `  \x1b[33m${shortId}\x1b[0m  \x1b[90m${entry.source}\x1b[0m  \x1b[90m·\x1b[0m  ${entry.title}  \x1b[90m·\x1b[0m  ${entry.chars} chars`,
            );
            if (preview) println(`    \x1b[90m${preview}${entry.content.length > preview.length ? '…' : ''}\x1b[0m`);
        }
        println('\n  \x1b[90mUse /thinking show <id> ou /thinking latest para abrir.\x1b[0m\n');
        return;
    }

    if (command === 'show' || command === 'latest') {
        const rawId = command === 'latest' ? 'latest' : extra;
        const entry =
            rawId === 'latest'
                ? getLatestThinkingHistoryEntry()
                : (getThinkingHistoryEntry(rawId) ??
                  getThinkingHistory(120)
                      .slice()
                      .reverse()
                      .find((item) => item.id === rawId || item.id.endsWith(rawId)));
        if (!entry) {
            println(`\n  \x1b[31mThinking não encontrado: ${rawId || '(vazio)'}\x1b[0m\n`);
            return;
        }
        println(`\n  \x1b[35m╭─ thinking ${entry.id.slice(-12)}\x1b[0m  \x1b[90m${entry.title}\x1b[0m`);
        println(
            `  \x1b[35m│\x1b[0m  \x1b[90mfonte=${entry.source} · status=${entry.status} · chars=${entry.chars} · duração=${(Number(entry.durationMs ?? 0) / 1000).toFixed(1)}s\x1b[0m`,
        );
        println('  \x1b[35m│\x1b[0m');
        for (const line of entry.content.split('\n')) {
            println(`  \x1b[35m│\x1b[0m  ${line}`);
        }
        println('  \x1b[35m╰────────────────────────────────────────────────────────────\x1b[0m\n');
        return;
    }

    if (command === 'clear') {
        clearThinkingHistory();
        println('\n  \x1b[90mHistórico de thinking limpo.\x1b[0m\n');
        return;
    }

    let next;

    if (trimmed === 'on') {
        next = true;
    } else if (trimmed === 'off') {
        next = false;
    } else {
        // toggle
        next = !getShowThinking();
    }

    setShowThinking(next);
    const status = next ? '\x1b[32mon\x1b[0m' : '\x1b[31moff\x1b[0m';
    println(`\n  💭  Exibição expandida de thinking: ${status}`);
    println('  \x1b[90mUso: /thinking [on|off|toggle|list [n]|show <id>|latest|clear]\x1b[0m\n');
}
