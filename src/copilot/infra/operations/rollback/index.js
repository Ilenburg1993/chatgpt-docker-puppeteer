// @ts-check
/** @module copilot/infra/operations/rollback */

/** @typedef {import('./token.js').IoRollbackStep} IoRollbackStep */
/** @typedef {import('./token.js').IoRollbackToken} IoRollbackToken */
/** @typedef {import('./types.js').RollbackExecutionResult} RollbackExecutionResult */

export { createIoRollbackCapabilityRuntime } from './capability.js';
export { executeAuthenticatedIoRollbackToken } from './executor.js';
export {
    ROLLBACK_TOKEN_AUDIENCE,
    ROLLBACK_TOKEN_VERSION,
    buildIoRollbackPlan,
    buildIoRollbackTokenAuthPayload,
    createIoRollbackTokenEnvelope,
    decodeIoRollbackToken,
    serializeIoRollbackToken,
    validateIoRollbackTokenShape,
    verifyIoRollbackTokenDigest,
} from './token.js';
