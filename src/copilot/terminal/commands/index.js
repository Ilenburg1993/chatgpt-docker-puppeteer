// @ts-check
/**
 * src/copilot/terminal/commands/index.js
 *
 * Re-exports de todos os handlers de comando do REPL terminal LLM-B.
 *
 * @module copilot/terminal/commands
 */

export { cmdAlias } from './alias.js';
export { cmdAttach } from './attach.js';
export { cmdModel, cmdReasoning } from './config.js';
export { cmdCompact, cmdContext } from './context.js';
export { cmdDiagnose } from './diagnose.js';
export { cmdGh } from './gh.js';
export { cmdGit } from './git.js';
export { cmdHelp } from './help.js';
export { cmdForget, cmdRecall, cmdRemember } from './memory.js';
export { cmdPlan } from './plan.js';
export { cmdResume } from './resume.js';
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
export { cmdSkills } from './skills.js';
