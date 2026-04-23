// @ts-check
/**
 * @module copilot/presentation/runtime-dialog
 * @file Façade compartilhada de helpers de input/dialog usados por bordas.
 *
 *   O objetivo desta camada é impedir que consumidores compartilhados reabram a topologia interna do runtime para enviar
 *   turnos, ler contexto de arquivos e montar embeddings de attachments.
 */

import { sendAgentDialogTurn, startAgentDialogLoop, stopAgentDialogLoopAuthorized } from '#copilot/agent';
import { readRuntimeControlState } from '../agent/facades/agent-runtime-controls.js';
import { getAgentRuntimeControlsTarget, getDefaultAgentRuntimeControlsTarget } from './runtime-controls.js';
import { attachmentToEmbed, embedMultiple, MAX_EMBED_BYTES, readFileContext } from './runtime-file-context.js';

export { MAX_EMBED_BYTES };

/**
 * @typedef {{
 *     dialogLoopActive?: boolean | undefined;
 *     dialogPaused?: boolean | undefined;
 *     startDialogLoop: (bootPrompt?: string) => Promise<void>;
 *     sendDialogTurn: (message: string, options?: { timeout?: number }) => Promise<string | null>;
 *     stopDialogLoop: (opts?: {
 *         authorized?: boolean;
 *         reason?: 'watchdog_restart' | 'authorized_stop';
 *         shutdownTimeoutMs?: number;
 *     }) => Promise<void>;
 * }} RuntimeDialogTarget
 */

/**
 * @param {RuntimeDialogTarget | null | undefined} [runtime]
 * @returns {RuntimeDialogTarget}
 */
function resolveRuntimeDialogTarget(runtime) {
    return /** @type {RuntimeDialogTarget} */ (runtime ?? getDefaultAgentRuntimeControlsTarget());
}

/**
 * @param {string | undefined} [bootPrompt]
 * @param {RuntimeDialogTarget | null | undefined} [runtime]
 * @returns {Promise<void>}
 */
export async function startRuntimeDialogLoop(bootPrompt, runtime) {
    await startAgentDialogLoop(resolveRuntimeDialogTarget(runtime), bootPrompt ?? undefined);
}

/**
 * Envia um turno para um dialog loop já ativo/pausado, sem tentar iniciar automaticamente o loop.
 *
 * @param {string} message
 * @param {{ timeout?: number }} [options]
 * @param {RuntimeDialogTarget | null | undefined} [runtime]
 * @returns {Promise<string | null>}
 */
export async function sendRuntimeDialogTurnOnActiveLoop(message, options, runtime) {
    const agent = resolveRuntimeDialogTarget(runtime);
    return sendAgentDialogTurn(agent, message, options);
}

/**
 * @param {string} message
 * @param {string} from
 * @param {{ timeout?: number }} [options]
 * @param {RuntimeDialogTarget | null | undefined} [runtime]
 * @returns {Promise<string | null>}
 */
export async function sendRuntimeDialogTurn(message, from, options, runtime) {
    const agent = resolveRuntimeDialogTarget(runtime);
    const state = readRuntimeControlState(/** @type {import('#copilot/agent').AlwaysAliveAgent} */ (agent));

    if (!state.dialogLoopActive && !state.dialogPaused) {
        await startRuntimeDialogLoop(undefined, agent);
    }

    void from;
    return sendRuntimeDialogTurnOnActiveLoop(message, options, agent);
}

/**
 * @param {string} message
 * @param {string} from
 * @param {{ timeout?: number }} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<string | null>}
 */
export async function sendRuntimeDialogTurnForRuntime(message, from, options, runtimeId) {
    return sendRuntimeDialogTurn(message, from, options, getAgentRuntimeControlsTarget(runtimeId));
}

/**
 * @param {RuntimeDialogTarget | null | undefined} [runtime]
 * @returns {Promise<void>}
 */
export async function stopRuntimeDialogLoopAuthorized(runtime) {
    await stopAgentDialogLoopAuthorized(resolveRuntimeDialogTarget(runtime));
}

/**
 * @param {string} filePath
 * @returns {ReturnType<typeof readFileContext>}
 */
export function readRuntimeFileContext(filePath) {
    return readFileContext(filePath);
}

/**
 * @param {Parameters<typeof embedMultiple>[0]} ctxs
 * @param {Parameters<typeof embedMultiple>[1]} message
 * @returns {ReturnType<typeof embedMultiple>}
 */
export function embedRuntimeMultiple(ctxs, message) {
    return embedMultiple(ctxs, message);
}

/**
 * @param {Parameters<typeof attachmentToEmbed>[0]} attachment
 * @returns {ReturnType<typeof attachmentToEmbed>}
 */
export function attachmentToRuntimeEmbed(attachment) {
    return attachmentToEmbed(attachment);
}
