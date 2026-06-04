// @ts-check
/**
 * Presenters canonicos para transicoes de modelo no terminal.
 *
 * O SDK, o model-gateway e comandos BYOK emitem eventos diferentes para o mesmo
 * fluxo humano: uma troca pode ter sido solicitada, confirmada, observada como
 * fallback ou apenas reconfirmada sem mudanca. Este presenter mantem a linguagem
 * curta e consistente entre transcript, /activity e SSE.
 *
 * @module copilot/terminal/events/model-transition-presenter
 */

import { terminalThemeRow } from '../state/ui/index.js';

/**
 * @typedef {'requested' | 'confirmed' | 'unchanged' | 'fallback'} TerminalModelTransitionKind
 */

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function modelLabel(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * @param {string} source
 * @returns {string}
 */
function renderModelTransitionSourceLabel(source) {
    const normalized = source.trim().toLowerCase();
    if (normalized === 'sdk') return 'SDK';
    if (normalized === 'agent') return 'agente';
    if (normalized === 'terminal') return 'terminal';
    if (normalized === 'model-gateway' || normalized === 'model_gateway') return 'model-gateway';
    return source;
}

/**
 * @param {number | string | Date | null | undefined} value
 * @returns {string}
 */
export function formatTerminalModelTransitionIsoTimestamp(value = Date.now()) {
    const date =
        value instanceof Date
            ? value
            : typeof value === 'number' || typeof value === 'string'
              ? new Date(value)
              : new Date();
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

/**
 * @param {{
 *     from?: string | null;
 *     to?: string | null;
 *     kind: TerminalModelTransitionKind;
 *     reasoningEffort?: string | null;
 *     source?: string | null;
 *     reason?: string | null;
 *     timestamp?: number | string | Date | null;
 * }} input
 * @returns {{ transition: string; detail: string; headline: string }}
 */
export function buildTerminalModelTransitionPresentation(input) {
    const from = modelLabel(input.from, '?');
    const to = modelLabel(input.to, '?');
    const changed = from !== to;
    const transition = changed ? `${from} → ${to}` : `${to} (sem troca)`;
    const state =
        input.kind === 'fallback'
            ? 'fallback aplicado'
            : input.kind === 'requested'
              ? 'solicitado'
            : input.kind === 'unchanged'
              ? 'confirmado sem troca'
              : 'confirmado';
    const source = modelLabel(input.source, input.kind === 'fallback' ? 'agent' : 'SDK');
    const parts = [
        `${state}: ${transition}`,
        input.reasoningEffort ? `raciocínio ${input.reasoningEffort}` : null,
        input.reason ? input.reason : null,
        `origem ${renderModelTransitionSourceLabel(source)}`,
        formatTerminalModelTransitionIsoTimestamp(input.timestamp),
    ].filter((part) => typeof part === 'string' && part.length > 0);
    return {
        transition,
        detail: parts.join(' · '),
        headline: state,
    };
}

/**
 * @param {Parameters<typeof buildTerminalModelTransitionPresentation>[0] & {
 *     label?: string;
 *     role?: 'info' | 'warn' | 'muted' | 'success' | 'error' | 'assistant' | 'thinking' | 'command' | 'user';
 * }} input
 * @returns {string}
 */
export function renderTerminalModelTransitionRow(input) {
    const label =
        input.label ??
        (input.kind === 'fallback'
            ? 'Fallback modelo'
            : input.kind === 'requested'
              ? 'Modelo pedido'
              : input.kind === 'unchanged'
                ? 'Modelo SDK'
                : 'Modelo SDK');
    return terminalThemeRow(label, buildTerminalModelTransitionPresentation(input).detail, {
        role: input.role ?? (input.kind === 'fallback' ? 'warn' : 'info'),
    });
}
