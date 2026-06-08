// @ts-check
/**
 * Nucleo puro da apresentacao de transicoes de modelo.
 *
 * Este modulo nao importa tema, UI, SDK ou BYOK. Ele existe para que comandos,
 * eventos e automacoes possam compartilhar a mesma linguagem sem puxar a camada
 * visual inteira para caminhos quentes ou testes com mocks estreitos.
 *
 * @module copilot/terminal/events/model-transition-presentation
 */

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
 * @param {unknown} value
 * @returns {string | null}
 */
function detailLabel(value) {
    const label = modelLabel(value, '');
    return label ? label.replace(/[_-]+/gu, ' ') : null;
}

/**
 * @param {string} source
 * @returns {string}
 */
export function renderTerminalModelTransitionSourceLabel(source) {
    const normalized = source.trim().toLowerCase().replace(/_/gu, '-');
    if (normalized === 'sdk') return 'SDK';
    if (normalized.startsWith('sdk/') || normalized.startsWith('sdk.')) return 'SDK';
    if (normalized === 'agent') return 'agente';
    if (normalized.startsWith('agent/') || normalized.startsWith('agent.')) return 'agente';
    if (normalized === 'terminal') return 'terminal';
    if (normalized === 'terminal.byok-model') return 'terminal /byok model';
    if (normalized === 'terminal.byok-auto') return 'automação BYOK';
    if (normalized === 'terminal.model') return 'terminal /model';
    if (normalized.startsWith('terminal.byok-')) return 'terminal BYOK';
    if (normalized === 'model-gateway' || normalized.startsWith('model-gateway')) return 'model-gateway';
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
 *     confidence?: string | null;
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
        input.confidence ? `confiança ${detailLabel(input.confidence)}` : null,
        `origem ${renderTerminalModelTransitionSourceLabel(source)}`,
        formatTerminalModelTransitionIsoTimestamp(input.timestamp),
    ].filter((part) => typeof part === 'string' && part.length > 0);
    return {
        transition,
        detail: parts.join(' · '),
        headline: state,
    };
}
