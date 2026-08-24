// @ts-check
/**
 * Delayed, non-blocking MCP startup maintenance.
 *
 * @module copilot/mcp/runtime/startup-maintenance/runtime
 */

import { readCloudflareTunnelConfig } from '#copilot/mcp/public/cloudflare/config';
import { createCloudflareStateStore } from '#copilot/mcp/public/cloudflare/state';
import { runMcpWorkspaceSmoke } from '#copilot/mcp/public/diagnostics/workspace-smoke';
import { reapCompletedDetachedLiveRuns } from '#copilot/mcp/public/integrations/model-gateway/live-runs';
import { logMcp } from '#copilot/mcp/public/observability';

const DEFAULT_STARTUP_SMOKE_DELAY_MS = 15_000;

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
 *     delayMs?: number;
 *     enabled?: boolean;
 *     setTimeoutFn?: typeof setTimeout;
 *     workspace?: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     smokeRunner?: () => Promise<Record<string, unknown>>;
 *     cleanupRunner?: () => Promise<{ removed: boolean }>;
 *     rollbackCleanupRunner?: () => Promise<Record<string, unknown> | null>;
 *     detachedLiveReaper?: () => Promise<{ reapedCount?: number; failureCount?: number } | null>;
 * }} [options]
 * @returns {boolean}
 */
export function scheduleMcpStartupMaintenance(options = {}) {
    if (startupState.scheduled || startupState.running || startupState.completed) return false;
    const defaultEnabled = process.env['NODE_ENV'] !== 'test' && !process.env['VITEST'];
    const enabled = options.enabled ?? readBooleanEnv('COPILOT_MCP_STARTUP_SMOKE_ENABLED', defaultEnabled);
    if (!enabled) return false;
    const delayMs = normalizeDelay(options.delayMs ?? Number(process.env['COPILOT_MCP_STARTUP_SMOKE_DELAY_MS']));
    const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    const smokeRunner =
        options.smokeRunner ??
        (() => {
            if (!options.workspace) throw new TypeError('MCP startup maintenance requires a workspace capability.');
            return runMcpWorkspaceSmoke(options.workspace);
        });
    const cleanupRunner = options.cleanupRunner ?? cleanupQuickTunnelStateAtStartup;
    const rollbackCleanupRunner = options.rollbackCleanupRunner ?? noRollbackCleanup;
    const detachedLiveReaper =
        options.detachedLiveReaper ??
        (() => {
            if (!options.workspace) throw new TypeError('MCP startup maintenance requires a workspace capability.');
            return reapCompletedDetachedLiveRuns(options.workspace);
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

async function cleanupQuickTunnelStateAtStartup() {
    const config = readCloudflareTunnelConfig();
    return createCloudflareStateStore(config).cleanupStaleQuickTunnelState({ staleAfterMs: config.staleAfterMs });
}

async function noRollbackCleanup() {
    return null;
}

/**
 * @param {unknown} value
 */
function normalizeDelay(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return DEFAULT_STARTUP_SMOKE_DELAY_MS;
    return Math.min(10 * 60 * 1000, Math.round(numeric));
}

/**
 * @param {string} name
 * @param {boolean} fallback
 */
function readBooleanEnv(name, fallback) {
    const value = String(process.env[name] ?? '')
        .trim()
        .toLowerCase();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value);
}
