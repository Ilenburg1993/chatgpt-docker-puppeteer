// @ts-check
/**
 * Delayed, non-blocking MCP startup maintenance.
 *
 * @module copilot/mcp/runtime/startup-maintenance/runtime
 */

import { runMcpWorkspaceSmoke } from '#copilot/mcp/public/diagnostics/workspace-smoke';
import { reapCompletedDetachedLiveRuns } from '#copilot/mcp/public/integrations/model-gateway/live-runs';
import { logMcp } from '#copilot/mcp/public/observability';
import { readMcpStartupMaintenanceConfig } from './config.js';

/** @type {NodeJS.Timeout | null} */
let startupTimer = null;
/** @type {Promise<void> | null} */
let startupRunPromise = null;
let startupGeneration = 0;
let startupState = {
    scheduled: false,
    running: false,
    completed: false,
    scheduledAt: /** @type {string | null} */ (null),
    startedAt: /** @type {string | null} */ (null),
    completedAt: /** @type {string | null} */ (null),
    success: /** @type {boolean | null} */ (null),
    error: /** @type {string | null} */ (null),
    staleQuickTunnelStateRemoved: false,
    detachedLiveRunsReaped: 0,
    detachedLiveRunReaperFailures: 0,
};

/**
 * @param {{
 *     policy?: import('./config.js').McpStartupMaintenanceConfig;
 *     delayMs?: number;
 *     enabled?: boolean;
 *     setTimeoutFn?: typeof setTimeout;
 *     workspace?: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     cloudflareConfig?: import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig;
 *     gitConfig?: import('#copilot/mcp/public/workspace/git').McpGitProcessConfig;
 *     audit?: ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>;
 *     smokeRunner?: () => Promise<Record<string, unknown>>;
 *     cleanupRunner?: () => Promise<{ removed: boolean }>;
 *     rollbackCleanupRunner?: () => Promise<Record<string, unknown> | null>;
 *     detachedLiveReaper?: () => Promise<{ reapedCount?: number; failureCount?: number } | null>;
 * }} [options]
 * @returns {boolean}
 */
export function scheduleMcpStartupMaintenance(options = {}) {
    if (startupState.scheduled || startupState.running || startupState.completed) return false;
    const policy = options.policy ?? readMcpStartupMaintenanceConfig();
    const enabled = options.enabled ?? policy.enabled;
    if (!enabled) return false;
    const delayMs = normalizeDelay(options.delayMs ?? policy.delayMs);
    const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    const smokeRunner =
        options.smokeRunner ??
        (() => {
            if (!options.workspace) throw new TypeError('MCP startup maintenance requires a workspace capability.');
            if (!options.cloudflareConfig)
                throw new TypeError('MCP startup maintenance requires a Cloudflare config projection.');
            if (!options.gitConfig)
                throw new TypeError('MCP startup maintenance requires a Git process config projection.');
            return runMcpWorkspaceSmoke(options.workspace, options.cloudflareConfig, { gitConfig: options.gitConfig });
        });
    const cleanupRunner = options.cleanupRunner ?? requireCleanupRunner;
    const rollbackCleanupRunner = options.rollbackCleanupRunner ?? noRollbackCleanup;
    const detachedLiveReaper =
        options.detachedLiveReaper ??
        (() => {
            if (!options.workspace) throw new TypeError('MCP startup maintenance requires a workspace capability.');
            return reapCompletedDetachedLiveRuns(options.workspace, {
                ...(options.audit ? { audit: options.audit } : {}),
            });
        });

    const generation = ++startupGeneration;
    startupState = {
        ...startupState,
        scheduled: true,
        scheduledAt: new Date().toISOString(),
    };
    startupTimer = setTimeoutFn(() => {
        startupTimer = null;
        if (generation !== startupGeneration) return;
        const run = runStartupMaintenance(
            smokeRunner,
            cleanupRunner,
            rollbackCleanupRunner,
            detachedLiveReaper,
            generation,
        );
        startupRunPromise = run;
        void run.finally(() => {
            if (startupRunPromise === run) startupRunPromise = null;
        });
    }, delayMs);
    if (typeof startupTimer?.unref === 'function') startupTimer.unref();
    return true;
}

/**
 * @returns {typeof startupState}
 */
export function readMcpStartupMaintenanceState() {
    return { ...startupState };
}

/**
 * Cancel delayed startup work and wait for any current generation to settle. Work that belongs to an invalidated
 * generation cannot continue into later startup phases or publish completion state.
 *
 * @returns {Promise<void>}
 */
export async function stopMcpStartupMaintenance() {
    startupGeneration += 1;
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
    startupState = { ...startupState, scheduled: false };
    const activeRun = startupRunPromise;
    if (activeRun) await activeRun.catch(() => undefined);
    startupState = { ...startupState, scheduled: false, running: false };
}

/**
 * @returns {void}
 */
export function resetMcpStartupMaintenanceForTests() {
    startupGeneration += 1;
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
    startupRunPromise = null;
    startupState = {
        scheduled: false,
        running: false,
        completed: false,
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
        success: null,
        error: null,
        staleQuickTunnelStateRemoved: false,
        detachedLiveRunsReaped: 0,
        detachedLiveRunReaperFailures: 0,
    };
}

/**
 * @param {() => Promise<Record<string, unknown>>} smokeRunner
 * @param {() => Promise<{ removed: boolean }>} cleanupRunner
 * @param {() => Promise<Record<string, unknown> | null>} rollbackCleanupRunner
 * @param {() => Promise<{ reapedCount?: number; failureCount?: number } | null>} detachedLiveReaper
 * @param {number} generation
 */
async function runStartupMaintenance(
    smokeRunner,
    cleanupRunner,
    rollbackCleanupRunner,
    detachedLiveReaper,
    generation,
) {
    if (generation !== startupGeneration) return;
    startupState = {
        ...startupState,
        scheduled: false,
        running: true,
        startedAt: new Date().toISOString(),
    };
    try {
        const cleanup = await cleanupRunner();
        if (generation !== startupGeneration) return;
        let rollbackCleanup = null;
        try {
            rollbackCleanup = await rollbackCleanupRunner();
        } catch (error) {
            logMcp('WARN', 'MCP startup rollback cleanup failed without blocking workspace smoke.', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        if (generation !== startupGeneration) return;
        let detachedLiveReap = null;
        try {
            detachedLiveReap = await detachedLiveReaper();
        } catch (error) {
            detachedLiveReap = { reapedCount: 0, failureCount: 1 };
            logMcp('WARN', 'MCP startup detached LLM-B reaper failed without blocking workspace smoke.', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        if (generation !== startupGeneration) return;
        const smoke = await smokeRunner();
        if (generation !== startupGeneration) return;
        const success = smoke['success'] === true;
        startupState = {
            ...startupState,
            running: false,
            completed: true,
            completedAt: new Date().toISOString(),
            success,
            error: success ? null : 'workspace-smoke-reported-failure',
            staleQuickTunnelStateRemoved: cleanup.removed === true,
            detachedLiveRunsReaped: Number(detachedLiveReap?.reapedCount ?? 0),
            detachedLiveRunReaperFailures: Number(detachedLiveReap?.failureCount ?? 0),
        };
        logMcp(success ? 'INFO' : 'WARN', 'MCP startup workspace smoke completed.', {
            success,
            staleQuickTunnelStateRemoved: cleanup.removed === true,
            rollbackCleanup,
            detachedLiveReap,
            status: smoke['status'] ?? null,
        });
    } catch (error) {
        if (generation !== startupGeneration) return;
        startupState = {
            ...startupState,
            running: false,
            completed: true,
            completedAt: new Date().toISOString(),
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
        logMcp('WARN', 'MCP startup workspace smoke failed.', { error: startupState.error });
    }
}

/** @returns {Promise<{ removed: boolean }>} */
async function requireCleanupRunner() {
    throw new TypeError('MCP startup maintenance requires a composed quick-tunnel cleanup runner.');
}

async function noRollbackCleanup() {
    return null;
}

/**
 * @param {unknown} value
 */
function normalizeDelay(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 15_000;
    return Math.min(10 * 60 * 1000, Math.round(numeric));
}
