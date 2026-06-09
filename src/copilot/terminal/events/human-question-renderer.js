// @ts-check
/**
 * Renderer compartilhado para perguntas humanas no terminal.
 *
 * `ask_user` e `request_user_input` são interações do operador, não ferramentas comuns. Este renderer mantém uma única
 * linguagem visual para SDK, replay do runtime e lifecycle de tool.
 *
 * @module copilot/terminal/human-question-renderer
 */

import {
    formatTerminalTimeLabel,
    terminalActionChip,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
} from '../state/events/index.js';
import { compactTerminalToolText } from './tool-activity-presenter.js';

/**
 * @typedef {{
 *     question?: string | null;
 *     choices?: string[] | null;
 *     allowFreeform?: boolean;
 *     source?: 'sdk' | 'runtime' | 'tool' | 'replay' | 'headless' | string;
 *     title?: string;
 *     state?: string;
 *     action?: string;
 *     note?: string | null;
 *     compact?: boolean;
 *     now?: number;
 *     includeDivider?: boolean;
 *     includeShortcuts?: boolean;
 *     maxQuestionChars?: number;
 * }} TerminalHumanQuestionCardOptions
 */

/**
 * @param {string | null | undefined} source
 * @returns {string}
 */
function renderQuestionSource(source) {
    if (source === 'sdk') return 'SDK';
    if (source === 'runtime') return 'conversa';
    if (source === 'tool') return 'ferramenta';
    if (source === 'replay') return 'restaurada';
    if (source === 'headless') return 'sem interface';
    return source && source.trim() ? source.trim() : 'terminal';
}

/**
 * @param {string[] | null | undefined} choices
 * @param {{ compact: boolean }} opts
 * @returns {string | null}
 */
function renderQuestionChoices(choices, opts) {
    const list = Array.isArray(choices) ? choices.filter((choice) => typeof choice === 'string' && choice.trim()) : [];
    if (list.length === 0) return null;
    const maxInlineChoices = opts.compact ? 4 : 6;
    const visible = list.slice(0, maxInlineChoices);
    const rendered = visible
        .map((choice, idx) => `[${idx + 1}] ${opts.compact ? compactTerminalToolText(choice, 18) : choice}`)
        .join('   ');
    return list.length > visible.length ? `${rendered}   ... +${list.length - visible.length}` : rendered;
}

/**
 * @param {TerminalHumanQuestionCardOptions} input
 * @returns {string[]}
 */
export function buildTerminalHumanQuestionCard(input = {}) {
    const compact = input.compact === true;
    const question = String(input.question ?? '').trim() || 'Aguardando resposta do operador';
    const questionText = compactTerminalToolText(question, input.maxQuestionChars ?? (compact ? 96 : 180));
    const choicesLine = renderQuestionChoices(input.choices, { compact });
    const state = input.state ?? 'decisão pendente';
    const action =
        input.action ??
        (choicesLine
            ? 'Digite o número, o texto da opção ou qualquer texto livre.'
            : 'Responda digitando normalmente ou use /answer <texto>.');
    const now = input.now ?? Date.now();
    /** @type {string[]} */
    const lines = [];
    if (input.includeDivider !== false) {
        lines.push(terminalThemeDivider(compact ? 37 : 52));
    }
    lines.push(terminalThemeHeadline('question', input.title ?? 'Pergunta ao operador', [state]));
    lines.push(terminalThemeRow('Origem', renderQuestionSource(input.source)));
    lines.push(terminalThemeRow('Hora', formatTerminalTimeLabel(now, { now, mode: 'dual' })));
    lines.push(terminalThemeRow('[PERGUNTA]', questionText, { role: 'question' }));
    if (choicesLine) {
        lines.push(terminalThemeRow('Opções', choicesLine, { role: 'info' }));
    }
    if (input.note && input.note.trim()) {
        lines.push(
            terminalThemeRow('Contexto', compactTerminalToolText(input.note, compact ? 96 : 180), { role: 'warn' }),
        );
    }
    lines.push(terminalThemeRow('Ação', action, { role: 'command' }));
    if (input.includeShortcuts !== false && !compact) {
        lines.push(
            terminalThemeRow(
                'Atalhos',
                `${terminalActionChip('/answer <texto>')} ${terminalActionChip('/status')} ${terminalActionChip('/sdk waits')}`,
            ),
        );
    }
    return lines;
}

/**
 * @param {(line: string) => void} println
 * @param {TerminalHumanQuestionCardOptions} input
 * @returns {void}
 */
export function printTerminalHumanQuestionCard(println, input = {}) {
    for (const line of buildTerminalHumanQuestionCard(input)) {
        println(line);
    }
}
