// @ts-check
/**
 * src/copilot/tools/todo/index.js
 *
 * Barrel — re-exporta todas as todo tools agrupadas e o store para acesso direto.
 *
 * @module copilot/tools/todo
 */

export { todoBulkUpdateTool, todoClearCompletedTool, todoImportTool } from './bulk-tools.js';

export {
    todoAddSubtaskTool,
    todoCreateTool,
    todoDeleteTool,
    todoGetTool,
    todoSetStatusTool,
    todoUpdateTool,
} from './crud-tools.js';

export { todoListTool, todoSearchTool, todoStatsTool } from './query-tools.js';

// ---------------------------------------------------------------------------
// Arrays agrupados (compatibilidade com consumidores antigos)
// @deprecated F33.1: Preferir imports nomeados individuais.
// ---------------------------------------------------------------------------

import { todoBulkUpdateTool, todoClearCompletedTool, todoImportTool } from './bulk-tools.js';
import {
    todoAddSubtaskTool,
    todoCreateTool,
    todoDeleteTool,
    todoGetTool,
    todoSetStatusTool,
    todoUpdateTool,
} from './crud-tools.js';
import { todoListTool, todoSearchTool, todoStatsTool } from './query-tools.js';

/**
 * Tools de leitura (skipPermission: true) — não modificam estado.
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const todoReadTools = [todoGetTool, todoListTool, todoSearchTool, todoStatsTool];

/**
 * Tools de escrita (requerem aprovação) — modificam estado.
 *
 * @type {import('@github/copilot-sdk').Tool[]}
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
 * Conjunto completo das 12 todo tools.
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const todoTools = [...todoReadTools, ...todoWriteTools];
