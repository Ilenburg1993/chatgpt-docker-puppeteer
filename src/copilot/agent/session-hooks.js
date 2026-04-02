// @ts-check
/**
 * src/copilot/agent/session-hooks.js
 *
 * @module copilot/agent/session-hooks
 * @deprecated Use `#copilot/hooks` (src/copilot/hooks/session-lifecycle.js) em novos módulos. Este arquivo será
 *   convertido em re-export de compatibilidade na Fase K do roadmap.
 * @see DOCUMENTAÇÃO/ARQUITETURA/HOOKS-SYSTEM-ANALYSIS-ROADMAP.md Factory de session lifecycle hooks para o AlwaysAliveAgent.
 *
 * Extrai `#onSessionStart`, `#onSessionEnd` e `#onErrorOccurred` para um módulo coeso, recebendo dependências via
 * injeção para eliminar acesso direto a campos privados.
 */

import { recordSessionEnd, recordSessionStart } from '#copilot/lib/index';
import { log } from '#core/logger';

/**
 * @typedef {import('./always-alive.js').AgentStatus} AgentStatus
 */

/**
 * Dependências injetadas para o factory de session hooks.
 *
 * @typedef {object} SessionHooksContext
 * @property {() => import('#copilot/lib/telemetry').TelemetryStore} getTelemetry - Getter da instância de telemetria
 *   atual (pode ser recriada entre sessões).
 * @property {(event: string, payload: object) => Promise<void>} emitWebhook - Emite evento de webhook.
 * @property {() => string | undefined} getModel - Retorna o model ativo no momento.
 * @property {(fallbackModel: string) => void} scheduleFallback - Agenda fallback de model no DLM.
 * @property {(event: string, payload: object) => void} emit - Emite evento no agente.
 */

/**
 * Cria os três session lifecycle hooks para o AlwaysAliveAgent: `onSessionStart`, `onSessionEnd` e `onErrorOccurred`.
 *
 * Cada hook é uma função vinculada ao contexto fornecido, sem acesso direto a `this`. As dependências que podem mudar
 * ao longo do ciclo de vida (ex: `telemetry`) são recebidas como getters — garantindo que cada chamada use o valor
 * atual.
 *
 * @param {SessionHooksContext} ctx
 * @returns {{
 *     onSessionStart: (input: { sessionId: string }) => Promise<Record<string, unknown>>;
 *     onSessionEnd: (input: { sessionId: string }) => Promise<void>;
 *     onErrorOccurred: (
 *         input: { error: string; errorContext: string; recoverable: boolean },
 *         invocation: { sessionId: string },
 *     ) => void;
 * }}
 */
export function createSessionHooks(ctx) {
    const { getTelemetry, emitWebhook, getModel, scheduleFallback, emit } = ctx;

    /**
     * @param {{ sessionId: string }} _input
     * @returns {Promise<Record<string, unknown>>}
     */
    async function onSessionStart(_input) {
        log('INFO', `[AlwaysAlive] SessionStart hook: ${_input.sessionId}`);
        recordSessionStart(getTelemetry(), _input.sessionId);
        await emitWebhook('session.start', { sessionId: _input.sessionId });
        return {};
    }

    /**
     * @param {{ sessionId: string }} _input
     * @returns {Promise<void>}
     */
    async function onSessionEnd(_input) {
        log('INFO', `[AlwaysAlive] SessionEnd hook: ${_input.sessionId}`);
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
            `[AlwaysAlive] SDK errorOccurred [${input.errorContext}]: ${input.error} (recuperável: ${input.recoverable})`,
        );

        // Aciona fallback de modelo se quota/rate_limit foi atingida e COPILOT_FALLBACK_MODEL está configurado.
        const isRateOrQuotaError = input.errorContext === 'rate_limit' || input.errorContext === 'quota';
        if (isRateOrQuotaError) {
            const fallbackModel = process.env['COPILOT_FALLBACK_MODEL'];
            const currentModel = getModel();
            if (fallbackModel && fallbackModel !== currentModel) {
                log(
                    'WARN',
                    `[AlwaysAlive] rate_limit/quota detectado — próxima reconexão usará model fallback: ${fallbackModel}`,
                );
                scheduleFallback(fallbackModel);
            } else {
                log('WARN', '[AlwaysAlive] rate_limit/quota sem COPILOT_FALLBACK_MODEL configurado.');
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
