// @ts-check
/**
 * src/copilot/observability/collectors/context.js
 *
 * Tipo compartilhado de contexto para os handler groups do EventCollector.
 *
 * @module copilot/observability/collectors/context
 * @see EventBus
 */

/**
 * @typedef {import('../metrics.js').MetricsStore} MetricsStore
 *
 * @typedef {import('#copilot/hooks/bus').HookBus} HookBus
 *
 * @typedef {import('../error-tracker.js').ErrorTracker} ErrorTracker
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 */

/**
 * Contexto compartilhado passado para cada grupo de handlers do EventCollector.
 *
 * @typedef {object} CollectorContext
 * @property {CopilotSession} session - Sessão SDK ativa.
 * @property {string} sessionId - ID da sessão.
 * @property {MetricsStore | null} metrics - Store de métricas.
 * @property {ErrorTracker | null} errorTracker - Tracker de erros.
 * @property {HookBus | null} hookBus - Bus para re-emitir hooks.
 * @property {boolean} persist - Se persiste eventos em JSONL.
 * @property {ReadonlySet<string>} persistSet - Tipos de eventos a persistir.
 * @property {(entry: Record<string, unknown>) => void} persistEvent - Função de persistência.
 * @property {boolean} captureUserContent - Se captura conteúdo do usuário.
 * @property {boolean} captureAssistantContent - Se captura conteúdo do assistente.
 * @property {Map<
 *     string,
 *     { toolName: string; mcpServerName: string | null; startTs: number; toolArgs: Record<string, unknown> }
 * >} pending
 *   - Mapa de tool calls pendentes.
 *
 * @property {Map<string, number>} turnStart - Mapa de turn starts.
 */

export {};
