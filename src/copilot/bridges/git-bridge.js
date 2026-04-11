// @ts-check
/**
 * src/copilot/bridges/git-bridge.js
 *
 * Barrel do Git Bridge. Re-exporta de git-bridge-read (status, log, diff, branch)
 * e git-bridge-write (createBranch, checkout, pull, push, add, commit, stash).
 *
 * @module copilot/bridges/git-bridge
 */

export {
    gitStatus,
    formatStatus,
    gitLog,
    formatLog,
    gitDiff,
    gitBranch,
    formatBranch,
} from './git-bridge-read.js';

export {
    gitCreateBranch,
    gitCheckout,
    gitPull,
    gitPush,
    gitAdd,
    gitCommit,
    gitStash,
    gitStashList,
} from './git-bridge-write.js';
