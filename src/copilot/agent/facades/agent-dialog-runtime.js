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
 *     sendDialogTurn?:
 *         | ((
 *               message: string,
 *               options?: {
 *                   timeout?: number | null;
 *                   signal?: AbortSignal;
 *                   traceId?: string;
 *               },
 *           ) => Promise<string>)
 *         | undefined;
 *     pauseDialogLoop?: ((sessionId: string | null) => Promise<void>) | undefined;
 *     isDialogLoopPaused?: (() => boolean) | undefined;
 *     getDialogPrMetricsSnapshot?:
 *         | (() => { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null)
 *         | undefined;
 *     getLastPrInfoSnapshot?:
 *         | (() => { model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null)
 *         | undefined;
 * }} AgentDialogContextTarget
 */

/**
 * @typedef {{
 *     sendDialogTurn: (
 *         message: string,
 *         options?: { timeout?: number | null; signal?: AbortSignal; traceId?: string },
 *     ) => Promise<string>;
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
 * @param {{ timeout?: number | null; signal?: AbortSignal; traceId?: string }} [options]
 * @returns {Promise<string>}
 */
export async function sendAgentDialogTurn(runtime, message, options) {
    return options ? runtime.sendDialogTurn(message, options) : runtime.sendDialogTurn(message);
}

/**
 * @param {AgentDialogContextTarget} runtime
 * @param {string} message
 * @param {{ timeout?: number | null; signal?: AbortSignal; traceId?: string }} [options]
 * @returns {Promise<string>}
 */
export async function dispatchAgentDialogTurn(runtime, message, options) {
    if (typeof runtime.sendDialogTurn !== 'function') {
        throw new Error('AGENT_DIALOG_TURN_UNAVAILABLE');
    }
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
 * @param {AgentDialogContextTarget} runtime
 * @param {string | null} sessionId
 * @returns {Promise<void>}
 */
export async function pauseAgentDialogLoop(runtime, sessionId) {
    if (typeof runtime.pauseDialogLoop !== 'function') {
        throw new Error('AGENT_DIALOG_PAUSE_UNAVAILABLE');
    }
    await runtime.pauseDialogLoop(sessionId);
}

/**
 * @param {AgentDialogContextTarget} runtime
 * @returns {boolean}
 */
export function isAgentDialogLoopPaused(runtime) {
    return typeof runtime.isDialogLoopPaused === 'function' ? runtime.isDialogLoopPaused() : false;
}

/**
 * @param {AgentDialogContextTarget} runtime
 * @returns {{ boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null}
 */
export function readAgentDialogPrMetrics(runtime) {
    return typeof runtime.getDialogPrMetricsSnapshot === 'function' ? runtime.getDialogPrMetricsSnapshot() : null;
}

/**
 * @param {AgentDialogContextTarget} runtime
 * @returns {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null}
 */
export function readAgentDialogLastPrInfo(runtime) {
    return typeof runtime.getLastPrInfoSnapshot === 'function' ? runtime.getLastPrInfoSnapshot() : null;
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
