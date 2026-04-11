// @ts-check
/**
 * src/copilot/agent/index.js — [L4] Core agent: AlwaysAlive, session, dialog.
 *
 * Barrel de exportação do módulo `src/copilot/agent/`. Centraliza os pontos de acesso públicos do agente.
 *
 * ### API pública (para uso externo)
 *
 * | Export             | Tipo      | Descrição                                 |
 * | ------------------ | --------- | ----------------------------------------- |
 * | `alwaysAliveAgent` | Singleton | Instância principal do agente AlwaysAlive |
 * | `getAgent()`       | Function  | Accessor para o agente (lazy)             |
 * | `AlwaysAliveAgent` | Class     | Classe do agente (uso interno/testes)     |
 *
 * ### Subsistemas re-exportados
 *
 * - `dialog/` — DialogLoopManager, turn execution, backpressure, watchdog
 * - `infra/` — tools bootstrap, webhook, permission, task executor, handoff
 * - `lifecycle/` — bootstrap, connection, reconnect, state persistence
 * - `messaging/` — agent messaging facade
 * - `session/` — session initializer, event wiring, keepalive, rotation, cleanup
 * - `state/` — agent state management
 *
 * @module copilot/agent
 */

// ── Raiz ─────────────────────────────────────────────────────
export { AGENT_EVENTS, DIALOG_LOOP_EVENTS, HIGH_FREQUENCY_EVENTS, PR_CONSUMING_EVENTS } from '../core/events.js';
export { AlwaysAliveAgent, alwaysAliveAgent, getAgent } from './always-alive.js';
export {} from './types.js'; // re-exporta os typedefs: IAlwaysAliveAgent, AgentStatus, etc.

// ── Subsistemas ──────────────────────────────────────────────
export * from './dialog/index.js';
export * from './infra/index.js';
export * from './lifecycle/index.js';
export * from './messaging/index.js';
export * from './session/index.js';
export * from './state/index.js';
