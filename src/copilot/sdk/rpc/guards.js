// @ts-check
/**
 * Guards compartilhados para RPC da SDK wrapper layer.
 *
 * @module copilot/sdk/rpc/guards
 */

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

/**
 * @param {unknown} session
 * @param {string} caller
 * @returns {asserts session is CopilotSession}
 */
export function assertRpcSession(session, caller) {
    if (!session || typeof session !== 'object' || !('rpc' in session)) {
        throw new TypeError(`[sdk/rpc/${caller}] Sessão inválida ou sem RPC disponível.`);
    }
}
