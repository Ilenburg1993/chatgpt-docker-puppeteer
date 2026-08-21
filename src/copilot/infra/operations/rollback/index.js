// @ts-check
/** @module copilot/infra/operations/rollback */

/** @typedef {import('./token.js').IoRollbackStep} IoRollbackStep */
/** @typedef {import('./token.js').IoRollbackToken} IoRollbackToken */
/** @typedef {import('./types.js').RollbackExecutionResult} RollbackExecutionResult */

export { executeIoRollbackToken } from './executor.js';
export {
    buildIoRollbackPlan,
    createIoRollbackToken,
    parseIoRollbackToken,
    serializeIoRollbackToken,
    verifyIoRollbackToken,
} from './token.js';
