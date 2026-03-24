// @ts-check
/**
 * src/copilot/terminal/commands/index.js
 *
 * Re-exports de todos os handlers de comando do REPL terminal LLM-B.
 *
 * @module copilot/terminal/commands
 */

export { cmdAlias } from './alias.js';
export { cmdGh } from './gh.js';
export { cmdGit } from './git.js';
export { cmdHelp } from './help.js';
export { cmdRemember, cmdRecall, cmdForget } from './memory.js';
export { cmdStatus, cmdHistory, cmdDbHistory, cmdDbSessions, cmdWho, cmdCount, cmdClear, cmdAnswer } from './session.js';
