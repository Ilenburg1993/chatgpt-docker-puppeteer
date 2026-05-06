// @ts-check
/**
 * @module copilot/core/interfaces
 * @file Contratos de interface canônicos para o sistema Copilot.
 *
 *   Faixa 3.2 — AC-5: Missing Abstractions.
 *
 *   Define as 7 interfaces que permitem desacoplamento por polimorfismo nos módulos de camada alta. Todas as interfaces
 *   são JSDoc `@typedef` — zero runtime overhead.
 *
 *   Convenção de nomenclatura: `I<NomeConceito>` (prefixo I = Interface).
 *
 *   ## Interfaces exportadas
 *
 *   | Interface | Implementação canônica | Camada | | ----------------- | ---------------------------------------- |
 *   -------------- | | IAgent | `agent/always-alive.js` | agent/ | | IEventBus | `core/event-bus.js::EventBus` | core/
 *   | | IStateStore | `agent/session/state/snapshot.js` | agent/session/ | | IToolRegistry |
 *   `sdk/tools/registry.js::ToolRegistry` | sdk/ | | IHooksPipeline | `hooks/types.js::SessionHooks` | hooks/ | |
 *   IConfigProvider | `config/env.js` (flat constants) | config/ | | IMetricsCollector |
 *   `observability/metrics.js::MetricsStore` | observability/ |
 *
 *   src/copilot/core/interfaces.js
 */

// ─── Re-imports de tipos dependentes ──────────────────────────────────────────

/** @typedef {import('../events/base-events.js').BaseEvent} BaseEvent */

// ═══════════════════════════════════════════════════════════════════════════════
// AC-5-01 — IAgent (facade contract)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Interface pública do agente de IA.
 *
 * Permite trocar a implementação concreta (`AlwaysAliveAgent`) por mocks em testes ou implementações alternativas.
 * Desacopla serviços de camadas superiores da implementação.
 *
 * @typedef {object} IAgent
 * @property {string} status - Status operacional atual: `'idle' | 'processing' | 'starting' | 'stopped'`
 * @property {string | null} sessionId - ID da sessão SDK ativa (null quando desconectado)
 * @property {number} queueSize - Número de tasks na fila de processamento
 * @property {boolean} [dialogLoopActive] - Se o dialog loop está ativo
 * @property {() => Promise<void>} start - Conecta ao SDK e inicia o processamento
 * @property {(opts?: { shutdownTimeoutMs?: number }) => Promise<void>} stop - Para o agente graciosamente
 * @property {(
 *     message: string,
 *     opts?: { timeoutMs?: number | null; attachments?: unknown; signal?: AbortSignal; taskId?: string },
 * ) => Promise<unknown>} sendMessage
 *   - Envia mensagem ao modelo
 *
 * @property {(answer: string) => boolean} answerPendingQuestion - Responde pergunta pendente do SDK
 * @property {(bootPrompt?: string) => Promise<void>} startDialogLoop - Inicia o dialog loop contínuo
 * @property {(opts?: { authorized?: boolean; reason?: string; shutdownTimeoutMs?: number }) => Promise<void>} stopDialogLoop
 *   - Para o dialog loop
 *
 * @property {() => Record<string, unknown>} getStatusSnapshot - Snapshot completo do estado do agente
 * @property {(event: string, listener: (...args: unknown[]) => void) => unknown} on - Registra listener de evento
 * @property {(event: string, listener: (...args: unknown[]) => void) => unknown} off - Remove listener de evento
 * @property {() => Record<string, number>} listenerDiagnostics - Diagnóstico de listeners por evento
 * @see module:copilot/agent/always-alive
 * @see module:copilot/agent/types.IAlwaysAliveAgent
 */

// ═══════════════════════════════════════════════════════════════════════════════
// AC-5-02 — IEventBus
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Middleware para o pipeline do EventBus.
 *
 * @callback EventBusMiddleware
 * @param {BaseEvent} event
 * @param {() => void} next
 * @returns {void}
 */

/**
 * Interface do bus de eventos cross-module.
 *
 * Permite trocar a implementação (`EventBus`) por mocks em testes ou adaptadores como NERV bus, EventEmitter legado ou
 * implementações in-memory.
 *
 * @typedef {object} IEventBus
 * @property {(eventType: string, handler: (event: BaseEvent) => void | Promise<void>) => () => void} on
 *
 *   - Inscreve handler; retorna função de unsubscribe
 *
 * @property {(eventType: string, handler: (event: BaseEvent) => void | Promise<void>) => () => void} once
 *
 *   - Inscreve handler de disparo único; retorna função de unsubscribe
 *
 * @property {(event: { type: string; timestamp?: number; [key: string]: unknown }) => void} emit
 *
 *   - Emite evento (passa por middleware antes dos handlers)
 *
 * @property {(fn: EventBusMiddleware) => void} use
 *
 *   - Adiciona middleware ao pipeline
 *
 * @property {(eventType: string) => number} count
 *
 *   - Retorna quantas vezes um evento foi emitido
 *
 * @property {() => Record<string, number>} stats
 *
 *   - Snapshot dos contadores de todos os eventos
 *
 * @property {() => string[]} channels
 *
 *   - Lista event types com pelo menos 1 subscriber ativo
 *
 * @property {() => void} dispose
 *
 *   - Libera todos os listeners e middleware
 *
 * @see module:copilot/core/event-bus
 */

// ═══════════════════════════════════════════════════════════════════════════════
// AC-5-03 — IStateStore
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Item de listagem de snapshot.
 *
 * @typedef {object} StateStoreListItem
 * @property {string} snapshotId - Identificador único
 * @property {number} createdAt - Timestamp de criação (ms)
 * @property {string} [reason] - Motivo do snapshot
 */

/**
 * Interface de persistência de estado do agente.
 *
 * Permite abstrair a camada de armazenamento (file system, SQLite, Redis, in-memory para testes). Implementação
 * canônica: funções em `agent/session/state/snapshot.js`.
 *
 * @typedef {object} IStateStore
 * @property {(opts: {
 *     sessionId: string | null;
 *     model: string;
 *     status: string;
 *     sendCount: number;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     pendingQuestion: string | null;
 *     reason?: string;
 * }) => Record<string, unknown>} createSnapshot
 *   - Cria snapshot sem persisti-lo
 *
 * @property {(snapshot: Record<string, unknown>) => Promise<void>} saveSnapshot
 *
 *   - Persiste snapshot no armazenamento
 *
 * @property {(snapshotId?: string) => Promise<Record<string, unknown> | null>} loadSnapshot
 *
 *   - Carrega snapshot por ID (ou mais recente se omitido)
 *
 * @property {() => Promise<StateStoreListItem[]>} listSnapshots
 *
 *   - Lista todos os snapshots disponíveis
 *
 * @see module:copilot/agent/session/snapshot
 */

// ═══════════════════════════════════════════════════════════════════════════════
// AC-5-04 — IToolRegistry
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Entrada de uma ferramenta no registry.
 *
 * @typedef {object} ToolRegistryEntry
 * @property {unknown} tool - Instância da ferramenta SDK (`@github/copilot-sdk::Tool`)
 * @property {string} category - Categoria funcional (ex: `'code'`, `'git'`, `'session'`)
 * @property {string[]} [tags] - Tags adicionais para filtro
 * @property {boolean} [readOnly] - Se a ferramenta não modifica estado externo
 */

/**
 * Interface do registry de ferramentas.
 *
 * Permite registrar, filtrar e inspecionar ferramentas sem acoplamento à implementação concreta. Implementação
 * canônica: `sdk/tools/registry.js`.
 *
 * @typedef {object} IToolRegistry
 * @property {Map<string, ToolRegistryEntry>} entries - Mapa de nome → ToolRegistryEntry
 * @property {(tool: unknown, meta?: { category?: string; tags?: string[]; readOnly?: boolean }) => void} register
 *
 *   - Registra uma ferramenta individual
 *
 * @property {(category: string) => unknown[]} getByCategory
 *
 *   - Retorna ferramentas filtradas por categoria
 *
 * @property {(tag: string) => unknown[]} getByTag
 *
 *   - Retorna ferramentas filtradas por tag
 *
 * @property {(names: string[]) => IToolRegistry} filter
 *
 *   - Retorna novo registry contendo apenas as ferramentas listadas
 *
 * @property {() => unknown[]} list
 *
 *   - Retorna todas as ferramentas registradas
 *
 * @property {() => { total: number; byCategory: Record<string, number> }} stats
 *
 *   - Estatísticas do registry
 *
 * @see module:copilot/sdk/tools-registry
 */

// ═══════════════════════════════════════════════════════════════════════════════
// AC-5-05 — IHooksPipeline
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Interface do pipeline de hooks do Copilot SDK.
 *
 * Abstrai os 6 slots de hooks do SDK (`onPreToolUse`, `onPostToolUse`, etc.) para que serviços de camada alta (agent,
 * server) possam compô-los sem depender de implementações concretas. Implementação canônica:
 * `hooks/types.js::SessionHooks`.
 *
 * @typedef {object} IHooksPipeline
 * @property {((...args: unknown[]) => Promise<unknown> | unknown) | undefined} [onPreToolUse]
 *
 *   - Intercepta chamada de ferramenta antes da execução
 *
 * @property {((...args: unknown[]) => Promise<unknown> | unknown) | undefined} [onPostToolUse]
 *
 *   - Intercepta resultado de ferramenta após execução
 *
 * @property {((...args: unknown[]) => Promise<unknown> | unknown) | undefined} [onUserPromptSubmitted]
 *
 *   - Intercepta prompt do usuário antes de enviar ao modelo
 *
 * @property {((...args: unknown[]) => Promise<unknown> | unknown) | undefined} [onSessionStart]
 *
 *   - Callback de início de sessão SDK
 *
 * @property {((...args: unknown[]) => Promise<void> | void) | undefined} [onSessionEnd]
 *
 *   - Callback de encerramento de sessão SDK
 *
 * @property {((...args: unknown[]) => Promise<unknown> | unknown) | undefined} [onErrorOccurred]
 *
 *   - Callback de erro no processamento do modelo
 *
 * @see module:copilot/hooks/types
 * @see module:copilot/hooks/factory
 */

// ═══════════════════════════════════════════════════════════════════════════════
// AC-5-06 — IConfigProvider
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Interface de acesso a configuração.
 *
 * Abstrai a fonte de configuração (env vars, arquivo, remote config service) para que módulos internos possam ser
 * configurados sem ler `process.env` diretamente. Implementação canônica: valores flat exportados de `config/env.js`.
 *
 * @typedef {object} IConfigProvider
 * @property {(key: string) => string | undefined} getString
 *
 *   - Lê uma configuração como string (undefined se ausente)
 *
 * @property {(key: string, fallback: number) => number} getInt
 *
 *   - Lê uma configuração como inteiro (retorna fallback se ausente ou inválido)
 *
 * @property {(key: string) => boolean} getBool
 *
 *   - Lê uma configuração como boolean (`'true'`/`'1'`/`'yes'` → true)
 *
 * @property {(key: string) => boolean} has
 *
 *   - Retorna true se a chave está definida e não vazia
 *
 * @see module:copilot/config/env
 */

// ═══════════════════════════════════════════════════════════════════════════════
// AC-5-07 — IMetricsCollector
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Interface do coletor de métricas do sistema.
 *
 * Permite trocar a implementação (histogramas em memória, OTEL, Prometheus, in-memory para testes) sem alterar os
 * módulos que registram eventos. Implementação canônica: `observability/metrics.js::MetricsStore`.
 *
 * @typedef {object} IMetricsCollector
 * @property {(toolName: string, durationMs: number, success: boolean) => void} recordToolCall
 *
 *   - Registra chamada de ferramenta com latência e resultado
 *
 * @property {(model: string, input?: number, output?: number, cacheRead?: number, cacheWrite?: number) => void} recordUsage
 *   - Registra uso de tokens por modelo
 *
 * @property {() => void} recordSessionStart - Início de sessão SDK
 * @property {() => void} recordSessionEnd - Encerramento de sessão SDK
 * @property {() => void} recordSessionError - Erro durante sessão
 * @property {() => void} recordHandoff - Transição de handoff
 * @property {(durationMs: number, success: boolean) => void} recordDialogTurn - Turn do dialog loop interno
 * @property {(durationMs: number, success: boolean) => void} recordSdkDialogTurn - Turn concluído pelo SDK/base model
 * @property {(durationMs: number, success: boolean, outcome?: 'completed' | 'timeout' | 'error') => void} recordInjectTurn
 *   - Resultado da borda HTTP `/inject`
 *
 * @property {(stalledMs: number) => void} recordDialogStall - Dialog loop parado
 * @property {(name: string, delta?: number) => void} recordCounter - Contador genérico
 * @property {(name: string, value: number) => void} recordGauge - Gauge genérico
 * @property {() => Record<string, unknown>} getSummary - Resumo de todas as métricas
 * @property {() => void} reset - Zera todos os contadores
 * @see module:copilot/observability/metrics
 */

export {};
