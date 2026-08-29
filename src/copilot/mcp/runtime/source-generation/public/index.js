// @ts-check
/** Public membrane for immutable MCP runtime source-generation identity and promotion transport. */

export {
    MCP_RUNTIME_GENERATION_CERTIFICATE_FINGERPRINT_KIND,
    MCP_RUNTIME_GENERATION_CERTIFICATE_KIND,
    MCP_RUNTIME_GENERATION_CERTIFICATE_SCHEMA_VERSION,
    MCP_RUNTIME_SOURCE_GENERATION_KIND,
    MCP_RUNTIME_SOURCE_GENERATION_SCHEMA_VERSION,
    MCP_RUNTIME_SOURCE_PROMOTION_ENV,
    buildMcpRuntimeGenerationCertificate,
    buildMcpRuntimeSourcePromotionEnvironment,
    createMcpRuntimeSourceGeneration,
    projectMcpRuntimeSourcePromotionEnvironment,
    readMcpRuntimeSourcePromotionBinding,
} from '../runtime.js';

/** @typedef {import('../runtime.js').McpRuntimeSourceGeneration} McpRuntimeSourceGeneration */
/** @typedef {import('../runtime.js').McpRuntimeSourcePromotionBinding} McpRuntimeSourcePromotionBinding */
/** @typedef {import('../runtime.js').McpRuntimeGenerationCertificate} McpRuntimeGenerationCertificate */
