// @ts-check
/**
 * src/copilot/agent/lifecycle/index.js — sub-barrel do subsistema Lifecycle.
 *
 * @module copilot/agent/lifecycle
 */

export { startWithRetry } from './entry.js';
export { tryReconnect } from './reconnect-policy.js';
export { clearState, drainStateWrites, readState, writeState, writeStateAsync } from './state-io.js';
