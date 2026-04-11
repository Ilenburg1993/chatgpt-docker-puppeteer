// @ts-check
/**
 * src/copilot/hooks/session-lifecycle.js
 *
 * Factory de session lifecycle hooks para o AlwaysAliveAgent. Migrado de src/copilot/agent/session-hooks.js — esse
 * arquivo é mantido como re-export.
 *
 * Responsabilidade: onSessionStart, onSessionEnd, onErrorOccurred com injeção de dependências. Enriquece onSessionStart
 * com additionalContext (Gap 4 do roadmap).
 *
 * ISOLAMENTO: este módulo NÃO importa de '.github/hooks/' ou paths do sistema operacional. Todo estado operacional é
 * recebido via ctx (injeção de dependências).
 *
 * @module copilot/hooks/session-lifecycle
 * @see module:copilot/hooks/types
 */

import { defaultAuditLog } from '#copilot/audit';
import { getCopilotFallbackModel } from '#copilot/config';
import { defaultMetrics, log } from '#copilot/observability';
import { modelSelector } from '#copilot/sdk';
import { hostname } from 'node:os';

/**
 * @typedef {import('./types.js').SessionLifecycleContext} SessionLifecycleContext
 */

/**
 * Cria os três session lifecycle hooks: `onSessionStart`, `onSessionEnd` e `onErrorOccurred`.
 *
 * Os hooks são funções vinculadas ao contexto fornecido via injeção de dependências, sem acesso direto a `this`.
 * Dependências mutáveis são recebidas como getters.
 *
 * Novidade em relação ao session-hooks.js original: `onSessionStart` retorna `additionalContext` rico com snapshot do
 * ambiente (Gap 4 do roadmap de hooks).
 *
 * @param {SessionLifecycleContext} ctx
 * @returns {{
 *     onSessionStart: (
 *         input: import('./types.js').SessionStartHookInput,
 *         invocation: import('./types.js').InvocationContext,
 *     ) => Promise<import('./types.js').SessionStartHookOutput>;
 *     onSessionEnd: (
 *         input: import('./types.js').SessionEndHookInput,
 *         invocation: import('./types.js').InvocationContext,
 *     ) => Promise<void>;
 *     onErrorOccurred: import('./types.js').ErrorOccurredHandler;
 * }}
 */
export function createSessionHooks(ctx) {
    const { emitWebhook, getModel, scheduleFallback, emit, getContextSnapshot } = ctx;

    /**
     * @param {import('./types.js').SessionStartHookInput} input
     * @param {import('./types.js').InvocationContext} invocation
     * @returns {Promise<import('./types.js').SessionStartHookOutput>}
     */
    async function onSessionStart(input, invocation) {
        const sessionId = invocation?.sessionId ?? '';
        log('INFO', `[hooks/session-lifecycle] SessionStart: ${sessionId}`);
        defaultMetrics.recordSessionStart();
        // CT-02: registrar no audit ring buffer
        defaultAuditLog.record({ type: 'session.start', sessionId });
        await emitWebhook('session.start', { sessionId });

        // Gap 4: retornar additionalContext com snapshot de ambiente
        const snapshot = getContextSnapshot ? getContextSnapshot() : {};
        const model = getModel();
        const additionalContext = [
            `sessionId: ${sessionId}`,
            model ? `model: ${model}` : null,
            `source: ${input.source ?? 'unknown'}`,
            `host: ${hostname()}`,
            `node: ${process.version}`,
            ...Object.entries(snapshot).map(([k, v]) => `${k}: ${v}`),
        ]
            .filter(Boolean)
            .join(' | ');

        return { additionalContext };
    }

    /**
     * @param {import('./types.js').SessionEndHookInput} _input
     * @param {import('./types.js').InvocationContext} invocation
     * @returns {Promise<void>}
     */
    async function onSessionEnd(_input, invocation) {
        const sessionId = invocation?.sessionId ?? '';
        log('INFO', `[hooks/session-lifecycle] SessionEnd: ${sessionId}`);
        defaultMetrics.recordSessionEnd();
        // CT-02: registrar no audit ring buffer
        defaultAuditLog.record({ type: 'session.end', sessionId });
        await emitWebhook('session.end', { sessionId });
    }

    /**
     * @param {{ error: string; errorContext: string; recoverable: boolean }} input
     * @param {import('./types.js').InvocationContext} invocation
     * @returns {void}
     */
    function onErrorOccurred(input, invocation) {
        log(
            'WARN',
            `[hooks/session-lifecycle] SDK errorOccurred [${input.errorContext}]: ${input.error} (recuperável: ${input.recoverable})`,
        );

        const isRateOrQuotaError = input.errorContext === 'rate_limit' || input.errorContext === 'quota';
        if (isRateOrQuotaError) {
            const currentModel = getModel() ?? 'unknown';
            // F40.3: priorizar env var explícita; se ausente, usar ModelSelector dinâmico
            const envFallback = getCopilotFallbackModel();
            const fallbackModel =
                envFallback && envFallback !== currentModel
                    ? envFallback
                    : (modelSelector.suggestFallback(currentModel)?.id ?? null);
            if (fallbackModel && fallbackModel !== currentModel) {
                log(
                    'WARN',
                    `[hooks/session-lifecycle] rate_limit/quota — próxima reconexão usará model fallback: ${fallbackModel}`,
                );
                scheduleFallback(fallbackModel);
            } else {
                log('WARN', '[hooks/session-lifecycle] rate_limit/quota sem fallback disponível.');
            }
        }

        emit('error', {
            hookType: 'errorOccurred',
            errorMessage: input.error,
            errorContext: input.errorContext,
            recoverable: input.recoverable,
            sessionId: invocation.sessionId,
        });
    }

    return { onSessionStart, onSessionEnd, onErrorOccurred };
}
