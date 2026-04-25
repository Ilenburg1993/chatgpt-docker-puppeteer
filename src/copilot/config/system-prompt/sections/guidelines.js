// @ts-check
/**
 * Seção: guidelines — Tips, behavioral best practices, behavioral guidelines
 *
 * @module copilot/config/system-prompt/sections/guidelines
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
- Siga o Protocolo de Hooks (.github/instructions/hooks-protocol.instructions.md).
- Encerre cada turno com vscode_askQuestions (Template A ou G).
- Use manage_todo_list para planejar e acompanhar tarefas.
- Leia session-briefing.md no início de cada sessão.
- Não encerre SESSION sem Template F + close_key autorizada pelo usuário.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('#copilot/sdk/types').SectionOverrideAction}
 */
export const ACTION = 'replace';
