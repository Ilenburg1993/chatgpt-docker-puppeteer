// @ts-check
/**
 * src/copilot/tools/index.js
 *
 * Registry centralizado de Custom Tools para o Always-Alive Agent. Agrupa todas as ferramentas disponíveis e as expõe
 * como array pronto para uso no SDK.
 *
 * @module copilot/tools
 */

import { codeTools } from './code-tools.js';
import { fileReadTools, fileTools, fileWriteTools } from './file/index.js';
import { gitTools } from './git/index.js';
import { configureHookTools, hookTools } from './hook-tools.js';
import { hubTools, setHub } from './hub-tools.js';
import {
    getDisabledTools,
    introspectionTools,
    isToolDisabled,
    registerForIntrospection,
} from './introspection-tools.js';
import { permissionTools, setPermissionAgent } from './permission-tools.js';
import { sessionRpcTools, setSessionRpc } from './session-rpc-tools.js';
import { sessionTools } from './session-tools.js';
import { shellTools } from './shell/index.js';
import { taskTools } from './task-tools.js';
import { todoReadTools, todoTools, todoWriteTools } from './todo/index.js';
import { buildTool, withSkipPermission } from './tool-factory.js';
import { webTools } from './web-tools.js';

/**
 * Conjunto completo de Custom Tools disponíveis para o SDK Agent.
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const allTools = [
    ...taskTools,
    ...codeTools,
    ...gitTools,
    ...sessionTools,
    ...sessionRpcTools,
    ...hookTools,
    ...hubTools,
    ...introspectionTools,
    ...fileTools,
    ...shellTools,
    ...webTools,
    ...todoTools,
    ...permissionTools,
];

export {
    buildTool,
    codeTools,
    configureHookTools,
    fileReadTools,
    fileTools,
    fileWriteTools,
    getDisabledTools,
    gitTools,
    hookTools,
    hubTools,
    introspectionTools,
    isToolDisabled,
    permissionTools,
    registerForIntrospection,
    sessionRpcTools,
    sessionTools,
    setHub,
    setPermissionAgent,
    setSessionRpc,
    shellTools,
    taskTools,
    todoReadTools,
    todoTools,
    todoWriteTools,
    webTools,
    withSkipPermission,
};
