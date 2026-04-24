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
 * @typedef {'ready' | 'reply' | 'stopped' | 'question'} PendingQuestionKind
 */

/**
 * @typedef {'fresh' | 'active' | 'expiring_soon' | 'expired'} PendingQuestionShadowState
 */

/**
 * @typedef {Object} PendingQuestionMeta
 * @property {PendingQuestionKind} kind - Semântica observável do ask_user atual.
 * @property {number} askedAt - Timestamp em ms em que a pergunta foi recebida.
 * @property {boolean} allowFreeform - Se o SDK aceita resposta livre.
 * @property {boolean} protocolControlled - `true` quando a pergunta faz parte do protocolo do dialog loop.
 * @property {string[]} [choices] - Opções disponíveis (se houver).
 */

/**
 * @typedef {Object} PendingQuestionShadow
 * @property {string} question - Texto persistido da pergunta pendente.
 * @property {PendingQuestionMeta} meta - Metadados semânticos persistidos para recovery/observabilidade.
 * @property {number} restoredAt - Timestamp em ms do momento em que a shadow foi restaurada no boot atual.
 * @property {number} expiresAt - Timestamp em ms após o qual a shadow é considerada expirada/não respondível.
 */

/**
 * @typedef {Object} PendingQuestion
 * @property {string} question - Texto da pergunta
 * @property {string[]} [choices] - Opções disponíveis (se houver)
 * @property {boolean} allowFreeform - Se permite resposta livre
 * @property {(answer: string) => void} resolve - Resolver a Promise do SDK
 * @property {number} askedAt - Timestamp em ms
 * @property {PendingQuestionKind} kind - Classificação semântica da pergunta no protocolo do dialog loop.
 * @property {boolean} protocolControlled - `true` quando a pergunta foi emitida como parte do protocolo READY/REPLY.
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
 * @property {PendingQuestionShadow | null} pendingQuestionShadow - Sombra persistida de `ask_user`, restaurada do
 *   state-io apenas para observabilidade/recovery hints.
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
 *
 * @property {AgentBootReport | null} lastBootReport - Último relatório consolidado do pipeline de boot.
 */

/**
 * Subestado de IO do `AgentContext`.
 *
 * @typedef {Object} AgentIOState
 * @property {CopilotClient | null} client - Cliente Copilot ativo.
 */

/**
 * Contrato mínimo de EventEmitter exigido pelos submódulos do agent.
 *
 * Mantido propositalmente pequeno para reduzir casts `unknown -> EventEmitter` em módulos como dialog e messaging.
 *
 * @typedef {Object} AgentEventHost
 * @property {(event: string | symbol, payload?: unknown) => boolean} emit
 * @property {((event: string | symbol, listener: (...args: any[]) => void) => void) | undefined} [on]
 * @property {((event: string | symbol, listener: (...args: any[]) => void) => void) | undefined} [once]
 * @property {((event: string | symbol, listener: (...args: any[]) => void) => void) | undefined} [off]
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
 * @property {{
 *     question: string;
 *     choices?: string[];
 *     allowFreeform: boolean;
 *     askedAt: number;
 *     kind: PendingQuestionKind;
 *     protocolControlled: boolean;
 * } | null} pendingQuestion
 *   - Pergunta pendente viva do modelo (ou null)
 *
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
 * @typedef {'runtime.stopped'
 *     | 'client.missing'
 *     | 'session.missing'
 *     | 'dialog.detached'
 *     | 'io.pending_question_drift'
 *     | 'io.pending_question_shadow'
 *     | 'io.pending_question_shadow_expiring_soon'
 *     | 'io.pending_question_shadow_expired'
 *     | 'io.keepalive_stopped'
 *     | 'background.backlog_high'
 *     | 'boot.failed'
 *     | 'boot.degraded'
 *     | 'quota.monitor_missing'
 *     | 'sdk.resources_incomplete'
 *     | 'queue.starvation'} AgentHealthRiskFlag
 */

/**
 * @typedef {'none'
 *     | 'restart_agent'
 *     | 'recreate_client'
 *     | 'recreate_session'
 *     | 'reattach_dialog'
 *     | 'resolve_pending_question'
 *     | 'review_pending_question_shadow'
 *     | 'clear_pending_question_shadow'
 *     | 'restart_keepalive'
 *     | 'drain_background_tasks'
 *     | 'inspect_boot_report'
 *     | 'restart_quota_monitor'
 *     | 'inspect_sdk_resources'
 *     | 'inspect_queue_starvation'} AgentRecommendedAction
 */

/**
 * Resultado observável de uma etapa do pipeline de boot do agent.
 *
 * @typedef {Object} AgentBootStepResult
 * @property {string} name
 * @property {'session'
 *     | 'observability'
 *     | 'lifecycle'
 *     | 'dialog'
 *     | 'mcp'
 *     | 'keepalive'
 *     | 'quota'
 *     | 'handoff'
 *     | 'hooks'
 *     | 'other'} phase
 * @property {'ok' | 'degraded' | 'failed' | 'skipped'} status
 * @property {number} durationMs
 * @property {number} ts
 * @property {string} [error]
 */

/**
 * Relatório consolidado do último boot do agent.
 *
 * @typedef {Object} AgentBootReport
 * @property {number} startedAt
 * @property {number} completedAt
 * @property {boolean} ok
 * @property {number} stepCount
 * @property {number} degradedCount
 * @property {number} failedCount
 * @property {AgentBootStepResult[]} steps
 */

/**
 * Handles crus do SDK atualmente acoplados ao runtime do agent.
 *
 * @typedef {Object} AgentSdkHandles
 * @property {CopilotClient | null} client
 * @property {CopilotSession | null} session
 * @property {unknown | null} serverRpc
 * @property {unknown | null} sessionRpc
 * @property {string | null} workspacePath
 */

/**
 * Snapshot verificável da cobertura de recursos SDK disponíveis ao agent.
 *
 * @typedef {Object} AgentSdkAccessSnapshot
 * @property {AgentSdkHandles} handles
 * @property {{
 *     clientAvailable: boolean;
 *     sessionAvailable: boolean;
 *     serverRpcAvailable: boolean;
 *     sessionRpcAvailable: boolean;
 *     workspacePathAvailable: boolean;
 *     permissionHandlerAvailable: boolean;
 *     userInputHandlerAvailable: boolean;
 *     hooksAvailable: boolean;
 *     toolRegistryAvailable: boolean;
 *     modelSwitchAvailable: boolean;
 *     abortAvailable: boolean;
 *     sessionLogAvailable: boolean;
 *     historyAvailable: boolean;
 *     lastSessionLookupAvailable: boolean;
 *     foregroundControlAvailable: boolean;
 *     customAgentsAvailable: boolean;
 *     experimentalAgentsAvailable: boolean;
 *     skillsAvailable: boolean;
 *     mcpAvailable: boolean;
 *     pluginsAvailable: boolean;
 *     extensionsAvailable: boolean;
 *     fleetAvailable: boolean;
 * }} resources
 * @property {string[]} missingResources
 * @property {boolean} allCoreResourcesAvailable
 * @property {boolean} allRuntimeResourcesAvailable
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
 * @property {PendingQuestionKind | null} pendingQuestionKind - Classificação da pergunta pendente, quando houver.
 * @property {boolean} pendingQuestionShadow - Indica se existe sombra persistida de `ask_user` restaurada do disco.
 * @property {PendingQuestionKind | null} pendingQuestionShadowKind - Classificação da sombra persistida, quando houver.
 * @property {PendingQuestionShadowState | null} pendingQuestionShadowState - Estado semântico atual da shadow
 *   persistida.
 * @property {boolean} pendingQuestionShadowExpired - Indica se a shadow persistida já expirou e não é mais respondível.
 * @property {number | null} pendingQuestionShadowAgeMs - Idade atual da shadow persistida em ms.
 * @property {number | null} pendingQuestionShadowExpiresAt - Timestamp em ms de expiração da shadow persistida.
 * @property {number | null} pendingQuestionShadowRemainingMs - Tempo restante em ms até a expiração da shadow.
 * @property {number} queueSize - Tamanho atual da fila do agente.
 * @property {number} oldestTaskWaitMs - Idade da tarefa mais antiga na fila.
 * @property {boolean} starvationAlert - Indica se a fila entrou em starvation.
 * @property {number} backgroundPendingCount - Quantidade de tarefas fire-and-forget em aberto.
 * @property {string[]} backgroundPendingLabels - Labels das tarefas em background ainda pendentes.
 * @property {AgentHealthRiskFlag[]} riskFlags - Flags canônicas de risco derivadas do estado atual.
 * @property {AgentRecommendedAction} recommendedAction - Próxima ação operacional recomendada para troubleshooting.
 * @property {number | null} uptime - Tempo em ms desde `startedAt`, quando disponível.
 * @property {string[]} issues - Lista canônica de issues operacionais detectadas na coleta.
 * @property {AgentBootReport | null} bootReport - Último relatório de boot conhecido, quando disponível.
 * @property {AgentSdkAccessSnapshot | null} sdkResources - Cobertura verificável dos recursos SDK expostos ao agent.
 * @property {{
 *     runtime: { ok: boolean; status: AgentStatus; operational: boolean };
 *     client: { ok: boolean; available: boolean };
 *     session: { ok: boolean; active: boolean; resumed: boolean };
 *     dialog: { ok: boolean; active: boolean; attached: boolean; paused: boolean };
 *     queue: { ok: boolean; size: number; oldestTaskWaitMs: number; starvationAlert: boolean };
 *     io: {
 *         ok: boolean;
 *         pendingQuestion: boolean;
 *         pendingQuestionKind: PendingQuestionKind | null;
 *         pendingQuestionShadow: boolean;
 *         pendingQuestionShadowKind: PendingQuestionKind | null;
 *         pendingQuestionShadowState: PendingQuestionShadowState | null;
 *         pendingQuestionShadowExpired: boolean;
 *         pendingQuestionShadowAgeMs: number | null;
 *         pendingQuestionShadowExpiresAt: number | null;
 *         pendingQuestionShadowRemainingMs: number | null;
 *         waitingForInput: boolean;
 *         keepaliveRunning: boolean;
 *         backgroundPendingCount: number;
 *     };
 *     background: { ok: boolean; pendingCount: number; warnThreshold: number; labels: string[] };
 *     sdkResources: {
 *         ok: boolean;
 *         available: boolean;
 *         allCoreResourcesAvailable: boolean | null;
 *         allRuntimeResourcesAvailable: boolean | null;
 *         missingResources: string[];
 *     };
 *     boot: {
 *         ok: boolean;
 *         reportAvailable: boolean;
 *         failedSteps: number;
 *         degradedSteps: number;
 *         lastCompletedAt: number | null;
 *     };
 *     quota: { ok: boolean; configured: boolean; running: boolean };
 * }} checks
 *   - Checks canônicos usados por rotas e diagnósticos.
 *
 * @property {number} ts - Timestamp da coleta.
 */

// ─── Host Interfaces (contratos internos para módulos extraídos) ──────────────

/**
 * Canal mínimo de eventos que o runtime do agent expõe para submódulos internos.
 *
 * Aqui o termo "host" significa "adapter de capacidades" e não "o AlwaysAliveAgent inteiro". Cada subsistema recebe
 * apenas o pedaço do runtime de que realmente precisa.
 *
 * @typedef {Object} AgentEventChannel
 * @property {(event: string | symbol, payload?: unknown) => boolean} emit
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => void} on
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => void} once
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => void} off
 */

/**
 * Host mínimo consumido pelo executor de turno do dialog loop.
 *
 * Responsabilidade:
 *
 * - observar se existe um `ask_user` vivo;
 * - responder esse `ask_user` sem abrir novo PR;
 * - expor eventos auxiliares (`assistant.message`, `assistant.turn_end`) usados apenas como fallback semântico quando o
 *   modelo deriva do protocolo `REPLY:`.
 *
 * Não é o agent inteiro; é a menor capability suficiente para o caminho quente de `sendDialogTurn()`.
 *
 * @typedef {Object} DialogTurnHost
 * @property {() => boolean} hasPendingQuestion
 * @property {(message: string) => boolean} answerPendingQuestion
 * @property {(() => {
 *           question: string;
 *           allowFreeform: boolean;
 *           askedAt: number;
 *           kind: PendingQuestionKind;
 *           protocolControlled: boolean;
 *           choices?: string[];
 *       } | null)
 *     | undefined} [getPendingQuestionSnapshot]
 * @property {((event: string | symbol, listener: (...args: any[]) => void) => void) | undefined} [on]
 * @property {((event: string | symbol, listener: (...args: any[]) => void) => void) | undefined} [once]
 * @property {((event: string | symbol, listener: (...args: any[]) => void) => void) | undefined} [off]
 * @property {(() => string | null) | undefined} [getSessionId]
 * @property {(() => string) | undefined} [getModel]
 * @property {(task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>} [trackBackgroundTask]
 */

/**
 * Host interno consumido pelo `DialogLoopManager`.
 *
 * Ele estende `DialogTurnHost` com capacidades de boot (`sendMessageDialogBoot`) e governança de modelo (`setModel`).
 * Esse adapter é construído por `agent-dialog-controller` a partir do host público do agent.
 *
 * @typedef {Object} DialogLoopHost
 * @property {(message: string, opts?: { timeoutMs?: number }) => Promise<string>} sendMessage
 * @property {(message: string, opts?: { timeoutMs?: number }) => Promise<string>} sendMessageDialogBoot
 * @property {() => boolean} hasPendingQuestion
 * @property {(message: string) => boolean} answerPendingQuestion
 * @property {() => {
 *     question: string;
 *     allowFreeform: boolean;
 *     askedAt: number;
 *     kind: PendingQuestionKind;
 *     protocolControlled: boolean;
 *     choices?: string[];
 * } | null} getPendingQuestionSnapshot
 * @property {((event: string | symbol, listener: (...args: any[]) => void) => void) | undefined} [on]
 * @property {((event: string | symbol, listener: (...args: any[]) => void) => void) | undefined} [once]
 * @property {((event: string | symbol, listener: (...args: any[]) => void) => void) | undefined} [off]
 * @property {() => string | null} getSessionId
 * @property {() => string} getModel
 * @property {(modelId: string) => void} [setModel]
 * @property {(task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>} [trackBackgroundTask]
 */

/**
 * Contrato do host exigido pelo módulo lifecycle (agentStart, agentStop, initSession).
 *
 * @typedef {Object} LifecycleHost
 * @property {(event: string | symbol, payload?: unknown) => boolean} emit
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => void} on
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => void} off
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
 * Host público consumido pelo controller do dialog (`dialogStart`, `dialogStop`, `dialogResume`).
 *
 * Este é o host "externo" do subsistema: representa o agent/live runtime e é o ponto a partir do qual o controller
 * constrói um `DialogLoopHost` menor para o manager.
 *
 * @typedef {Object} DialogHost
 * @property {(event: string | symbol, payload?: unknown) => boolean} emit
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => void} on
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => void} once
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => void} off
 * @property {string | null} sessionId
 * @property {(msg: string, opts?: object) => Promise<string>} sendMessage
 * @property {(msg: string, opts?: object) => Promise<string>} sendMessageDialogBoot
 * @property {(answer: string) => boolean} answerPendingQuestion
 */

/**
 * Contrato do host exigido pelo módulo messaging (sendMessage, enqueueTask, etc.).
 *
 * @typedef {Object} MessagingHost
 * @property {(event: string | symbol, payload?: unknown) => boolean} emit
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
 * @property {PendingQuestion | null | undefined} [pendingQuestion] - Pergunta viva do SDK, quando houver.
 * @property {PendingQuestionShadow | null | undefined} [pendingQuestionShadow] - Sombra persistida do ask_user, quando
 *   houver.
 * @property {PendingQuestionKind | null | undefined} [pendingQuestionKind] - Classificação da pergunta viva atual.
 * @property {PendingQuestionKind | null | undefined} [pendingQuestionShadowKind] - Classificação da sombra persistida
 *   restaurada.
 * @property {PendingQuestionShadowState | null | undefined} [pendingQuestionShadowState] - Estado semântico atual da
 *   shadow persistida.
 * @property {boolean | undefined} [pendingQuestionShadowExpired] - Indica se a shadow persistida já expirou.
 * @property {number | null | undefined} [pendingQuestionShadowAgeMs] - Idade atual da shadow persistida em ms.
 * @property {number | null | undefined} [pendingQuestionShadowExpiresAt] - Timestamp de expiração da shadow, quando
 *   houver.
 * @property {number | null | undefined} [pendingQuestionShadowRemainingMs] - Tempo restante até a expiração da shadow.
 * @property {(() => boolean) | undefined} [clearPendingQuestionShadow] - Limpa a shadow persistida de `ask_user`
 *   restaurada do disco.
 * @property {boolean} [dialogLoopActive] - Indica se o dialog loop está ativo
 * @property {() => AgentStatusSnapshot} getStatusSnapshot - Retorna o snapshot completo do status
 * @property {(() => AgentHealthSnapshot) | undefined} getHealthSnapshot - Retorna o snapshot consolidado de health
 * @property {(() => AgentSdkHandles) | undefined} getSdkHandles - Retorna os handles crus do SDK atualmente acoplados
 * @property {(() => AgentSdkAccessSnapshot) | undefined} getSdkResourceSnapshot - Retorna um snapshot verificável da
 *   cobertura de recursos SDK
 * @property {(() => {
 *           name: string;
 *           description: string | null;
 *           category: string;
 *           tags: string[];
 *           readOnly: boolean;
 *           skipPermission: boolean;
 *       }[])
 *     | undefined} getToolRegistryEntriesSnapshot
 *   - Retorna uma projeção serializável das tools registradas no runtime
 *
 * @property {boolean | undefined} [dialogPaused] - Indica se o dialog loop está pausado
 * @property {() => Promise<void>} start - Inicia o agente (conecta ao SDK e começa a processar a fila)
 * @property {(opts?: { shutdownTimeoutMs?: number }) => Promise<void>} stop - Para o agente graciosamente
 * @property {(() => Promise<import('#copilot/sdk/types').ModeResult>) | undefined} getSdkSessionMode - Retorna o modo
 *   vanilla atual da sessão SDK
 * @property {((mode: 'interactive' | 'plan' | 'autopilot') => Promise<import('#copilot/sdk/types').ModeResult>)
 *     | undefined} setSdkSessionMode
 *   - Altera o modo vanilla da sessão SDK
 *
 * @property {(() => Promise<import('#copilot/sdk/types').PlanReadResult>) | undefined} readSdkPlan - Lê o plan.md
 *   vanilla da sessão SDK
 * @property {((content: string) => Promise<object>) | undefined} updateSdkPlan - Atualiza o plan.md vanilla da sessão
 *   SDK
 * @property {(() => Promise<object>) | undefined} deleteSdkPlan - Remove o plan.md vanilla da sessão SDK
 * @property {(
 *     message: string,
 *     opts?: {
 *         timeoutMs?: number;
 *         attachments?: import('#copilot/sdk/types').MessageOptions['attachments'];
 *         signal?: AbortSignal;
 *         taskId?: string;
 *     },
 * ) => Promise<string>} sendMessage
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
 * @property {(() => Promise<{ message: string; timestamp: number; protocolVersion?: number }>) | undefined} pingSdk -
 *   Executa ping no client SDK atual
 * @property {(() => Promise<import('#copilot/sdk/types').GetStatusResponse>) | undefined} getSdkStatus - Retorna status
 *   do SDK/CLI atual
 * @property {(() => Promise<import('#copilot/sdk/types').GetAuthStatusResponse>) | undefined} getSdkAuthStatus -
 *   Retorna status de autenticação do SDK/CLI atual
 * @property {(() => Promise<string | undefined>) | undefined} getLastSdkSessionId - Retorna a última sessão conhecida
 *   pelo SDK atual
 * @property {(() => Promise<string | undefined>) | undefined} getForegroundSdkSessionId - Retorna a sessão em
 *   foreground do SDK atual
 * @property {((sessionId: string) => Promise<void>) | undefined} setForegroundSdkSessionId - Define a sessão em
 *   foreground do SDK atual
 * @property {((
 *           filter?: import('#copilot/sdk/types').SessionListFilter,
 *       ) => Promise<import('#copilot/sdk/types').SessionMetadata[]>)
 *     | undefined} listSdkSessions
 *   - Lista sessões conhecidas pelo SDK atual
 *
 * @property {(() => Promise<unknown>) | undefined} listSdkAgents - Lista agentes customizados disponíveis na sessão
 *   atual
 * @property {(() => Promise<unknown>) | undefined} getCurrentSdkAgent - Retorna o agente customizado ativo na sessão
 *   atual
 * @property {((name: string) => Promise<unknown>) | undefined} selectSdkAgent - Seleciona um agente customizado na
 *   sessão atual
 * @property {(() => Promise<unknown>) | undefined} deselectSdkAgent - Remove a seleção do agente customizado atual
 * @property {(() => Promise<unknown>) | undefined} reloadSdkAgents - Recarrega agentes customizados na sessão atual
 */

export {};
