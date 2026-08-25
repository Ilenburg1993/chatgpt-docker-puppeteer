// @ts-check
/** Production public membrane for MCP startup maintenance lifecycle. */

/** @typedef {import('../config.js').McpStartupMaintenanceConfig} McpStartupMaintenanceConfig */

export {
    DEFAULT_MCP_STARTUP_MAINTENANCE_DELAY_MS,
    MCP_STARTUP_MAINTENANCE_CONFIG_KIND,
    MCP_STARTUP_MAINTENANCE_CONFIG_SCHEMA_VERSION,
    readMcpStartupMaintenanceConfig,
} from '../config.js';
export {
    readMcpStartupMaintenanceState,
    scheduleMcpStartupMaintenance,
    stopMcpStartupMaintenance,
} from '../runtime.js';
