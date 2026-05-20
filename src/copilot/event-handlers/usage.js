// @ts-check
/**
 * @module copilot/event-handlers/usage
 * @see EventBus
 * Handler dedicado para telemetria de LLM (`assistant.usage`) e classificação conservadora de Premium Requests.
 */

import { EMITTER_LLM_USAGE, SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { onSessionEvent } from '#copilot/sdk/session';
import { createAssistantUsageClassifier, normalizeAssistantUsageEvent } from './usage-classifier.js';

/**
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @param {Pick<import('./contracts.js').SessionWirerCallbacks, 'emit' | 'onPrInfo'>} cb
 * @returns {() => void}
 */
export function wireUsageEvent(session, { emit, onPrInfo }) {
    const classifier = createAssistantUsageClassifier();
    const cleanups = [
        onSessionEvent(session, SESSION_EVENTS.USER_MESSAGE, (evt) => {
            classifier.recordUserMessage(evt);
        }),
        onSessionEvent(session, SESSION_EVENTS.USER_INPUT_REQUESTED, (evt) => {
            classifier.recordUserInputRequested(evt);
        }),
        onSessionEvent(session, SESSION_EVENTS.USER_INPUT_COMPLETED, (evt) => {
            classifier.recordUserInputCompleted(evt);
        }),
        onSessionEvent(session, SESSION_EVENTS.ASSISTANT_USAGE, (evt) => {
            const usage = normalizeAssistantUsageEvent(evt, session);
            const classification = classifier.classify(usage);
            const usageInfo = /** @type {Record<string, unknown> & typeof classification} */ ({
                ...usage,
                ...classification,
            });
            const billedModel = typeof usageInfo['model'] === 'string' ? usageInfo['model'] : undefined;
            const configuredModel =
                typeof usageInfo['configuredModel'] === 'string' ? usageInfo['configuredModel'] : undefined;
            const effectiveModel =
                typeof usageInfo['effectiveModel'] === 'string' ? usageInfo['effectiveModel'] : undefined;
            const cost = typeof usageInfo['cost'] === 'number' ? usageInfo['cost'] : undefined;
            const modelMismatch = usageInfo['modelMismatch'] === true;

            emit(EMITTER_LLM_USAGE, usageInfo);
            if (classification.premiumRequest) {
                log(
                    modelMismatch ? 'WARN' : 'DEBUG',
                    `[AlwaysAlive] Premium request contabilizado: billedModel=${billedModel ?? '?'} configuredModel=${configuredModel ?? '?'} effectiveModel=${effectiveModel ?? '?'} cost=${cost ?? '?'} reason=${classification.premiumRequestReason}${modelMismatch ? ' [MODEL_MISMATCH]' : ''}`,
                );
                onPrInfo(
                    /** @type {{
                     *     model?: string;
                     *     configuredModel?: string;
                     *     modelMismatch?: boolean;
                     *     sessionId?: string | null;
                     *     cost?: number;
                     *     quotaSnapshots?: Record<string, unknown>;
                     *     ts: number;
                     * }} */ (/** @type {unknown} */ (usageInfo)),
                );
                emit('pr.consumed', usageInfo);
                return;
            }
            log(
                modelMismatch ? 'WARN' : 'DEBUG',
                `[AlwaysAlive] LLM usage sem novo PR: classification=${classification.classification} reason=${classification.premiumRequestReason} billedModel=${billedModel ?? '?'} configuredModel=${configuredModel ?? '?'} effectiveModel=${effectiveModel ?? '?'} cost=${cost ?? '?'}${modelMismatch ? ' [MODEL_MISMATCH]' : ''}`,
            );
        }),
    ];
    return () => {
        for (const cleanup of cleanups) cleanup();
    };
}
