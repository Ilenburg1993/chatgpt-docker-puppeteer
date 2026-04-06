// @ts-check
/**
 * @module copilot/agent/events
 * @file Re-export de constantes de eventos do agente.
 *
 *   Definições canônicas agora vivem em `core/agent-events.js` (R9). Este arquivo preserva compatibilidade retroativa
 *   para importadores existentes.
 * @see module:copilot/core/agent-events
 */

export { AGENT_EVENTS, DIALOG_LOOP_EVENTS, HIGH_FREQUENCY_EVENTS, PR_CONSUMING_EVENTS } from '../core/agent-events.js';

/** @typedef {import('../core/agent-events.js').AgentEventName} AgentEventName */
