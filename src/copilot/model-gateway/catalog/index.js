// @ts-check
/**
 * Universal catalog contracts and future import/store entrypoints.
 *
 * @module copilot/model-gateway/catalog
 */

export {
    MODEL_GATEWAY_CATALOG_CONFIDENCE,
    MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
    createCanonicalModelProjection,
    createCanonicalProviderProjection,
    createModelMetadataEvidence,
    createModelRouteOption,
    createProviderAccountOverlay,
    createProviderCatalogSource,
    createProviderMetadataEvidence,
} from './contracts.js';
export { createDefaultModelGatewayCatalogImporters } from './default-importers.js';
export { auditCatalogImporterSet, describeCatalogImporter } from './importer-audit.js';
export {
    projectModelGatewayMetadataCoverageMetrics,
    projectModelGatewayProviderFreshnessMetrics,
    summarizeModelGatewayMetadataCoverage,
    summarizeModelGatewayProviderFreshness,
} from './coverage.js';
export { explainModelGatewayCatalogEntry, explainModelGatewayProviderEntry } from './explain.js';
export {
    MODEL_GATEWAY_RAW_PAYLOAD_STORAGE_POLICY,
    createCatalogImportRun,
    createCatalogModelTombstones,
    createSanitizedRawPayloadRef,
    diffCanonicalModelProjections,
    summarizeCanonicalModelProjectionDiff,
} from './import-runs.js';
export {
    ANTHROPIC_MODELS_API_DOCS_URL,
    ANTHROPIC_MODELS_API_VERSION,
    ANTHROPIC_MODELS_CATALOG_URL,
    ANTHROPIC_MODELS_DOCS_URL,
    ANTHROPIC_PRICING_DOCS_URL,
    CEREBRAS_PUBLIC_MODELS_CATALOG_URL,
    CHUTES_MODELS_CATALOG_URL,
    CHUTES_OPENAI_BASE_URL,
    CLOUDFLARE_AI_GATEWAY_CREDIT_BALANCE_PATH,
    CLOUDFLARE_AI_GATEWAY_GATEWAYS_PATH,
    CLOUDFLARE_AI_GATEWAY_GATEWAY_PATH,
    CLOUDFLARE_AI_GATEWAY_PROVIDER_CONFIGS_PATH,
    CLOUDFLARE_AI_GATEWAY_SPENDING_LIMIT_PATH,
    CLOUDFLARE_AI_GATEWAY_UNIVERSAL_URL,
    CLOUDFLARE_API_BASE_URL,
    CLOUDFLARE_WORKERS_AI_MODELS_CATALOG_URL,
    CLOUDFLARE_WORKERS_AI_MODELS_SEARCH_PATH,
    CLOUDFLARE_WORKERS_AI_OPENAI_BASE_URL,
    CLOUDFLARE_WORKERS_AI_REST_BASE_URL,
    GEMINI_MODELS_API_VERSION,
    GEMINI_MODELS_CATALOG_URL,
    GEMINI_MODELS_DOCS_URL,
    GEMINI_OPENAI_COMPATIBLE_BASE_URL,
    GEMINI_OPENAI_COMPATIBILITY_DOCS_URL,
    GEMINI_PRICING_DOCS_URL,
    GEMINI_VERTEX_MODELS_DOCS_URL,
    GROQ_DOCS_MODELS_URL,
    GROQ_MODELS_CATALOG_URL,
    GROQ_OPENAI_BASE_URL,
    GROQ_PRICING_URL,
    HUGGINGFACE_ROUTE_POLICY_SUFFIXES,
    HUGGINGFACE_ROUTER_BASE_URL,
    HUGGINGFACE_ROUTER_MODELS_URL,
    KILO_GATEWAY_MODELS_CATALOG_URL,
    KILO_GATEWAY_PROVIDERS_CATALOG_URL,
    MISTRAL_KNOWN_LIMITATIONS_DOCS_URL,
    MISTRAL_MODELS_API_DOCS_URL,
    MISTRAL_MODELS_CATALOG_URL,
    MISTRAL_MODELS_DOCS_URL,
    NVIDIA_NIM_BASE_URL,
    NVIDIA_NIM_MANAGEMENT_ENDPOINTS,
    NVIDIA_NIM_MODELS_CATALOG_URL,
    OLLAMA_LOCAL_API_BASE_URL,
    OLLAMA_LOCAL_OPENAI_BASE_URL,
    OLLAMA_LOCAL_SHOW_URL,
    OLLAMA_LOCAL_TAGS_URL,
    OPENCODE_ZEN_BASE_URL,
    OPENCODE_ZEN_CHAT_COMPLETIONS_URL,
    OPENCODE_ZEN_DOCS_URL,
    OPENCODE_ZEN_MESSAGES_URL,
    OPENCODE_ZEN_MODELS_URL,
    OPENCODE_ZEN_RESPONSES_URL,
    OPENAI_DOCS_PRICING_URL,
    OPENAI_MODEL_COMPARE_URL,
    OPENAI_MODELS_DOCS_URL,
    OPENAI_MODELS_CATALOG_URL,
    OPENROUTER_KEY_URL,
    OPENROUTER_MODELS_CATALOG_URL,
    ZAI_BUILT_IN_WEB_SEARCH_USD_PER_USE,
    ZAI_CHAT_COMPLETIONS_PATH,
    ZAI_DOCS_PRICING_URL,
    ZAI_OPENAI_BASE_URL,
    ZAI_OPENAPI_URL,
    createAnthropicDocsModelsImporter,
    createAnthropicModelsImporter,
    createCerebrasPublicModelsImporter,
    createChutesModelsImporter,
    createCloudflareWorkersAiAccountImporter,
    createCloudflareWorkersAiCatalogImporter,
    createGeminiDocsModelsImporter,
    createGeminiModelsImporter,
    createGroqDocsModelsImporter,
    createGroqModelsImporter,
    createHuggingFaceInferenceProvidersImporter,
    createKiloGatewayAccountImporter,
    createKiloGatewayModelsImporter,
    createKiloGatewayProvidersImporter,
    createMistralDocsModelsImporter,
    createMistralModelsImporter,
    createNvidiaNimModelsImporter,
    createOllamaCatalogImporter,
    createOpenCodeZenDocsImporter,
    createOpenCodeZenModelsImporter,
    createOpenAiDocsModelsImporter,
    createOpenAICompatibleModelsImporter,
    createOpenAIModelsImporter,
    createOpenRouterKeyAccountImporter,
    createOpenRouterModelsImporter,
    createZaiModelsImporter,
    parseAnthropicDocsRows,
    parseCloudflareWorkersAiAccountRows,
    parseGeminiDocsRows,
    parseKiloGatewayAccountRows,
    parseMistralDocsRows,
    parseOpenAiDocsRows,
    parseOpenRouterKeyRows,
} from './importers/index.js';
export { runCatalogImporters } from './importer-runner.js';
export {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    createModelGatewayCatalogSnapshotId,
    normalizeStoredCatalogSnapshot,
} from './json-catalog-store.js';
export { SqliteModelGatewayCatalogStore } from './sqlite-catalog-store.js';
export { mergeModelMetadataEvidence, mergeProviderMetadataEvidence, rankCatalogEvidenceConfidence } from './merge.js';
export {
    OPENAI_MODEL_LIST_OBJECT,
    OPENAI_MODEL_OBJECT,
    toOpenAIModelCatalogEntry,
    toOpenAIModelCatalogList,
} from './openai-schema.js';
export {
    normalizeAccountOverlayControls,
    normalizeCatalogModalities,
    normalizeModelAliases,
    normalizeModelIdentityTraits,
    normalizeModelLifecycle,
    normalizeModelModalities,
    normalizeModelPricingTaxonomy,
    normalizeModelRoutePolicyTraits,
    normalizeModelTokenLimits,
    normalizeOpenAICompatibleModelCapabilities,
    normalizeRateLimitTaxonomy,
    normalizeRuntimeAgenticCapabilityTaxonomy,
    normalizeDataPolicyTaxonomy,
    normalizeUsdPricing,
    parseModelModalityExpression,
    resolveModelDeprecationAlias,
} from './normalizers.js';
export {
    ModelGatewayCatalogRefreshLockError,
    isModelGatewayCatalogRefreshLocked,
    resolveModelGatewayCatalogRefreshLockKey,
    withModelGatewayCatalogRefreshLock,
} from './refresh-lock.js';
export { planModelGatewayCatalogRefresh } from './refresh-plan.js';
export { refreshModelGatewayCatalog } from './refresh.js';
export { applyModelGatewayCatalogRetention } from './retention.js';
export {
    MODEL_GATEWAY_SQLITE_SCHEMA_SQL,
    MODEL_GATEWAY_SQLITE_SCHEMA_VERSION,
    MODEL_GATEWAY_SQLITE_TABLES,
} from './sqlite-schema.js';
export {
    mirrorModelGatewayCatalogSnapshotToSqlite,
    summarizeModelGatewayCatalogSnapshot,
} from './sqlite-migration.js';
export { searchModelGatewayCatalogEntries } from './search.js';
