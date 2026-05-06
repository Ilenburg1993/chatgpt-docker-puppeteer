// @ts-check
/**
 * src/copilot/sdk/rpc.js
 *
 * Barrel de RPC — re-exporta rpc-session.js (model, mode, plan, workspace, log) e rpc-ops.js (compaction, shell,
 * elicitation, commands, permissions, tools). Expõe createSessionRpcFacade como API agregada principal.
 *
 * @module copilot/sdk/rpc
 * @see EventBus
 * @see module:copilot/sdk/session-lifecycle
 */

import { assertRpcSession } from './rpc/guards.js';
import {
    instructionSourcesGet,
    modeGet,
    modelGetCurrent,
    modelSwitchTo,
    modeSet,
    planDelete,
    planRead,
    planUpdate,
    sessionLog,
    workspaceCreateFile,
    workspaceListFiles,
    workspaceReadFile,
} from './rpc/session.js';

export {
    instructionSourcesGet,
    modeGet,
    modelGetCurrent,
    modelSwitchTo,
    modeSet,
    planDelete,
    planRead,
    planUpdate,
    sessionLog,
    workspaceCreateFile,
    workspaceListFiles,
    workspaceReadFile,
} from './rpc/session.js';

export {
    agentDeselect,
    agentList,
    agentSelect,
    commandsHandlePending,
    compactionCompact,
    compactionCompactTyped,
    permissionsHandlePending,
    permissionsListPending,
    shellExec,
    shellKill,
    toolsHandlePendingCall,
    uiElicitation,
} from './rpc/ops.js';

import { agentDeselect, agentList, agentSelect, compactionCompactTyped } from './rpc/ops.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {'interactive' | 'plan' | 'autopilot'} SessionMode
 *
 * @typedef {{ modelId: string }} ModelCurrentResult
 *
 * @typedef {{ modelId?: string }} ModelSwitchResult
 *
 * @typedef {{ mode: SessionMode }} ModeResult
 *
 * @typedef {{ exists: boolean; content: string | null; path: string | null }} PlanReadResult
 *
 * @typedef {{ files: string[] }} WorkspaceListResult
 *
 * @typedef {{ content: string }} WorkspaceReadResult
 *
 * @typedef {{ eventId: string; [k: string]: unknown }} LogResult
 *
 * @typedef {{ success: boolean; tokensRemoved: number; messagesRemoved: number }} CompactionResult
 *
 * @typedef {{ processId: string }} ShellExecResult
 *
 * @typedef {{ killed: boolean }} ShellKillResult
 *
 * @typedef {{
 *     action: 'accept' | 'decline' | 'cancel';
 *     content?: Record<string, string | number | boolean | string[]>;
 * }} ElicitationResult
 *
 *
 * @typedef {{ success: boolean }} HandleResult
 *
 * @typedef {{ name: string; displayName: string; description: string }} AgentInfo
 *
 * @typedef {{ agents: AgentInfo[] }} AgentListResult
 *
 * @typedef {{ agent: AgentInfo }} AgentSelectResult
 *
 * @typedef {{}} AgentDeselectResult
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Aggregate — createSessionRpcFacade
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cria um objeto façade com todos os RPCs core agrupados por subsistema. Permite uso ergonômico: `const rpc =
 * createSessionRpcFacade(session); await rpc.model.getCurrent();`
 *
 * @param {CopilotSession} session
 * @returns {{
 *     model: {
 *         getCurrent: () => Promise<ModelCurrentResult>;
 *         switchTo: (modelId: string, options?: { reasoningEffort?: string }) => Promise<ModelSwitchResult>;
 *     };
 *     mode: { get: () => Promise<ModeResult>; set: (mode: SessionMode) => Promise<ModeResult> };
 *     plan: {
 *         read: () => Promise<PlanReadResult>;
 *         update: (content: string) => Promise<object>;
 *         delete: () => Promise<object>;
 *     };
 *     workspace: {
 *         listFiles: () => Promise<WorkspaceListResult>;
 *         readFile: (path: string) => Promise<WorkspaceReadResult>;
 *         createFile: (path: string, content: string) => Promise<object>;
 *     };
 *     log: (
 *         message: string,
 *         options?: { level?: 'info' | 'warning' | 'error'; ephemeral?: boolean; url?: string },
 *     ) => Promise<LogResult>;
 *     instructions: {
 *         getSources: () => Promise<unknown>;
 *     };
 *     agent: {
 *         list: () => Promise<AgentListResult>;
 *         select: (name: string) => Promise<AgentSelectResult>;
 *         deselect: () => Promise<AgentDeselectResult>;
 *     };
 *     compaction: {
 *         compact: () => Promise<CompactionResult>;
 *     };
 * }}
 */
export function createSessionRpcFacade(session) {
    assertRpcSession(session, 'createSessionRpcFacade');
    return {
        model: {
            getCurrent: () => /** @type {Promise<ModelCurrentResult>} */ (modelGetCurrent(session)),
            switchTo: (modelId, options) =>
                /** @type {Promise<ModelSwitchResult>} */ (modelSwitchTo(session, modelId, options)),
        },
        mode: {
            get: () => /** @type {Promise<ModeResult>} */ (modeGet(session)),
            set: (mode) => /** @type {Promise<ModeResult>} */ (modeSet(session, mode)),
        },
        plan: {
            read: () => /** @type {Promise<PlanReadResult>} */ (planRead(session)),
            update: (content) => planUpdate(session, content),
            delete: () => planDelete(session),
        },
        workspace: {
            listFiles: () => /** @type {Promise<WorkspaceListResult>} */ (workspaceListFiles(session)),
            readFile: (path) => /** @type {Promise<WorkspaceReadResult>} */ (workspaceReadFile(session, path)),
            createFile: (path, content) => workspaceCreateFile(session, path, content),
        },
        log: (message, options) => /** @type {Promise<LogResult>} */ (sessionLog(session, message, options)),
        instructions: {
            getSources: () => instructionSourcesGet(session),
        },
        agent: {
            list: () => /** @type {Promise<AgentListResult>} */ (agentList(session)),
            select: (name) => /** @type {Promise<AgentSelectResult>} */ (agentSelect(session, name)),
            deselect: () => /** @type {Promise<AgentDeselectResult>} */ (agentDeselect(session)),
        },
        compaction: {
            compact: () => /** @type {Promise<CompactionResult>} */ (compactionCompactTyped(session)),
        },
    };
}
