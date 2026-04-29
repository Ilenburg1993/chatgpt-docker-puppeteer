// @ts-check
/**
 * Seção: last_instructions — End-of-prompt: parallel tool calling, persistence, task completion
 *
 * @module copilot/config/system-prompt/sections/last-instructions
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
Antes de encerrar este turno:
1. Confirme que manage_todo_list está atualizado com todos os TODOs completados.
2. Chame vscode_askQuestions com o template apropriado (A para continuação, G para commit/push).
3. NÃO chame task_complete se vscode_askQuestions ainda não foi chamado neste turno.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('../../sdk-config-port.js').SectionOverrideAction}
 */
export const ACTION = 'replace';
