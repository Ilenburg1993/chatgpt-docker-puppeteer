// @ts-check
/**
 * Canonical immutable MCP process configuration snapshot.
 *
 * This composition owner is the only production layer that should turn ambient process environment into the
 * cross-owner configuration projections consumed by listeners and server factories. Domain owners retain their own
 * parsers; composition evaluates them once at process construction so request semantics do not drift when process.env
 * changes later.
 *
 * @module copilot/mcp/composition/process-config/runtime
 */

import { readMcpHttpRequestPolicy } from '#copilot/mcp/public/adapters/http-config';
import { readMcpHttp1ListenerConfig } from '#copilot/mcp/public/adapters/http1';
import { readMcpHttp2ListenerConfig } from '#copilot/mcp/public/adapters/http2';
import {
    readDevOAuthProcessConfig,
    readMcpAuthJwksWarmupPolicy,
    readMcpAuthRuntimeConfig,
    readOAuthReplayStoreConfig,
} from '#copilot/mcp/public/auth';
import { readCloudflareTunnelConfig } from '#copilot/mcp/public/cloudflare/config';
import { createCloudflareEnvironmentAuthority } from '#copilot/mcp/public/cloudflare/environment-authority';
import { readCompanyKnowledgeProcessConfig } from '#copilot/mcp/public/company-knowledge';
import { createMcpConnectionRuntimeConfig, readMcpConnectionConfig } from '#copilot/mcp/public/connection';
import { readMcpDevcontainerNetworkConfig } from '#copilot/mcp/public/diagnostics/devcontainer-network';
import { readMcpIoCacheProcessConfig } from '#copilot/mcp/public/diagnostics/io-cache';
import { createMcpLatencyRuntimeConfig, readMcpLatencyProcessConfig } from '#copilot/mcp/public/diagnostics/latency';
import { readMcpToolPayloadAuditConfig } from '#copilot/mcp/public/diagnostics/tool-payload';
import { readMcpIndexAutoBuildConfig } from '#copilot/mcp/public/indexing/auto-build';
import { createModelGatewayLiveRunEnvironmentAuthority } from '#copilot/mcp/public/integrations/model-gateway/live-runs';
import { readMcpAuditProcessConfig } from '#copilot/mcp/public/observability';
import { readMcpTerminalProcessConfig } from '#copilot/mcp/public/process/terminal';
import { readMcpRegistryPolicy, readMcpToolSurfacePolicy } from '#copilot/mcp/public/registry';
import { readMcpReloadProcessConfig } from '#copilot/mcp/public/runtime/reload';
import { createMcpRuntimeSourceGeneration } from '#copilot/mcp/public/runtime/source-generation';
import { readMcpStartupMaintenanceConfig } from '#copilot/mcp/public/runtime/startup-maintenance';
import { readCopilotMcpServerProfile } from '#copilot/mcp/public/server';
import { readMcpHttpStatefulProcessConfig } from '#copilot/mcp/public/transport/http/stateful/config';
import { readMcpValidationProcessConfig } from '#copilot/mcp/public/validation';
import { createMcpGitProcessConfig } from '#copilot/mcp/public/workspace/git';
import { readMcpRepositoryPatchConfig } from '#copilot/mcp/public/workspace/repository/patch/config';
import { readMcpRepoReadCacheConfig } from '#copilot/mcp/public/workspace/repository/read-cache';

export const MCP_PROCESS_CONFIG_SCHEMA_VERSION = 1;

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     server: ReturnType<typeof readCopilotMcpServerProfile>;
 *     registry: Readonly<{
 *         policy: ReturnType<typeof readMcpRegistryPolicy>;
 *         surfacePolicy: ReturnType<typeof readMcpToolSurfacePolicy>;
 *     }>;
 *     auth: Readonly<ReturnType<typeof readMcpAuthRuntimeConfig> & {
 *         jwksWarmup: ReturnType<typeof readMcpAuthJwksWarmupPolicy>;
 *         replay: ReturnType<typeof readOAuthReplayStoreConfig>;
 *         issuer: ReturnType<typeof readDevOAuthProcessConfig>;
 *     }>;
 *     cloudflare: ReturnType<typeof readCloudflareTunnelConfig>;
 *     companyKnowledge: ReturnType<typeof readCompanyKnowledgeProcessConfig>;
 *     connection: ReturnType<typeof readMcpConnectionConfig>;
 *     diagnostics: Readonly<{
 *         devcontainerNetwork: ReturnType<typeof readMcpDevcontainerNetworkConfig>;
 *         ioCache: ReturnType<typeof readMcpIoCacheProcessConfig>;
 *         latency: ReturnType<typeof createMcpLatencyRuntimeConfig>;
 *     }>;
 *     indexing: Readonly<{ autoBuild: ReturnType<typeof readMcpIndexAutoBuildConfig> }>;
 *     observability: Readonly<{
 *         audit: ReturnType<typeof readMcpAuditProcessConfig>;
 *     }>;
 *     runtime: Readonly<{
 *         reload: ReturnType<typeof readMcpReloadProcessConfig>;
 *         sourceGeneration: ReturnType<typeof createMcpRuntimeSourceGeneration>;
 *         startupMaintenance: ReturnType<typeof readMcpStartupMaintenanceConfig>;
 *     }>;
 *     validation: ReturnType<typeof readMcpValidationProcessConfig>;
 *     git: ReturnType<typeof createMcpGitProcessConfig>;
 *     repositoryPatch: ReturnType<typeof readMcpRepositoryPatchConfig>;
 *     repositoryReadCache: ReturnType<typeof readMcpRepoReadCacheConfig>;
 *     terminal: ReturnType<typeof readMcpTerminalProcessConfig>;
 *     toolCapabilities: Readonly<{
 *         cloudflare: ReturnType<typeof createCloudflareEnvironmentAuthority>;
 *         modelGatewayLiveRuns: ReturnType<typeof createModelGatewayLiveRunEnvironmentAuthority>;
 *     }>;
 *     toolConfig: Readonly<{
 *         connection: ReturnType<typeof createMcpConnectionRuntimeConfig>;
 *         authConfig: ReturnType<typeof readMcpAuthRuntimeConfig>['config'];
 *         authIssuer: ReturnType<typeof readDevOAuthProcessConfig>;
 *         cloudflare: ReturnType<typeof readCloudflareTunnelConfig>;
 *         companyKnowledge: ReturnType<typeof readCompanyKnowledgeProcessConfig>;
 *         devcontainerNetwork: ReturnType<typeof readMcpDevcontainerNetworkConfig>;
 *         ioCache: ReturnType<typeof readMcpIoCacheProcessConfig>;
 *         indexAutoBuild: ReturnType<typeof readMcpIndexAutoBuildConfig>;
 *         latencyDashboard: ReturnType<typeof readMcpLatencyProcessConfig>['dashboard'];
 *         reload: ReturnType<typeof readMcpReloadProcessConfig>;
 *         runtimeSourceGeneration: ReturnType<typeof createMcpRuntimeSourceGeneration>;
 *         toolPayload: ReturnType<typeof readMcpToolPayloadAuditConfig>;
 *         validation: ReturnType<typeof readMcpValidationProcessConfig>;
 *         git: ReturnType<typeof createMcpGitProcessConfig>;
 *         repositoryPatch: ReturnType<typeof readMcpRepositoryPatchConfig>;
 *         repositoryReadCache: ReturnType<typeof readMcpRepoReadCacheConfig>;
 *         terminal: ReturnType<typeof readMcpTerminalProcessConfig>;
 *     }>;
 *     transport: Readonly<{
 *         http1: ReturnType<typeof readMcpHttp1ListenerConfig>;
 *         http2: ReturnType<typeof readMcpHttp2ListenerConfig>;
 *         http: Readonly<{
 *             request: ReturnType<typeof readMcpHttpRequestPolicy>;
 *             stateful: ReturnType<typeof readMcpHttpStatefulProcessConfig>;
 *         }>;
 *     }>;
 * }>} McpProcessConfig
 */

/**
 * Capture one process-scoped configuration generation from an explicit environment projection.
 *
 * The raw environment is deliberately not retained on the returned object. Secrets and unrelated ambient variables
 * therefore do not become a generic configuration bag that downstream owners can rediscover.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpProcessConfig}
 */
export function createMcpProcessConfig(env = process.env) {
    const authRuntime = readMcpAuthRuntimeConfig(env);
    const auth = Object.freeze({
        ...authRuntime,
        jwksWarmup: readMcpAuthJwksWarmupPolicy(env),
        replay: readOAuthReplayStoreConfig(env),
        issuer: readDevOAuthProcessConfig(env),
    });
    const cloudflare = readCloudflareTunnelConfig(env);
    const cloudflareAuthority = createCloudflareEnvironmentAuthority(env);
    const companyKnowledge = readCompanyKnowledgeProcessConfig(env);
    const connection = readMcpConnectionConfig(env, { authConfig: auth.config });
    const connectionRuntime = createMcpConnectionRuntimeConfig(connection, cloudflare);
    const devcontainerNetwork = readMcpDevcontainerNetworkConfig(env);
    const ioCache = readMcpIoCacheProcessConfig(env);
    const latency = readMcpLatencyProcessConfig(env);
    const indexAutoBuild = readMcpIndexAutoBuildConfig(env);
    const latencyRuntime = createMcpLatencyRuntimeConfig(latency, cloudflare);
    const audit = readMcpAuditProcessConfig(env);
    const reload = readMcpReloadProcessConfig(env);
    const sourceGeneration = createMcpRuntimeSourceGeneration(env);
    const toolPayload = readMcpToolPayloadAuditConfig(env);
    const startupMaintenance = readMcpStartupMaintenanceConfig(env);
    const stateful = readMcpHttpStatefulProcessConfig(env);
    const validation = readMcpValidationProcessConfig(env);
    const git = createMcpGitProcessConfig(env);
    const repositoryPatch = readMcpRepositoryPatchConfig(env);
    const repositoryReadCache = readMcpRepoReadCacheConfig(env);
    const terminal = readMcpTerminalProcessConfig(env);
    const modelGatewayLiveRuns = createModelGatewayLiveRunEnvironmentAuthority(env);
    return /** @type {McpProcessConfig} */ (
        deepFreeze({
            schemaVersion: MCP_PROCESS_CONFIG_SCHEMA_VERSION,
            server: readCopilotMcpServerProfile(env),
            registry: {
                policy: readMcpRegistryPolicy(env),
                surfacePolicy: readMcpToolSurfacePolicy(env),
            },
            auth,
            cloudflare,
            companyKnowledge,
            connection,
            diagnostics: { devcontainerNetwork, ioCache, latency: latencyRuntime },
            indexing: { autoBuild: indexAutoBuild },
            observability: { audit },
            runtime: { reload, sourceGeneration, startupMaintenance },
            validation,
            git,
            repositoryPatch,
            repositoryReadCache,
            terminal,
            toolCapabilities: { cloudflare: cloudflareAuthority, modelGatewayLiveRuns },
            toolConfig: {
                connection: connectionRuntime,
                cloudflare,
                authConfig: auth.config,
                authIssuer: auth.issuer,
                companyKnowledge,
                devcontainerNetwork,
                ioCache,
                indexAutoBuild,
                latencyDashboard: latency.dashboard,
                reload,
                runtimeSourceGeneration: sourceGeneration,
                toolPayload,
                validation,
                git,
                repositoryPatch,
                repositoryReadCache,
                terminal,
            },
            transport: {
                http1: readMcpHttp1ListenerConfig(env),
                http2: readMcpHttp2ListenerConfig(env),
                http: {
                    stateful,
                    request: readMcpHttpRequestPolicy(env, { statefulConfig: stateful }),
                },
            },
        })
    );
}

/**
 * Freeze plain configuration graphs recursively. Set/Map instances are treated as atomic values because their domain
 * parsers own their semantics; no raw environment object is retained or exposed.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    if (value instanceof Set) return /** @type {T} */ (hardenSet(value));
    if (value instanceof Map) return /** @type {T} */ (hardenMap(value));
    if (value instanceof Date) return Object.freeze(value);
    for (const child of Object.values(/** @type {Record<string, unknown>} */ (value))) deepFreeze(child);
    return Object.freeze(value);
}

/** @template T @param {Set<T>} value */
function hardenSet(value) {
    for (const child of value.values()) deepFreeze(child);
    Object.defineProperties(value, {
        add: {
            value: () => {
                throw new TypeError('McpProcessConfig Set is immutable.');
            },
        },
        delete: {
            value: () => {
                throw new TypeError('McpProcessConfig Set is immutable.');
            },
        },
        clear: {
            value: () => {
                throw new TypeError('McpProcessConfig Set is immutable.');
            },
        },
    });
    return Object.freeze(value);
}

/** @template K,V @param {Map<K,V>} value */
function hardenMap(value) {
    for (const child of value.values()) deepFreeze(child);
    Object.defineProperties(value, {
        set: {
            value: () => {
                throw new TypeError('McpProcessConfig Map is immutable.');
            },
        },
        delete: {
            value: () => {
                throw new TypeError('McpProcessConfig Map is immutable.');
            },
        },
        clear: {
            value: () => {
                throw new TypeError('McpProcessConfig Map is immutable.');
            },
        },
    });
    return Object.freeze(value);
}
