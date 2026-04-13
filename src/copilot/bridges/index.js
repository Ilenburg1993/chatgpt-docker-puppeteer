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
    gitStatus
} from './git-bridge.js';
export { _resetMcpState, buildMcpTools, getMcpStatus, listMcpTools, startMcpAutoReconnect } from './mcp-tool-bridge.js';
export { emitNerv, NervEventBusAdapter, nervEventBusAdapter } from './nerv-event-bus-adapter.js';

// ─── GitHub CLI bridge ────────────────────────────────────────────────────────
export * from './gh/index.js';

// ─── DI Tokens ────────────────────────────────────────────────────────────────
export { BRIDGE_AGENT, FALLBACK_AGENT, NERV_BRIDGE_AGENT, PERMISSION_AGENT } from './di-tokens.js';
