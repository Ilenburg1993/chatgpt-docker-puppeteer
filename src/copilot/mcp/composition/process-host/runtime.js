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
    configurePersistentOAuthReplayStore,
    createConfiguredOAuthReplayStore,
    scheduleMcpAuthJwksWarmup,
    stopMcpAuthJwksWarmup,
} from '#copilot/mcp/public/auth';
import { configureMcpInfraHealthReader } from '#copilot/mcp/public/diagnostics/infra-health';
import {
    configureMcpRoundTripAnalytics,
    scheduleMcpRoundTripAnalyticsMonitor,
    scheduleOpenAiEndpointLatencyMonitor,
    stopMcpRoundTripAnalyticsMonitor,
    stopOpenAiEndpointLatencyMonitor,
} from '#copilot/mcp/public/diagnostics/latency';
import { maybeStartMcpIndexAutoBuild, readMcpIndexAutoBuildState } from '#copilot/mcp/public/indexing/auto-build';
import { configureModelGatewayIntegrationDatabase } from '#copilot/mcp/public/integrations/model-gateway/sqlite-fingerprint';
import { configureAiArtifactsRuntime, createAiArtifactsRuntime } from '#copilot/mcp/public/maintenance';
import { logMcp } from '#copilot/mcp/public/observability';
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
 * }} [options]
 */
export function createComposedMcpProcessHost(options = {}) {
    const backgroundServices = options.backgroundServices !== false;
    const workspaceInfra = getApplicationWorkspaceInfra(MCP_WORKSPACE_ROOT);
    const workspace = createMcpWorkspaceCapability(workspaceInfra);
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
                const before = readMcpIndexAutoBuildState();
                if (before.status === 'completed' || before.status === 'running' || before.status === 'disabled')
                    return;
                const database = readComposedMcpSqliteDatabase();
                const build = maybeStartMcpIndexAutoBuild({
                    workspace,
                    reason: 'mcp-process-host-start',
                    ...(database ? { db: database } : {}),
                });
                void build.catch((error) => {
                    logMcp('WARN', 'MCP index auto-build failed in process host.', { error: errorMessage(error) });
                });
                // The index builder does not yet expose cancellation. The host therefore owns completion and drains it
                // during teardown instead of pretending that fire-and-forget work has stopped.
                return async () => {
                    await build.catch(() => undefined);
                };
            },
        });
    }

    if (backgroundServices && options.authJwksWarmup !== false) {
        services.push(scheduledService('auth-jwks-warmup', scheduleMcpAuthJwksWarmup, stopMcpAuthJwksWarmup));
    }
    if (backgroundServices && options.startupMaintenance !== false) {
        services.push({
            name: 'startup-maintenance',
            start() {
                const scheduled = scheduleMcpStartupMaintenance({
                    workspace,
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
                scheduleOpenAiEndpointLatencyMonitor,
                stopOpenAiEndpointLatencyMonitor,
            ),
        );
    }
    if (backgroundServices && options.roundTripAnalyticsMonitor !== false) {
        services.push(
            scheduledService(
                'round-trip-analytics-monitor',
                scheduleMcpRoundTripAnalyticsMonitor,
                stopMcpRoundTripAnalyticsMonitor,
            ),
        );
    }

    const processHost = createMcpProcessHost({
        ...(options.hostId ? { hostId: options.hostId } : {}),
        prepare: () => prepareApplicationInfra(workspace, workspaceInfra),
        services,
        log: logMcp,
    });
    return Object.freeze({ ...processHost, workspace });
}

/**
 * Remove expired rollback sidecars and enforce the process-owned rollback budget. This belongs to composition because
 * it combines application runtime policy with the concrete MCP workspace rollback capability.
 */
function configureComposedInfraHealthReader() {
    return configureMcpInfraHealthReader(() => {
        const host = getApplicationInfraHost();
        return {
            runtime: readIoRuntimeHealthSnapshot(host.runtime),
            process: readIoProcessHealthSnapshot(host.processInfra),
        };
    });
}

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {ReturnType<typeof getApplicationWorkspaceInfra>} workspaceInfra
 */
function configureComposedAiArtifactsRuntime(workspace, workspaceInfra) {
    const workspaceRoot = workspace.workspaceRoot;
    const policy = getApplicationInfraRuntime().config.rollback;
    const rollback = workspaceInfra.rollback;
    if (!rollback) throw new Error('MCP workspace is missing its rollback maintenance capability.');
    const aiDir = path.join(workspaceRoot, 'src/copilot/.ai');
    const io = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'mcp.ai-artifacts.runtime',
            roots: [aiDir, path.resolve(policy.directory)],
            operations: ['delete', 'list', 'stat'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory'],
        }),
    );
    return configureAiArtifactsRuntime(
        createAiArtifactsRuntime({
            workspaceRoot,
            rollbackPolicy: policy,
            rollbackMaintenance: rollback,
            io,
        }),
    );
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
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {ReturnType<typeof getApplicationWorkspaceInfra>} workspaceInfra
 */
async function prepareApplicationInfra(workspace, workspaceInfra) {
    /** @type {{ capability: string; dispose: () => void | Promise<void> }[]} */
    const disposers = [];
    const configure = (
        /** @type {string} */ capability,
        /** @type {() => void | (() => void | Promise<void>)} */ factory,
    ) => {
        const dispose = configureOptionalProcessCapability(capability, factory);
        if (dispose) disposers.push({ capability, dispose });
    };

    configure('infra-health', configureComposedInfraHealthReader);
    configure('ai-artifacts', () => configureComposedAiArtifactsRuntime(workspace, workspaceInfra));

    try {
        await bootstrapApplicationInfraSqliteProvider();
        const database = getApplicationSqliteDatabase();
        configure('oauth-replay-store', () =>
            configurePersistentOAuthReplayStore(createConfiguredOAuthReplayStore(database)),
        );
        configure('round-trip-analytics', () => configureMcpRoundTripAnalytics(database));
        configure('model-gateway-sqlite-fingerprint', () => configureModelGatewayIntegrationDatabase(database));
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
 * Optional process capabilities fail independently. One diagnostic/persistence projection must never prevent unrelated
 * capabilities from being composed or turn an otherwise usable MCP process into a false all-or-nothing bootstrap.
 *
 * @param {string} capability
 * @param {() => void | (() => void | Promise<void>)} configure
 * @returns {(() => void | Promise<void>) | null}
 */
function configureOptionalProcessCapability(capability, configure) {
    try {
        const dispose = configure();
        return typeof dispose === 'function' ? dispose : null;
    } catch (error) {
        logMcp('WARN', 'MCP optional process capability configuration failed.', {
            capability,
            error: errorMessage(error),
        });
        return null;
    }
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
