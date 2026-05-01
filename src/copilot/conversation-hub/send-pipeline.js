// @ts-check
/**
 * src/copilot/conversation-hub/send-pipeline.js
 *
 * Pipeline de envio de mensagens para LLM-B — extraído de HubOrchestrator.
 *
 * @module copilot/conversation-hub/send-pipeline
 * @see EventBus
 */

import { SessionError, toError } from '#copilot/core';
import { HUB_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { COPILOT_MODEL } from '../config/agent.js';
import { LLM_B_TURN_TIMEOUT_MS } from '../config/env.js';
import { resolveHubTurnTimeout } from '../config/hub-timeout-policy.js';
import { callViaDialogLoop, callViaSimpleChat, callViaStructured } from './call-strategies.js';

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
 * @property {number | null} [timeoutMs] - Timeout em ms. `null` ou `0` desabilita o inactivity guard.
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
    const timeoutDecision = resolveHubTurnTimeout({
        defaultTimeoutMs: LLM_B_TURN_TIMEOUT_MS,
        ...(opts.timeoutMs !== undefined ? { explicitTimeoutMs: opts.timeoutMs } : {}),
        payloadChars: typeof message === 'string' ? message.length : JSON.stringify(message).length,
        useStructured,
    });
    const timeoutMs = timeoutDecision.timeoutMs;
    const runtimeModelLabel = (() => {
        const activeAgent = agent ?? fallbackAgent;
        const modelFromAgent =
            activeAgent && typeof activeAgent === 'object' && typeof activeAgent['model'] === 'string'
                ? String(activeAgent['model'])
                : null;
        return modelFromAgent ?? opts.model ?? COPILOT_MODEL;
    })();

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
    log(
        'DEBUG',
        `[HubOrchestrator] timeout(turn=${timeoutMs === null ? 'watchdog-only' : `${timeoutMs}ms`}/${timeoutDecision.strategy}; reasons=${timeoutDecision.reasons.join('+')})`,
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
    } catch (err) {
        const errMsg = `[HubOrchestrator] Erro na resposta de LLM-B: ${toError(err).message}`;
        log('ERROR', errMsg);
        emit('error', { hubSessionId, message: errMsg, error: err });

        await store.writeTurn(hubSessionId, {
            role: 'llm_b',
            content: `[ERRO] ${toError(err).message}`,
            ...(sdkSessionId !== undefined && { sdkSessionId }),
            model: runtimeModelLabel,
            durationMs: Date.now() - startTime,
            metadata: { error: true, errorMessage: toError(err).message },
        });

        throw err;
    }

    const durationMs = Date.now() - startTime;

    const llmBTurnId = await store.writeTurn(hubSessionId, {
        role: 'llm_b',
        content: llmBResponse,
        ...(sdkSessionId !== undefined && { sdkSessionId }),
        model: runtimeModelLabel,
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
