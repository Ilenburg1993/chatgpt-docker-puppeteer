// @ts-check
/**
 * Delayed, non-blocking MCP startup maintenance.
 *
 * @module copilot/mcp/control-plane/startup-maintenance
 */

import { readCloudflareTunnelConfig } from '../cloudflare/config.js';
import { cleanupStaleQuickTunnelState } from '../cloudflare/state.js';
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
};

/**
 * @param {{
 *     delayMs?: number;
 *     enabled?: boolean;
 *     setTimeoutFn?: typeof setTimeout;
 *     smokeRunner?: () => Promise<Record<string, unknown>>;
 *     cleanupRunner?: () => Promise<{ removed: boolean }>;
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
    const cleanupRunner = options.cleanupRunner ?? cleanupLegacyQuickTunnelState;

    startupState = {
        ...startupState,
        scheduled: true,
        scheduledAt: new Date().toISOString(),
    };
    startupTimer = setTimeoutFn(() => {
        startupTimer = null;
        void runStartupMaintenance(smokeRunner, cleanupRunner);
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
    };
}

/**
 * @param {() => Promise<Record<string, unknown>>} smokeRunner
 * @param {() => Promise<{ removed: boolean }>} cleanupRunner
 */
async function runStartupMaintenance(smokeRunner, cleanupRunner) {
    startupState = {
        ...startupState,
        scheduled: false,
        running: true,
        startedAt: new Date().toISOString(),
    };
    try {
        const cleanup = await cleanupRunner();
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
        };
        logMcp(success ? 'INFO' : 'WARN', 'MCP startup workspace smoke completed.', {
            success,
            staleQuickTunnelStateRemoved: cleanup.removed === true,
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

async function cleanupLegacyQuickTunnelState() {
    const config = readCloudflareTunnelConfig();
    return cleanupStaleQuickTunnelState(config.stateFile, { staleAfterMs: config.staleAfterMs });
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
