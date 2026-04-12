// @ts-check
/**
 * Barrel — Bridges (integrações externas: git, MCP, Nerv).
 *
 * @module copilot/bridges
 * @see EventBus
 */

export {
    formatBranch,
    formatLog,
    formatStatus,
    gitAdd,
    gitBranch,
    gitCheckout,
    gitCommit,
    gitCreateBranch,
    gitDiff,
    gitLog,
    gitPull,
    gitPush,
    gitStash,
    gitStashList,
    gitStatus,
} from './git-bridge.js';
export { _resetMcpState, buildMcpTools, getMcpStatus, listMcpTools, startMcpAutoReconnect } from './mcp-tool-bridge.js';
// FAIXA-L13: nerv-bridge.js is deprecated — kept for test compat; production uses NervEventBusAdapter
export { _resetNervBridgeState, copilotNervBridge, mount, unmount } from './nerv-bridge.js';
export { NervEventBusAdapter, emitNerv, nervEventBusAdapter } from './nerv-event-bus-adapter.js';

// ─── GitHub CLI bridge ────────────────────────────────────────────────────────
export * from './gh/index.js';
