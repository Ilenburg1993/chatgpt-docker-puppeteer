// @ts-check
/**
 * src/copilot/conversation-hub/send-pipeline.js
 *
 * Pipeline de envio de mensagens para LLM-B — extraído de HubOrchestrator.
 *
 * @module copilot/conversation-hub/send-pipeline
 * @see EventBus
 */

import { SessionError } from '#copilot/core';
import { log } from '#copilot/observability';
import { callViaDialogLoop, callViaSimpleChat, callViaStructured } from './call-strategies.js';
import { HUB_EVENTS } from './events.js';

/**
 * @typedef {Object} SendPipelineDeps
 * @property {import('./store.js').ConversationStore} store
 * @property {import('../channel/client.js').LlmBridgeClient | null} bridge
 * @property {import('./orchestrator.js').AgentLike | null} agent
 * @property {import('./orchestrator.js').AgentLike | null} fallbackAgent
 * @property {(event: string, ...args: any[]) => boolean} emit
 * @property {() => string | undefined} getActiveSdkSessionId
 */

/**
 * @typedef {Object} SendToLlmBOpts
 * @property {boolean} [useStructured]
 * @property {number} [timeoutMs]
 * @property {string} [model]
 */

/**
 * @typedef {Object} OrchestratorResult
 * @property {number} turnId
 * @property {string} content
 * @property {object | null} structured
 * @property {number} durationMs
 * @property {string} hubSessionId
 * @property {number} turnNumber
 */

/**
 * Executa o pipeline de envio para LLM-B: valida estado, persiste turn LLM-A, invoca LLM-B, persiste resposta, emite
 * eventos.
 *
 * @param {string} hubSessionId
 * @param {string | object} message
 * @param {SendToLlmBOpts} opts
 * @param {SendPipelineDeps} deps
 * @returns {Promise<OrchestratorResult>}
 */
export async function executeSendToLlmB(hubSessionId, message, opts, deps) {
    const { store, bridge, agent, fallbackAgent, emit, getActiveSdkSessionId } = deps;

    if (!bridge) {
        throw new SessionError('[HubOrchestrator] Não inicializado. Chame init() primeiro.', 'ORCH_NOT_INITIALIZED');
    }

    const agentCheck = agent ?? fallbackAgent;
    if (!agentCheck || agentCheck.status === 'stopped') {
        throw new SessionError('[HubOrchestrator] AlwaysAliveAgent não está ativo', 'ORCH_AGENT_INACTIVE');
    }

    const useStructured = opts.useStructured !== false;
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const modelLabel = opts.model ?? 'gpt-4.1';

    const messageContent = typeof message === 'string' ? message : JSON.stringify(message);

    const sdkSessionId = getActiveSdkSessionId();
    const structuredMeta =
        typeof message === 'object' && message !== null
            ? {
                  traceId: /** @type {Record<string, unknown>} */ (message)['traceId'],
                  correlationId: /** @type {Record<string, unknown>} */ (message)['correlationId'],
              }
            : {};
    const llmATurnId = await store.writeTurn(hubSessionId, {
        role: 'llm_a',
        content: messageContent,
        ...(sdkSessionId !== undefined && { sdkSessionId }),
        model: 'copilot-claude-sonnet-4.6',
        structured: typeof message === 'object' ? message : null,
        metadata: Object.keys(structuredMeta).length > 0 ? structuredMeta : null,
    });
    const llmATurn = store.getTurn(llmATurnId);
    const turnNumber = llmATurn?.turn_number;
    if (!turnNumber) {
        throw new SessionError(
            `[HubOrchestrator] Turno ${llmATurnId} não encontrado após writeTurn`,
            'ORCH_TURN_NOT_FOUND',
        );
    }

    emit(HUB_EVENTS.TURN_SENT, {
        hubSessionId,
        turnId: llmATurnId,
        role: 'llm_a',
        content: messageContent,
        turnNumber,
    });

    log(
        'DEBUG',
        `[HubOrchestrator] Turno #${turnNumber} (LLM-A) enviado para LLM-B: ${messageContent.slice(0, 80)}...`,
    );

    const startTime = Date.now();
    /** @type {string} */ let llmBResponse;
    let llmBStructured = null;
    let parseError = null;

    try {
        const agentInst = agent ?? fallbackAgent;
        const useDialogLoop = agentInst?.dialogLoopActive === true;

        /** @type {import('./call-strategies.js').CallStrategyContext} */
        const ctx = {
            hubSessionId,
            turnNumber,
            timeoutMs,
            emit,
        };

        if (useDialogLoop) {
            if (!agentInst) {
                throw new SessionError('[HubOrchestrator] Agent não disponível', 'ORCH_AGENT_INACTIVE');
            }
            llmBResponse = await callViaDialogLoop(agentInst, message, messageContent, ctx);
        } else if (useStructured && typeof message === 'object') {
            ({ llmBResponse, llmBStructured, parseError } = await callViaStructured(bridge, message, ctx));
        } else {
            llmBResponse = await callViaSimpleChat(bridge, messageContent, ctx);
        }
    } catch (/** @type {any} */ err) {
        const errMsg = `[HubOrchestrator] Erro na resposta de LLM-B: ${err.message}`;
        log('ERROR', errMsg);
        emit('error', { hubSessionId, message: errMsg, error: err });

        await store.writeTurn(hubSessionId, {
            role: 'llm_b',
            content: `[ERRO] ${err.message}`,
            ...(sdkSessionId !== undefined && { sdkSessionId }),
            model: modelLabel,
            durationMs: Date.now() - startTime,
            metadata: { error: true, errorMessage: err.message },
        });

        throw err;
    }

    const durationMs = Date.now() - startTime;

    const llmBTurnId = await store.writeTurn(hubSessionId, {
        role: 'llm_b',
        content: llmBResponse,
        ...(sdkSessionId !== undefined && { sdkSessionId }),
        model: modelLabel,
        structured: llmBStructured,
        durationMs,
        metadata: parseError !== null ? { parseError } : null,
    });

    const llmBTurn = store.getTurn(llmBTurnId);
    const llmBTurnNumber = llmBTurn?.turn_number ?? turnNumber + 1;

    emit(HUB_EVENTS.TURN_COMPLETE, {
        hubSessionId,
        turnId: llmBTurnId,
        role: 'llm_b',
        content: llmBResponse,
        structured: llmBStructured,
        durationMs,
        turnNumber: llmBTurnNumber,
    });

    log('INFO', `[HubOrchestrator] Turno #${llmBTurnNumber} (LLM-B) completado em ${durationMs}ms.`);

    return {
        turnId: llmBTurnId,
        content: llmBResponse,
        structured: llmBStructured,
        durationMs,
        hubSessionId,
        turnNumber: llmBTurnNumber,
    };
}
