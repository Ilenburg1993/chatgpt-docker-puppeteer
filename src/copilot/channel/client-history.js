// @ts-check
/**
 * src/copilot/channel/client-history.js
 *
 * Funções utilitárias de histórico extraídas de LlmBridgeClient.
 *
 * @module copilot/channel/client-history
 */

/**
 * @typedef {import('./client.js').ConversationTurn} ConversationTurn
 */

/**
 * Retorna os últimos N pares (user + assistant) de um array de histórico.
 *
 * Cursor-based: navega do fim para o início sem arrays intermediários.
 * Opção `summarize: true` trunca conteúdo a 200 chars para economia de tokens.
 *
 * @param {ReadonlyArray<ConversationTurn>} history
 * @param {number} [pairs=5]
 * @param {{ summarize?: boolean }} [opts]
 * @returns {ReadonlyArray<ConversationTurn>}
 */
export function getLastNPairs(history, pairs = 5, opts = {}) {
    const hist = /** @type {ConversationTurn[]} */ (/** @type {unknown} */ (history));
    /** @type {{ user: ConversationTurn; assistant: ConversationTurn }[]} */
    const collected = [];
    let i = hist.length - 1;
    while (i >= 0 && collected.length < pairs) {
        const cur = hist[i];
        if (cur?.role === 'assistant') {
            const j = i - 1;
            const prev = j >= 0 ? hist[j] : undefined;
            if (prev?.role === 'user') {
                collected.unshift({ user: prev, assistant: cur });
                i = j - 1;
                continue;
            }
        }
        i--;
    }
    /** @type {ConversationTurn[]} */
    let result;
    if (!collected.length) {
        result = /** @type {ConversationTurn[]} */ (hist.slice(-pairs * 2));
    } else {
        result = collected.flatMap(({ user, assistant }) => [user, assistant]);
    }
    if (opts.summarize) {
        result = result.map((t) => ({
            ...t,
            content: t.content.length > 200 ? t.content.slice(0, 200) + '…' : t.content,
        }));
    }
    return /** @type {ReadonlyArray<ConversationTurn>} */ (result);
}
