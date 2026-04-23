// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-todos
 * @file Façade agent-level para projections da capacidade TODO.
 */

import { listActiveTodoSummaries } from '../ports/todo-port.js';

/**
 * @param {{ limit?: number }} [input]
 * @returns {Promise<import('../ports/todo-port.js').AgentTodoSummary[]>}
 */
export function readAgentRuntimeTodoSummaries(input = {}) {
    return listActiveTodoSummaries(input);
}
