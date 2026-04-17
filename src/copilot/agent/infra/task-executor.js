// @ts-check
/**
 * @module copilot/agent/infra/task-executor
 * @file Shim de compatibilidade para `executeTask()`.
 *
 *   A implementação canônica da L2.3 agora vive em `agent/messaging/agent-messaging.js`, junto da cadeia real de
 *   enfileiramento/processamento. Este módulo é mantido temporariamente para preservar imports legados durante a
 *   migração.
 * @see EventBus
 */

/** @typedef {import('../messaging/agent-messaging.js').TaskExecutorCallbacks} TaskExecutorCallbacks */
/** @typedef {import('../messaging/agent-messaging.js').QueuedTask} QueuedTask */

export { executeTask } from '../messaging/agent-messaging.js';
