// @ts-check
/**
 * @module copilot/presentation/runtime-dialog
 * @file Façade compartilhada de helpers de input/dialog usados por bordas.
 *
 *   O objetivo desta camada é impedir que consumidores compartilhados reabram a topologia interna do runtime para enviar
 *   turnos, ler contexto de arquivos e montar embeddings de attachments.
 */

import {
    readRuntimeControlState,
    readRuntimeInteractionState,
    recoverAgentDialogInputChannel,
    sendAgentDialogTurn,
    startAgentDialogLoop,
    stopAgentDialogLoopAuthorized,
} from '#copilot/agent';
import { log } from '#copilot/observability';
import { getAgentRuntimeControlsTarget, getDefaultAgentRuntimeControlsTarget } from './runtime-controls.js';
import { attachmentToEmbed, embedMultiple, MAX_EMBED_BYTES, readFileContext } from './runtime-file-context.js';

export { MAX_EMBED_BYTES };

/**
 * @typedef {{
 *     dialogLoopActive?: boolean | undefined;
 *     dialogPaused?: boolean | undefined;
 *     startDialogLoop: (bootPrompt?: string) => Promise<void>;
 *     sendDialogTurn: (
 *         message: string,
 *         options?: { timeout?: number | null; signal?: AbortSignal; traceId?: string },
 *     ) => Promise<string>;
 *     stopDialogLoop: (opts?: {
 *         authorized?: boolean;
 *         reason?: 'watchdog_restart' | 'authorized_stop' | 'recovery_restart';
 *         shutdownTimeoutMs?: number;
 *     }) => Promise<void>;
 *     recoverDialogInputChannel?: (opts?: { reason?: string; traceId?: string }) => Promise<{
 *         recovered: boolean;
 *         reason: string;
 *         strategy: string;
 *         prConsumed: boolean;
 *         durationMs: number;
 *     }>;
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
 * @param {string | undefined} [traceId]
 * @returns {string}
 */
function traceLabel(traceId) {
    return traceId ? `trace=${traceId}` : 'trace=none';
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
 * @param {{ timeout?: number | null; signal?: AbortSignal; traceId?: string }} [options]
 * @param {RuntimeDialogTarget | null | undefined} [runtime]
 * @returns {Promise<string>}
 */
export async function sendRuntimeDialogTurnOnActiveLoop(message, options, runtime) {
    const agent = resolveRuntimeDialogTarget(runtime);
    const startedAt = Date.now();
    const { traceId, timeout } = options ?? {};
    log('INFO', `[runtime-dialog] send turn on active loop (${traceLabel(traceId)}, timeout=${timeout ?? 'default'})`);
    try {
        const reply = await sendAgentDialogTurn(agent, message, options);
        log(
            'INFO',
            `[runtime-dialog] turn resolved (${traceLabel(traceId)}, duration=${Date.now() - startedAt}ms, reply=ok)`,
        );
        return reply;
    } catch (error) {
        const reason = error instanceof Error ? `${error.name}:${error.message}` : String(error);
        log(
            'WARN',
            `[runtime-dialog] turn failed (${traceLabel(traceId)}, duration=${Date.now() - startedAt}ms, error=${reason})`,
        );
        throw error;
    }
}

/**
 * @param {string} message
 * @param {string} from
 * @param {{ timeout?: number | null; signal?: AbortSignal; traceId?: string }} [options]
 * @param {RuntimeDialogTarget | null | undefined} [runtime]
 * @returns {Promise<string>}
 */
export async function sendRuntimeDialogTurn(message, from, options, runtime) {
    const agent = resolveRuntimeDialogTarget(runtime);
    const state = readRuntimeControlState(/** @type {import('#copilot/agent').AlwaysAliveAgent} */ (agent));
    const { traceId } = options ?? {};

    if (!state.dialogLoopActive && !state.dialogPaused) {
        log('INFO', `[runtime-dialog] auto-starting dialog loop before turn (${traceLabel(traceId)}, from=${from})`);
        await startRuntimeDialogLoop(undefined, agent);
    } else if (state.dialogLoopActive && !state.dialogPaused && state.status === 'idle') {
        const interaction = readRuntimeInteractionState(
            /** @type {import('#copilot/agent').AlwaysAliveAgent} */ (agent),
        );
        if (interaction.pendingQuestion === null) {
            log(
                'WARN',
                `[runtime-dialog] active loop sem pending READY antes do turno; solicitando recovery ao Agent (${traceLabel(traceId)}, from=${from})`,
            );
            await recoverAgentDialogInputChannel(agent, {
                reason: 'input_channel_missing',
                ...(traceId ? { traceId } : {}),
            });
        }
    }

    void from;
    return sendRuntimeDialogTurnOnActiveLoop(message, options, agent);
}

/**
 * @param {string} message
 * @param {string} from
 * @param {{ timeout?: number | null; signal?: AbortSignal; traceId?: string }} [options]
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<string>}
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
