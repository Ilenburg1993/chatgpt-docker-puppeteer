// @ts-check
/**
 * src/copilot/agent/types.js
 *
 * Typedefs centralizados do subsistema agent. Elimina importações circulares de tipos entre módulos (status-snapshot,
 * dialog/loop-manager, session/event-wirer ↔ always-alive).
 *
 * @module copilot/agent/types
 * @see EventBus
 */

// ─── SDK Re-exports ──────────────────────────────────────────────────────────

/**
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 *
 * @typedef {import('#copilot/sdk/types').CopilotClient} CopilotClient
 */

// ─── Agent Status ─────────────────────────────────────────────────────────────

/**
 * @typedef {'idle' | 'processing' | 'waiting_for_input' | 'starting' | 'stopped'} AgentStatus
 */

// ─── PendingQuestion ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} PendingQuestion
 * @property {string} question - Texto da pergunta
 * @property {string[]} [choices] - Opções disponíveis (se houver)
 * @property {boolean} allowFreeform - Se permite resposta livre
 * @property {(answer: string) => void} resolve - Resolver a Promise do SDK
 * @property {number} askedAt - Timestamp em ms
 */

// ─── AgentContext Partitioning (K1a) ───────────────────────────────────────

/**
 * Subestado de sessão do `AgentContext`.
 *
 * @typedef {Object} AgentSessionState
 * @property {CopilotSession | null} session - Sessão ativa do SDK.
 * @property {boolean} isReconnecting - Indica se há reconnect em andamento.
 * @property {(() => void)[]} sessionEventUnsubscribers - Callbacks de unsubscribe registrados no boot.
 * @property {boolean} isResumed - Indica se a sessão atual foi retomada.
 * @property {{ tokens: number; tokenLimit: number; utilization: number } | null} contextState - Uso real de contexto.
 * @property {string | null} lastCheckpointPath - Último checkpoint persistido pelo SDK.
 */

/**
 * Subestado de diálogo do `AgentContext`.
 *
 * @typedef {Object} AgentDialogState
 * @property {PendingQuestion | null} pendingQuestion - Pergunta pendente do SDK aguardando resposta.
 * @property {boolean} dialogLoopAttached - Flag de idempotência do wiring do dialog loop.
 */

/**
 * Subestado de configuração do `AgentContext`.
 *
 * @typedef {Object} AgentConfigState
 * @property {string} model - Modelo atual em uso.
 * @property {'low' | 'medium' | 'high' | 'xhigh' | undefined} reasoningEffort - Nível atual de reasoning.
 * @property {{
 *     buildTools: () => Promise<import('#copilot/sdk/types').Tool<any>[]>;
 *     buildConfig: () => Record<string, unknown>;
 *     startAutoReconnect: (onTools: (tools: import('#copilot/sdk/types').Tool<any>[]) => void) => () => void;
 * } | null} mcpBridge
 *   - Dependências MCP injetáveis.
 */

/**
 * Subestado de métricas/cache do `AgentContext`.
 *
 * @typedef {Object} AgentMetricsState
 * @property {number} sendCount - Total de mensagens enviadas nesta sessão.
 * @property {{ snapshot: AgentStatusSnapshot; at: number } | null} statusSnapshotCache - Cache temporário do snapshot.
 * @property {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null} lastPrInfo
 *   - Último snapshot de billing/quota.
 */

/**
 * Subestado de runtime/lifecycle do `AgentContext`.
 *
 * @typedef {Object} AgentRuntimeState
 * @property {AgentStatus} status - Estado atual do agente.
 * @property {ReturnType<typeof setInterval> | null} metricsTimer - Timer de emissão periódica de métricas.
 * @property {(() => void) | null} mcpReconnectCancel - Cancel do auto-reconnect MCP.
 * @property {import('#copilot/sdk/quota-monitor').QuotaMonitor | null} quotaMonitor - Monitor periódico de quota.
 * @property {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void } | null} agentObserver
 *   - Observer do agente para cleanup.
 */

/**
 * Subestado de IO do `AgentContext`.
 *
 * @typedef {Object} AgentIOState
 * @property {CopilotClient | null} client - Cliente Copilot ativo.
 */

// ─── AgentTask ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AgentTask
 * @property {string} id - ID único da tarefa
 * @property {string} message - Mensagem a enviar ao modelo
 * @property {function(string): void} resolve - Callback de resolução
 * @property {function(Error): void} reject - Callback de erro
 * @property {number} enqueuedAt - Timestamp em ms
 * @property {number} [timeoutMs] - Timeout personalizado para sendAndWait (ms). undefined = usa padrão de 60s do SDK.
 * @property {import('#copilot/sdk/types').MessageOptions['attachments']} [attachments] - Anexos (arquivos, imagens,
 *   seleções) a enviar junto com a mensagem.
 */

// ─── AgentStatusSnapshot ──────────────────────────────────────────────────────

/**
 * Snapshot do estado atual do agente retornado por `getStatusSnapshot()`.
 *
 * @typedef {Object} AgentStatusSnapshot
 * @property {string} status - Estado atual do agente
 * @property {string | null} sessionId - ID da sessão ativa
 * @property {string} model - Modelo ativo
 * @property {string | undefined} reasoningEffort - Nível de esforço de raciocínio
 * @property {number} queueSize - Número de tarefas na fila
 * @property {number} oldestTaskWaitMs - Tempo de espera da tarefa mais antiga em ms
 * @property {boolean} starvationAlert - true se há tarefa esperando > 60s
 * @property {object | null} pendingQuestion - Pergunta pendente do modelo (ou null)
 * @property {boolean} isResumed - true se a sessão foi retomada
 * @property {number} resumeCount - Número de retomadas desde o início
 * @property {number} sendCount - Total de mensagens enviadas
 * @property {number | null} startedAt - Epoch ms do início da sessão
 * @property {{ tokens: number; tokenLimit: number; utilization: number } | null} contextWindow - Dados reais de uso de
 *   contexto do SDK (ou null se não disponível)
 * @property {string | null} lastCheckpointPath - Último caminho de checkpoint do SDK (ou null se nenhum ainda)
 * @property {'approve_all' | 'audit_only' | 'selective'} permissionMode - Modo de permissão ativo
 */

/**
 * @typedef {'healthy' | 'degraded' | 'unhealthy'} AgentHealthStatus
 */

/**
 * Snapshot de health operacional do agente.
 *
 * `healthy` é mantido como alias de compatibilidade para consumidores legados; `ok` é o campo canônico para semântica
 * de rota HTTP/health.
 *
 * @typedef {Object} AgentHealthSnapshot
 * @property {boolean} ok - `true` quando o agente segue operacional.
 * @property {boolean} healthy - Alias compatível de `ok`.
 * @property {AgentHealthStatus} status - Graduação operacional consolidada.
 * @property {AgentStatus} agentStatus - Status interno atual do agente.
 * @property {string | null} sessionId - SessionId ativo, quando houver.
 * @property {string} model - Modelo configurado no agente.
 * @property {string | undefined} reasoningEffort - Nível de raciocínio configurado.
 * @property {boolean} dialogLoopActive - Indica se o dialog loop está ativo.
 * @property {boolean} pendingQuestion - Indica se há pergunta pendente aguardando resposta.
 * @property {number} queueSize - Tamanho atual da fila do agente.
 * @property {number} oldestTaskWaitMs - Idade da tarefa mais antiga na fila.
 * @property {boolean} starvationAlert - Indica se a fila entrou em starvation.
 * @property {number} backgroundPendingCount - Quantidade de tarefas fire-and-forget em aberto.
 * @property {number | null} uptime - Tempo em ms desde `startedAt`, quando disponível.
 * @property {string[]} issues - Lista canônica de issues operacionais detectadas na coleta.
 * @property {{
 *     runtime: { ok: boolean; status: AgentStatus; operational: boolean };
 *     client: { ok: boolean; available: boolean };
 *     session: { ok: boolean; active: boolean; resumed: boolean };
 *     dialog: { ok: boolean; active: boolean; attached: boolean; paused: boolean };
 *     queue: { ok: boolean; size: number; oldestTaskWaitMs: number; starvationAlert: boolean };
 *     io: {
 *         ok: boolean;
 *         pendingQuestion: boolean;
 *         waitingForInput: boolean;
 *         keepaliveRunning: boolean;
 *         backgroundPendingCount: number;
 *     };
 *     background: { ok: boolean; pendingCount: number; warnThreshold: number };
 *     quota: { ok: boolean; configured: boolean; running: boolean };
 * }} checks
 *   - Checks canônicos usados por rotas e diagnósticos.
 *
 * @property {number} ts - Timestamp da coleta.
 */

// ─── Host Interfaces (contratos internos para módulos extraídos) ──────────────

/**
 * Contrato do host exigido pelo módulo lifecycle (agentStart, agentStop, initSession).
 *
 * @typedef {Object} LifecycleHost
 * @property {(event: string, payload?: unknown) => boolean} emit
 * @property {(event: string, listener: (...args: any[]) => void) => void} on
 * @property {(event: string, listener: (...args: any[]) => void) => void} off
 * @property {(event: string) => void} removeAllListeners
 * @property {string | null} sessionId
 * @property {() => AgentStatusSnapshot} getStatusSnapshot
 * @property {() => Promise<void>} resumeDialogLoop
 * @property {() => Promise<void>} startDialogLoop
 * @property {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null} dialogPrMetrics
 * @property {() => void} ensureDialogLoopAttached
 * @property {(msg: string, opts?: object) => Promise<string>} sendMessage
 * @property {(msg: string, opts?: object) => Promise<string>} sendMessageDialogBoot
 * @property {(answer: string) => boolean} answerPendingQuestion
 */

/**
 * Contrato do host exigido pelo módulo dialog (dialogStart, dialogStop, etc.).
 *
 * @typedef {Object} DialogHost
 * @property {(event: string, payload?: unknown) => boolean} emit
 * @property {(event: string, listener: (...args: any[]) => void) => void} on
 * @property {string | null} sessionId
 * @property {(msg: string, opts?: object) => Promise<string>} sendMessage
 * @property {(msg: string, opts?: object) => Promise<string>} sendMessageDialogBoot
 * @property {(answer: string) => boolean} answerPendingQuestion
 */

/**
 * Contrato do host exigido pelo módulo messaging (sendMessage, enqueueTask, etc.).
 *
 * @typedef {Object} MessagingHost
 * @property {(event: string, payload?: unknown) => boolean} emit
 */

/**
 * Contrato do host exigido pelo módulo state (getStatusSnapshot, listenerDiagnostics).
 *
 * @typedef {Object} StateHost
 * @property {string | null} sessionId
 * @property {(event: string | symbol) => number} listenerCount
 */

// ─── IAlwaysAliveAgent (contrato público) ─────────────────────────────────────

/**
 * Interface pública canônica do AlwaysAliveAgent.
 *
 * @typedef {Object} IAlwaysAliveAgent
 * @property {string} status - Status operacional atual do agente
 * @property {string | null} sessionId - ID da sessão ativa (null quando não conectado)
 * @property {number} queueSize - Número de tasks na fila
 * @property {boolean} [dialogLoopActive] - Indica se o dialog loop está ativo
 * @property {() => AgentStatusSnapshot} getStatusSnapshot - Retorna o snapshot completo do status
 * @property {(() => AgentHealthSnapshot) | undefined} getHealthSnapshot - Retorna o snapshot consolidado de health
 * @property {boolean | undefined} [dialogPaused] - Indica se o dialog loop está pausado
 * @property {() => Promise<void>} start - Inicia o agente (conecta ao SDK e começa a processar a fila)
 * @property {(opts?: { shutdownTimeoutMs?: number }) => Promise<void>} stop - Para o agente graciosamente
 * @property {(
 *     message: string,
 *     opts?: {
 *         timeoutMs?: number;
 *         attachments?: import('@github/copilot-sdk').MessageOptions['attachments'];
 *         signal?: AbortSignal;
 *         taskId?: string;
 *     },
 * ) => Promise<unknown>} sendMessage
 *   - Envia mensagem ao agente
 *
 * @property {(message: string, opts?: { timeoutMs?: number }) => Promise<string>} sendMessageDialogBoot - Envia o boot
 *   prompt ignorando o guard do dialog loop (uso exclusivo do DialogLoopManager durante boot)
 * @property {(answer: string) => boolean} answerPendingQuestion - Responde a uma pergunta pendente do SDK
 * @property {(bootPrompt?: string) => Promise<void>} startDialogLoop - Inicia o dialog loop contínuo
 * @property {(text: string, opts?: { timeout?: number }) => Promise<string>} sendDialogTurn - Envia um turn ao dialog
 *   loop
 * @property {(opts?: {
 *     authorized?: boolean;
 *     reason?: 'watchdog_restart' | 'authorized_stop';
 *     shutdownTimeoutMs?: number;
 * }) => Promise<void>} stopDialogLoop
 *   - Para o dialog loop
 *
 * @property {(() => 'approve_all' | 'audit_only' | 'selective') | undefined} getPermissionMode - Retorna o modo de
 *   permissão atual
 * @property {((
 *           mode: 'approve_all' | 'audit_only' | 'selective',
 *           opts?: { allowTools?: string[]; denyTools?: string[]; denyShell?: boolean },
 *       ) => void)
 *     | undefined} setPermissionMode
 *   - Define o modo de permissão
 *
 * @property {(event: string, listener: (...args: any[]) => void) => void} on - Inscreve listener para um evento
 * @property {(event: string, listener: (...args: any[]) => void) => void} off - Remove listener de um evento
 * @property {() => Record<string, number>} listenerDiagnostics - Retorna diagnóstico de listeners por evento
 * @property {((n: number) => void) | undefined} setMaxListeners - Define o número máximo de listeners
 * @property {((prompt: string) => Promise<string>) | undefined} steerMessage - Envia mensagem em modo steering
 */

export {};
