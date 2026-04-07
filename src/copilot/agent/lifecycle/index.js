// @ts-check
/**
 * src/copilot/agent/lifecycle/index.js — sub-barrel do subsistema Lifecycle.
 *
 * @module copilot/agent/lifecycle
 */

export { tryReconnect } from './reconnect-policy.js';
export {
    clearState,
    clearStateAsync,
    drainStateWrites,
    persistState,
    readState,
    readStateAsync,
    writeState,
    writeStateAsync,
} from './state-io.js';
