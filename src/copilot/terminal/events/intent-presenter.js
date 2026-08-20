// @ts-check
/**
 * Presenter puro para intenções explícitas da LLM-B.
 *
 * Mantém uma única gramática visual para `assistant.intent`, `report_intent` e o alias local, separando a superfície
 * humana do envelope técnico preservado em SSE/export.
 *
 * @module copilot/terminal/events/intent-presenter
 */

import {
    compactTerminalDiagnosticId,
    getTerminalHumanToolName,
    isTerminalInternalCallIdentifier,
} from './tool-activity-presenter.js';

/**
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
export function compactTerminalIntentText(value, max) {
    const text = value.replace(/\s+/gu, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * @param {import('../state/intent-state.js').TerminalIntentRisk} risk
 * @param {{ withPrefix?: boolean }} [opts]
 * @returns {string}
 */
export function humanTerminalIntentRiskLabel(risk, opts = {}) {
    const prefix = opts.withPrefix === false ? '' : 'risco ';
    if (risk === 'low') return `${prefix}baixo`;
    if (risk === 'medium') return `${prefix}médio`;
    if (risk === 'high') return `${prefix}alto`;
    return `${prefix}não informado`;
}

/**
 * @param {string} source
 * @returns {string}
 */
export function humanTerminalIntentSource(source) {
    const text = source.trim().toLowerCase();
    if (text.includes('assistant.intent')) return 'SDK';
    if (text.includes('report_intent')) return 'ferramenta de intenção';
    if (text.includes('terminal')) return 'terminal';
    if (text.includes('tool/')) return 'ferramenta';
    return 'captura';
}

/**
 * @param {import('../state/intent-state.js').TerminalIntentRisk} risk
 * @returns {'info' | 'warn' | 'error' | 'muted'}
 */
export function terminalIntentRiskTheme(risk) {
    if (risk === 'high') return 'error';
    if (risk === 'medium') return 'warn';
    if (risk === 'unknown') return 'muted';
    return 'info';
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function formatIntentDiagnosticReference(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return null;
    if (isTerminalInternalCallIdentifier(text)) return 'id interno';
    return compactTerminalDiagnosticId(text, 16);
}

/**
 * @param {import('../state/intent-state.js').TerminalIntentEntry} entry
 * @returns {string}
 */
export function formatTerminalIntentTechnicalEnvelope(entry) {
    const source = `origem ${humanTerminalIntentSource(entry.source)}`;
    const tool = entry.tool ? `ferramenta ${getTerminalHumanToolName(entry.tool)}` : null;
    const call = entry.toolCallId
        ? `chamada ${formatIntentDiagnosticReference(entry.toolCallId) ?? 'id interno'}`
        : null;
    const record = `registro ${formatIntentDiagnosticReference(entry.id) ?? 'local'}`;
    return [source, tool, call, record].filter(Boolean).join(' · ');
}
