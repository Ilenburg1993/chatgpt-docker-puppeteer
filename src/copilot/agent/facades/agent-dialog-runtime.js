// @ts-check
/**
 * @module copilot/agent/facades/agent-dialog-runtime
 * @file Facade canônica das operações de diálogo runtime (`start/send/stop`).
 *
 *   Esta camada concentra a capability de diálogo do runtime para que `presentation/`, `channel/` e integrações do hub
 *   não precisem chamar `startDialogLoop` / `sendDialogTurn` / `stopDialogLoop` diretamente em múltiplos pontos.
 */

/**
 * @typedef {{
 *     startDialogLoop: (bootPrompt?: string) => Promise<void>;
 * }} AgentDialogStartTarget
 */

/**
 * @typedef {{
 *     sendDialogTurn: (message: string, options?: { timeout?: number }) => Promise<string | null>;
 * }} AgentDialogTurnTarget
 */

/**
 * @typedef {{
 *     stopDialogLoop: (opts: {
 *         authorized?: boolean;
 *         reason?: 'watchdog_restart' | 'authorized_stop';
 *         shutdownTimeoutMs?: number;
 *     }) => Promise<void>;
 * }} AgentDialogStopTarget
 */

/**
 * @param {AgentDialogStartTarget} runtime
 * @param {string | undefined} [bootPrompt]
 * @returns {Promise<void>}
 */
export async function startAgentDialogLoop(runtime, bootPrompt) {
    await runtime.startDialogLoop(bootPrompt ?? undefined);
}

/**
 * @param {AgentDialogTurnTarget} runtime
 * @param {string} message
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<string | null>}
 */
export async function sendAgentDialogTurn(runtime, message, options) {
    return options ? runtime.sendDialogTurn(message, options) : runtime.sendDialogTurn(message);
}

/**
 * @param {AgentDialogStopTarget} runtime
 * @param {'watchdog_restart' | 'authorized_stop'} [reason]
 * @returns {Promise<void>}
 */
export async function stopAgentDialogLoopAuthorized(runtime, reason) {
    await runtime.stopDialogLoop({ authorized: true, ...(reason ? { reason } : {}) });
}
