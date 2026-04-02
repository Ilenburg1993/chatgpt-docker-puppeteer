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

import { recordSessionEnd, recordSessionStart } from '#copilot/lib/index';
import { log } from '#core/logger';
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
 *     onSessionStart: (input: { sessionId: string; source?: string }) => Promise<Record<string, unknown>>;
 *     onSessionEnd: (input: { sessionId: string }) => Promise<void>;
 *     onErrorOccurred: (
 *         input: { error: string; errorContext: string; recoverable: boolean },
 *         invocation: { sessionId: string },
 *     ) => void;
 * }}
 */
export function createSessionHooks(ctx) {
    const { getTelemetry, emitWebhook, getModel, scheduleFallback, emit, getContextSnapshot } = ctx;

    /**
     * @param {{ sessionId: string; source?: string }} _input
     * @returns {Promise<Record<string, unknown>>}
     */
    async function onSessionStart(_input) {
        log('INFO', `[hooks/session-lifecycle] SessionStart: ${_input.sessionId}`);
        recordSessionStart(getTelemetry(), _input.sessionId);
        await emitWebhook('session.start', { sessionId: _input.sessionId });

        // Gap 4: retornar additionalContext com snapshot de ambiente
        const snapshot = getContextSnapshot ? getContextSnapshot() : {};
        const model = getModel();
        const additionalContext = [
            `sessionId: ${_input.sessionId}`,
            model ? `model: ${model}` : null,
            `source: ${_input.source ?? 'unknown'}`,
            `host: ${hostname()}`,
            `node: ${process.version}`,
            ...Object.entries(snapshot).map(([k, v]) => `${k}: ${v}`),
        ]
            .filter(Boolean)
            .join(' | ');

        return { additionalContext };
    }

    /**
     * @param {{ sessionId: string }} _input
     * @returns {Promise<void>}
     */
    async function onSessionEnd(_input) {
        log('INFO', `[hooks/session-lifecycle] SessionEnd: ${_input.sessionId}`);
        recordSessionEnd(getTelemetry(), _input.sessionId);
        await emitWebhook('session.end', { sessionId: _input.sessionId });
    }

    /**
     * @param {{ error: string; errorContext: string; recoverable: boolean }} input
     * @param {{ sessionId: string }} invocation
     * @returns {void}
     */
    function onErrorOccurred(input, invocation) {
        log(
            'WARN',
            `[hooks/session-lifecycle] SDK errorOccurred [${input.errorContext}]: ${input.error} (recuperável: ${input.recoverable})`,
        );

        const isRateOrQuotaError = input.errorContext === 'rate_limit' || input.errorContext === 'quota';
        if (isRateOrQuotaError) {
            const fallbackModel = process.env['COPILOT_FALLBACK_MODEL'];
            const currentModel = getModel();
            if (fallbackModel && fallbackModel !== currentModel) {
                log(
                    'WARN',
                    `[hooks/session-lifecycle] rate_limit/quota — próxima reconexão usará model fallback: ${fallbackModel}`,
                );
                scheduleFallback(fallbackModel);
            } else {
                log('WARN', '[hooks/session-lifecycle] rate_limit/quota sem COPILOT_FALLBACK_MODEL configurado.');
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
