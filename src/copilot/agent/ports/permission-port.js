// @ts-check
/**
 * Porta de política de permissão do agent.
 *
 * Mantida separada de `hook-port.js` para que módulos que só precisam montar hooks de sessão não carreguem o
 * `PermissionController` nem seus defaults do SDK durante testes/mocks.
 *
 * O `PermissionController` é exposto pelo SDK como policy operacional canônica de permissão.
 *
 * @module copilot/agent/ports/permission-port
 * @internal
 */

import { PermissionController } from '#copilot/sdk/session';

/**
 * @typedef {'approve_all' | 'audit_only' | 'selective'} AgentPermissionMode
 *
 * @typedef {{
 *     mode: AgentPermissionMode;
 *     allowTools: string[];
 *     denyTools: string[];
 *     denyShell: boolean;
 *     defaultDecision: 'allow' | 'deny';
 * }} PermissionPolicySnapshot
 *
 *
 * @typedef {{
 *     getMode: () => AgentPermissionMode;
 *     setMode: (
 *         mode: AgentPermissionMode,
 *         opts?: { allowTools?: string[]; denyTools?: string[]; denyShell?: boolean },
 *     ) => void;
 *     readonly handler: import('#copilot/sdk/types').PermissionHandler;
 *     getPolicySnapshot?: () => PermissionPolicySnapshot;
 * }} AgentPermissionController
 */

/**
 * Cria o controller de permissões usado pelo runtime.
 *
 * Consumers do agent devem depender desta factory, não de implementações concretas da policy.
 *
 * @param {ConstructorParameters<typeof PermissionController>[0]} [options]
 * @returns {AgentPermissionController}
 */
export function createAgentPermissionController(options) {
    return new PermissionController(options);
}

export { PermissionController };
