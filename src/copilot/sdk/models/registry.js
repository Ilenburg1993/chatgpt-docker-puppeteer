// @ts-check
/**
 * src/copilot/sdk/models/registry.js
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
 * @module copilot/sdk/models/registry
 */

import { KNOWN_MODELS } from './known-models.js';
import { AutoDowngradeDetector, ModelSelector } from './selector.js';
import { ModelStatsTracker } from './stats-tracker.js';

export { AutoDowngradeDetector, ModelSelector } from './selector.js';
export { ModelStatsTracker } from './stats-tracker.js';

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

// ─── Instâncias singleton ───────────────────────────────────────────────────

const modelRegistry = new ModelRegistry();
const modelStatsTracker = new ModelStatsTracker();
const modelSelector = new ModelSelector(modelRegistry, modelStatsTracker);
const autoDowngradeDetector = new AutoDowngradeDetector(modelStatsTracker, modelSelector);

// ─── Exports ────────────────────────────────────────────────────────────────

export {
    autoDowngradeDetector,
    ModelRegistry,
    modelRegistry,
    modelSelector,
    modelStatsTracker,
};
