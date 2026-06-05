// @ts-check
/**
 * src/copilot/terminal/commands/errors.js
 *
 * Comando `/errors [n]` do REPL terminal LLM-B.
 *
 * Mostra os últimos N erros rastreados pelo error tracker.
 *
 * @module copilot/terminal/commands/errors
 * @see EventBus
 */

import { readTerminalErrorsProjection } from '../frontend/index.js';
import { formatTerminalTimeLabel, terminalThemeHeadline, terminalThemeRow } from '../state/index.js';

/**
 * @typedef {object} ErrorsContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * @typedef {object} TerminalErrorPresentation
 * @property {string} label
 * @property {string} detail
 * @property {'error' | 'warning'} role
 */

/**
 * @param {string} message
 * @returns {string | null}
 */
function extractProgressTimeout(message) {
    const match = message.match(/sendTurn sem progresso por\s+(\d+)ms/i);
    if (!match) return null;
    const ms = Number(match[1]);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const seconds = Math.max(1, Math.round(ms / 1000));
    return `${seconds}s sem progresso`;
}

/**
 * @param {{ errorType?: string; source?: string; message: string }} err
 * @param {string} ts
 * @returns {TerminalErrorPresentation}
 */
function renderErrorForOperator(err, ts) {
    const message = String(err.message ?? '');
    const source = String(err.source ?? '');
    const timeoutLabel = extractProgressTimeout(message);
    if (timeoutLabel || /agent\.backpressure\.mutex/i.test(source)) {
        return {
            label: 'Turno sem progresso',
            detail: `${ts} · ${timeoutLabel ?? 'sem progresso'} · rota/modelo não respondeu · veja /activity 40 · /events 60 · /byok health`,
            role: 'warning',
        };
    }
    if (/terminal\.dialog\.empty_output/i.test(source) || /Turno sem saída pública materializada/i.test(message)) {
        return {
            label: 'Turno vazio',
            detail: `${ts} · nenhuma resposta pública materializada · veja /activity 40 · /events 60 · /byok health`,
            role: 'warning',
        };
    }
    if (/provider BYOK|rota BYOK|Erro de sessão BYOK|Erro de provider BYOK/i.test(message)) {
        return {
            label: 'Rota BYOK',
            detail: `${ts} · falha operacional contida · veja /byok health · /byok auto status`,
            role: 'warning',
        };
    }
    const type = err.errorType ?? 'Error';
    const src = err.source ? ` · fonte ${err.source}` : '';
    return {
        label: type,
        detail: `${ts}${src} · ${message}`,
        role: 'error',
    };
}

/**
 * Comando `/errors [n]`.
 *
 * - Sem argumento: mostra últimos 10 erros.
 * - Com número: mostra últimos N erros.
 *
 * @param {ErrorsContext} ctx
 * @param {string} [arg] - Número de erros a exibir
 * @returns {void}
 */
export function cmdErrors({ println }, arg) {
    const limit = Number(arg) || 10;
    const { stats, recent } = readTerminalErrorsProjection(limit);

    println('');
    println(
        terminalThemeHeadline('error', 'Erros rastreados', [`${stats.total} total`, `${stats.buffered} no buffer`]),
    );
    println('');

    if (recent.length === 0) {
        println(terminalThemeRow('Estado', 'nenhum erro recente', { role: 'success' }));
        println('');
        return;
    }

    for (const err of recent) {
        const ts = formatTerminalTimeLabel(err.timestamp, { mode: 'dual' });
        const rendered = renderErrorForOperator(err, ts);
        println(terminalThemeRow(rendered.label, rendered.detail, { role: rendered.role, width: 20 }));
    }
    println('');
}
