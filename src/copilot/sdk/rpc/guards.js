// @ts-check
/**
 * Structural guards for the SDK RPC wrapper layer.
 *
 * The wrapper deliberately depends on the RPC capability surface rather than on the nominal CopilotSession/
 * CopilotClient classes. This keeps RPC adapters testable, supports compatible SDK hosts, and matches the runtime
 * validation performed at this boundary.
 *
 * @module copilot/sdk/rpc/guards
 */

/**
 * @typedef {{
 *   sessionId: string;
 *   rpc: import('@github/copilot-sdk').CopilotSession['rpc'];
 * }} RpcSessionPort
 *
 * @typedef {{
 *   rpc: import('@github/copilot-sdk').CopilotClient['rpc'];
 * }} RpcClientPort
 */

/**
 * @param {unknown} session
 * @param {string} caller
 * @returns {asserts session is RpcSessionPort}
 */
export function assertRpcSession(session, caller) {
    if (
        !session ||
        typeof session !== 'object' ||
        !('rpc' in session) ||
        !session.rpc ||
        typeof session.rpc !== 'object' ||
        !('sessionId' in session) ||
        typeof session.sessionId !== 'string' ||
        session.sessionId.length === 0
    ) {
        throw new TypeError(`[sdk/rpc/${caller}] Sessão inválida ou sem RPC disponível.`);
    }
}

/**
 * @param {unknown} client
 * @param {string} caller
 * @param {string} [scope='server-rpc']
 * @returns {asserts client is RpcClientPort}
 */
export function assertRpcClient(client, caller, scope = 'server-rpc') {
    if (!client || typeof client !== 'object' || !('rpc' in client) || !client.rpc || typeof client.rpc !== 'object') {
        throw new TypeError(`[sdk/${scope}/${caller}] CopilotClient inválido ou não conectado.`);
    }
}
