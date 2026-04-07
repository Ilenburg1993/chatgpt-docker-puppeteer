// @ts-check
/**
 * src/copilot/sdk/models/index.js
 *
 * Barrel de re-exportação para os módulos de gerenciamento de modelos.
 *
 * @module copilot/sdk/models
 */

// Funções puras de listagem, filtragem e seleção de modelos
export {
    buildReasoningConfig,
    clearModelsCache,
    filterEnabledModels,
    filterReasoningModels,
    filterVisionModels,
    getContextWindowSize,
    getModelById,
    getSupportedReasoningEfforts,
    indexModelsById,
    listModels,
    pickModel,
    resolveModelId,
    supportsReasoning,
} from './helpers.js';

// Classes stateful: registry, selector, stats tracker, auto-downgrade
export {
    AutoDowngradeDetector,
    ModelRegistry,
    ModelSelector,
    ModelStatsTracker,
    autoDowngradeDetector,
    modelRegistry,
    modelSelector,
    modelStatsTracker,
} from './registry.js';

// Dados estáticos: catálogo de modelos conhecidos e ordenação de tiers
export { COST_ORDER, KNOWN_MODELS, SPEED_ORDER } from './known-models.js';
