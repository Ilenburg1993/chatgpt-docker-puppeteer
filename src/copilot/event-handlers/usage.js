// @ts-check
/**
 * @module copilot/event-handlers/usage
 * @see EventBus
 * F62.8: Handler dedicado para billing (assistant.usage).
 */

import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { onSessionEvent } from '#copilot/sdk/session';

/**
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @param {Pick<import('./contracts.js').SessionWirerCallbacks, 'emit' | 'onPrInfo'>} cb
 * @returns {() => void}
 */
export function wireUsageEvent(session, { emit, onPrInfo }) {
    return onSessionEvent(session, SESSION_EVENTS.ASSISTANT_USAGE, (evt) => {
        const data = evt?.data ?? {};
        const billedModel = /** @type {string | undefined} */ (data['model']);
        const cost = /** @type {number | undefined} */ (data['cost']);
        const quotaSnapshots = /** @type {Record<string, unknown> | undefined} */ (data['quotaSnapshots']);
        const sessionRecord = /**
         * @type {{
         *     model?: unknown;
         *     config?: { model?: unknown };
         *     sessionId?: unknown;
         *     __copilotConfiguredModel?: unknown;
         *     __copilotEffectiveModel?: unknown;
         * }}
         */ (session);
        const configuredModel =
            typeof sessionRecord.model === 'string'
                ? sessionRecord.model
                : typeof sessionRecord.config?.model === 'string'
                  ? sessionRecord.config.model
                  : typeof sessionRecord.__copilotConfiguredModel === 'string'
                    ? sessionRecord.__copilotConfiguredModel
                    : undefined;
        const rawEffectiveModel =
            typeof sessionRecord.__copilotEffectiveModel === 'string'
                ? sessionRecord.__copilotEffectiveModel
                : billedModel;
        const effectiveModel = rawEffectiveModel === 'auto' && billedModel ? billedModel : rawEffectiveModel;
        const modelMismatch =
            Boolean(billedModel && configuredModel && billedModel !== configuredModel) ||
            Boolean(effectiveModel && configuredModel && effectiveModel !== configuredModel);
        const prInfo = {
            ts: Date.now(),
            ...(billedModel !== undefined ? { model: billedModel } : {}),
            ...(configuredModel !== undefined ? { configuredModel } : {}),
            ...(effectiveModel !== undefined ? { effectiveModel } : {}),
            ...(modelMismatch ? { modelMismatch } : {}),
            sessionId: typeof sessionRecord.sessionId === 'string' ? sessionRecord.sessionId : null,
            ...(cost !== undefined ? { cost } : {}),
            ...(quotaSnapshots !== undefined ? { quotaSnapshots } : {}),
        };
        log(
            modelMismatch ? 'WARN' : 'DEBUG',
            `[AlwaysAlive] PR consumido: billedModel=${billedModel ?? '?'} configuredModel=${configuredModel ?? '?'} effectiveModel=${effectiveModel ?? '?'} cost=${cost ?? '?'}${modelMismatch ? ' [MODEL_MISMATCH]' : ''}`,
        );
        onPrInfo(prInfo);
        emit('pr.consumed', prInfo);
    });
}
