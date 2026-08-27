// @ts-check
/** Process-execution membrane for MCP terminal operations. @module copilot/mcp/process/terminal/public */

export {
    FALLBACK_TERMINAL_SHELL,
    MCP_TERMINAL_PROCESS_CONFIG_KIND,
    MCP_TERMINAL_PROCESS_CONFIG_SCHEMA_VERSION,
    readMcpTerminalProcessConfig,
} from '../config.js';
/** @typedef {import('../config.js').McpTerminalProcessConfig} McpTerminalProcessConfig */
/** @typedef {import('../runtime.js').TerminalExecutionRuntime} TerminalExecutionRuntime */

export {
    MCP_TERMINAL_CONTROL_VERSION,
    controlTerminalSession,
    executeTerminalCommand,
    executeTerminalCommandBatch,
    getTerminalCapabilities,
    openTerminalSession,
    readTerminalSession,
    readTerminalSessionWithWait,
} from '../runtime.js';
