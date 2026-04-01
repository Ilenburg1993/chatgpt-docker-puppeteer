// @ts-check
/**
 * src/copilot/agent/agent-contract.js
 *
 * Contratos de interface canônicos para o AlwaysAliveAgent.
 *
 * Exporta o typedef `IAlwaysAliveAgent` — a API pública mínima que qualquer consumer do agente deve utilizar, evitando
 * acoplamento direto à implementação concreta.
 *
 * Uso recomendado:
 *
 * ```js
 * // @param {import('../agent/agent-contract.js').IAlwaysAliveAgent} agent
 * ```
 *
 * @module copilot/agent/agent-contract
 */

/**
 * Interface pública canônica do AlwaysAliveAgent.
 *
 * Substitui `AlwaysAliveAgentLike` dispersa em `bridge-control.js`. Centralizar o typedef aqui faz com que alterações
 * na API pública do agente reflitam em todos os consumers.
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
 *   -
 *
 *   Envia mensagem ao agente
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
 *   - Para o dialog loop (G2-ARCH-11: timeout configurável via shutdownTimeoutMs, default 30s)
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
 */

// Este módulo é de declarações de tipos — não há código executável.
export {};
