// @ts-check
/**
 * src/copilot/terminal/commands/index.js
 *
 * Re-exports de todos os handlers de comando do REPL terminal LLM-B.
 *
 * @module copilot/terminal/commands
 */

export { cmdAlias } from './alias.js';
export { cmdModel, cmdReasoning } from './config.js';
export { cmdGh } from './gh.js';
export { cmdGit } from './git.js';
export { cmdHelp } from './help.js';
export { cmdForget, cmdRecall, cmdRemember } from './memory.js';
export {
    cmdAnswer,
    cmdClear,
    cmdCount,
    cmdDbHistory,
    cmdDbSessions,
    cmdHistory,
    cmdStatus,
    cmdWho,
} from './session.js';
