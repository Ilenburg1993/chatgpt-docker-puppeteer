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
    formatTerminalTimeLabel,
    readTerminalIntentHistory,
    readTerminalIntentStats,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
} from '../state/index.js';
import {
    compactTerminalIntentText,
    formatTerminalIntentTechnicalEnvelope,
    humanTerminalIntentRiskLabel,
    humanTerminalIntentSource,
    terminalIntentRiskTheme,
} from '../events/intent-presenter.js';

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
    return formatTerminalTimeLabel(timestamp, { mode: 'dual' });
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
        const theme = terminalIntentRiskTheme(entry.risk);
        const source = humanTerminalIntentSource(entry.source);
        lines.push(terminalThemeRow('Intenção', compactTerminalIntentText(entry.intent, 180), { role: theme }));
        lines.push(
            terminalThemeRow(
                'Contexto',
                `${formatTime(entry.timestamp)} · origem ${source} · ${humanTerminalIntentRiskLabel(entry.risk)}`,
            ),
        );
        if (detail) {
            lines.push(terminalThemeRow('Envelope', formatTerminalIntentTechnicalEnvelope(entry)));
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
