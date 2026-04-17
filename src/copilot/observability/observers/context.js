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
 * Há dois modos de uso:
 *
 * - **Modo emitter (legado)**: `agent` é o EventEmitter real do agente; `on` registra listeners diretamente nele.
 * - **Modo bus (FAIXA-L14)**: `agent` é `null` (sem emitter); `on` ignora o primeiro argumento e registra no EventBus via
 *   mapeamento SSOT em `event-name-map.js`.
 *
 * Os handler groups (`dialog-task-handlers.js`, `session-agent-handlers.js`) funcionam em ambos os modos sem
 * modificação, pois apenas chamam `on(agent, event, listener)` e a semântica de `on` é resolvida externamente.
 *
 * @typedef {object} ObserverContext
 * @property {import('../metrics.js').MetricsStore} metrics
 * @property {import('../error-tracker.js').ErrorTracker | null | undefined} errorTracker
 * @property {import('node:events').EventEmitter | null} agent EventEmitter do agente (modo emitter) ou `null` (modo
 *   bus — sem emitter disponível).
 * @property {{
 *           record: (
 *               model: string,
 *               stats: { latencyMs: number; success: boolean; inputTokens?: number; outputTokens?: number },
 *           ) => void;
 *       }
 *     | null
 *     | undefined} [modelStatsTracker]
 *   Tracker de estatísticas de modelo (injetado pelo caller que tem acesso ao sdk/).
 * @property {(
 *     emitter: import('node:events').EventEmitter | null,
 *     event: string,
 *     listener: (...args: any[]) => void,
 * ) => void} on
 *   Registra listener e armazena para cleanup. Em modo emitter, registra no EventEmitter recebido. Em modo bus, ignora
 *   `emitter` e registra no EventBus via mapeamento SSOT.
 * @property {(fn: (...args: any[]) => void, context: string) => (...args: any[]) => void} safe Wrapper que captura
 *   erros nos handlers.
 */
