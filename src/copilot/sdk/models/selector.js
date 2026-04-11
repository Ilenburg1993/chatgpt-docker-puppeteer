// @ts-check
/**
 * src/copilot/sdk/models/selector.js
 *
 * F40.2 — ModelSelector + F40.6 — AutoDowngradeDetector. Heurística de seleção dinâmica e detecção de downgrade
 * automático. Extraído de registry.js (F104) para reduzir complexidade.
 *
 * @module copilot/sdk/models/selector
 * @see EventBus
 */

import { log } from '../logger.js';
import { COST_ORDER, SPEED_ORDER } from './known-models.js';

/** @typedef {import('./registry.js').ModelMeta} ModelMeta */
/** @typedef {import('./registry.js').SelectionCriteria} SelectionCriteria */
/** @typedef {import('./stats-tracker.js').ModelStatsTracker} ModelStatsTracker */
/** @typedef {import('./registry.js').ModelRegistry} ModelRegistry */

/**
 * Seleciona o melhor modelo com base em critérios e métricas históricas.
 */
export class ModelSelector {
    /** @type {ModelRegistry} */
    #registry;

    /** @type {ModelStatsTracker} */
    #stats;

    /**
     * @param {ModelRegistry} registry
     * @param {ModelStatsTracker} stats
     */
    constructor(registry, stats) {
        this.#registry = registry;
        this.#stats = stats;
    }

    /**
     * Seleciona o melhor modelo disponível com base nos critérios fornecidos.
     *
     * @param {SelectionCriteria} criteria
     * @param {string[]} [availableIds]
     * @returns {ModelMeta | undefined}
     */
    select(criteria, availableIds) {
        let candidates = this.#registry.filter(criteria);

        if (availableIds) {
            const available = new Set(availableIds);
            candidates = candidates.filter((m) => available.has(m.id));
        }

        if (candidates.length === 0) return undefined;

        if (criteria.prefer) {
            const preferred = candidates.find(
                (m) => m.id === criteria.prefer || this.#registry.resolveId(criteria.prefer ?? '') === m.id,
            );
            if (preferred) return preferred;
        }

        return this._scoreAndSort(candidates, criteria)[0];
    }

    /**
     * Retorna os top-N modelos ordenados por adequação.
     *
     * @param {SelectionCriteria} criteria
     * @param {number} [n=3] Default is `3`
     * @param {string[]} [availableIds]
     * @returns {ModelMeta[]}
     */
    topN(criteria, n = 3, availableIds) {
        let candidates = this.#registry.filter(criteria);
        if (availableIds) {
            const available = new Set(availableIds);
            candidates = candidates.filter((m) => available.has(m.id));
        }
        return this._scoreAndSort(candidates, criteria).slice(0, n);
    }

    /**
     * Calcula score composto e ordena (maior score = melhor candidato).
     *
     * @param {ModelMeta[]} candidates
     * @param {SelectionCriteria} criteria
     * @returns {ModelMeta[]}
     */
    _scoreAndSort(candidates, criteria) {
        /** @type {{ model: ModelMeta; score: number }[]} */
        const scored = candidates.map((model) => {
            let score = 0;

            const costScore = 4 - COST_ORDER[model.costTier];
            if (criteria.preferLowCost) score += costScore * 3;

            const speedScore = SPEED_ORDER[model.speedTier];
            if (criteria.preferFast) score += speedScore * 3;

            if (model.contextWindow >= 500_000) score += 2;
            else if (model.contextWindow >= 128_000) score += 1;

            const stats = this.#stats.getStats(model.id);
            if (stats) {
                score += Math.round(stats.successRate * 3);
                if (stats.avgLatencyMs < 1000) score += 2;
                else if (stats.avgLatencyMs < 3000) score += 1;
            }

            return { model, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.map((s) => s.model);
    }

    /**
     * Sugere fallback: retorna o modelo mais barato e rápido diferente do atual.
     *
     * @param {string} currentModelId
     * @param {string[]} [availableIds]
     * @returns {ModelMeta | undefined}
     */
    suggestFallback(currentModelId, availableIds) {
        return this.select(
            {
                preferLowCost: true,
                preferFast: true,
                exclude: [currentModelId],
            },
            availableIds,
        );
    }
}

/**
 * Detecta modelo lento e sinaliza switch automático.
 */
export class AutoDowngradeDetector {
    /** @type {ModelStatsTracker} */
    #stats;

    /** @type {ModelSelector} */
    #selector;

    /** @type {number} */
    #latencyThresholdMs;

    /** @type {number} */
    #minSuccessRate;

    /** @type {number} */
    #minCalls;

    /**
     * @param {ModelStatsTracker} stats
     * @param {ModelSelector} selector
     * @param {object} [options]
     * @param {number} [options.latencyThresholdMs=5000] Default is `5000`
     * @param {number} [options.minSuccessRate=0.7] Default is `0.7`
     * @param {number} [options.minCalls=3] Default is `3`
     */
    constructor(stats, selector, options = {}) {
        this.#stats = stats;
        this.#selector = selector;
        this.#latencyThresholdMs = options.latencyThresholdMs ?? 5000;
        this.#minSuccessRate = options.minSuccessRate ?? 0.7;
        this.#minCalls = options.minCalls ?? 3;
    }

    /**
     * Avalia se o modelo atual deve ser trocado.
     *
     * @param {string} currentModelId
     * @param {string[]} [availableIds]
     * @returns {{ shouldDowngrade: boolean; reason?: string; suggestedModel?: ModelMeta }}
     */
    evaluate(currentModelId, availableIds) {
        const stats = this.#stats.getStats(currentModelId);
        if (!stats || stats.totalCalls < this.#minCalls) {
            return { shouldDowngrade: false };
        }

        if (stats.avgLatencyMs > this.#latencyThresholdMs) {
            const suggested = this.#selector.suggestFallback(currentModelId, availableIds);
            if (suggested) {
                log(
                    'INFO',
                    `[AutoDowngrade] Modelo ${currentModelId} lento (avg=${stats.avgLatencyMs}ms > ${this.#latencyThresholdMs}ms). Sugerindo ${suggested.id}.`,
                );
                return {
                    shouldDowngrade: true,
                    reason: `latency_high (avg=${stats.avgLatencyMs}ms)`,
                    suggestedModel: suggested,
                };
            }
        }

        if (stats.successRate < this.#minSuccessRate) {
            const suggested = this.#selector.suggestFallback(currentModelId, availableIds);
            if (suggested) {
                log(
                    'INFO',
                    `[AutoDowngrade] Modelo ${currentModelId} baixa taxa de sucesso (${(stats.successRate * 100).toFixed(1)}% < ${(this.#minSuccessRate * 100).toFixed(1)}%). Sugerindo ${suggested.id}.`,
                );
                return {
                    shouldDowngrade: true,
                    reason: `success_rate_low (${(stats.successRate * 100).toFixed(1)}%)`,
                    suggestedModel: suggested,
                };
            }
        }

        return { shouldDowngrade: false };
    }
}
