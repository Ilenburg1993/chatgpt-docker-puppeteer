// @ts-check
/**
 * Barrel de exportação do módulo `src/copilot/agent/`.
 *
 * Centraliza os pontos de acesso públicos do agente via sub-barrels, evitando importações com caminhos profundos em
 * outros módulos do sistema.
 *
 * @module copilot/agent
 */

// ── Raiz ─────────────────────────────────────────────────────
export { AlwaysAliveAgent, alwaysAliveAgent, getAgent } from './always-alive.js';
export { AGENT_EVENTS, DIALOG_LOOP_EVENTS, HIGH_FREQUENCY_EVENTS, PR_CONSUMING_EVENTS } from './events.js';
export {} from './types.js'; // re-exporta os typedefs: IAlwaysAliveAgent, AgentStatus, etc.

// ── Subsistemas ──────────────────────────────────────────────
export * from './dialog/index.js';
export * from './infra/index.js';
export * from './lifecycle/index.js';
export * from './session/index.js';
