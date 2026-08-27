// @ts-check
/** Public membrane for immutable MCP runtime source-generation identity and promotion transport. */

export {
    MCP_RUNTIME_SOURCE_GENERATION_KIND,
    MCP_RUNTIME_SOURCE_GENERATION_SCHEMA_VERSION,
    MCP_RUNTIME_SOURCE_PROMOTION_ENV,
    buildMcpRuntimeSourcePromotionEnvironment,
    createMcpRuntimeSourceGeneration,
    projectMcpRuntimeSourcePromotionEnvironment,
    readMcpRuntimeSourcePromotionBinding,
} from '../runtime.js';

/** @typedef {import('../runtime.js').McpRuntimeSourceGeneration} McpRuntimeSourceGeneration */
/** @typedef {import('../runtime.js').McpRuntimeSourcePromotionBinding} McpRuntimeSourcePromotionBinding */
