// @ts-check
/** Immutable process policy for delayed MCP startup maintenance. */

export const MCP_STARTUP_MAINTENANCE_CONFIG_SCHEMA_VERSION = 1;
export const MCP_STARTUP_MAINTENANCE_CONFIG_KIND = 'copilot-mcp-startup-maintenance-config';
export const DEFAULT_MCP_STARTUP_MAINTENANCE_DELAY_MS = 15_000;

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-startup-maintenance-config';
 *     enabled: boolean;
 *     delayMs: number;
 * }>} McpStartupMaintenanceConfig
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpStartupMaintenanceConfig}
 */
export function readMcpStartupMaintenanceConfig(env = process.env) {
    const defaultEnabled = env['NODE_ENV'] !== 'test' && !env['VITEST'];
    return Object.freeze({
        schemaVersion: MCP_STARTUP_MAINTENANCE_CONFIG_SCHEMA_VERSION,
        kind: MCP_STARTUP_MAINTENANCE_CONFIG_KIND,
        enabled: readBoolean(env['COPILOT_MCP_STARTUP_SMOKE_ENABLED'], defaultEnabled),
        delayMs: normalizeDelay(env['COPILOT_MCP_STARTUP_SMOKE_DELAY_MS']),
    });
}

/** @param {unknown} value @param {boolean} fallback */
function readBoolean(value, fallback) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

/** @param {unknown} value */
function normalizeDelay(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return DEFAULT_MCP_STARTUP_MAINTENANCE_DELAY_MS;
    return Math.min(10 * 60 * 1000, Math.round(numeric));
}
