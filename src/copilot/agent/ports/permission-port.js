// @ts-check
/**
 * Porta de política de permissão do agent.
 *
 * Mantida separada de `hook-port.js` para que módulos que só precisam montar hooks de sessão não carreguem o
 * `PermissionController` nem seus defaults do SDK durante testes/mocks.
 *
 * @module copilot/agent/ports/permission-port
 * @internal
 */

import { PermissionController } from '../../hooks/permission-controller.js';

/**
 * @param {ConstructorParameters<typeof PermissionController>[0]} [options]
 * @returns {PermissionController}
 */
export function createAgentPermissionController(options) {
    return new PermissionController(options);
}

export { PermissionController };
