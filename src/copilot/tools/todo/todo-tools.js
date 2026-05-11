// @ts-check
/**
 * src/copilot/tools/todo/todo-tools.js
 *
 * Agregador concreto do subdomínio `todo`. Mantido fora de `index.js` para preservar a regra arquitetural de
 * barrel-only.
 *
 * @module copilot/tools/todo/todo-tools
 */

import { todoBulkUpdateTool, todoClearCompletedTool, todoImportTool } from './bulk-tools.js';
import { todoAddSubtaskTool, todoGetTool, todoUpdateTool } from './crud-tools.js';
import { todoListTool, todoSearchTool, todoStatsTool } from './query-tools.js';
import { todoCreateTool, todoDeleteTool, todoSetStatusTool } from './todo-write-tools.js';

/**
 * Tools de leitura (skipPermission: true) — não modificam estado.
 *
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const todoReadTools = [todoGetTool, todoListTool, todoSearchTool, todoStatsTool];

/**
 * Tools de escrita (requerem aprovação) — modificam estado.
 *
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const todoWriteTools = [
    todoCreateTool,
    todoUpdateTool,
    todoSetStatusTool,
    todoDeleteTool,
    todoAddSubtaskTool,
    todoBulkUpdateTool,
    todoClearCompletedTool,
    todoImportTool,
];

/**
 * Conjunto completo das todo tools.
 *
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const todoTools = [...todoReadTools, ...todoWriteTools];
