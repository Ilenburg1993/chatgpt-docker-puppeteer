// @ts-check
/**
 * Stable parser/projection for terminal LLM-B adaptive-selection public outcomes.
 *
 * READY and EXHAUSTED are deliberately distinct terminal states. Exhaustion is a bounded negative result: it proves
 * that the current selection cycle ended without an authorized winner and must never be promoted to READY.
 *
 * @module copilot/model-gateway/control-plane/adaptive-selection-outcome
 */

const TERMINAL_LINE_PREFIX = String.raw`[^\S\r\n]*(?:│[^\S\r\n]*)?`;
const READY_RE = new RegExp(
    `^${TERMINAL_LINE_PREFIX}ADAPTIVE-SELECTION-READY provider=(\\S+) model=(\\S+) decision=(use_current|switch_recommended)[^\\S\\r\\n]*$`,
    'mu',
);
const EXHAUSTED_RE = new RegExp(
    `^${TERMINAL_LINE_PREFIX}ADAPTIVE-SELECTION-EXHAUSTED provider=(\\S+) model=(\\S+) reason=([^\\r\\n]+?)[^\\S\\r\\n]*$`,
    'mu',
);

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {{
 *   status: 'ready' | 'exhausted' | 'pending';
 *   terminal: boolean;
 *   winner: boolean;
 *   providerId: string | null;
 *   providerModel: string | null;
 *   decision: 'use_current' | 'switch_recommended' | null;
 *   reason: string | null;
 *   marker: string | null;
 * }}
 */
export function parseModelGatewayAdaptiveSelectionOutcome(value) {
    const input = text(value) ?? '';
    const ready = input.match(READY_RE);
    if (ready) {
        return {
            status: 'ready',
            terminal: true,
            winner: true,
            providerId: ready[1] ?? null,
            providerModel: ready[2] ?? null,
            decision: /** @type {'use_current' | 'switch_recommended'} */ (ready[3]),
            reason: null,
            marker: `ADAPTIVE-SELECTION-READY provider=${ready[1]} model=${ready[2]} decision=${ready[3]}`,
        };
    }
    const exhausted = input.match(EXHAUSTED_RE);
    if (exhausted) {
        return {
            status: 'exhausted',
            terminal: true,
            winner: false,
            providerId: exhausted[1] ?? null,
            providerModel: exhausted[2] ?? null,
            decision: null,
            reason: exhausted[3]?.trim() || 'probe_budget_exhausted',
            marker: `ADAPTIVE-SELECTION-EXHAUSTED provider=${exhausted[1]} model=${exhausted[2]} reason=${exhausted[3]?.trim() || 'probe_budget_exhausted'}`,
        };
    }
    return {
        status: 'pending',
        terminal: false,
        winner: false,
        providerId: null,
        providerModel: null,
        decision: null,
        reason: null,
        marker: null,
    };
}
