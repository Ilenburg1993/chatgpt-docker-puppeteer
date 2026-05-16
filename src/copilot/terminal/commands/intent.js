// @ts-check
/**
 * Comando `/intent` do REPL terminal LLM-B.
 *
 * Consulta o histórico persistente de intents capturados por `assistant.intent`, `report_intent` e
 * `report_intent_local`.
 *
 * @module copilot/terminal/commands/intent
 */

import {
    clearTerminalIntentHistory,
    readTerminalIntentHistory,
    readTerminalIntentStats,
    terminalThemeBadge,
    terminalThemeText,
} from '../state/index.js';

/**
 * @typedef {object} IntentCommandContext
 * @property {(text: string) => void} println
 * @property {((lines: string[]) => void)=} printlnBlock
 */

/**
 * @param {IntentCommandContext} ctx
 * @param {string[]} lines
 * @returns {void}
 */
function printBlock(ctx, lines) {
    if (ctx.printlnBlock) ctx.printlnBlock(lines);
    else ctx.println(lines.join('\n'));
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
function compact(value, max) {
    const text = value.replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * @param {import('../state/intent-state.js').TerminalIntentRisk} risk
 * @returns {'info' | 'warn' | 'error' | 'muted'}
 */
function riskTheme(risk) {
    if (risk === 'high') return 'error';
    if (risk === 'medium') return 'warn';
    if (risk === 'unknown') return 'muted';
    return 'info';
}

/**
 * @param {IntentCommandContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdIntent(ctx, arg) {
    const trimmed = (arg ?? '').trim().toLowerCase();
    if (trimmed === 'clear') {
        clearTerminalIntentHistory();
        ctx.println(`\n  ${terminalThemeText('muted', 'Histórico de intents limpo.')}\n`);
        return;
    }

    const requested = Number.parseInt(trimmed || '20', 10);
    const limit = Number.isFinite(requested) && requested > 0 ? requested : 20;
    const entries = readTerminalIntentHistory(limit);
    const stats = readTerminalIntentStats();

    if (entries.length === 0) {
        ctx.println(`\n  ${terminalThemeText('muted', 'Nenhum intent capturado ainda.')}\n`);
        return;
    }

    /** @type {string[]} */
    const lines = [
        '',
        `  ${terminalThemeBadge('info', 'INTENT')} ${terminalThemeText('info', `Últimos ${entries.length} intents`)} ${terminalThemeText('muted', `· total=${stats.entries} · bytes=${stats.bytes}`)}`,
        '',
    ];
    for (const entry of entries) {
        const theme = riskTheme(entry.risk);
        const tool = entry.tool ? ` · tool=${entry.tool}` : '';
        const call = entry.toolCallId ? ` · call=${compact(entry.toolCallId, 18)}` : '';
        lines.push(
            `  ${terminalThemeText(theme, entry.id.slice(-10))} ${terminalThemeText('muted', `${formatTime(entry.timestamp)} · ${entry.source}${tool}${call} · risk=${entry.risk}`)}`,
        );
        lines.push(`    ${compact(entry.intent, 180)}`);
    }
    lines.push('', `  ${terminalThemeText('muted', 'Use /intent <n> para ampliar ou /intent clear para limpar a janela em memória.')}`, '');
    printBlock(ctx, lines);
}
