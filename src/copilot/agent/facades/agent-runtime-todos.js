// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-todos
 * @file Façade agent-level para projections da capacidade TODO.
 */

import { listActiveTodoSummaries } from '../ports/index.js';

/**
 * @param {{ limit?: number }} [input]
 * @returns {Promise<import('../ports/index.js').AgentTodoSummary[]>}
 */
export function readAgentRuntimeTodoSummaries(input = {}) {
    return listActiveTodoSummaries(input);
}
