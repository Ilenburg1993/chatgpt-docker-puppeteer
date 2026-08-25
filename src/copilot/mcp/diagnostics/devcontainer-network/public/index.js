// @ts-check
/** Public membrane for DevContainer network posture diagnostics. */

export {
    MCP_DEVCONTAINER_NETWORK_CONFIG_KIND,
    MCP_DEVCONTAINER_NETWORK_CONFIG_SCHEMA_VERSION,
    readMcpDevcontainerNetworkConfig,
} from '../config.js';
/** @typedef {import('../config.js').McpDevcontainerNetworkConfig} McpDevcontainerNetworkConfig */
export {
    auditDevcontainerNetworkPosture,
    refreshDevcontainerNetworkControlPlaneState,
} from '../runtime.js';
