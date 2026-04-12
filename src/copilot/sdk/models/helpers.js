// @ts-check
/**
 * src/copilot/lib/models.js
 * @module copilot/lib/models
 * @see EventBus
 */

import { ConfigError } from '#copilot/core';
import { getClient } from '../client.js';

/**
 * @typedef {import('@github/copilot-sdk').ModelInfo} ModelInfo
 *
 * @typedef {import('@github/copilot-sdk').ModelCapabilities} ModelCapabilities
 *
 * @typedef {import('@github/copilot-sdk').ModelPolicy} ModelPolicy
 *
 * @typedef {import('@github/copilot-sdk').ModelBilling} ModelBilling
 *
 * @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffort
 */

// ─── AB.2: Cache de model list (TTL 5 min) ───────────────────────────────────

/** TTL do cache de listModels em ms (5 minutos). */
const MODELS_CACHE_TTL_MS = 5 * 60_000;

/** @type {{ models: ModelInfo[]; expiresAt: number } | null} */
let _modelsCache = null;

/**
 * Invalida o cache de modelos (útil em testes ou após mudança de conta).
 *
 * @returns {void}
 */
export function clearModelsCache() {
    _modelsCache = null;
}

// ─── Listagem e filtragem ────────────────────────────────────────────────────

/**
 * Lista todos os modelos disponíveis usando o cliente SDK ativo.
 *
 * AB.2: resultado cacheado por 5 minutos para evitar requisições repetidas. Equivale a `client.listModels()` mas usa o
 * cliente singleton gerenciado.
 *
 * @param {object} [clientOverrides={}] - Overrides opcionais para o cliente. Default is `{}`
 * @param {boolean} [forceRefresh=false] - Ignorar cache e buscar lista atualizada. Default is `false`
 * @returns {Promise<ModelInfo[]>}
 */
export async function listModels(clientOverrides = {}, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _modelsCache && _modelsCache.expiresAt > now) {
        return _modelsCache.models;
    }
    const client = await getClient(clientOverrides);
    let models;
    try {
        models = await client.listModels();
    } catch (e) {
        // RF-048: purge cache stale em caso de erro de rede, para forçar retry na próxima chamada
        _modelsCache = null;
        throw e;
    }
    _modelsCache = { models, expiresAt: now + MODELS_CACHE_TTL_MS };
    return models;
}

/**
 * Filtra modelos que estejam com política habilitada (`policy.state === 'enabled'`). Modelos sem campo `policy` são
 * incluídos (considerados habilitados por padrão).
 *
 * @param {ModelInfo[]} models
 * @returns {ModelInfo[]}
 */
export function filterEnabledModels(models) {
    return models.filter((m) => !m.policy || m.policy.state === 'enabled');
}

/**
 * Filtra modelos que suportam reasoningEffort.
 *
 * @param {ModelInfo[]} models
 * @returns {ModelInfo[]}
 */
export function filterReasoningModels(models) {
    return models.filter((m) => m.capabilities.supports.reasoningEffort);
}

/**
 * Filtra modelos que suportam visão (imagens).
 *
 * @param {ModelInfo[]} models
 * @returns {ModelInfo[]}
 */
export function filterVisionModels(models) {
    return models.filter((m) => m.capabilities.supports.vision);
}

// ─── Seleção e roteamento ────────────────────────────────────────────────────

/**
 * Seleciona o primeiro modelo habilitado que atende aos critérios de capacidade. Retorna o modelo preferido ou
 * `undefined` se nenhum for encontrado.
 *
 * @param {ModelInfo[]} models - Lista de modelos (obtida via listModels)
 * @param {object} [criteria={}] Default is `{}`
 * @param {boolean} [criteria.vision] - Requer suporte a visão
 * @param {boolean} [criteria.reasoning] - Requer suporte a reasoningEffort
 * @param {boolean} [criteria.enabledOnly=true] - Apenas modelos hablitados pela política. Default is `true`
 * @param {string} [criteria.prefer] - ID de modelo preferido (se disponível e compatível)
 * @returns {ModelInfo | undefined}
 */
export function pickModel(models, criteria = {}) {
    const { vision, reasoning, enabledOnly = true, prefer } = criteria;

    let candidates = enabledOnly ? filterEnabledModels(models) : [...models];

    if (vision) candidates = filterVisionModels(candidates);
    if (reasoning) candidates = filterReasoningModels(candidates);

    if (prefer) {
        const preferred = candidates.find((m) => m.id === prefer);
        if (preferred) return preferred;
    }

    return candidates[0];
}

/**
 * Retorna o ID do modelo preferido ou um fallback padrão se o modelo não estiver disponível.
 *
 * @param {ModelInfo[]} models - Lista de modelos disponíveis
 * @param {string} preferred - ID do modelo preferido
 * @param {string} [fallback='gpt-4.1'] - Modelo de fallback se o preferido não estiver disponível. Default is
 *   `'gpt-4.1'`
 * @returns {string} ID do modelo a usar
 */
export function resolveModelId(models, preferred, fallback = 'gpt-4.1') {
    const enabled = filterEnabledModels(models);
    const found = enabled.find((m) => m.id === preferred);
    return found ? found.id : fallback;
}

// ─── Configuração de reasoningEffort ─────────────────────────────────────────

/**
 * Verifica se um modelo suporta reasoningEffort.
 *
 * @param {ModelInfo} model
 * @returns {boolean}
 * @see getSupportedReasoningEfforts
 * @see buildReasoningConfig
 */
export function supportsReasoning(model) {
    return Boolean(model.capabilities.supports.reasoningEffort);
}

/**
 * Retorna os níveis de reasoningEffort suportados por um modelo. Retorna array vazio se o modelo não suportar
 * reasoning.
 *
 * @param {ModelInfo} model
 * @returns {ReasoningEffort[]}
 * @see supportsReasoning
 */
export function getSupportedReasoningEfforts(model) {
    if (!supportsReasoning(model)) return [];
    return /** @type {ReasoningEffort[]} */ (model.supportedReasoningEfforts ?? ['low', 'medium', 'high']);
}

/**
 * Constrói opções de reasoningEffort para SessionConfig. Inclui `reasoningEffort` apenas se o modelo suportar. Lança
 * erro se effort for inválido para o modelo.
 *
 * @example
 *     const config = buildReasoningConfig(models, 'gpt-4.1', 'high');
 *     // => { model: 'gpt-4.1', reasoningEffort: 'high' }
 *
 * @param {ModelInfo[]} models - Lista de modelos disponíveis
 * @param {string} modelId - ID do modelo a usar
 * @param {ReasoningEffort} effort - Nível de esforço desejado
 * @returns {{ model: string; reasoningEffort?: ReasoningEffort }}
 * @throws {Error} Se o reasoningEffort não for suportado pelo modelo
 * @see getModelById
 * @see supportsReasoning
 */
export function buildReasoningConfig(models, modelId, effort) {
    const model = models.find((m) => m.id === modelId);

    if (!model) {
        return { model: modelId, reasoningEffort: effort };
    }

    if (!supportsReasoning(model)) {
        return { model: modelId };
    }

    const supported = getSupportedReasoningEfforts(model);
    if (supported.length > 0 && !supported.includes(effort)) {
        throw new ConfigError(
            `[lib/models] reasoningEffort '${effort}' não é suportado por '${modelId}'. Suportados: ${supported.join(', ')}.`,
        );
    }

    return { model: modelId, reasoningEffort: effort };
}

// ─── Informações de modelo ───────────────────────────────────────────────────

/**
 * Retorna informações de capacidade de um modelo pelo ID. Retorna `undefined` se o modelo não for encontrado.
 *
 * @param {ModelInfo[]} models
 * @param {string} modelId
 * @returns {ModelInfo | undefined}
 */
export function getModelById(models, modelId) {
    return models.find((m) => m.id === modelId);
}

/**
 * Mapeia uma lista de modelos para um objeto por ID (para lookups O(1)).
 *
 * @param {ModelInfo[]} models
 * @returns {Record<string, ModelInfo>}
 */
export function indexModelsById(models) {
    /** @type {Record<string, ModelInfo>} */
    const index = {};
    for (const model of models) {
        index[model.id] = model;
    }
    return index;
}

/**
 * Retorna o limite máximo de tokens de contexto para um modelo. Retorna `undefined` se o modelo não for encontrado.
 *
 * @param {ModelInfo[]} models
 * @param {string} modelId
 * @returns {number | undefined}
 */
export function getContextWindowSize(models, modelId) {
    return getModelById(models, modelId)?.capabilities.limits.max_context_window_tokens;
}

// ─── Faixa 14: Capability helpers adicionais ─────────────────────────────────

/**
 * Verifica se um modelo suporta vision (imagens).
 *
 * @param {ModelInfo} model - modelo a verificar
 * @returns {boolean}
 */
export function hasVision(model) {
    if (!model || !model.capabilities) return false;
    return model.capabilities.supports?.vision === true;
}

/**
 * Retorna o max context window tokens de um modelo. Retorna `undefined` se capabilities nao disponivel.
 *
 * @param {ModelInfo} model - modelo a consultar
 * @returns {number | undefined}
 */
export function getMaxContextTokens(model) {
    if (!model || !model.capabilities) return undefined;
    return model.capabilities.limits?.max_context_window_tokens;
}

/**
 * Retorna o max prompt tokens de um modelo. Retorna `undefined` se nao disponivel.
 *
 * @param {ModelInfo} model - modelo a consultar
 * @returns {number | undefined}
 */
export function getMaxPromptTokens(model) {
    if (!model || !model.capabilities) return undefined;
    return model.capabilities.limits?.max_prompt_tokens;
}

/**
 * Verifica se um modelo esta habilitado pela policy. Retorna `true` se policy nao definida (assume enabled).
 *
 * @param {ModelInfo} model - modelo a verificar
 * @returns {boolean}
 */
export function isModelEnabled(model) {
    if (!model) return false;
    if (!model.policy) return true;
    return model.policy.state === 'enabled';
}

/**
 * Retorna o billing multiplier de um modelo. Retorna `1` como default se billing nao disponivel.
 *
 * @param {ModelInfo} model - modelo a consultar
 * @returns {number}
 */
export function getBillingMultiplier(model) {
    if (!model || !model.billing) return 1;
    return model.billing.multiplier;
}

/**
 * Retorna os media types suportados para vision de um modelo. Retorna array vazio se vision nao suportado.
 *
 * @param {ModelInfo} model - modelo a consultar
 * @returns {string[]}
 */
export function getVisionMediaTypes(model) {
    if (!model || !model.capabilities) return [];
    return model.capabilities.limits?.vision?.supported_media_types ?? [];
}

/**
 * Retorna o default reasoning effort de um modelo. Retorna `undefined` se nao disponivel.
 *
 * @param {ModelInfo} model - modelo a consultar
 * @returns {ReasoningEffort | undefined}
 */
export function getDefaultReasoningEffort(model) {
    if (!model) return undefined;
    return /** @type {ReasoningEffort | undefined} */ (model.defaultReasoningEffort);
}

/**
 * Filtra modelos por capacidade.
 *
 * @param {ModelInfo[]} models - lista de modelos
 * @param {object} filter - filtro de capacidades
 * @param {boolean} [filter.vision] - filtrar por suporte a vision
 * @param {boolean} [filter.reasoningEffort] - filtrar por suporte a reasoning effort
 * @param {boolean} [filter.enabled] - filtrar por policy enabled
 * @returns {ModelInfo[]}
 */
export function filterModels(models, filter) {
    if (!Array.isArray(models)) return [];
    return models.filter((m) => {
        if (filter.vision !== undefined && hasVision(m) !== filter.vision) return false;
        if (filter.reasoningEffort !== undefined && supportsReasoning(m) !== filter.reasoningEffort) return false;
        if (filter.enabled !== undefined && isModelEnabled(m) !== filter.enabled) return false;
        return true;
    });
}
