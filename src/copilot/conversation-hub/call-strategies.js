// @ts-check
/**
 * src/copilot/conversation-hub/call-strategies.js
 *
 * Estratégias de chamada LLM-B: dialog loop (sendDialogTurn), chatStructured, e chat simples. Cada função é autônoma e
 * recebe as dependências necessárias (bridge, agent) como parâmetros.
 *
 * @module copilot/conversation-hub/call-strategies
 * @see EventBus
 */

import { SessionError } from '#copilot/core';
import { HUB_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { sendRuntimeDialogTurnOnActiveLoop } from '#copilot/runtime';
import { createChunkRetention } from '../channel/chunk-retention.js';

/**
 * @typedef {import('./orchestrator.js').AgentLike} AgentLike
 *
 * @typedef {import('../channel/client.js').LlmBridgeClient} LlmBridgeClient
 */

/**
 * @typedef {Object} CallStrategyContext
 * @property {string} hubSessionId
 * @property {number} turnNumber
 * @property {number | null} timeoutMs - Timeout por inatividade em ms. `null` desabilita o inactivity guard.
 * @property {(event: string, data: object) => boolean} emit - EventEmitter.emit
 */

/**
 * Envia message via Dialog Loop (sendDialogTurn). Emite `turn:delta` em tempo real via task.delta do agente.
 *
 * @param {AgentLike} agent
 * @param {string | object} message
 * @param {string} messageContent - Versão string normalizada
 * @param {CallStrategyContext} ctx
 * @returns {Promise<string>}
 * @throws {SessionError} Se agent não suportar sendDialogTurn
 */
export async function callViaDialogLoop(agent, message, messageContent, ctx) {
    if (!agent.sendDialogTurn) {
        throw new SessionError('[HubOrchestrator] agentInst não suporta sendDialogTurn', 'ORCH_NO_DIALOG_TURN');
    }
    const content = typeof message === 'string' ? message : messageContent;
    log('DEBUG', `[HubOrchestrator] Usando sendDialogTurn (modo eficiente) para turno #${ctx.turnNumber + 1}.`);
    // BUG-HIGH-03 (fix): capturar task.delta durante sendDialogTurn para emitir turn:delta em tempo real
    const onDelta = (/** @type {{ chunk: string }} */ evt) => {
        const chunk = evt?.chunk ?? '';
        if (chunk)
            ctx.emit(HUB_EVENTS.TURN_DELTA, { hubSessionId: ctx.hubSessionId, chunk, turnNumber: ctx.turnNumber + 1 });
    };
    agent.on?.('task.delta', onDelta);
    try {
        const reply = await sendRuntimeDialogTurnOnActiveLoop(
            content,
            ctx.timeoutMs !== null ? { timeout: ctx.timeoutMs } : undefined,
            /** @type {Parameters<typeof sendRuntimeDialogTurnOnActiveLoop>[2]} */ (/** @type {unknown} */ (agent)),
        );
        if (reply === null) {
            throw new SessionError('[HubOrchestrator] sendDialogTurn retornou null', 'ORCH_DIALOG_NULL_REPLY');
        }
        return reply;
    } finally {
        agent.off?.('task.delta', onDelta);
    }
}

/**
 * Envia message via chatStructured() com StructuredMessage.
 *
 * @param {LlmBridgeClient} bridge
 * @param {object} message
 * @param {CallStrategyContext} ctx
 * @returns {Promise<{ llmBResponse: string; llmBStructured: object | null; parseError: unknown }>}
 */
export async function callViaStructured(bridge, message, ctx) {
    const legacyRawFallback = createChunkRetention();
    const result = await bridge.chatStructured(
        /** @type {import('#copilot/core/structured-message').StructuredMessageInput} */ (message),
        {
            onDelta: (chunk) => {
                legacyRawFallback.record(chunk);
                ctx.emit(HUB_EVENTS.TURN_DELTA, {
                    hubSessionId: ctx.hubSessionId,
                    chunk,
                    turnNumber: ctx.turnNumber + 1,
                });
            },
            captureChunks: false,
            ...(ctx.timeoutMs !== null ? { timeoutMs: ctx.timeoutMs } : {}),
        },
    );
    const fallback = legacyRawFallback.snapshot();
    if (typeof result.raw !== 'string' && fallback.chunksTruncated) {
        throw new SessionError(
            '[HubOrchestrator] fallback legado de resposta estruturada excedeu o budget',
            'ORCH_STRUCTURED_FALLBACK_TOO_LARGE',
        );
    }
    return {
        llmBResponse: typeof result.raw === 'string' ? result.raw : fallback.chunks.join(''),
        llmBStructured: result.structured ?? null,
        parseError: result.parseError ?? null,
    };
}

/**
 * Envia message via chat() simples (fallback). ARCH-03: registra WARN pois indica useStructured=false ou mensagem em
 * formato inesperado.
 *
 * @param {LlmBridgeClient} bridge
 * @param {string} messageContent
 * @param {CallStrategyContext} ctx
 * @returns {Promise<string>}
 */
export async function callViaSimpleChat(bridge, messageContent, ctx) {
    log(
        'WARN',
        `[HubOrchestrator] Usando chat() simples (fallback path) para hubSession=${ctx.hubSessionId}, messageType=string`,
    );
    const result = await bridge.chat(messageContent, {
        onDelta: (chunk) => {
            ctx.emit(HUB_EVENTS.TURN_DELTA, {
                hubSessionId: ctx.hubSessionId,
                chunk,
                turnNumber: ctx.turnNumber + 1,
            });
        },
        captureChunks: false,
        ...(ctx.timeoutMs !== null ? { timeoutMs: ctx.timeoutMs } : {}),
    });
    return result.response;
}
