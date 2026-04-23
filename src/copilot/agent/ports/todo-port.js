// @ts-check
/**
 * @module copilot/agent/ports/todo-port
 * @file Port do agent para estado da capacidade TODO.
 *
 *   `tools/todo` mantém persistência e mutações. O agent expõe snapshots semânticos para que bordas não conheçam o store
 *   da tool diretamente.
 */

import { readStore } from '../../tools/todo/store.js';

/**
 * @typedef {{
 *     id: string;
 *     title: string;
 *     status: string;
 * }} AgentTodoSummary
 */

/**
 * @param {{ limit?: number }} [input]
 * @returns {Promise<AgentTodoSummary[]>}
 */
export async function listActiveTodoSummaries(input = {}) {
    const limit = Number.isFinite(input.limit) && Number(input.limit) > 0 ? Number(input.limit) : 5;
    const store = await readStore();
    return Object.values(store.tasks)
        .filter((task) => task.status === 'todo' || task.status === 'in_progress')
        .slice(0, limit)
        .map((task) => ({ id: task.id, title: task.title, status: task.status }));
}
