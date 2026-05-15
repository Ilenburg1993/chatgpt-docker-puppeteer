// @ts-check
/**
 * src/copilot/lib/models.js
 *
 * @module copilot/lib/models
 * @see EventBus
 */

import { ConfigError } from '#copilot/core';
import { log } from '../logger.js';
import { getModelListClient } from './client-provider.js';
import { modelSelector } from './registry.js';

import { toError } from '#copilot/core/error-handlers';
import {
    clearPersistentModelCache,
    evaluatePersistentCache,
    readPersistentModelCache,
    writePersistentModelCacheAsync,
} from './persistent-cache.js';
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

/** @type {Promise<ModelInfo[]> | null} */
let _inflightRequest = null;

/**
 * Invalida o cache de modelos (útil em testes ou após mudança de conta).
 *
 * @returns {void}
 */
export function clearModelsCache() {
    _modelsCache = null;
    _inflightRequest = null;
    // Limpar L2 cache persistente também (async, não-bloqueante)
    void clearPersistentModelCache();
}

/**
 * Invalida cache L1 e aguarda limpeza do cache persistente L2.
 *
 * @returns {Promise<void>}
 */
export async function clearModelsCacheAsync() {
    _modelsCache = null;
    _inflightRequest = null;
    await clearPersistentModelCache();
}

// ─── Listagem e filtragem ────────────────────────────────────────────────────

/**
 * Lista todos os modelos disponíveis usando o cliente SDK ativo.
 *
 * AB.2: resultado cacheado por 5 minutos para evitar requisições repetidas. Equivale a `client.listModels()` mas usa o
 * cliente singleton gerenciado. Deduplica requisições concorrentes via `_inflightRequest`.
 *
 * @param {object} [clientOverrides={}] - Overrides opcionais para o cliente. Default is `{}`
 * @param {boolean} [forceRefresh=false] - Ignorar cache e buscar lista atualizada. Default is `false`
 * @returns {Promise<ModelInfo[]>}
 */
export async function listModels(clientOverrides = {}, forceRefresh = false) {
    const now = Date.now();
    // L1: Check memória (5min TTL)
    if (!forceRefresh && _modelsCache && _modelsCache.expiresAt > now) {
        return _modelsCache.models;
    }

    // L2: Check disk persistent cache se L1 miss (24h TTL)
    if (!forceRefresh && !_modelsCache) {
        const persistedCache = await readPersistentModelCache();
        if (persistedCache) {
            const fallbackResult = evaluatePersistentCache(persistedCache);
            if (!fallbackResult.isStale) {
                // Cache no disk está fresco, usar
                _modelsCache = {
                    models: persistedCache.models,
                    expiresAt: now + MODELS_CACHE_TTL_MS,
                };
                log('DEBUG', `[models] Cache disk usado (age: ${fallbackResult.ageMs}ms)`);
                return _modelsCache.models;
            }
        }
    }

    // Se há uma requisição em voo, reutilizar ao invés de disparar outra
    if (_inflightRequest !== null) {
        return _inflightRequest;
    }

    const client = await getModelListClient(clientOverrides);
    // Guardar Promise em voo para deduplicação (L3: network fetch)
    _inflightRequest = (async () => {
        try {
            const models = await client.listModels();
            _modelsCache = { models, expiresAt: now + MODELS_CACHE_TTL_MS };
            // Fase 3.3 Optimization #2: Salvar L2 persistente async (fire-and-forget)
            writePersistentModelCacheAsync(models);
            return models;
        } catch (e) {
            // Network falhou: try fallback L2 (mesmo que stale)
            _modelsCache = null;
            const persistedCache = await readPersistentModelCache();
            if (persistedCache) {
                log('WARN', `[models] Network falhou, usando cache stale do disk`);
                const fallbackResult = evaluatePersistentCache(persistedCache);
                _modelsCache = {
                    models: persistedCache.models,
                    expiresAt: now + (fallbackResult.isStale ? 60_000 : MODELS_CACHE_TTL_MS),
                };
                return persistedCache.models;
            }
            throw e;
        } finally {
            // Limpar referência de inflight após conclusão (sucesso ou erro)
            _inflightRequest = null;
        }
    })();
    return _inflightRequest;
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
 * @param {string} [fallback='auto'] - Modelo de fallback se o preferido não estiver disponível. Default is `'auto'`
 * @returns {string} ID do modelo a usar
 */
export function resolveModelId(models, preferred, fallback = 'auto') {
    const enabled = filterEnabledModels(models);
    const found = enabled.find((m) => m.id === preferred);
    return found ? found.id : fallback;
}

/**
 * Seleciona automaticamente o melhor modelo disponível usando ModelSelector (F40.2). Se preferred é 'auto', usa
 * heurística de seleção; caso contrário, usa resolveModelId.
 *
 * @example
 *     const models = await listModels();
 *     const model = await resolveModelIdAuto(models, 'auto');
 *     // => 'gpt-4o-mini' (exemplo: rápido + barato)
 *
 * @param {ModelInfo[]} models - Lista de modelos disponíveis
 * @param {string} [preferred='auto'] - ID do modelo preferido ou 'auto' para seleção automática. Default is `'auto'`
 * @param {string} [fallback='auto'] - Modelo de fallback se auto-selection falhar. Default is `'auto'`
 * @returns {Promise<string>} ID do modelo selecionado
 * @throws {Error} Se não houver modelos disponíveis
 */
export async function resolveModelIdAuto(models, preferred = 'auto', fallback = 'auto') {
    // Se preferred não é 'auto', usar resolveModelId original
    if (preferred !== 'auto') {
        return resolveModelId(models, preferred, fallback);
    }

    // Auto-selection: usar ModelSelector para escolher melhor modelo
    const enabled = filterEnabledModels(models);
    if (enabled.length === 0) {
        log('WARN', '[models] Nenhum modelo habilitado encontrado; usando fallback');
        return fallback;
    }

    try {
        // Critério de seleção: rápido + barato (balanceado para terminal)
        const selected = modelSelector.select(
            {
                preferFast: true,
                preferLowCost: true,
                // Nota: reasoningEffort exigiria requireReasoning: true
                // Por enquanto, deixamos aberto para qualquer modelo
            },
            enabled.map((m) => m.id),
        );

        if (!selected) {
            log('WARN', '[models] ModelSelector não selecionou modelo; usando primeiro habilitado');
            const firstModel = enabled[0];
            if (!firstModel) {
                log('ERROR', '[models] enabled array vazio (condição inesperada); usando fallback');
                return fallback;
            }
            return firstModel.id;
        }

        log(
            'INFO',
            `[models] Auto-selecionado: ${selected.id} (custo: ${selected.costTier}, velocidade: ${selected.speedTier})`,
        );
        return selected.id;
    } catch (e) {
        const err = toError(e);
        log('ERROR', `[models] Auto-selection falhou: ${err.message}; usando fallback`);
        return fallback;
    }
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
 *     const config = buildReasoningConfig(models, 'gpt-5-mini', 'high');
 *     // => { model: 'gpt-5-mini', reasoningEffort: 'high' }
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
