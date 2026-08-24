// @ts-check
/** Test-only membrane for index auto-build state and checkpoint policy. */

export {
    classifyIndexJournalReplayRows,
    parseGitNameStatusZ,
    parseGitStatusZ,
    planIndexStartup,
    readCommittedIndexChanges,
    readIndexGitSnapshot,
    readIndexStartupCheckpoint,
    writeIndexStartupCheckpoint,
} from '../checkpoint.js';
export { resetMcpIndexAutoBuildStateForTests } from '../runtime.js';
