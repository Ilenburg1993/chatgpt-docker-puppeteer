// @ts-check
/**
 * src/copilot/agent/dialog/protocol.js
 *
 * Protocolo de comunicação do Dialog Loop.
 *
 * Centraliza as constantes de protocolo, a lógica de classificação de mensagens `ask_user` e a extração de conteúdo de
 * REPLY/DONE. Exposto como `DialogProtocol` para permitir testes unitários isolados, sem depender de
 * `AlwaysAliveAgent`.
 *
 * @module copilot/agent/dialog/protocol
 * @see module:copilot/agent/dialog/loop-manager
 * @see module:copilot/channel/client
 */

/** @typedef {'ready' | 'reply' | 'stopped' | 'question'} DialogMessageKind */

/**
 * Constantes de classificação de mensagens do dialog loop.
 *
 * @type {Readonly<Record<string, DialogMessageKind>>}
 */
export const MESSAGE_KIND = /** @type {const} */ ({
    READY: 'ready',
    REPLY: 'reply',
    STOPPED: 'stopped',
    QUESTION: 'question',
});

/**
 * Prefixo que o modelo usa ao sinalizar prontidão para o próximo turno.
 *
 * @type {string}
 */
export const DIALOG_PROTO_READY = 'READY:';

/**
 * Prefixo que o modelo usa ao enviar uma resposta ao usuário.
 *
 * @type {string}
 */
export const DIALOG_PROTO_REPLY = 'REPLY:';

/**
 * Prefixo alternativo que encerra a resposta e indica término da cadeia corrente.
 *
 * @type {string}
 */
export const DIALOG_PROTO_DONE = 'DONE:';

/**
 * String que indica ao agente que o modelo está encerrando o loop (não permitido em produção).
 *
 * @type {string}
 */
export const DIALOG_PROTO_STOPPED = 'STOPPED';

/**
 * Protocolo do Dialog Loop — análise e extração de mensagens `ask_user` do modelo.
 *
 * Todos os métodos são estáticos; a classe serve como namespace testável.
 */
export class DialogProtocol {
    /**
     * Classifica uma mensagem `ask_user` emitida pelo modelo em uma das 4 categorias:
     *
     * - `'ready'` — modelo sinalizou prontidão (READY:)
     * - `'reply'` — modelo enviou uma resposta (REPLY: / DONE:)
     * - `'stopped'` — modelo tentou encerrar o loop (STOPPED / STOP_DIALOG)
     * - `'question'` — mensagem normal do usuário ou formato desconhecido
     *
     * @param {string} question - La questão bruta recebida de `onUserInputRequest`
     * @returns {DialogMessageKind}
     */
    static classify(question) {
        const trimmed = question.trim();
        if (trimmed.startsWith(DIALOG_PROTO_READY) || trimmed === 'READY') {
            return 'ready';
        }
        if (trimmed.startsWith(DIALOG_PROTO_REPLY) || trimmed.startsWith(DIALOG_PROTO_DONE)) {
            return 'reply';
        }
        if (trimmed.startsWith(DIALOG_PROTO_STOPPED) || trimmed === 'STOP_DIALOG') {
            return 'stopped';
        }
        return 'question';
    }

    /**
     * Extrai o conteúdo da resposta do modelo de uma mensagem `ask_user` classificada como `'reply'`. Remove os
     * prefixos `REPLY:` ou `DONE:` (case-insensitive) do início da string.
     *
     * @param {string} question - Mensagem de ask_user de kind 'reply'
     * @returns {string} Conteúdo da resposta sem o prefixo
     */
    static extractReply(question) {
        return question
            .trim()
            .replace(/^(REPLY:|DONE:)\s*/i, '')
            .trim();
    }

    /**
     * Constrói o metaPrompt de boot do dialog loop, instruindo o modelo a seguir o protocolo.
     *
     * @param {object} opts
     * @param {string} [opts.firstMessage] - Primeira mensagem a responder após o boot (opcional)
     * @returns {string} Metaprompt completo
     */
    static buildBootPrompt(opts = {}) {
        const lines = [
            `Você está em modo de diálogo permanente. Siga este protocolo EXATAMENTE:`,
            ``,
            `1. Chame ask_user("${DIALOG_PROTO_READY} aguardando próxima mensagem") para sinalizar prontidão.`,
            `2. Quando receber uma mensagem, processe-a completamente.`,
            `3. Chame ask_user("${DIALOG_PROTO_REPLY} " + sua_resposta) para enviar a resposta.`,
            `4. Retorne ao passo 1 para aguardar a próxima mensagem.`,
            ``,
            `IMPORTANTE: NUNCA encerre o loop. Não use ask_user("${DIALOG_PROTO_STOPPED}") nem qualquer forma de`,
            `encerramento. Se não houver mais nada para fazer, aguarde indefinidamente com READY:.`,
        ];
        if (opts.firstMessage) {
            lines.push(``, `Primeira mensagem a processar: ${opts.firstMessage}`);
        }
        return lines.join('\n');
    }
}
