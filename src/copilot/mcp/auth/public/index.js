// @ts-check
/** Runtime membrane for MCP authentication and OAuth. @module copilot/mcp/auth/public */

/** @typedef {import('../resource-server/service.js').McpAuthMode} McpAuthMode */
/** @typedef {import('../resource-server/service.js').McpAuthEnforcementMode} McpAuthEnforcementMode */
/** @typedef {import('../resource-server/service.js').McpAuthScope} McpAuthScope */
/** @typedef {import('../resource-server/service.js').McpOauthInitialScopeProfile} McpOauthInitialScopeProfile */
/** @typedef {import('../resource-server/service.js').McpAuthConfig} McpAuthConfig */
/** @typedef {import('../resource-server/service.js').McpAuthRuntimeConfig} McpAuthRuntimeConfig */
/** @typedef {import('../resource-server/service.js').McpAuthRuntimeSecrets} McpAuthRuntimeSecrets */
/** @typedef {import('../resource-server/decision-cache.js').McpAuthDecisionCachePolicy} McpAuthDecisionCachePolicy */
/** @typedef {import('../runtime/jwks-warmup.js').McpAuthJwksWarmupPolicy} McpAuthJwksWarmupPolicy */
/** @typedef {import('../persistence/config.js').OAuthReplayStoreConfig} OAuthReplayStoreConfig */
/** @typedef {import('../issuer/config.js').DevOAuthProcessConfig} DevOAuthProcessConfig */
/** @typedef {import('../resource-server/service.js').McpAuthContext} McpAuthContext */
/** @typedef {import('../resource-server/service.js').McpAuthorizationDecision} McpAuthorizationDecision */
/** @typedef {import('../resource-server/service.js').McpSessionAuthBinding} McpSessionAuthBinding */
/** @typedef {import('../resource-server/service.js').McpSessionAuthBindingResolution} McpSessionAuthBindingResolution */
/** @typedef {import('../resource-server/service.js').McpPrincipalIdentity} McpPrincipalIdentity */

export {
    MCP_AUTH_IMPLEMENTATION_NAME,
    MCP_AUTH_IMPLEMENTATION_VERSION,
    MCP_AUTH_SCOPES,
    authorizeMcpToolCall,
    createMcpAuthResourceServerRuntime,
    buildMcpSessionAuthBindingFromVerifiedJwtPayload,
    buildMcpPrincipalIdentity,
    buildProtectedResourceMetadata,
    buildWwwAuthenticateChallenge,
    isPublicOauthDiagnosticTool,
    normalizeMcpAuthEnforcement,
    normalizeMcpAuthMode,
    parseBearerToken,
    protectedResourceMetadataUrlForResource,
    readMcpAuthConfig,
    readMcpAuthConfigCacheStats,
    readMcpAuthRuntimeConfig,
    readMcpAuthDecisionCacheStats,
    resolveMcpSessionAuthBinding,
    scopesForMcpTool,
    securitySchemesForMcpTool,
    warmMcpRemoteJwks,
} from '../resource-server/service.js';
export { readMcpAuthDecisionCachePolicy } from '../resource-server/decision-cache.js';

export {
    DEV_OAUTH_PROCESS_CONFIG_KIND,
    DEV_OAUTH_PROCESS_CONFIG_SCHEMA_VERSION,
    readDevOAuthProcessConfig,
    resolveDevOAuthProcessConfig,
} from '../issuer/config.js';

export {
    DEV_OAUTH_IMPLEMENTATION_NAME,
    DEV_OAUTH_IMPLEMENTATION_VERSION,
    createDevOAuthRuntime,
} from '../issuer/dev-oauth.js';

export {
    readMcpAuthJwksWarmupPolicy,
    readMcpAuthJwksWarmupState,
    scheduleMcpAuthJwksWarmup,
    stopMcpAuthJwksWarmup,
} from '../runtime/jwks-warmup.js';

export {
    createConfiguredOAuthReplayStore,
    createOAuthReplayCapability,
} from '../persistence/replay-store.js';
export { readOAuthReplayStoreConfig } from '../persistence/config.js';
