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
import { fileReadTools, fileTools, fileWriteTools } from './file-tools.js';
import { gitTools } from './git/index.js';
import { hookTools } from './hook-tools.js';
import { hubTools } from './hub-tools.js';
import { introspectionTools, registerForIntrospection, setTelemetryStore } from './introspection-tools.js';
import { permissionTools } from './permission-tools.js';
import { sessionRpcTools, setSessionRpc } from './session-rpc-tools.js';
import { sessionTools } from './session-tools.js';
import { shellTools } from './shell/index.js';
import { taskTools } from './task-tools.js';
import { todoReadTools, todoTools, todoWriteTools } from './todo-tools.js';
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
    codeTools,
    fileReadTools,
    fileTools,
    fileWriteTools,
    gitTools,
    hookTools,
    hubTools,
    introspectionTools,
    permissionTools,
    registerForIntrospection,
    sessionRpcTools,
    sessionTools,
    setSessionRpc,
    setTelemetryStore,
    shellTools,
    taskTools,
    todoReadTools,
    todoTools,
    todoWriteTools,
    webTools,
};
