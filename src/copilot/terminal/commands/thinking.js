// @ts-check
/**
 * src/copilot/terminal/commands/thinking.js
 *
 * Comando `/thinking [on|off|toggle]` do REPL terminal LLM-B.
 *
 * Controla a exibição em tempo real do extended thinking (reasoning) da LLM-B no stdout. Quando ativo, chunks de
 * `assistant.reasoning_delta` são renderizados inline com rótulo humano de raciocínio.
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
import {
    formatTerminalThinkingRef,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeText,
} from '../state/events/index.js';

/**
 * @typedef {object} ThinkingContext
 * @property {(text: string) => void} println - Função de output do terminal
 * @property {(lines: string[]) => void} [printlnBlock] - Escrita em bloco, quando disponível
 */

/**
 * @param {ThinkingContext} ctx
 * @param {string[]} lines
 * @returns {void}
 */
function printBlock(ctx, lines) {
    if (ctx.printlnBlock) ctx.printlnBlock(lines);
    else ctx.println(lines.join('\n'));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function humanThinkingStatus(value) {
    const status = String(value ?? '')
        .trim()
        .toLowerCase();
    if (status === 'completed' || status === 'done' || status === 'success') return 'concluído';
    if (status === 'active' || status === 'running' || status === 'started') return 'em andamento';
    if (status === 'failed' || status === 'error') return 'falhou';
    return status || 'registrado';
}

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
export function cmdThinking(ctx, arg) {
    const { println } = ctx;
    const trimmed = (arg ?? '').trim().toLowerCase();
    const [command = '', extra = ''] = trimmed.split(/\s+/, 2);

    if (command === 'list') {
        const requested = Number.parseInt(extra || '10', 10);
        const entries = getThinkingHistory(Number.isFinite(requested) ? requested : 10);
        if (entries.length === 0) {
            println('');
            println(terminalThemeRow('Raciocínio', 'nenhum raciocínio capturado ainda.'));
            println('');
            return;
        }
        /** @type {string[]} */
        const lines = ['', terminalThemeHeadline('thinking', 'Raciocínio capturado', [`${entries.length}`])];
        for (const entry of entries) {
            const shortId = formatTerminalThinkingRef(entry.id);
            const preview = entry.content.replace(/\s+/g, ' ').trim().slice(0, 72);
            lines.push(
                `  ${terminalThemeText('command', shortId)}  ${terminalThemeText('muted', entry.source)}  ${terminalThemeText('muted', '·')}  ${entry.title}  ${terminalThemeText('muted', '·')}  ${entry.chars} caracteres`,
            );
            if (preview)
                lines.push(
                    `    ${terminalThemeText('muted', `${preview}${entry.content.length > preview.length ? '…' : ''}`)}`,
                );
        }
        lines.push('', terminalThemeRow('Uso', '/thinking show <id> ou /thinking latest', { role: 'command' }), '');
        printBlock(ctx, lines);
        return;
    }

    if (command === 'show' || command === 'latest') {
        const rawId = command === 'latest' ? 'latest' : extra;
        const entry =
            rawId === 'latest'
                ? getLatestThinkingHistoryEntry()
                : (getThinkingHistoryEntry(rawId) ??
                  getThinkingHistory(Number.MAX_SAFE_INTEGER)
                      .slice()
                      .reverse()
                      .find((item) => item.id === rawId || item.id.endsWith(rawId)));
        if (!entry) {
            println('');
            println(terminalThemeRow('Erro', `raciocínio não encontrado: ${rawId || '(vazio)'}`, { role: 'error' }));
            println('');
            return;
        }
        const shortId = formatTerminalThinkingRef(entry.id);
        /** @type {string[]} */
        const lines = ['', terminalThemeHeadline('thinking', `Raciocínio ${shortId}`, [entry.title])];
        lines.push(
            terminalThemeRow(
                'Metadados',
                `fonte ${entry.source} · estado ${humanThinkingStatus(entry.status)} · ${entry.chars} caracteres · duração ${(Number(entry.durationMs ?? 0) / 1000).toFixed(1)}s`,
            ),
        );
        lines.push(terminalThemeDivider(60));
        for (const line of entry.content.split('\n')) {
            lines.push(`  ${terminalThemeText('thinking', '│')}  ${line}`);
        }
        lines.push(terminalThemeDivider(60), '');
        printBlock(ctx, lines);
        return;
    }

    if (command === 'clear') {
        clearThinkingHistory();
        println('');
        println(terminalThemeRow('Raciocínio', 'histórico limpo.'));
        println('');
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
    const status = next ? terminalThemeText('success', 'ativa') : terminalThemeText('error', 'inativa');
    println('');
    println(terminalThemeRow('Raciocínio', `exibição expandida ${status}`, { role: next ? 'success' : 'error' }));
    println(terminalThemeRow('Uso', '/thinking [on|off|toggle|list [n]|show <id>|latest|clear]', { role: 'command' }));
    println('');
}
