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
import { gitTools } from './git-tools.js';
import { hookTools } from './hook-tools.js';
import { introspectionTools, registerForIntrospection, setTelemetryStore } from './introspection-tools.js';
import { sessionTools } from './session-tools.js';
import { taskTools } from './task-tools.js';

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
    ...hookTools,
    ...introspectionTools,
    ...fileTools,
];

export {
    codeTools,
    fileReadTools,
    fileTools,
    fileWriteTools,
    gitTools,
    hookTools,
    introspectionTools,
    registerForIntrospection,
    sessionTools,
    setTelemetryStore,
    taskTools,
};
