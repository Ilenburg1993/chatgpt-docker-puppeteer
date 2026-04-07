// @ts-check
/**
 * Contrato de plugin para Channels do Copilot.
 *
 * Define a interface mínima que um Channel plugin deve implementar para mediar a comunicação entre LLM-A (Copilot SDK)
 * e LLM-B (terminal interativo). O {@link LlmBridgeClient} satisfaz este contrato.
 *
 * @module copilot/sdk/channel-contract
 */

/**
 * Interface mínima de um Channel plugin.
 *
 * Channels são pontes de comunicação que conectam dois endpoints LLM, gerenciam histórico de conversa e suportam
 * mensagens estruturadas.
 *
 * @typedef {Object} ChannelPlugin
 * @property {(message: string, opts?: ChannelChatOptions) => Promise<ChannelChatResult>} chat Envia mensagem e aguarda
 *   resposta completa.
 * @property {() => ChannelTurn[]} getHistory Retorna o histórico de turnos da conversa atual.
 * @property {() => void} clearHistory Limpa o histórico de conversa.
 * @property {() => number} turnCount Retorna o número total de turnos enviados.
 */

/**
 * Opções para {@link ChannelPlugin.chat}.
 *
 * @typedef {Object} ChannelChatOptions
 * @property {(chunk: string) => void} [onDelta] - Callback para streaming de chunks.
 * @property {(question: object) => void} [onQuestion] - Callback para perguntas interativas.
 * @property {number} [timeoutMs] - Timeout em ms.
 * @property {{ type: string; data: string }[]} [attachments] - Anexos para o turno.
 */

/**
 * Resultado de uma chamada {@link ChannelPlugin.chat}.
 *
 * @typedef {Object} ChannelChatResult
 * @property {string} taskId - ID da task processada.
 * @property {string} response - Resposta completa.
 * @property {number} responseLen - Comprimento da resposta em caracteres.
 * @property {string[]} chunks - Chunks recebidos durante streaming.
 * @property {number} durationMs - Duração total em ms.
 */

/**
 * Um turno no histórico de conversa.
 *
 * @typedef {Object} ChannelTurn
 * @property {'user' | 'assistant'} role - Papel do participante.
 * @property {string} content - Conteúdo do turno.
 * @property {number} [timestamp] - Timestamp Unix em ms.
 */

export {};
