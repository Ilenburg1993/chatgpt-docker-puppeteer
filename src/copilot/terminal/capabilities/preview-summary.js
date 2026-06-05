// @ts-check
/**
 * Sumarização canônica de previews no terminal.
 *
 * Os renderers externos são enriquecimentos explícitos. A UX deve sempre deixar claro quando o operador está vendo um
 * renderer externo e quando o terminal caiu para o fallback JS canônico.
 *
 * @module copilot/terminal/capabilities/preview-summary
 */

/**
 * @typedef {{
 *     renderer?: string;
 *     fallbackReason?: string | null;
 *     truncated?: boolean;
 *     queryApplied?: boolean;
 * }} TerminalPreviewLike
 */

const TERMINAL_EXTERNAL_PREVIEW_RENDERERS = new Set(['bat', 'glow', 'delta', 'jq', 'yq']);

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanSummaryPart(value) {
    return String(value ?? '')
        .replace(/\s+/gu, ' ')
        .trim();
}

/**
 * @param {TerminalPreviewLike} preview
 * @returns {boolean}
 */
export function isTerminalExternalPreviewRenderer(preview) {
    return TERMINAL_EXTERNAL_PREVIEW_RENDERERS.has(cleanSummaryPart(preview.renderer));
}

/**
 * @param {TerminalPreviewLike} preview
 * @param {{ query?: string | null; queryApplied?: boolean }} [options]
 * @returns {string}
 */
export function renderTerminalPreviewSummary(preview, options = {}) {
    const renderer = cleanSummaryPart(preview.renderer) || 'js';
    const isExternal = isTerminalExternalPreviewRenderer({ renderer });
    const parts = [renderer, isExternal ? 'renderer externo' : 'fallback canônico'];
    const query = cleanSummaryPart(options.query);
    const queryApplied = options.queryApplied ?? preview.queryApplied === true;
    if (queryApplied && query && query !== '.') parts.push(`filtro ${query}`);
    const fallbackReason = cleanSummaryPart(preview.fallbackReason);
    if (fallbackReason) parts.push(`motivo ${fallbackReason}`);
    if (preview.truncated) parts.push('truncado');
    return parts.join(' · ');
}

/**
 * @param {TerminalPreviewLike} preview
 * @returns {'success' | 'muted'}
 */
export function terminalPreviewSummaryRole(preview) {
    return isTerminalExternalPreviewRenderer(preview) ? 'success' : 'muted';
}

export const __test__ = {
    TERMINAL_EXTERNAL_PREVIEW_RENDERERS,
    cleanSummaryPart,
};
