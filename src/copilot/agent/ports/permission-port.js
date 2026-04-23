// @ts-check
/**
 * Porta de política de permissão do agent.
 *
 * Mantida separada de `hook-port.js` para que módulos que só precisam montar hooks de sessão não carreguem o
 * `PermissionController` nem seus defaults do SDK durante testes/mocks.
 *
 * O `PermissionController` ainda vive em `hooks/`, mas para o runtime ele é uma policy operacional. Esta porta marca
 * essa transição até a policy virar capability/configuração própria do agent.
 *
 * @module copilot/agent/ports/permission-port
 * @internal
 */

import { PermissionController } from '../../hooks/permission-controller.js';

/**
 * @typedef {'approve_all' | 'audit_only' | 'selective'} AgentPermissionMode
 *
 * @typedef {{
 *     getMode: () => AgentPermissionMode;
 *     setMode: (
 *         mode: AgentPermissionMode,
 *         opts?: { allowTools?: string[]; denyTools?: string[]; denyShell?: boolean },
 *     ) => void;
 *     readonly handler: import('#copilot/sdk/types').PermissionHandler;
 * }} AgentPermissionController
 */

/**
 * Cria o controller de permissões usado pelo runtime.
 *
 * Consumers do agent devem depender desta factory, não da classe concreta em `hooks/permission-controller.js`.
 *
 * @param {ConstructorParameters<typeof PermissionController>[0]} [options]
 * @returns {AgentPermissionController}
 */
export function createAgentPermissionController(options) {
    return new PermissionController(options);
}

export { PermissionController };
