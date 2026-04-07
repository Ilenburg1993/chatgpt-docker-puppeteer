// @ts-check
/**
 * Contrato de plugin para Agents do Copilot.
 *
 * Define a interface mínima que um Agent plugin deve implementar para ser registrado e utilizado pelo sistema. O
 * {@link AlwaysAliveAgent} satisfaz este contrato.
 *
 * @module copilot/sdk/agent-contract
 */

/**
 * Interface mínima de um Agent plugin.
 *
 * Agents são componentes de longa duração que mantêm sessão com o Copilot SDK, processam mensagens, gerenciam tools e
 * emitem eventos.
 *
 * @typedef {Object} AgentPlugin
 * @property {'stopped' | 'starting' | 'idle' | 'processing' | 'cooldown'} status Estado do ciclo de vida do agente.
 * @property {() => Promise<void>} start Inicializa o agente: cria/restaura sessão, registra tools, inicia event loop.
 * @property {(opts?: { shutdownTimeoutMs?: number }) => Promise<void>} stop Encerra o agente gracefully: flush de
 *   pendências, persiste estado, libera recursos.
 * @property {(message: string, opts?: SendMessageOptions) => Promise<string>} sendMessage Envia uma mensagem ao LLM e
 *   retorna a resposta. Enfileira se já houver mensagem em processamento.
 * @property {() => AgentStatusSnapshot} getStatusSnapshot Retorna snapshot do estado atual do agente (modelo, sessão,
 *   métricas, etc.).
 * @property {(event: string, listener: (...args: any[]) => void) => void} on Registra listener para evento do agente.
 * @property {(event: string, listener: (...args: any[]) => void) => void} off Remove listener de evento do agente.
 * @property {(event: string, ...args: any[]) => boolean} emit Emite evento do agente.
 */

/**
 * Opções para {@link AgentPlugin.sendMessage}.
 *
 * @typedef {Object} SendMessageOptions
 * @property {number} [timeoutMs] - Timeout em ms para a resposta.
 * @property {{ type: string; data: string }[]} [attachments] - Anexos para o turno.
 * @property {AbortSignal} [signal] - Sinal de cancelamento.
 */

/**
 * Snapshot do estado atual do agente.
 *
 * @typedef {Object} AgentStatusSnapshot
 * @property {'stopped' | 'starting' | 'idle' | 'processing' | 'cooldown'} status
 * @property {string} [sessionId] - ID da sessão ativa.
 * @property {string} model - Modelo LLM em uso.
 * @property {number} sendCount - Total de mensagens enviadas.
 * @property {number} queueDepth - Mensagens na fila.
 * @property {number} uptimeMs - Tempo desde o start.
 */

/**
 * Eventos que um Agent plugin deve emitir.
 *
 * | Evento          | Payload                            | Quando                         |
 * | --------------- | ---------------------------------- | ------------------------------ |
 * | `ready`         | `{ sessionId, isResumed }`         | Após start() bem-sucedido      |
 * | `task.queued`   | `{ taskId }`                       | Mensagem enfileirada           |
 * | `task.delta`    | `{ taskId, chunk }`                | Chunk de streaming recebido    |
 * | `task.done`     | `{ taskId, response, durationMs }` | Resposta completa recebida     |
 * | `task.error`    | `{ taskId, error }`                | Erro ao processar mensagem     |
 * | `agent.metrics` | `AgentStatusSnapshot`              | Snapshot periódico de métricas |
 * | `agent.stopped` | `{ reason }`                       | Após stop() concluído          |
 * | `session.error` | `{ error, context }`               | Erro de sessão SDK             |
 *
 * @typedef {'ready'
 *     | 'task.queued'
 *     | 'task.delta'
 *     | 'task.done'
 *     | 'task.error'
 *     | 'agent.metrics'
 *     | 'agent.stopped'
 *     | 'session.error'} AgentEvent
 */

export {};
