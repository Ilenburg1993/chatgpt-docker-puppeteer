// @ts-check
/**
 * src/copilot/sdk/models/index.js
 *
 * Barrel de re-exportação para os módulos de gerenciamento de modelos.
 *
 * @module copilot/sdk/models
 * @see EventBus
 */

// Funções puras de listagem, filtragem e seleção de modelos
export {
    COPILOT_AUTO_MODEL_EXCLUDED_CLASSES,
    COPILOT_AUTO_MODEL_PUBLIC_CRITERIA,
    DEFAULT_AUTO_MODEL_PREFERENCE,
    describeAutoModelPolicy,
    readAutoModelPreference,
} from './auto-policy.js';
export { isAutoModelSelector, resolveModelSelectionMismatch } from '#copilot/core';

export {
    buildReasoningConfig,
    clearModelsCache,
    clearModelsCacheAsync,
    filterEnabledModels,
    filterModels,
    filterReasoningModels,
    filterVisionModels,
    getBillingMultiplier,
    getContextWindowSize,
    getDefaultReasoningEffort,
    getMaxContextTokens,
    getMaxPromptTokens,
    getModelById,
    getSupportedReasoningEfforts,
    getVisionMediaTypes,
    hasVision,
    indexModelsById,
    isModelEnabled,
    listModels,
    pickModel,
    resolveModelId,
    resolveModelIdAuto,
    supportsReasoning,
} from './helpers.js';

// Classes stateful: registry, selector, stats tracker, auto-downgrade
export {
    AutoDowngradeDetector,
    ModelRegistry,
    ModelSelector,
    ModelStatsTracker,
    autoDowngradeDetector,
    createModelRuntime,
    defaultModelRuntime,
    modelRegistry,
    modelSelector,
    modelStatsTracker,
} from './registry.js';

// Dados estáticos: catálogo de modelos conhecidos e ordenação de tiers
export { COST_ORDER, KNOWN_MODELS, SPEED_ORDER } from './known-models.js';
