// @ts-check
/**
 * src/copilot/bridges/git-bridge.js
 *
 * Barrel do Git Bridge. Re-exporta de git-bridge-read (status, log, diff, branch) e git-bridge-write (createBranch,
 * checkout, pull, push, add, commit, stash).
 *
 * @module copilot/bridges/git-bridge
 * @see EventBus
 */

export { formatBranch, formatLog, formatStatus, gitBranch, gitDiff, gitLog, gitStatus } from './git-bridge-read.js';

export {
    gitAdd,
    gitCheckout,
    gitCommit,
    gitCreateBranch,
    gitPull,
    gitPush,
    gitStash,
    gitStashList,
} from './git-bridge-write.js';
