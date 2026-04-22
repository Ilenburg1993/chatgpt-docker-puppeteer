// @ts-check
/**
 * @module copilot/agent/queue-processor
 * @file Compat shim da Fase M-03/L2.3.
 *
 *   A implementação canônica de `processQueue()` agora vive em `agent/messaging/agent-messaging.js`.
 *
 *   Nota estrutural de retrocompatibilidade: o re-enqueue interno passa por `AgentContext.unshiftMessageTask()` no
 *   processador canônico.
 * @deprecated Use `#copilot/agent` / `agent/messaging/agent-messaging.js`.
 * @see EventBus
 */

export { processQueue } from './messaging/agent-messaging.js';
