// @ts-check
/** Runtime membrane for MCP authentication and OAuth. @module copilot/mcp/auth/public */

/** @typedef {import('../resource-server/service.js').McpAuthMode} McpAuthMode */
/** @typedef {import('../resource-server/service.js').McpAuthEnforcementMode} McpAuthEnforcementMode */
/** @typedef {import('../resource-server/service.js').McpAuthScope} McpAuthScope */
/** @typedef {import('../resource-server/service.js').McpOauthInitialScopeProfile} McpOauthInitialScopeProfile */
/** @typedef {import('../resource-server/service.js').McpAuthConfig} McpAuthConfig */
/** @typedef {import('../resource-server/service.js').McpAuthContext} McpAuthContext */
/** @typedef {import('../resource-server/service.js').McpAuthorizationDecision} McpAuthorizationDecision */
/** @typedef {import('../resource-server/service.js').McpSessionAuthBinding} McpSessionAuthBinding */
/** @typedef {import('../resource-server/service.js').McpSessionAuthBindingResolution} McpSessionAuthBindingResolution */

export {
    MCP_AUTH_IMPLEMENTATION_NAME,
    MCP_AUTH_IMPLEMENTATION_VERSION,
    MCP_AUTH_SCOPES,
    authorizeMcpToolCall,
    buildMcpSessionAuthBindingFromVerifiedJwtPayload,
    buildProtectedResourceMetadata,
    buildWwwAuthenticateChallenge,
    isPublicOauthDiagnosticTool,
    normalizeMcpAuthEnforcement,
    normalizeMcpAuthMode,
    parseBearerToken,
    protectedResourceMetadataUrlForResource,
    readMcpAuthConfig,
    readMcpAuthConfigCacheStats,
    readMcpAuthDecisionCacheStats,
    resolveMcpSessionAuthBinding,
    scopesForMcpTool,
    securitySchemesForMcpTool,
    warmMcpRemoteJwks,
} from '../resource-server/service.js';

export {
    DEV_OAUTH_IMPLEMENTATION_NAME,
    DEV_OAUTH_IMPLEMENTATION_VERSION,
    buildBuiltInDevOAuthClientMetadata,
    buildBuiltInDevOAuthMetadata,
    handleBuiltInDevOAuthRequest,
    isBuiltInDevOAuthEnabled,
    readDevOAuthClientLifetimePolicy,
    readDevOAuthPersistenceConfig,
    readDevOAuthPersistenceStatus,
    readDevOAuthTokenLifetimePolicy,
} from '../issuer/dev-oauth.js';

export {
    readMcpAuthJwksWarmupState,
    scheduleMcpAuthJwksWarmup,
    stopMcpAuthJwksWarmup,
} from '../runtime/jwks-warmup.js';

export {
    configurePersistentOAuthReplayStore,
    createConfiguredOAuthReplayStore,
} from '../persistence/replay-store.js';
