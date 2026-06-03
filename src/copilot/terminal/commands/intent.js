// @ts-check
/**
 * Comando `/intent` do REPL terminal LLM-B.
 *
 * Consulta o histórico persistente de intenções explícitas capturadas da LLM-B.
 *
 * @module copilot/terminal/commands/intent
 */

import {
    clearTerminalIntentHistory,
    formatTerminalIsoTimestamp,
    readTerminalIntentHistory,
    readTerminalIntentStats,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
} from '../state/index.js';

/**
 * @typedef {object} IntentCommandContext
 * @property {(text: string) => void} println
 * @property {(lines: string[]) => void} [printlnBlock]
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
    return formatTerminalIsoTimestamp(timestamp);
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
 * @returns {string}
 */
function humanRiskLabel(risk) {
    if (risk === 'low') return 'baixo';
    if (risk === 'medium') return 'médio';
    if (risk === 'high') return 'alto';
    return 'não informado';
}

/**
 * @param {string} source
 * @returns {string}
 */
function humanIntentSource(source) {
    const text = source.trim().toLowerCase();
    if (text.includes('assistant.intent')) return 'SDK';
    if (text.includes('report_intent')) return 'ferramenta de intenção';
    if (text.includes('terminal')) return 'terminal';
    return 'captura';
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
    const tokens = (arg ?? '').trim().split(/\s+/u).filter(Boolean);
    const normalizedTokens = tokens.map((token) => token.toLowerCase());
    if (normalizedTokens.includes('clear')) {
        clearTerminalIntentHistory();
        ctx.println('');
        ctx.println(terminalThemeRow('Intenções', 'histórico limpo', { role: 'success' }));
        ctx.println('');
        return;
    }

    const detail = normalizedTokens.includes('detail') || normalizedTokens.includes('raw');
    const numericToken = normalizedTokens.find((token) => /^\d+$/u.test(token));
    const requested = Number.parseInt(numericToken || '20', 10);
    const limit = Number.isFinite(requested) && requested > 0 ? requested : 20;
    const entries = readTerminalIntentHistory(limit);
    const stats = readTerminalIntentStats();

    if (entries.length === 0) {
        ctx.println('');
        ctx.println(terminalThemeRow('Intenções', 'Nenhuma intenção capturada ainda', { role: 'muted' }));
        ctx.println('');
        return;
    }

    /** @type {string[]} */
    const lines = [
        '',
        terminalThemeHeadline('info', 'Intenções capturadas', [
            `últimas ${entries.length}`,
            `total ${stats.entries}`,
            `${stats.bytes} bytes`,
            detail ? 'detalhe técnico' : null,
        ]),
        terminalThemeDivider(58),
    ];
    for (const entry of entries) {
        const theme = riskTheme(entry.risk);
        const source = humanIntentSource(entry.source);
        lines.push(terminalThemeRow('Intenção', compact(entry.intent, 180), { role: theme }));
        lines.push(
            terminalThemeRow(
                'Contexto',
                `${formatTime(entry.timestamp)} · origem ${source} · risco ${humanRiskLabel(entry.risk)}`,
            ),
        );
        if (detail) {
            const tool = entry.tool ? ` · ferramenta ${entry.tool}` : '';
            const call = entry.toolCallId ? ` · chamada ${compact(entry.toolCallId, 18)}` : '';
            lines.push(
                terminalThemeRow('Técnico', `origem bruta ${entry.source}${tool}${call} · registro ${entry.id}`),
            );
        }
    }
    lines.push(
        '',
        terminalThemeRow(
            'Uso',
            'Use /intent <n> para ampliar, /intent detail para envelope técnico ou /intent clear para limpar a janela em memória.',
            { role: 'command' },
        ),
        '',
    );
    printBlock(ctx, lines);
}
