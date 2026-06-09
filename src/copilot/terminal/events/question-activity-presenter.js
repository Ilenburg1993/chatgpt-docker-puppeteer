// @ts-check
/**
 * Presenter compartilhado para subestados de atividades `question`.
 *
 * A fase interna `question` cobre mais do que uma pergunta humana direta: resposta registrada,
 * permissões/formulários, mailbox de intervenção, OAuth e sampling MCP. Este módulo mantém a
 * classificação em uma única fonte de verdade para evitar drift entre linha viva e comandos.
 *
 * @module copilot/terminal/question-activity-presenter
 */

/**
 * @typedef {'response' | 'intervention' | 'decision' | 'integration' | 'prompt' | 'interaction'} TerminalQuestionActivityKind
 */

/**
 * @param {{ label?: string | null; detail?: string | null }} entry
 * @returns {string}
 */
function normalizeQuestionActivityText(entry) {
    return `${entry.label ?? ''} ${entry.detail ?? ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
}

/**
 * @param {{ label?: string | null; detail?: string | null }} [entry]
 * @returns {TerminalQuestionActivityKind}
 */
export function classifyTerminalQuestionActivity(entry = {}) {
    const text = normalizeQuestionActivityText(entry);
    if (
        text.includes('resposta registrada') ||
        text.includes('resposta humana') ||
        text.includes('eco de resposta') ||
        text.includes('aguardando resposta final')
    ) {
        return 'response';
    }
    if (text.includes('fila de intervencao') || text.includes('caixa de entrada') || text.includes('nova mensagem')) {
        return 'intervention';
    }
    if (text.includes('formulario') || text.includes('permissao')) return 'decision';
    if (text.includes('oauth') || text.includes('sampling mcp')) return 'integration';
    if (text.includes('pergunta ao operador') || text.includes('pergunta humana')) return 'prompt';
    return 'interaction';
}

/**
 * @param {{ label?: string | null; detail?: string | null }} [entry]
 * @returns {string}
 */
export function renderTerminalQuestionActivityLiveLabel(entry = {}) {
    const kind = classifyTerminalQuestionActivity(entry);
    if (kind === 'response') return 'continuando';
    if (kind === 'intervention') return 'intervenção';
    if (kind === 'decision') return 'decisão';
    if (kind === 'integration') return 'integração';
    if (kind === 'prompt') return 'pergunta';
    return 'interação';
}

/**
 * @param {{ label?: string | null; detail?: string | null }} [entry]
 * @returns {string}
 */
export function renderTerminalQuestionActivityPhaseLabel(entry = {}) {
    const kind = classifyTerminalQuestionActivity(entry);
    if (kind === 'response') return 'continuação';
    if (kind === 'intervention') return 'intervenção';
    if (kind === 'decision') return 'decisão';
    if (kind === 'integration') return 'integração';
    if (kind === 'prompt') return 'pergunta';
    return 'interação';
}
