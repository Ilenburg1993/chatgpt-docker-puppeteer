// @ts-check
/**
 * src/copilot/sdk/models/stats-tracker.js
 *
 * F40.4 — ModelStatsTracker: rastreamento de latência, success rate e custo por modelo. Extraído de registry.js (F104)
 * para reduzir complexidade.
 *
 * @module copilot/sdk/models/stats-tracker
 */

/** @typedef {import('./registry.js').ModelStats} ModelStats */

/**
 * Rastreia métricas de performance por modelo: latência, success rate, tokens.
 */
export class ModelStatsTracker {
    /** @type {Map<string, ModelStats>} */
    #stats = new Map();

    /**
     * Retorna ou inicializa estatísticas de um modelo.
     *
     * @param {string} modelId
     * @returns {ModelStats}
     */
    _getOrCreate(modelId) {
        let s = this.#stats.get(modelId);
        if (!s) {
            s = {
                totalCalls: 0,
                successCount: 0,
                errorCount: 0,
                totalLatencyMs: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                lastCallTs: 0,
            };
            this.#stats.set(modelId, s);
        }
        return s;
    }

    /**
     * Registra uma chamada a um modelo.
     *
     * @param {string} modelId
     * @param {object} result
     * @param {number} result.latencyMs
     * @param {boolean} result.success
     * @param {number} [result.inputTokens]
     * @param {number} [result.outputTokens]
     * @returns {void}
     */
    record(modelId, { latencyMs, success, inputTokens = 0, outputTokens = 0 }) {
        const s = this._getOrCreate(modelId);
        s.totalCalls++;
        if (success) s.successCount++;
        else s.errorCount++;
        s.totalLatencyMs += latencyMs;
        s.totalInputTokens += inputTokens;
        s.totalOutputTokens += outputTokens;
        s.lastCallTs = Date.now();
    }

    /**
     * Retorna estatísticas de um modelo.
     *
     * @param {string} modelId
     * @returns {{ avgLatencyMs: number; successRate: number; totalCalls: number; totalTokens: number } | null}
     */
    getStats(modelId) {
        const s = this.#stats.get(modelId);
        if (!s || s.totalCalls === 0) return null;
        return {
            avgLatencyMs: Math.round(s.totalLatencyMs / s.totalCalls),
            successRate: s.successCount / s.totalCalls,
            totalCalls: s.totalCalls,
            totalTokens: s.totalInputTokens + s.totalOutputTokens,
        };
    }

    /**
     * Retorna estatísticas de todos os modelos.
     *
     * @returns {{
     *     modelId: string;
     *     avgLatencyMs: number;
     *     successRate: number;
     *     totalCalls: number;
     *     totalTokens: number;
     * }[]}
     */
    allStats() {
        /**
         * @type {{
         *     modelId: string;
         *     avgLatencyMs: number;
         *     successRate: number;
         *     totalCalls: number;
         *     totalTokens: number;
         * }[]}
         */
        const result = [];
        for (const [modelId, s] of this.#stats) {
            if (s.totalCalls === 0) continue;
            result.push({
                modelId,
                avgLatencyMs: Math.round(s.totalLatencyMs / s.totalCalls),
                successRate: s.successCount / s.totalCalls,
                totalCalls: s.totalCalls,
                totalTokens: s.totalInputTokens + s.totalOutputTokens,
            });
        }
        return result;
    }

    /**
     * Limpa todas as estatísticas.
     *
     * @returns {void}
     */
    reset() {
        this.#stats.clear();
    }
}
