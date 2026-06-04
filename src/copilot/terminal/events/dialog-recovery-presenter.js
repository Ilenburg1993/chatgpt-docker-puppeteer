// @ts-check
/**
 * Presenter compartilhado para estados de recuperacao do dialogo terminal.
 *
 * Esses textos aparecem em stdout humano e em comandos como `/events`. O payload bruto continua
 * preservado em SSE/raw/export; aqui mantemos uma camada curta, acionavel e sem IDs longos.
 *
 * @module copilot/terminal/events/dialog-recovery-presenter
 */

export const EMPTY_AFTER_USER_INPUT_RESUME_COMMAND =
    '/turn Continue a partir da ultima resposta humana e entregue a resposta final em texto publico.';
export const EMPTY_AFTER_USER_INPUT_DIAGNOSTIC_COMMANDS = '/activity 40 · /events 60 · /byok health';
export const EMPTY_AFTER_USER_INPUT_MODEL_COMMAND = '/byok model';

/**
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string}
 */
export function compactTerminalRecoveryText(value, maxLength = 120) {
    const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

/**
 * @param {{
 *     detail?: unknown;
 *     answerPreview?: unknown;
 *     turnId?: unknown;
 *     includeModelSwitch?: boolean;
 * }} [input]
 * @returns {Array<{ label: string; value: string; role: 'muted' | 'warn' | 'command' }>}
 */
export function buildEmptyAfterUserInputRecoveryRows(input = {}) {
    const detail = compactTerminalRecoveryText(input.detail, 132);
    const answerPreview = compactTerminalRecoveryText(input.answerPreview, 80);
    const turnId = compactTerminalRecoveryText(input.turnId, 40);
    /** @type {Array<{ label: string; value: string; role: 'muted' | 'warn' | 'command' } | null>} */
    const rows = [
        {
            label: 'Estado',
            value: 'resposta humana registrada; a LLM-B encerrou sem texto publico',
            role: 'warn',
        },
        answerPreview ? { label: 'Resposta', value: answerPreview, role: 'muted' } : null,
        turnId ? { label: 'Turno', value: `turno ${turnId}`, role: 'muted' } : null,
        detail ? { label: 'Detalhe', value: detail, role: 'muted' } : null,
        { label: 'Retomar', value: EMPTY_AFTER_USER_INPUT_RESUME_COMMAND, role: 'command' },
        { label: 'Diagnóstico', value: EMPTY_AFTER_USER_INPUT_DIAGNOSTIC_COMMANDS, role: 'command' },
        input.includeModelSwitch
            ? { label: 'Alternativa', value: `${EMPTY_AFTER_USER_INPUT_MODEL_COMMAND} para trocar modelo`, role: 'command' }
            : null,
    ];
    /** @type {Array<{ label: string; value: string; role: 'muted' | 'warn' | 'command' }>} */
    const visibleRows = [];
    for (const row of rows) {
        if (row && row.value.length > 0) visibleRows.push(row);
    }
    return visibleRows;
}

/**
 * @param {{
 *     detail?: unknown;
 *     showIds?: boolean;
 *     requestId?: unknown;
 * }} [input]
 * @returns {string}
 */
export function summarizeEmptyAfterUserInputRecovery(input = {}) {
    const detail = compactTerminalRecoveryText(input.detail, 120) || 'continuação pós-pergunta terminou sem texto público';
    const requestId = compactTerminalRecoveryText(input.requestId, 14);
    return [
        detail,
        input.showIds && requestId ? `req ${requestId}` : null,
        `retomar ${EMPTY_AFTER_USER_INPUT_RESUME_COMMAND}`,
        `diagnóstico ${EMPTY_AFTER_USER_INPUT_DIAGNOSTIC_COMMANDS}`,
    ]
        .filter(Boolean)
        .join(' · ');
}
