// @ts-check
/**
 * src/copilot/lib/model-registry.js
 *
 * F40 — Multi-Model Selection Pool.
 *
 * Fornece:
 *
 * - **ModelRegistry**: catálogo de modelos com capabilities expandidas (cost tier, speed tier, context size)
 * - **ModelSelector**: heurística de seleção dinâmica baseada em custo, velocidade, capacidade e métricas históricas
 * - **ModelStatsTracker**: rastreamento de latência, success rate e custo por modelo
 * - **AutoDowngradeDetector**: detecção de modelo lento → sinaliza switch automático
 *
 * @module copilot/lib/model-registry
 */

import { log } from '#copilot/observability/logger';

// ─── Tipos ───────────────────────────────────────────────────────────────────

/**
 * Tier de custo do modelo (quanto maior, mais caro).
 *
 * @typedef {'free' | 'low' | 'medium' | 'high' | 'premium'} CostTier
 */

/**
 * Tier de velocidade (quanto maior, mais rápido).
 *
 * @typedef {'slow' | 'medium' | 'fast'} SpeedTier
 */

/**
 * Metadata expandida de um modelo no registry.
 *
 * @typedef {object} ModelMeta
 * @property {string} id - ID do modelo (ex: 'gpt-4.1', 'claude-sonnet-4')
 * @property {CostTier} costTier - Classificação de custo
 * @property {SpeedTier} speedTier - Classificação de velocidade
 * @property {number} contextWindow - Tamanho da janela de contexto em tokens
 * @property {boolean} supportsReasoning - Suporte a reasoningEffort
 * @property {boolean} supportsVision - Suporte a visão/imagens
 * @property {string[]} [aliases] - Nomes alternativos (ex: 'gpt4' → 'gpt-4.1')
 */

/**
 * Estatísticas de performance de um modelo.
 *
 * @typedef {object} ModelStats
 * @property {number} totalCalls - Total de chamadas
 * @property {number} successCount - Chamadas com sucesso
 * @property {number} errorCount - Chamadas com erro
 * @property {number} totalLatencyMs - Latência acumulada
 * @property {number} totalInputTokens - Tokens de input acumulados
 * @property {number} totalOutputTokens - Tokens de output acumulados
 * @property {number} lastCallTs - Timestamp da última chamada
 */

/**
 * Critério de seleção para o ModelSelector.
 *
 * @typedef {object} SelectionCriteria
 * @property {boolean} [preferLowCost] - Preferir modelos mais baratos
 * @property {boolean} [preferFast] - Preferir modelos mais rápidos
 * @property {boolean} [requireReasoning] - Exigir suporte a reasoning
 * @property {boolean} [requireVision] - Exigir suporte a vision
 * @property {number} [minContextWindow] - Tamanho mínimo de contexto
 * @property {string} [prefer] - ID de modelo preferido (prioridade máxima se disponível)
 * @property {string[]} [exclude] - IDs de modelos a excluir
 */

// ─── Known model metadata (hardcoded defaults para modelos conhecidos) ───────

/**
 * Catálogo de modelos conhecidos com capabilities expandidas. Quando o SDK retorna modelos sem metadata suficiente,
 * este catálogo é usado como fallback.
 *
 * @type {ReadonlyArray<ModelMeta>}
 */
const KNOWN_MODELS = Object.freeze([
    {
        id: 'gpt-4.1',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 1_047_576,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['gpt4.1'],
    },
    {
        id: 'gpt-4.1-mini',
        costTier: /** @type {CostTier} */ ('low'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 1_047_576,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['gpt4.1-mini', 'mini'],
    },
    {
        id: 'gpt-4.1-nano',
        costTier: /** @type {CostTier} */ ('free'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 1_047_576,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['nano'],
    },
    {
        id: 'gpt-4o',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 128_000,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['4o'],
    },
    {
        id: 'gpt-4o-mini',
        costTier: /** @type {CostTier} */ ('low'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 128_000,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['4o-mini'],
    },
    {
        id: 'o3',
        costTier: /** @type {CostTier} */ ('premium'),
        speedTier: /** @type {SpeedTier} */ ('slow'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: [],
    },
    {
        id: 'o3-mini',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: false,
        aliases: [],
    },
    {
        id: 'o4-mini',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: [],
    },
    {
        id: 'claude-sonnet-4',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['claude-sonnet', 'sonnet'],
    },
    {
        id: 'claude-3.5-sonnet',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 200_000,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['sonnet-3.5'],
    },
    {
        id: 'gemini-2.5-pro',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 1_000_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['gemini-pro'],
    },
]);

// ─── Ordenação de tiers para comparação numérica ─────────────────────────────

/** @type {Record<CostTier, number>} */
const COST_ORDER = { free: 0, low: 1, medium: 2, high: 3, premium: 4 };

/** @type {Record<SpeedTier, number>} */
const SPEED_ORDER = { slow: 0, medium: 1, fast: 2 };

// ─── ModelRegistry ───────────────────────────────────────────────────────────

/**
 * Registry que combina modelos do SDK com metadata local expandida.
 */
class ModelRegistry {
    /** @type {Map<string, ModelMeta>} */
    #catalog = new Map();

    /** @type {Map<string, string>} alias → canonical id */
    #aliases = new Map();

    constructor() {
        this._loadDefaults();
    }

    /**
     * Carrega o catálogo default de modelos conhecidos.
     *
     * @returns {void}
     */
    _loadDefaults() {
        for (const meta of KNOWN_MODELS) {
            this.#catalog.set(meta.id, meta);
            if (meta.aliases) {
                for (const alias of meta.aliases) {
                    this.#aliases.set(alias, meta.id);
                }
            }
        }
    }

    /**
     * Resolve um ID ou alias para o ID canônico.
     *
     * @param {string} idOrAlias
     * @returns {string}
     */
    resolveId(idOrAlias) {
        return this.#aliases.get(idOrAlias) ?? idOrAlias;
    }

    /**
     * Retorna metadata expandida de um modelo.
     *
     * @param {string} idOrAlias
     * @returns {ModelMeta | undefined}
     */
    get(idOrAlias) {
        const id = this.resolveId(idOrAlias);
        return this.#catalog.get(id);
    }

    /**
     * Registra ou atualiza metadata de um modelo.
     *
     * @param {ModelMeta} meta
     * @returns {void}
     */
    register(meta) {
        this.#catalog.set(meta.id, meta);
        if (meta.aliases) {
            for (const alias of meta.aliases) {
                this.#aliases.set(alias, meta.id);
            }
        }
    }

    /**
     * Retorna todos os modelos registrados.
     *
     * @returns {ModelMeta[]}
     */
    all() {
        return [...this.#catalog.values()];
    }

    /**
     * Enriquece a lista do SDK com metadata local. Modelos desconhecidos recebem defaults conservadores.
     *
     * @param {{ id: string; capabilities?: { supports?: { reasoningEffort?: boolean; vision?: boolean } } }[]} sdkModels
     * @returns {ModelMeta[]}
     */
    enrichFromSdk(sdkModels) {
        /** @type {ModelMeta[]} */
        const result = [];
        for (const sdk of sdkModels) {
            const existing = this.#catalog.get(sdk.id);
            if (existing) {
                result.push(existing);
            } else {
                /** @type {ModelMeta} */
                const inferred = {
                    id: sdk.id,
                    costTier: /** @type {CostTier} */ ('medium'),
                    speedTier: /** @type {SpeedTier} */ ('medium'),
                    contextWindow: 128_000,
                    supportsReasoning: sdk.capabilities?.supports?.reasoningEffort ?? false,
                    supportsVision: sdk.capabilities?.supports?.vision ?? false,
                };
                this.register(inferred);
                result.push(inferred);
            }
        }
        return result;
    }

    /**
     * Filtra modelos por critérios.
     *
     * @param {SelectionCriteria} criteria
     * @returns {ModelMeta[]}
     */
    filter(criteria) {
        let models = this.all();
        if (criteria.requireReasoning) models = models.filter((m) => m.supportsReasoning);
        if (criteria.requireVision) models = models.filter((m) => m.supportsVision);
        if (criteria.minContextWindow) {
            const min = criteria.minContextWindow;
            models = models.filter((m) => m.contextWindow >= min);
        }
        if (criteria.exclude?.length) {
            const excluded = new Set(criteria.exclude);
            models = models.filter((m) => !excluded.has(m.id));
        }
        return models;
    }
}

// ─── ModelStatsTracker (F40.4) ───────────────────────────────────────────────

/**
 * Rastreia métricas de performance por modelo: latência, success rate, tokens.
 */
class ModelStatsTracker {
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

// ─── ModelSelector (F40.2) ──────────────────────────────────────────────────

/**
 * Seleciona o melhor modelo com base em critérios e métricas históricas.
 */
class ModelSelector {
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
     * Ordem de prioridade:
     *
     * 1. Modelo preferido (se existir e atender critérios)
     * 2. Custo (se preferLowCost) — ordena por costTier ascendente
     * 3. Velocidade (se preferFast) — ordena por speedTier descendente
     * 4. Performance histórica (avgLatencyMs, successRate)
     *
     * @param {SelectionCriteria} criteria
     * @param {string[]} [availableIds] - IDs dos modelos disponíveis (do SDK). Se omitido, usa todo o registro.
     * @returns {ModelMeta | undefined}
     */
    select(criteria, availableIds) {
        let candidates = this.#registry.filter(criteria);

        // Restringir a modelos disponíveis no SDK (se fornecido)
        if (availableIds) {
            const available = new Set(availableIds);
            candidates = candidates.filter((m) => available.has(m.id));
        }

        if (candidates.length === 0) return undefined;

        // 1. Modelo preferido tem prioridade máxima
        if (criteria.prefer) {
            const preferred = candidates.find(
                (m) => m.id === criteria.prefer || this.#registry.resolveId(criteria.prefer ?? '') === m.id,
            );
            if (preferred) return preferred;
        }

        // 2. Score composto
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

            // Custo: menor = melhor quando preferLowCost
            const costScore = 4 - COST_ORDER[model.costTier]; // 0..4
            if (criteria.preferLowCost) score += costScore * 3; // peso triplo

            // Velocidade: maior = melhor quando preferFast
            const speedScore = SPEED_ORDER[model.speedTier]; // 0..2
            if (criteria.preferFast) score += speedScore * 3; // peso triplo

            // Context window: bonus para maiores
            if (model.contextWindow >= 500_000) score += 2;
            else if (model.contextWindow >= 128_000) score += 1;

            // Métricas históricas
            const stats = this.#stats.getStats(model.id);
            if (stats) {
                // Success rate alta = bonus
                score += Math.round(stats.successRate * 3);
                // Latência baixa = bonus (inverso)
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
     * @param {string} currentModelId - Modelo atual a evitar
     * @param {string[]} [availableIds] - IDs disponíveis no SDK
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

// ─── AutoDowngradeDetector (F40.6) ──────────────────────────────────────────

/**
 * Detecta modelo lento e sinaliza switch automático.
 */
class AutoDowngradeDetector {
    /** @type {ModelStatsTracker} */
    #stats;

    /** @type {ModelSelector} */
    #selector;

    /** @type {number} Threshold de latência média para considerar "lento" (ms) */
    #latencyThresholdMs;

    /** @type {number} Threshold de success rate para considerar "problemático" */
    #minSuccessRate;

    /** @type {number} Mínimo de chamadas antes de avaliar */
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
     * Avalia se o modelo atual deve ser trocado por um mais rápido/confiável.
     *
     * @param {string} currentModelId - ID do modelo ativo
     * @param {string[]} [availableIds] - IDs do SDK
     * @returns {{ shouldDowngrade: boolean; reason?: string; suggestedModel?: ModelMeta }}
     */
    evaluate(currentModelId, availableIds) {
        const stats = this.#stats.getStats(currentModelId);
        if (!stats || stats.totalCalls < this.#minCalls) {
            return { shouldDowngrade: false };
        }

        // Check latência
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

        // Check success rate
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

// ─── Instâncias singleton ───────────────────────────────────────────────────

const modelRegistry = new ModelRegistry();
const modelStatsTracker = new ModelStatsTracker();
const modelSelector = new ModelSelector(modelRegistry, modelStatsTracker);
const autoDowngradeDetector = new AutoDowngradeDetector(modelStatsTracker, modelSelector);

// ─── Exports ────────────────────────────────────────────────────────────────

export {
    AutoDowngradeDetector,
    autoDowngradeDetector,
    COST_ORDER,
    KNOWN_MODELS,
    ModelRegistry,
    modelRegistry,
    ModelSelector,
    modelSelector,
    ModelStatsTracker,
    modelStatsTracker,
    SPEED_ORDER,
};
