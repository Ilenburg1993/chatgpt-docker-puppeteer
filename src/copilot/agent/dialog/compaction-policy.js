// @ts-check
/**
 * @module copilot/agent/dialog/compaction-policy
 * @file Policy de solicitação de compaction baseada no orçamento de tokens.
 *
 *   O manager do loop continua emitindo eventos. Esta policy decide somente se o budget observado deve gerar uma
 *   solicitação proativa ou crítica, mantendo o dedupe de compaction proativa fora do orquestrador.
 */

/**
 * @typedef {{ currentTokens: number; tokenLimit: number; ratio: number }} DialogTokenBudget
 *
 * @typedef {{
 *     currentTokens: number;
 *     tokenLimit: number;
 *     ratio: number;
 *     urgency: 'critical' | 'proactive';
 * }} DialogCompactionRequest
 */

/**
 * Policy de thresholds para compaction do dialog loop.
 */
export class DialogCompactionPolicy {
    /** @type {boolean} */
    #proactiveRequested = false;

    /**
     * Avalia o budget atual.
     *
     * Regras compatíveis:
     *
     * - `ratio >= 95`: emite sempre `critical` e libera nova emissão proativa futura;
     * - `ratio >= 90`: emite uma vez `proactive` até `reset()`;
     * - abaixo disso: não emite.
     *
     * @param {DialogTokenBudget} budget
     * @returns {DialogCompactionRequest | null}
     */
    evaluate({ currentTokens, tokenLimit, ratio }) {
        if (ratio >= 95) {
            this.#proactiveRequested = false;
            return { currentTokens, tokenLimit, ratio, urgency: 'critical' };
        }

        if (ratio >= 90 && !this.#proactiveRequested) {
            this.#proactiveRequested = true;
            return { currentTokens, tokenLimit, ratio, urgency: 'proactive' };
        }

        return null;
    }

    /**
     * Libera nova emissão proativa após uma compaction concluída.
     */
    reset() {
        this.#proactiveRequested = false;
    }
}
