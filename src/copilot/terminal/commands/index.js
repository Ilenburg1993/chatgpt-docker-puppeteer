// @ts-check
/**
 * src/copilot/terminal/commands/index.js
 *
 * Re-exports de todos os handlers de comando do REPL terminal LLM-B.
 *
 * @module copilot/terminal/commands
 * @see EventBus
 */

export { cmdActivity } from './activity.js';
export { cmdAlias } from './alias.js';
export { cmdAttach } from './attach.js';
export { cmdAudit } from './audit.js';
export { cmdByok } from './byok.js';
export { cmdModel, cmdReasoning } from './config.js';
export { cmdCompact, cmdContext } from './context.js';
export { cmdDiagnose } from './diagnose.js';
export { cmdDisplay } from './display.js';
export { cmdErrors } from './errors.js';
export { cmdEvents } from './events.js';
export { cmdExport } from './export.js';
export { cmdFs } from './fs.js';
export { cmdGh } from './gh.js';
export { cmdGit } from './git.js';
export { cmdHelp } from './help.js';
export { cmdIntent } from './intent.js';
export { cmdForget, cmdRecall, cmdRemember } from './memory.js';
export { cmdMenu } from './menu.js';
export { cmdMetrics } from './metrics.js';
export { cmdPlan } from './plan.js';
export { cmdResume } from './resume.js';
export { cmdScope } from './scope.js';
export { cmdElicitation, cmdPermission, cmdSdk, cmdWorkspace } from './sdk.js';
export { cmdSearch } from './search.js';
export {
    cmdAnswer,
    cmdClear,
    cmdClearShadow,
    cmdCount,
    cmdDbHistory,
    cmdDbSessions,
    cmdHistory,
    cmdLive,
    cmdNow,
    cmdSessionList,
    cmdSessionRestore,
    cmdSessionSave,
    cmdSessionSdk,
    cmdStatus,
    cmdWho,
} from './session.js';
export { cmdSkills } from './skills.js';
export { cmdTerminal, cmdTerminalLibs } from './terminal.js';
export { cmdThinking } from './thinking.js';
export { cmdTools } from './tools.js';
export { cmdUsage } from './usage.js';
export { cmdIndex } from './workspace-index.js';
