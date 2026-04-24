// @ts-check
/**
 * @module copilot/dialog/protocol
 * @file Contrato puro do protocolo READY/REPLY usado entre o dialog loop e as bordas.
 *
 *   Este módulo não pertence ao `agent/`: ele define a linguagem compartilhada do loop. O agent executa o runtime; o
 *   terminal apenas filtra sinais de protocolo para não apresentá-los como perguntas reais ao usuário.
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

/** @type {string} */
export const DIALOG_PROTO_READY = 'READY:';

/** @type {string} */
export const DIALOG_PROTO_REPLY = 'REPLY:';

/** @type {string} */
export const DIALOG_PROTO_DONE = 'DONE:';

/** @type {string} */
export const DIALOG_PROTO_STOPPED = 'STOPPED';

/**
 * Protocolo do Dialog Loop — análise e extração de mensagens `ask_user` do modelo.
 */
export class DialogProtocol {
    /**
     * @param {string} question
     * @returns {boolean}
     */
    static isProtocolMessage(question) {
        return this.classify(question) !== 'question';
    }

    /**
     * @param {string} question
     * @returns {DialogMessageKind}
     */
    static classify(question) {
        const trimmed = question.trim();
        if (/^READY(?::|$)/i.test(trimmed)) {
            return 'ready';
        }
        if (/^(REPLY:|DONE:)/i.test(trimmed)) {
            return 'reply';
        }
        if (/^(STOPPED|STOP_DIALOG)$/i.test(trimmed)) {
            return 'stopped';
        }
        return 'question';
    }

    /**
     * @param {string} question
     * @returns {string}
     */
    static extractReply(question) {
        return question
            .trim()
            .replace(/^(REPLY:|DONE:)\s*/i, '')
            .trim();
    }

    /**
     * @param {object} opts
     * @param {string} [opts.firstMessage]
     * @returns {string}
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
