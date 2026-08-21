// @ts-check
/**
 * Delayed, non-blocking MCP startup maintenance.
 *
 * @module copilot/mcp/control-plane/startup-maintenance
 */

import { getApplicationInfraRuntime } from '#copilot/boot';
import { cleanupRollbackSidecars } from '#copilot/infra/public/operations';
import { readCloudflareTunnelConfig } from '../cloudflare/config.js';
import { createCloudflareStateStore } from '../cloudflare/state.js';
import { logMcp } from './audit.js';

const DEFAULT_STARTUP_SMOKE_DELAY_MS = 15_000;

/** @type {NodeJS.Timeout | null} */
let startupTimer = null;
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
    const smokeRunner = options.smokeRunner ?? runWorkspaceSmoke;
    const cleanupRunner = options.cleanupRunner ?? cleanupQuickTunnelStateAtStartup;
    const rollbackCleanupRunner = options.rollbackCleanupRunner ?? cleanupRollbackStateAtStartup;
    const detachedLiveReaper = options.detachedLiveReaper ?? reapCompletedDetachedLiveRunsAtStartup;

    startupState = {
        ...startupState,
        scheduled: true,
        scheduledAt: new Date().toISOString(),
    };
    startupTimer = setTimeoutFn(() => {
        startupTimer = null;
        void runStartupMaintenance(smokeRunner, cleanupRunner, rollbackCleanupRunner, detachedLiveReaper);
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
 * @returns {void}
 */
export function resetMcpStartupMaintenanceForTests() {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
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
 */
async function runStartupMaintenance(smokeRunner, cleanupRunner, rollbackCleanupRunner, detachedLiveReaper) {
    startupState = {
        ...startupState,
        scheduled: false,
        running: true,
        startedAt: new Date().toISOString(),
    };
    try {
        const cleanup = await cleanupRunner();
        let rollbackCleanup = null;
        try {
            rollbackCleanup = await rollbackCleanupRunner();
        } catch (error) {
            logMcp('WARN', 'MCP startup rollback cleanup failed without blocking workspace smoke.', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        let detachedLiveReap = null;
        try {
            detachedLiveReap = await detachedLiveReaper();
        } catch (error) {
            detachedLiveReap = { reapedCount: 0, failureCount: 1 };
            logMcp('WARN', 'MCP startup detached LLM-B reaper failed without blocking workspace smoke.', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        const smoke = await smokeRunner();
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

async function runWorkspaceSmoke() {
    const { mcpSmokeWorkspaceTool } = await import('../tools/smoke-workspace.js');
    const result = await mcpSmokeWorkspaceTool.handler({});
    return /** @type {Record<string, unknown>} */ (result.structuredContent ?? {});
}

async function cleanupQuickTunnelStateAtStartup() {
    const config = readCloudflareTunnelConfig();
    return createCloudflareStateStore(config).cleanupStaleQuickTunnelState({ staleAfterMs: config.staleAfterMs });
}

async function reapCompletedDetachedLiveRunsAtStartup() {
    const { reapCompletedDetachedLiveRuns } = await import('../tools/llm-b-live.js');
    return reapCompletedDetachedLiveRuns();
}

/**
 * Remove expirados em qualquer modo e, quando rollback automático está habilitado, também aplica os budgets ativos.
 * Sidecars válidos não expirados nunca são purgados silenciosamente quando o modo automático está desligado.
 *
 * @returns {Promise<Record<string, unknown>>}
 */
async function cleanupRollbackStateAtStartup() {
    const policy = getApplicationInfraRuntime().config.rollback;
    const cleanup = await cleanupRollbackSidecars({
        policy,
        directory: policy.directory,
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
