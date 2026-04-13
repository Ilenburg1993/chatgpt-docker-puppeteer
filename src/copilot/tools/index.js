// @ts-check
/**
 * src/copilot/tools/index.js — [L3] Definição de Custom Tools para o agente.
 *
 * Registry centralizado de Custom Tools para o Always-Alive Agent. Agrupa todas as ferramentas e expõe como array
 * pronto para uso no SDK.
 *
 * ### API pública
 *
 * | Export               | Tipo    | Descrição                                    |
 * | -------------------- | ------- | -------------------------------------------- |
 * | `allTools`           | Tool[]  | Array completo de todas as tools registradas |
 * | `buildTool()`        | Factory | Factory canônica para criar novas tools      |
 * | `withSkipPermission` | Wrapper | Wrapper para tools que pulam permissão       |
 *
 * ### Categorias de Tools
 *
 * - `taskTools` — gerenciamento de tarefas
 * - `codeTools` — operações de código
 * - `gitTools` — operações git
 * - `sessionTools` / `sessionRpcTools` — controle de sessão SDK
 * - `hookTools` — controle de hooks/permissões
 * - `hubTools` — interação com conversation hub
 * - `fileTools` (read + write) — operações de arquivo
 * - `shellTools` — execução de comandos shell
 * - `webTools` — operações web (HTTP, scrape)
 * - `todoTools` (read + write) — CRUD de todos
 * - `permissionTools` — controle de permissões
 * - `introspectionTools` — autodiagnóstico e introspecção
 *
 * ### Setters de DI
 *
 * - `setHub(hub)` — injeta ConversationHub para hub-tools
 * - `setPermissionAgent(agent)` — injeta agente de permissão
 * - `setSessionRpc(rpc)` — injeta facade RPC de sessão
 *
 * @module copilot/tools
 * @see EventBus
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
 * @type {import('#copilot/sdk/types').Tool[]}
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

// ─── Todo store (acesso direto ao estado persistido) ─────────────────────────
export { readStore } from './todo/store.js';

// ─── Logger + Metrics injection (Faixa 3.1 — desacopla tools/ de observability/) ─
export { clearToolsLogger, setToolsLogger } from './logger.js';
export { clearToolsMetrics, setToolsMetrics } from './metrics-proxy.js';
