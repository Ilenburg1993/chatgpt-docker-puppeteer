// @ts-check
/**
 * MCP application composition for process-scoped runtime services.
 *
 * This is the smallest layer entitled to know both the neutral process-host owner and today's concrete MCP/boot
 * services. Transport adapters receive only the resulting host capability; they never locate these dependencies.
 *
 * @module copilot/mcp/composition/process-host/runtime
 */

import {
    bootstrapApplicationInfraSqliteProvider,
    getApplicationInfraHost,
    getApplicationInfraRuntime,
    getApplicationSqliteDatabase,
    getApplicationWorkspaceInfra,
} from '#copilot/boot/application-infra';
import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { readIoRuntimeHealthSnapshot } from '#copilot/infra/public/observability';
import { readIoProcessHealthSnapshot } from '#copilot/infra/public/observability/process';
import {
    createDevOAuthRuntime,
    createMcpAuthResourceServerRuntime,
    createOAuthReplayCapability,
    scheduleMcpAuthJwksWarmup,
    stopMcpAuthJwksWarmup,
} from '#copilot/mcp/public/auth';
import { createCloudflareStateStore } from '#copilot/mcp/public/cloudflare/tunnel';
import { createMcpProcessConfig } from '#copilot/mcp/public/composition/process-config';
import { createMcpInfraHealthCapability } from '#copilot/mcp/public/diagnostics/infra-health';
import {
    scheduleOpenAiEndpointLatencyMonitor,
    stopOpenAiEndpointLatencyMonitor,
} from '#copilot/mcp/public/diagnostics/latency';
import {
    createMcpRoundTripAnalyticsCapability,
    scheduleMcpRoundTripAnalyticsMonitor,
    stopMcpRoundTripAnalyticsMonitor,
} from '#copilot/mcp/public/diagnostics/latency/round-trip';
import { maybeStartMcpIndexAutoBuild, readMcpIndexAutoBuildState } from '#copilot/mcp/public/indexing/auto-build';
import { createModelGatewaySqliteFingerprintCapability } from '#copilot/mcp/public/integrations/model-gateway/sqlite-fingerprint';
import { createAiArtifactsRuntime } from '#copilot/mcp/public/maintenance';
import { createMcpAuditCapability, logMcp } from '#copilot/mcp/public/observability';
import { createMcpProcessHost } from '#copilot/mcp/public/process/host';
import {
    scheduleMcpStartupMaintenance,
    stopMcpStartupMaintenance,
} from '#copilot/mcp/public/runtime/startup-maintenance';
import { MCP_WORKSPACE_ROOT, createMcpWorkspaceCapability } from '#copilot/mcp/public/workspace';
import { invalidateRepoReadResponseCache } from '#copilot/mcp/public/workspace/repository/read-cache';
import path from 'node:path';

/**
 * @param {{
 *     hostId?: string;
 *     backgroundServices?: boolean;
 *     workspaceWatch?: boolean;
 *     indexAutoBuild?: boolean;
 *     authJwksWarmup?: boolean;
 *     startupMaintenance?: boolean;
 *     openAiEndpointMonitor?: boolean;
 *     roundTripAnalyticsMonitor?: boolean;
 *     env?: NodeJS.ProcessEnv;
 *     processConfig?: import('#copilot/mcp/public/composition/process-config').McpProcessConfig;
 * }} [options]
 */
export function createComposedMcpProcessHost(options = {}) {
    const backgroundServices = options.backgroundServices !== false;
    const processConfig = options.processConfig ?? createMcpProcessConfig(options.env);
    const workspaceInfra = getApplicationWorkspaceInfra(MCP_WORKSPACE_ROOT);
    const workspace = createMcpWorkspaceCapability(workspaceInfra);
    const infraHealth = createMcpInfraHealthCapability(() => {
        const host = getApplicationInfraHost();
        return {
            runtime: readIoRuntimeHealthSnapshot(host.runtime),
            process: readIoProcessHealthSnapshot(host.processInfra),
        };
    });
    const audit = createMcpAuditCapability(processConfig.observability.audit);
    const oauthReplay = createOAuthReplayCapability(readComposedMcpSqliteDatabase, processConfig.auth.replay);
    const authResourceServer = createMcpAuthResourceServerRuntime(oauthReplay);
    const authIssuerRuntime = createDevOAuthRuntime({
        processConfig: processConfig.auth.issuer,
        replay: oauthReplay,
        compatibilityObserver: audit.recordCompatibility,
    });
    const authRuntime = Object.freeze({
        ...processConfig.auth,
        resourceServer: authResourceServer,
        issuerRuntime: authIssuerRuntime,
    });
    const aiArtifacts = createComposedAiArtifactsRuntime(workspace, workspaceInfra);
    const roundTripAnalytics = createMcpRoundTripAnalyticsCapability(readComposedMcpSqliteDatabase, audit);
    const modelGatewaySqliteFingerprint = createModelGatewaySqliteFingerprintCapability(readComposedMcpSqliteDatabase);
    const toolCapabilities = Object.freeze({
        ...processConfig.toolCapabilities,
        infraHealth,
        audit,
        authIssuerRuntime,
        aiArtifacts,
        roundTripAnalytics,
        modelGatewaySqliteFingerprint,
    });
    /** @type {import('#copilot/mcp/public/process/host').McpProcessHostService[]} */
    const services = [
        {
            name: 'workspace-repository-read-response-cache-coherence',
            required: true,
            start: () =>
                workspace.registerInvalidationHook((filePath, event) => {
                    invalidateRepoReadResponseCache(filePath, event);
                }),
        },
    ];

    if (backgroundServices && options.workspaceWatch !== false) {
        services.push({
            name: 'workspace-external-watch',
            start: async () => {
                const lease = await workspace.acquireExternalWatch();
                if (lease.started !== true || typeof lease.release !== 'function') return;
                return async () => {
                    lease.release();
                };
            },
        });
    }

    if (backgroundServices && options.indexAutoBuild !== false) {
        services.push({
            name: 'workspace-index-auto-build',
            start: () => {
                const before = readMcpIndexAutoBuildState(processConfig.indexing.autoBuild);
                if (before.status === 'completed' || before.status === 'running' || before.status === 'disabled')
                    return;
                const database = readComposedMcpSqliteDatabase();
                const controller = new AbortController();
                const build = maybeStartMcpIndexAutoBuild({
                    workspace,
                    config: processConfig.indexing.autoBuild,
                    gitConfig: processConfig.git,
                    signal: controller.signal,
                    reason: 'mcp-process-host-start',
                    ...(database ? { db: database } : {}),
                });
                void build.catch((error) => {
                    logMcp('WARN', 'MCP index auto-build failed in process host.', { error: errorMessage(error) });
                });
                // The process host owns this background generation. Teardown first invalidates/cancels it, then drains
                // the physical work so no Git subprocess or index phase leaks into a later host generation.
                return async () => {
                    controller.abort(new Error('MCP process host is stopping index auto-build.'));
                    await build.catch(() => undefined);
                };
            },
        });
    }

    if (backgroundServices && options.authJwksWarmup !== false) {
        services.push(
            scheduledService(
                'auth-jwks-warmup',
                () =>
                    scheduleMcpAuthJwksWarmup({
                        policy: processConfig.auth.jwksWarmup,
                        authConfig: processConfig.auth.config,
                        warmupRunner: () => authResourceServer.warmRemoteJwks({ config: processConfig.auth.config }),
                    }),
                stopMcpAuthJwksWarmup,
            ),
        );
    }
    if (backgroundServices && options.startupMaintenance !== false) {
        services.push({
            name: 'startup-maintenance',
            start() {
                const scheduled = scheduleMcpStartupMaintenance({
                    policy: processConfig.runtime.startupMaintenance,
                    workspace,
                    cloudflareConfig: processConfig.cloudflare,
                    gitConfig: processConfig.git,
                    audit,
                    cleanupRunner: () =>
                        createCloudflareStateStore(processConfig.cloudflare).cleanupStaleQuickTunnelState({
                            staleAfterMs: processConfig.cloudflare.staleAfterMs,
                        }),
                    rollbackCleanupRunner: () => cleanupRollbackStateAtStartup(workspaceInfra),
                });
                return scheduled ? stopMcpStartupMaintenance : undefined;
            },
        });
    }
    if (backgroundServices && options.openAiEndpointMonitor !== false) {
        services.push(
            scheduledService(
                'openai-endpoint-latency-monitor',
                () =>
                    scheduleOpenAiEndpointLatencyMonitor({
                        policy: processConfig.diagnostics.latency.owner.openAiMonitor,
                    }),
                stopOpenAiEndpointLatencyMonitor,
            ),
        );
    }
    if (backgroundServices && options.roundTripAnalyticsMonitor !== false) {
        services.push(
            scheduledService(
                'round-trip-analytics-monitor',
                () =>
                    scheduleMcpRoundTripAnalyticsMonitor({
                        policy: processConfig.diagnostics.latency.owner.roundTripMonitor,
                        // Background refresh is intentionally one chunk per cycle so a new analytics generation cannot
                        // monopolize the interactive process while replaying historical audit bytes. Explicit analytics
                        // calls retain the full catch-up budget.
                        syncFn: () => roundTripAnalytics.sync({ maxChunks: 1 }),
                    }),
                stopMcpRoundTripAnalyticsMonitor,
            ),
        );
    }

    const processHost = createMcpProcessHost({
        ...(options.hostId ? { hostId: options.hostId } : {}),
        prepare: () => prepareApplicationInfra(processConfig, audit),
        services,
        log: logMcp,
    });
    return Object.freeze({
        ...processHost,
        workspace,
        processConfig,
        toolCapabilities,
        authRuntime,
    });
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {ReturnType<typeof getApplicationWorkspaceInfra>} workspaceInfra
 */
function createComposedAiArtifactsRuntime(workspace, workspaceInfra) {
    const workspaceRoot = workspace.workspaceRoot;
    const policy = getApplicationInfraRuntime().config.rollback;
    const rollback = workspaceInfra.rollback;
    if (!rollback) throw new Error('MCP workspace is missing its rollback maintenance capability.');
    if (!path.isAbsolute(workspaceRoot) || !path.isAbsolute(policy.directory)) {
        throw new Error('MCP composition requires absolute workspace and rollback identities.');
    }
    const aiDir = path.join(workspaceRoot, 'src/copilot/.ai');
    const io = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'mcp.ai-artifacts.runtime',
            roots: [aiDir, policy.directory],
            operations: ['delete', 'list', 'stat'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory'],
        }),
    );
    return createAiArtifactsRuntime({
        workspaceRoot,
        rollbackPolicy: policy,
        rollbackMaintenance: rollback,
        io,
    });
}

/** @param {ReturnType<typeof getApplicationWorkspaceInfra>} workspaceInfra */
async function cleanupRollbackStateAtStartup(workspaceInfra) {
    const policy = getApplicationInfraRuntime().config.rollback;
    const rollback = workspaceInfra.rollback;
    if (!rollback) throw new Error('MCP workspace is missing its rollback maintenance capability.');
    const cleanup = await rollback.cleanupSidecars({
        enforceBudget: policy.enabled,
        maxEntries: policy.maxEntries,
        maxBytes: policy.maxBytes,
    });
    return {
        policy: {
            enabled: policy.enabled,
            ttlMs: policy.ttlMs,
            maxEntries: policy.maxEntries,
            maxBytes: policy.maxBytes,
        },
        ...cleanup,
    };
}

/**
 * Read the process-owned SQLite capability after ProcessHost.prepare(). Absence is explicit and degradable: callers
 * decide whether the operation they are composing can run without durable state.
 *
 * @returns {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort | null}
 */
export function readComposedMcpSqliteDatabase() {
    try {
        return getApplicationSqliteDatabase();
    } catch {
        return null;
    }
}

/**
 * @param {import('#copilot/mcp/public/composition/process-config').McpProcessConfig} processConfig
 * @param {ReturnType<typeof createMcpAuditCapability>} audit
 */
async function prepareApplicationInfra(processConfig, audit) {
    /** @type {{ capability: string; dispose: () => void | Promise<void> }[]} */
    const disposers = [{ capability: 'audit-runtime', dispose: () => audit.flush() }];

    await Promise.all([
        processConfig.toolCapabilities.cloudflare.prepare(),
        processConfig.toolCapabilities.modelGatewayLiveRuns.prepare(),
    ]);

    try {
        await bootstrapApplicationInfraSqliteProvider();
        getApplicationSqliteDatabase();
    } catch (error) {
        // SQLite is an application capability, not a prerequisite for every MCP endpoint. Preserve degradable startup
        // while keeping non-database capabilities independently configured above.
        logMcp('WARN', 'MCP application infra SQLite bootstrap failed; continuing in degraded mode.', {
            error: errorMessage(error),
        });
    }

    return async () => {
        /** @type {Error[]} */
        const failures = [];
        for (const entry of disposers.reverse()) {
            try {
                await entry.dispose();
            } catch (error) {
                failures.push(error instanceof Error ? error : new Error(String(error)));
                logMcp('ERROR', 'MCP process capability revocation failed.', {
                    capability: entry.capability,
                    error: errorMessage(error),
                });
            }
        }
        if (failures.length > 0) {
            throw new AggregateError(failures, `MCP process capability revocation failed (${failures.length}).`);
        }
    };
}

/**
 * Create a service whose disposer is owned only when this host successfully scheduled the underlying singleton.
 *
 * @param {string} name
 * @param {() => boolean} schedule
 * @param {() => Promise<void>} stop
 */
function scheduledService(name, schedule, stop) {
    return Object.freeze({
        name,
        start() {
            return schedule() ? stop : undefined;
        },
    });
}

/** @param {unknown} error */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
