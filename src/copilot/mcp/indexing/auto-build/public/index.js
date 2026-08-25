// @ts-check
/** Public runtime membrane for MCP index startup auto-build lifecycle. */

export {
    MCP_INDEX_AUTO_BUILD_CONFIG_KIND,
    MCP_INDEX_AUTO_BUILD_CONFIG_SCHEMA_VERSION,
    readMcpIndexAutoBuildConfig,
} from '../config.js';
/** @typedef {import('../config.js').McpIndexAutoBuildConfig} McpIndexAutoBuildConfig */
export { maybeStartMcpIndexAutoBuild, readMcpIndexAutoBuildState } from '../runtime.js';
