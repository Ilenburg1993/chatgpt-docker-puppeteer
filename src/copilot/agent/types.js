// @ts-check
/**
 * src/copilot/agent/types.js
 *
 * Typedefs centralizados do subsistema agent. Elimina importações circulares de tipos entre módulos (status-snapshot,
 * dialog-loop-manager, session-event-wirer ↔ always-alive).
 *
 * @module copilot/agent/types
 */

// ─── SDK Re-exports ──────────────────────────────────────────────────────────

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
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

// ─── AgentTask ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AgentTask
 * @property {string} id - ID único da tarefa
 * @property {string} message - Mensagem a enviar ao modelo
 * @property {function(string): void} resolve - Callback de resolução
 * @property {function(Error): void} reject - Callback de erro
 * @property {number} enqueuedAt - Timestamp em ms
 * @property {number} [timeoutMs] - Timeout personalizado para sendAndWait (ms). undefined = usa padrão de 60s do SDK.
 * @property {import('@github/copilot-sdk').MessageOptions['attachments']} [attachments] - Anexos (arquivos, imagens,
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

// ─── IAlwaysAliveAgent (contrato público) ─────────────────────────────────────

/**
 * Interface pública canônica do AlwaysAliveAgent.
 *
 * @typedef {Object} IAlwaysAliveAgent
 * @property {string} status - Status operacional atual do agente
 * @property {string | null} sessionId - ID da sessão ativa (null quando não conectado)
 * @property {number} queueSize - Número de tasks na fila
 * @property {boolean} [dialogLoopActive] - Indica se o dialog loop está ativo
 * @property {() => Record<string, unknown>} getStatusSnapshot - Retorna o snapshot completo do status
 * @property {() => Promise<void>} start - Inicia o agente (conecta ao SDK e começa a processar a fila)
 * @property {(opts?: { shutdownTimeoutMs?: number }) => Promise<void>} stop - Para o agente graciosamente
 * @property {(
 *     message: string,
 *     opts?: { timeoutMs?: number; attachments?: any; signal?: AbortSignal; taskId?: string },
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
 * @property {(event: string, listener: (...args: any[]) => void) => any} on - Inscreve listener para um evento
 * @property {(event: string, listener: (...args: any[]) => void) => any} off - Remove listener de um evento
 * @property {() => Record<string, number>} listenerDiagnostics - Retorna diagnóstico de listeners por evento
 * @property {((n: number) => void) | undefined} setMaxListeners - Define o número máximo de listeners
 * @property {((prompt: string) => Promise<string>) | undefined} steerMessage - Envia mensagem em modo steering
 */

export {};
