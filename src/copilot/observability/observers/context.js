// @ts-check
/**
 * src/copilot/observability/observers/context.js
 *
 * Tipo compartilhado entre handler groups do AgentEventObserver.
 *
 * @module copilot/observability/observers/context
 * @see EventBus
 */

/**
 * Contexto injetado nos handler groups do AgentEventObserver.
 *
 * @typedef {object} ObserverContext
 * @property {import('../metrics.js').MetricsStore} metrics
 * @property {import('../error-tracker.js').ErrorTracker | null | undefined} errorTracker
 * @property {import('node:events').EventEmitter} agent
 * @property {(emitter: import('node:events').EventEmitter, event: string, listener: (...args: any[]) => void) => void} on
 *   Registra listener e armazena para cleanup.
 * @property {(fn: (...args: any[]) => void, context: string) => (...args: any[]) => void} safe Wrapper que captura
 *   erros nos handlers.
 */
