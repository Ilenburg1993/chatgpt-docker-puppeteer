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
import { buildTerminalModelTransitionPresentation } from './model-transition-presentation.js';

export {
    buildTerminalModelTransitionPresentation,
    formatTerminalModelTransitionIsoTimestamp,
    renderTerminalModelTransitionSourceLabel,
} from './model-transition-presentation.js';

/**
 * @typedef {Parameters<typeof buildTerminalModelTransitionPresentation>[0] & {
 *     label?: string;
 *     role?: 'info' | 'warn' | 'muted' | 'success' | 'error' | 'assistant' | 'thinking' | 'command' | 'user';
 * }} TerminalModelTransitionRowInput
 */

/**
 * @param {TerminalModelTransitionRowInput} input
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
