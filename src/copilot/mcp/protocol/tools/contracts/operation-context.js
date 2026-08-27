// @ts-check
/**
 * Canonical per-invocation context for MCP tool operations.
 *
 * This contract is deliberately below the catalog/registry and wire adapters. It preserves the
 * official MCP request cancellation signal and request identity while adding the local deadline
 * budget used by workspace operations. Tool handlers may ignore the optional second argument during
 * migration, but new/rewritten operations must propagate its signal downstream.
 *
 * @module copilot/mcp/protocol/tools/contracts/operation-context
 */

export const MCP_TOOL_OPERATION_CONTEXT_VERSION = '1.1.0';

/**
 * @typedef {'2025' | '2026' | 'unknown'} McpProtocolEra
 *
 * @typedef {{
 *     sessionId?: string;
 *     mcpReq: {
 *         id: string | number;
 *         method: string;
 *         signal: AbortSignal;
 *         _meta?: Record<string, unknown>;
 *         envelope?: Record<string, unknown>;
 *     };
 *     http?: { authInfo?: import('@modelcontextprotocol/server').AuthInfo };
 * }} McpSdkRequestContext
 *
 * @typedef {Readonly<{
 *     version: string;
 *     signal: AbortSignal;
 *     callerSignal: AbortSignal;
 *     callId?: string;
 *     requestId: string;
 *     method: string;
 *     protocolEra: McpProtocolEra;
 *     sessionId?: string;
 *     requestMeta?: Readonly<Record<string, unknown>>;
 *     requestEnvelope?: Readonly<Record<string, unknown>>;
 *     authInfo?: import('@modelcontextprotocol/server').AuthInfo;
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     config: McpToolConfigProjection;
 *     capabilities: McpToolCapabilityProjection;
 *     startedAtMs: number;
 *     deadlineAtMs: number | null;
 *     remainingBudgetMs: () => number | null;
 *     cancellationSource: () => 'caller' | 'deadline' | null;
 * }>} McpToolOperationContext
 *
 * @typedef {Readonly<{
 *     connection?: import('#copilot/mcp/public/connection').McpConnectionRuntimeConfig;
 *     authConfig?: import('#copilot/mcp/public/auth').McpAuthConfig;
 *     authIssuer?: import('#copilot/mcp/public/auth').DevOAuthProcessConfig;
 *     cloudflare?: import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig;
 *     companyKnowledge?: import('#copilot/mcp/public/company-knowledge').CompanyKnowledgeProcessConfig;
 *     devcontainerNetwork?: import('#copilot/mcp/public/diagnostics/devcontainer-network').McpDevcontainerNetworkConfig;
 *     ioCache?: import('#copilot/mcp/public/diagnostics/io-cache').McpIoCacheProcessConfig;
 *     indexAutoBuild?: import('#copilot/mcp/public/indexing/auto-build').McpIndexAutoBuildConfig;
 *     latencyDashboard?: import('#copilot/mcp/public/diagnostics/latency').McpLatencyDashboardPolicy;
 *     reload?: import('#copilot/mcp/public/runtime/reload').McpReloadProcessConfig;
 *     runtimeSourceGeneration?: import('#copilot/mcp/public/runtime/source-generation').McpRuntimeSourceGeneration;
 *     toolPayload?: import('#copilot/mcp/public/diagnostics/tool-payload').McpToolPayloadAuditConfig;
 *     validation?: import('#copilot/mcp/public/validation').McpValidationProcessConfig;
 *     git?: import('#copilot/mcp/public/workspace/git').McpGitProcessConfig;
 *     repositoryReadCache?: import('#copilot/mcp/public/workspace/repository/read-cache').McpRepoReadCacheConfig;
 *     terminal?: import('#copilot/mcp/public/process/terminal').McpTerminalProcessConfig;
 * }>} McpToolConfigProjection
 *
 * @typedef {Readonly<{
 *     cloudflare?: import('#copilot/mcp/public/cloudflare/environment-authority').CloudflareEnvironmentAuthority;
 *     modelGatewayLiveRuns?: import('#copilot/mcp/public/integrations/model-gateway/live-runs').ModelGatewayLiveRunEnvironmentAuthority;
 *     infraHealth?: import('#copilot/mcp/public/diagnostics/infra-health').McpInfraHealthCapability;
 *     httpSessionRuntime?: Readonly<{ readState: () => Record<string, unknown> }>;
 *     audit?: ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>;
 *     authIssuerRuntime?: ReturnType<typeof import('#copilot/mcp/public/auth').createDevOAuthRuntime>;
 *     aiArtifacts?: ReturnType<typeof import('#copilot/mcp/public/maintenance').createAiArtifactsRuntime>;
 *     roundTripAnalytics?: ReturnType<typeof import('#copilot/mcp/public/diagnostics/latency/round-trip').createMcpRoundTripAnalyticsCapability>;
 *     modelGatewaySqliteFingerprint?: ReturnType<typeof import('#copilot/mcp/public/integrations/model-gateway/sqlite-fingerprint').createModelGatewaySqliteFingerprintCapability>;
 *     toolSurface?: Readonly<{
 *         tools: readonly import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[];
 *         names: readonly string[];
 *         descriptorFingerprint?: string;
 *         descriptorFingerprintKind?: string;
 *         toolDescriptorFingerprints?: Readonly<Record<string, string>>;
 *         toolDescriptorRevisionTokens?: Readonly<Record<string, string>>;
 *         resolveCanonicalSurfaces?: () => readonly Readonly<{
 *             mode: string;
 *             tools: readonly import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[];
 *             names: readonly string[];
 *         }>[];
 *     }>;
 * }>} McpToolCapabilityProjection
 *
 * @typedef {{
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     callId?: string;
 *     config?: McpToolConfigProjection;
 *     capabilities?: McpToolCapabilityProjection;
 *     timeoutMs?: number;
 *     now?: () => number;
 * }} McpToolOperationContextOptions
 */

/**
 * Build the immutable operation context passed from the MCP SDK boundary to tool/application code.
 *
 * The SDK's caller signal is never replaced. A local deadline is composed with it so downstream
 * operations can cooperatively abort. `cancellationSource()` distinguishes an upstream/client abort
 * from the local deadline without relying on exception-message parsing.
 *
 * @param {McpSdkRequestContext} serverContext
 * @param {McpToolOperationContextOptions} [options]
 * @returns {McpToolOperationContext}
 */
export function createMcpToolOperationContext(serverContext, options) {
    if (!options?.workspace) throw new TypeError('MCP tool operation context requires a workspace capability.');
    const now = options.now ?? (() => Date.now());
    const startedAtMs = now();
    const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    const deadlineAtMs = timeoutMs === null ? null : startedAtMs + timeoutMs;
    const deadlineSignal = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);
    const callerSignal = serverContext.mcpReq.signal;
    const signal = deadlineSignal ? AbortSignal.any([callerSignal, deadlineSignal]) : callerSignal;
    const requestMeta = freezeRecord(serverContext.mcpReq._meta);
    const requestEnvelope = freezeRecord(serverContext.mcpReq.envelope);
    const protocolEra = inferProtocolEra(serverContext, requestEnvelope);

    return Object.freeze({
        version: MCP_TOOL_OPERATION_CONTEXT_VERSION,
        signal,
        callerSignal,
        ...(options.callId ? { callId: options.callId } : {}),
        requestId: String(serverContext.mcpReq.id),
        method: serverContext.mcpReq.method,
        protocolEra,
        ...(serverContext.sessionId ? { sessionId: serverContext.sessionId } : {}),
        ...(requestMeta ? { requestMeta } : {}),
        ...(requestEnvelope ? { requestEnvelope } : {}),
        ...(serverContext.http?.authInfo ? { authInfo: serverContext.http.authInfo } : {}),
        workspace: options.workspace,
        config: freezeToolConfig(options.config),
        capabilities: freezeToolCapabilities(options.capabilities),
        startedAtMs,
        deadlineAtMs,
        remainingBudgetMs: () => (deadlineAtMs === null ? null : Math.max(0, deadlineAtMs - now())),
        cancellationSource: () => {
            if (callerSignal.aborted) return 'caller';
            if (deadlineSignal?.aborted) return 'deadline';
            return null;
        },
    });
}

/**
 * Require the composition-owned workspace capability at a migrated wire boundary.
 *
 * Handler context remains optional in the transitional registry type so legacy handlers can migrate incrementally;
 * rewritten handlers must call this guard rather than inventing a fallback locator.
 *
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/workspace').McpWorkspaceCapability}
 */
export function requireMcpToolWorkspace(operationContext) {
    if (!operationContext?.workspace) throw new TypeError('MCP tool execution requires a workspace capability.');
    return operationContext.workspace;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/auth').McpAuthConfig}
 */
export function requireMcpToolAuthConfig(operationContext) {
    const config = operationContext?.config.authConfig;
    if (!config) throw new TypeError('MCP tool execution requires an auth configuration projection.');
    return config;
}

/**
 * Require the composition-owned OAuth issuer configuration projection at a migrated tool boundary.
 *
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/auth').DevOAuthProcessConfig}
 */
export function requireMcpToolAuthIssuerConfig(operationContext) {
    const issuerConfig = operationContext?.config.authIssuer;
    if (!issuerConfig) throw new TypeError('MCP tool execution requires an OAuth issuer configuration projection.');
    return issuerConfig;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig}
 */
export function requireMcpToolCloudflareConfig(operationContext) {
    const config = operationContext?.config.cloudflare;
    if (!config) throw new TypeError('MCP tool execution requires a Cloudflare config projection.');
    return config;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/cloudflare/environment-authority').CloudflareEnvironmentAuthority}
 */
export function requireMcpToolCloudflareEnvironmentAuthority(operationContext) {
    const authority = operationContext?.capabilities.cloudflare;
    if (!authority) throw new TypeError('MCP tool execution requires a Cloudflare environment authority.');
    return authority;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/company-knowledge').CompanyKnowledgeProcessConfig}
 */
export function requireMcpToolCompanyKnowledgeConfig(operationContext) {
    const config = operationContext?.config.companyKnowledge;
    if (!config) throw new TypeError('MCP tool execution requires a Company Knowledge configuration projection.');
    return config;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/diagnostics/devcontainer-network').McpDevcontainerNetworkConfig}
 */
export function requireMcpToolDevcontainerNetworkConfig(operationContext) {
    const config = operationContext?.config.devcontainerNetwork;
    if (!config) throw new TypeError('MCP tool execution requires a DevContainer network configuration projection.');
    return config;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/diagnostics/io-cache').McpIoCacheProcessConfig}
 */
export function requireMcpToolIoCacheConfig(operationContext) {
    const config = operationContext?.config.ioCache;
    if (!config) throw new TypeError('MCP tool execution requires an IO-cache configuration projection.');
    return config;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/integrations/model-gateway/live-runs').ModelGatewayLiveRunEnvironmentAuthority}
 */
export function requireMcpToolModelGatewayLiveRunEnvironmentAuthority(operationContext) {
    const authority = operationContext?.capabilities.modelGatewayLiveRuns;
    if (!authority) throw new TypeError('MCP tool execution requires a Model Gateway live-run environment authority.');
    return authority;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/indexing/auto-build').McpIndexAutoBuildConfig}
 */
export function requireMcpToolIndexAutoBuildConfig(operationContext) {
    const config = operationContext?.config.indexAutoBuild;
    if (!config) throw new TypeError('MCP tool execution requires an index auto-build config projection.');
    return config;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/diagnostics/latency').McpLatencyDashboardPolicy}
 */
export function requireMcpToolLatencyDashboardConfig(operationContext) {
    const policy = operationContext?.config.latencyDashboard;
    if (!policy) throw new TypeError('MCP tool execution requires a latency dashboard configuration projection.');
    return policy;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/workspace/git').McpGitProcessConfig}
 */
export function requireMcpToolGitConfig(operationContext) {
    const config = operationContext?.config.git;
    if (!config) throw new TypeError('MCP tool execution requires a Git process config projection.');
    return config;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/workspace/repository/read-cache').McpRepoReadCacheConfig}
 */
export function requireMcpToolRepositoryReadCacheConfig(operationContext) {
    const config = operationContext?.config.repositoryReadCache;
    if (!config) throw new TypeError('MCP tool execution requires a repository read-cache config projection.');
    return config;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/process/terminal').McpTerminalProcessConfig}
 */
export function requireMcpToolTerminalConfig(operationContext) {
    const config = operationContext?.config.terminal;
    if (!config) throw new TypeError('MCP tool execution requires a terminal process config projection.');
    return config;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/validation').McpValidationProcessConfig}
 */
export function requireMcpToolValidationConfig(operationContext) {
    const config = operationContext?.config.validation;
    if (!config) throw new TypeError('MCP tool execution requires a validation process config projection.');
    return config;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/runtime/reload').McpReloadProcessConfig}
 */
export function requireMcpToolReloadConfig(operationContext) {
    const config = operationContext?.config.reload;
    if (!config) throw new TypeError('MCP tool execution requires a reload configuration projection.');
    return config;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/runtime/source-generation').McpRuntimeSourceGeneration}
 */
export function requireMcpToolRuntimeSourceGeneration(operationContext) {
    const generation = operationContext?.config.runtimeSourceGeneration;
    if (!generation) throw new TypeError('MCP tool execution requires a runtime source-generation projection.');
    return generation;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/diagnostics/tool-payload').McpToolPayloadAuditConfig}
 */
export function requireMcpToolPayloadAuditConfig(operationContext) {
    const config = operationContext?.config.toolPayload;
    if (!config) throw new TypeError('MCP tool execution requires a tool-payload configuration projection.');
    return config;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {NonNullable<McpToolCapabilityProjection['toolSurface']>}
 */
export function requireMcpToolSurface(operationContext) {
    const surface = operationContext?.capabilities.toolSurface;
    if (!surface) throw new TypeError('MCP tool execution requires the effective tool-surface capability.');
    return surface;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/diagnostics/infra-health').McpInfraHealthCapability}
 */
export function requireMcpToolInfraHealthCapability(operationContext) {
    const capability = operationContext?.capabilities.infraHealth;
    if (!capability) throw new TypeError('MCP tool execution requires the composed Infra health capability.');
    return capability;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {NonNullable<McpToolCapabilityProjection['audit']>}
 */
export function requireMcpToolAuditCapability(operationContext) {
    const capability = operationContext?.capabilities.audit;
    if (!capability) throw new TypeError('MCP tool execution requires the composed audit capability.');
    return capability;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {NonNullable<McpToolCapabilityProjection['authIssuerRuntime']>}
 */
export function requireMcpToolAuthIssuerRuntime(operationContext) {
    const capability = operationContext?.capabilities.authIssuerRuntime;
    if (!capability) throw new TypeError('MCP tool execution requires the composed OAuth issuer runtime.');
    return capability;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {NonNullable<McpToolCapabilityProjection['aiArtifacts']>}
 */
export function requireMcpToolAiArtifactsCapability(operationContext) {
    const capability = operationContext?.capabilities.aiArtifacts;
    if (!capability) throw new TypeError('MCP tool execution requires the composed AI-artifacts capability.');
    return capability;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {NonNullable<McpToolCapabilityProjection['roundTripAnalytics']>}
 */
export function requireMcpToolRoundTripAnalyticsCapability(operationContext) {
    const capability = operationContext?.capabilities.roundTripAnalytics;
    if (!capability) throw new TypeError('MCP tool execution requires the composed round-trip analytics capability.');
    return capability;
}

/**
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {NonNullable<McpToolCapabilityProjection['modelGatewaySqliteFingerprint']>}
 */
export function requireMcpToolModelGatewaySqliteFingerprintCapability(operationContext) {
    const capability = operationContext?.capabilities.modelGatewaySqliteFingerprint;
    if (!capability)
        throw new TypeError('MCP tool execution requires the Model Gateway SQLite fingerprint capability.');
    return capability;
}

/**
 * @param {McpToolCapabilityProjection | undefined} capabilities
 * @returns {McpToolCapabilityProjection}
 */
function freezeToolCapabilities(capabilities) {
    return Object.freeze({
        ...(capabilities?.cloudflare ? { cloudflare: capabilities.cloudflare } : {}),
        ...(capabilities?.modelGatewayLiveRuns ? { modelGatewayLiveRuns: capabilities.modelGatewayLiveRuns } : {}),
        ...(capabilities?.infraHealth ? { infraHealth: capabilities.infraHealth } : {}),
        ...(capabilities?.httpSessionRuntime ? { httpSessionRuntime: capabilities.httpSessionRuntime } : {}),
        ...(capabilities?.audit ? { audit: capabilities.audit } : {}),
        ...(capabilities?.authIssuerRuntime ? { authIssuerRuntime: capabilities.authIssuerRuntime } : {}),
        ...(capabilities?.aiArtifacts ? { aiArtifacts: capabilities.aiArtifacts } : {}),
        ...(capabilities?.roundTripAnalytics ? { roundTripAnalytics: capabilities.roundTripAnalytics } : {}),
        ...(capabilities?.modelGatewaySqliteFingerprint
            ? { modelGatewaySqliteFingerprint: capabilities.modelGatewaySqliteFingerprint }
            : {}),
        ...(capabilities?.toolSurface
            ? {
                  toolSurface: Object.freeze({
                      tools: Object.freeze([...capabilities.toolSurface.tools]),
                      names: Object.freeze([...capabilities.toolSurface.names]),
                      ...(capabilities.toolSurface.descriptorFingerprint
                          ? { descriptorFingerprint: capabilities.toolSurface.descriptorFingerprint }
                          : {}),
                      ...(capabilities.toolSurface.descriptorFingerprintKind
                          ? { descriptorFingerprintKind: capabilities.toolSurface.descriptorFingerprintKind }
                          : {}),
                      ...(capabilities.toolSurface.toolDescriptorFingerprints
                          ? {
                                toolDescriptorFingerprints: Object.freeze({
                                    ...capabilities.toolSurface.toolDescriptorFingerprints,
                                }),
                            }
                          : {}),
                      ...(capabilities.toolSurface.toolDescriptorRevisionTokens
                          ? {
                                toolDescriptorRevisionTokens: Object.freeze({
                                    ...capabilities.toolSurface.toolDescriptorRevisionTokens,
                                }),
                            }
                          : {}),
                      ...(capabilities.toolSurface.resolveCanonicalSurfaces
                          ? { resolveCanonicalSurfaces: capabilities.toolSurface.resolveCanonicalSurfaces }
                          : {}),
                  }),
              }
            : {}),
    });
}

/**
 * @param {McpToolConfigProjection | undefined} config
 * @returns {McpToolConfigProjection}
 */
function freezeToolConfig(config) {
    return Object.freeze({
        ...(config?.connection ? { connection: config.connection } : {}),
        ...(config?.authConfig ? { authConfig: config.authConfig } : {}),
        ...(config?.authIssuer ? { authIssuer: config.authIssuer } : {}),
        ...(config?.cloudflare ? { cloudflare: config.cloudflare } : {}),
        ...(config?.companyKnowledge ? { companyKnowledge: config.companyKnowledge } : {}),
        ...(config?.devcontainerNetwork ? { devcontainerNetwork: config.devcontainerNetwork } : {}),
        ...(config?.ioCache ? { ioCache: config.ioCache } : {}),
        ...(config?.indexAutoBuild ? { indexAutoBuild: config.indexAutoBuild } : {}),
        ...(config?.latencyDashboard ? { latencyDashboard: config.latencyDashboard } : {}),
        ...(config?.reload ? { reload: config.reload } : {}),
        ...(config?.runtimeSourceGeneration ? { runtimeSourceGeneration: config.runtimeSourceGeneration } : {}),
        ...(config?.toolPayload ? { toolPayload: config.toolPayload } : {}),
        ...(config?.validation ? { validation: config.validation } : {}),
        ...(config?.git ? { git: config.git } : {}),
        ...(config?.repositoryReadCache ? { repositoryReadCache: config.repositoryReadCache } : {}),
        ...(config?.terminal ? { terminal: config.terminal } : {}),
    });
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeTimeoutMs(value) {
    if (value === undefined || value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, unknown>> | undefined}
 */
function freezeRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return Object.freeze({ .../** @type {Record<string, unknown>} */ (value) });
}

/**
 * @param {McpSdkRequestContext} serverContext
 * @param {Readonly<Record<string, unknown>> | undefined} envelope
 * @returns {McpProtocolEra}
 */
function inferProtocolEra(serverContext, envelope) {
    if (envelope) return '2026';
    if (serverContext.sessionId) return '2025';
    return 'unknown';
}
