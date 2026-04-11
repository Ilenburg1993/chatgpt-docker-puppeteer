// @ts-check
/**
 * src/copilot/sdk/rpc.js
 *
 * Barrel de RPC — re-exporta rpc-session.js (model, mode, plan, workspace, log)
 * e rpc-ops.js (compaction, shell, elicitation, commands, permissions, tools).
 * Expõe createSessionRpcFacade como API agregada principal.
 *
 * @module copilot/sdk/rpc
 * @see module:copilot/sdk/session-lifecycle
 */

import { log as _appLog } from './logger.js';
import {
    modelGetCurrent,
    modelSwitchTo,
    modeGet,
    modeSet,
    planRead,
    planUpdate,
    planDelete,
    workspaceListFiles,
    workspaceReadFile,
    workspaceCreateFile,
    sessionLog,
} from './rpc-session.js';

export {
    modelGetCurrent,
    modelSwitchTo,
    modeGet,
    modeSet,
    planRead,
    planUpdate,
    planDelete,
    workspaceListFiles,
    workspaceReadFile,
    workspaceCreateFile,
    sessionLog,
} from './rpc-session.js';

export {
    compactionCompact,
    shellExec,
    shellKill,
    uiElicitation,
    commandsHandlePending,
    permissionsHandlePending,
    toolsHandlePendingCall,
} from './rpc-ops.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {'interactive' | 'plan' | 'autopilot'} SessionMode
 *
 * @typedef {{ modelId?: string }} ModelCurrentResult
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
 * @typedef {{ eventId: string }} LogResult
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
 */

// ─── Validação interna ────────────────────────────────────────────────────────

/**
 * @param {unknown} session
 * @param {string} caller
 * @returns {asserts session is CopilotSession}
 */
function assertSession(session, caller) {
    if (!session || typeof session !== 'object' || !('rpc' in session)) {
        throw new TypeError(`[sdk/rpc/${caller}] Sessão inválida ou sem RPC disponível.`);
    }
}

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
 * }}
 */
export function createSessionRpcFacade(session) {
    assertSession(session, 'createSessionRpcFacade');
    return {
        model: {
            getCurrent: () => modelGetCurrent(session),
            switchTo: (modelId, options) => modelSwitchTo(session, modelId, options),
        },
        mode: {
            get: () => modeGet(session),
            set: (mode) => modeSet(session, mode),
        },
        plan: {
            read: () => planRead(session),
            update: (content) => planUpdate(session, content),
            delete: () => planDelete(session),
        },
        workspace: {
            listFiles: () => workspaceListFiles(session),
            readFile: (path) => workspaceReadFile(session, path),
            createFile: (path, content) => workspaceCreateFile(session, path, content),
        },
        log: (message, options) => sessionLog(session, message, options),
    };
}
