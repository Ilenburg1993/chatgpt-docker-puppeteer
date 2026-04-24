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
 *     sendDialogTurn: (message: string, options?: { timeout?: number; traceId?: string }) => Promise<string | null>;
 * }} AgentDialogTurnTarget
 */

/**
 * @typedef {{
 *     stopDialogLoop: (opts: {
 *         authorized?: boolean;
 *         reason?: 'watchdog_restart' | 'authorized_stop' | 'recovery_restart';
 *         shutdownTimeoutMs?: number;
 *     }) => Promise<void>;
 * }} AgentDialogStopTarget
 */

/**
 * @typedef {{
 *     recoverDialogInputChannel?: (opts?: { reason?: string; traceId?: string }) => Promise<{
 *         recovered: boolean;
 *         reason: string;
 *         strategy: string;
 *         prConsumed: boolean;
 *         durationMs: number;
 *     }>;
 * }} AgentDialogRecoveryTarget
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
 * @param {{ timeout?: number; traceId?: string }} [options]
 * @returns {Promise<string | null>}
 */
export async function sendAgentDialogTurn(runtime, message, options) {
    return options ? runtime.sendDialogTurn(message, options) : runtime.sendDialogTurn(message);
}

/**
 * @param {AgentDialogStopTarget} runtime
 * @param {'watchdog_restart' | 'authorized_stop' | 'recovery_restart'} [reason]
 * @returns {Promise<void>}
 */
export async function stopAgentDialogLoopAuthorized(runtime, reason) {
    await runtime.stopDialogLoop({ authorized: true, ...(reason ? { reason } : {}) });
}

/**
 * Recupera o canal de input do dialog loop usando a capability semântica do Agent quando disponível.
 *
 * @param {AgentDialogStartTarget & AgentDialogStopTarget & AgentDialogRecoveryTarget} runtime
 * @param {{ reason?: string; traceId?: string }} [opts]
 * @returns {Promise<{
 *     recovered: boolean;
 *     reason: string;
 *     strategy: string;
 *     prConsumed: boolean;
 *     durationMs: number;
 * }>}
 */
export async function recoverAgentDialogInputChannel(runtime, opts) {
    if (typeof runtime.recoverDialogInputChannel === 'function') {
        return runtime.recoverDialogInputChannel(opts);
    }
    const startedAt = Date.now();
    await stopAgentDialogLoopAuthorized(runtime, 'recovery_restart');
    await startAgentDialogLoop(runtime);
    return {
        recovered: true,
        reason: opts?.reason ?? 'input_channel_missing',
        strategy: 'restart_with_pr',
        prConsumed: true,
        durationMs: Date.now() - startedAt,
    };
}
