// @ts-check
/**
 * Presenter compartilhado para taxonomia humana de usage LLM no terminal.
 *
 * Os enums crus permanecem em SSE/export raw; stdout, /usage e /events default usam estes labels.
 *
 * @module copilot/terminal/events/usage-presenter
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeUsageToken(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function renderTerminalLlmUsageClassification(value) {
    const text = normalizeUsageToken(value);
    if (text === 'ask_user_continuation') return 'continuação da pergunta humana';
    if (text === 'non_user_initiated') return 'iniciado pelo agente';
    if (text === 'byok_user_message') return 'mensagem BYOK do operador';
    if (text === 'premium_request') return 'pedido premium';
    if (text === 'tool_originated') return 'originado por ferramenta';
    if (text === 'unattributed_llm_usage') return 'uso LLM sem atribuição';
    return '';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function renderTerminalLlmUsageReason(value) {
    const text = normalizeUsageToken(value);
    if (text === 'user_input_completed_continuation') return 'continuação após resposta humana';
    if (text === 'pending_user_input_request_continuation') return 'continuação de pergunta pendente';
    if (text === 'pending_user_input_request_without_id') return 'pergunta pendente sem vínculo';
    if (text === 'pending_user_input_request') return 'pergunta pendente';
    if (text === 'parent_tool_call') return 'chamada originada por ferramenta';
    if (text === 'no_user_message') return 'sem mensagem do operador';
    if (text.startsWith('initiator:')) return `iniciador ${text.slice('initiator:'.length).replace(/[_-]+/gu, ' ')}`;
    if (text.startsWith('byok_user_message:')) {
        return `mensagem BYOK do operador · ${text.slice('byok_user_message:'.length).replace(/[_-]+/gu, ' ')}`;
    }
    return '';
}

/**
 * @param {unknown} llmClass
 * @param {unknown} llmReason
 * @returns {string}
 */
export function renderTerminalLlmUsageKind(llmClass, llmReason) {
    const usageClass = normalizeUsageToken(llmClass);
    const reason = normalizeUsageToken(llmReason);
    if (/ask_user|user_input/iu.test(usageClass) || /ask_user|user_input/iu.test(reason)) {
        return 'continuação da pergunta humana';
    }
    if (/tool/iu.test(usageClass) || /tool/iu.test(reason)) return 'ferramenta/automação';
    if (/stream|delta/iu.test(usageClass) || /stream|delta/iu.test(reason)) return 'streaming';
    if (usageClass === 'unknown' && reason === 'n/d') return 'sem classificação';
    return renderTerminalLlmUsageClassification(usageClass) || usageClass.replace(/[_-]+/gu, ' ') || 'sem classificação';
}
