// @ts-check
/**
 * src/copilot/core/constants.js
 *
 * Constantes centralizadas do módulo copilot.
 *
 * Centraliza valores literais que antes estavam espalhados (portas, limites,
 * nomes de eventos) para facilitar manutenção e tipagem.
 *
 * @module copilot/core/constants
 */

/**
 * Porta padrão do terminal LLM-B (servidor HTTP raw + endpoint /inject).
 * Pode ser sobrescrita via variável de ambiente `LLM_B_TERMINAL_PORT`.
 *
 * @type {number}
 */
export const LLM_B_TERMINAL_PORT = 3009;

/**
 * Tamanho máximo da fila de mensagens do AlwaysAliveAgent.
 * Quando a fila atinge este limite, novas mensagens são rejeitadas.
 *
 * @type {number}
 */
export const MAX_QUEUE_SIZE = 100;

/**
 * Nomes canônicos de eventos emitidos pelo AlwaysAliveAgent.
 * Re-exportados de agent/events.js para acesso centralizado via core/.
 *
 * @type {readonly string[]}
 */
export { AGENT_EVENTS } from '../agent/events.js';
