// @ts-check
/**
 * Presenters compartilhados para traces de turno/atividade do terminal.
 *
 * O estado interno usa `implicit:*` para agrupar I/O local sem turno conversacional real.
 * A superfície humana não deve chamar esses agrupamentos de "turno da LLM-B".
 */

/**
 * @param {unknown} trace
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(trace) {
    return trace && typeof trace === 'object' ? /** @type {Record<string, unknown>} */ (trace) : null;
}

/**
 * @param {unknown} trace
 * @returns {boolean}
 */
export function isTerminalImplicitOperationalTrace(trace) {
    const value = objectOrNull(trace);
    if (!value) return false;
    const turnId = typeof value['turnId'] === 'string' ? value['turnId'].trim() : '';
    if (turnId) return false;
    const traceId = typeof value['traceId'] === 'string' ? value['traceId'] : '';
    const source = typeof value['source'] === 'string' ? value['source'] : '';
    return traceId.startsWith('implicit:') || source === 'implicit' || source === 'io';
}

/**
 * @param {string} conversationalTitle
 * @param {string} operationalTitle
 * @param {unknown} trace
 * @returns {string}
 */
export function renderTerminalTraceSummaryTitle(conversationalTitle, operationalTitle, trace) {
    return isTerminalImplicitOperationalTrace(trace) ? operationalTitle : conversationalTitle;
}

/**
 * @param {string} summary
 * @param {unknown} trace
 * @returns {string}
 */
export function renderTerminalTraceFlowSummary(summary, trace) {
    if (!isTerminalImplicitOperationalTrace(trace)) return summary;
    return String(summary || '')
        .replace(/\bturno\b/giu, 'atividade')
        .replace(/\bturnos\b/giu, 'atividades');
}

