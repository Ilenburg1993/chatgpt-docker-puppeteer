// @ts-check
/**
 * src/copilot/sdk/rpc/index.js — Barrel canônico de `sdk/rpc/`
 *
 * Política 2.1: superfície explícita (runtime-only), evitando colisões de declaração por typedefs homônimos entre
 * `ops/session/server/guards`.
 *
 * @module copilot/sdk/rpc
 */

export { assertRpcSession } from './guards.js';

export {
    agentDeselect,
    agentGetCurrent,
    agentList,
    agentReload,
    agentSelect,
    commandsHandlePending,
    compactionCompact,
    compactionCompactTyped,
    permissionsHandlePending,
    permissionsListPending,
    permissionsResetSessionApprovals,
    permissionsSetApproveAll,
    shellExec,
    shellKill,
    toolsHandlePendingCall,
    uiElicitation,
} from './ops.js';

export {
    accountGetQuota,
    createServerRpcFacade,
    mcpConfigAdd,
    mcpConfigDisable,
    mcpConfigEnable,
    mcpConfigList,
    mcpConfigRemove,
    mcpConfigUpdate,
    mcpDiscover,
    modelsList,
    ping,
    sessionsFork,
    skillsConfigSetDisabledSkills,
    skillsDiscover,
    toolsList,
} from './server.js';

export { createSessionRpcFacade } from './session-facade.js';

export {
    instructionSourcesGet,
    modeGet,
    modeSet,
    modelGetCurrent,
    modelSwitchTo,
    nameGet,
    nameSet,
    planDelete,
    planRead,
    planUpdate,
    sessionLog,
    workspaceCreateFile,
    workspaceListFiles,
    workspaceReadFile,
} from './session.js';
