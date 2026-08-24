// @ts-check
/** Process-execution membrane for MCP terminal operations. @module copilot/mcp/process/terminal/public */

/** @typedef {import('../runtime.js').TerminalExecutionRuntime} TerminalExecutionRuntime */

export {
    MCP_TERMINAL_CONTROL_VERSION,
    controlTerminalSession,
    executeTerminalCommand,
    executeTerminalCommandBatch,
    getTerminalCapabilities,
    openTerminalSession,
    readTerminalSession,
} from '../runtime.js';
