// @ts-check
/**
 * @module copilot/presentation/runtime-todos
 * @file Projection de estado declarativo/operacional das TODO tools para bordas.
 *
 *   `tools/todo` continua dono da persistência e das mutações da capacidade. Bordas consomem apenas projections deste
 *   módulo, sem abrir o store diretamente.
 */

import { readAgentRuntimeTodoSummaries } from '#copilot/agent';

/**
 * @typedef {{
 *     id: string;
 *     title: string;
 *     status: string;
 * }} RuntimeTodoSummary
 */

/**
 * Lista tarefas ativas em formato estável para diagnósticos de borda.
 *
 * @param {{ limit?: number }} [input]
 * @returns {Promise<RuntimeTodoSummary[]>}
 */
export async function listActiveRuntimeTodosProjection(input = {}) {
    return readAgentRuntimeTodoSummaries(input);
}
