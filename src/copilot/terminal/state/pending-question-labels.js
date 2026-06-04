// @ts-check

/**
 * @param {unknown} kind
 * @returns {string}
 */
function normalizePendingQuestionKind(kind) {
    return String(kind ?? '')
        .trim()
        .toLowerCase()
        .replace(/[_-]+/gu, ' ');
}

/**
 * @param {unknown} kind
 * @param {string} [fallback]
 * @returns {string}
 */
export function renderTerminalPendingQuestionKindLabel(kind, fallback = 'geral') {
    const normalized = normalizePendingQuestionKind(kind);
    if (!normalized) return fallback;
    if (normalized === 'ready') return 'pronto';
    if (normalized === 'question') return 'operador';
    if (normalized === 'confirm' || normalized === 'confirmation') return 'confirmação';
    if (normalized === 'choice' || normalized === 'select' || normalized === 'selection') return 'escolha';
    if (normalized === 'text' || normalized === 'freeform' || normalized === 'free form') return 'texto livre';
    if (normalized === 'protocol' || normalized.startsWith('protocol ')) return 'protocolo';
    return normalized;
}

/**
 * @param {unknown} kind
 * @returns {string}
 */
export function renderTerminalPendingQuestionPromptTag(kind) {
    const label = renderTerminalPendingQuestionKindLabel(kind);
    return label === 'geral' ? 'PERGUNTA' : `PERGUNTA:${label.toUpperCase()}`;
}
