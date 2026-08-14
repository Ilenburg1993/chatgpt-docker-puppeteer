// @ts-check
/**
 * @module copilot/event-handlers/usage
 * @see EventBus
 * Handler dedicado para telemetria de LLM (`assistant.usage`) e attribution de usage no billing AI-credit/token-based.
 */

import {
    EMITTER_LLM_USAGE,
    EMITTER_SESSION_LIMITS_CHANGED,
    EMITTER_SESSION_LIMITS_EXHAUSTED_COMPLETED,
    EMITTER_SESSION_LIMITS_EXHAUSTED_REQUESTED,
    EMITTER_SESSION_USAGE_CHECKPOINT,
    SESSION_EVENTS,
} from '#copilot/events';
import { log } from '#copilot/observability';
import { onSessionEvent } from '#copilot/events/sdk-events';
import { createAssistantUsageClassifier, normalizeAssistantUsageEvent } from './usage-classifier.js';

/** @param {unknown} value @returns {Record<string, unknown>} */
function usageRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/** @param {unknown} value @returns {number | undefined} */
function usageNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Normaliza os eventos de controle de usage do SDK sem transformar campos request-based legacy em domínio moderno.
 *
 * @param {unknown} evt
 * @param {'limits_changed' | 'checkpoint' | 'exhausted_requested' | 'exhausted_completed'} kind
 */
function normalizeSessionUsageControlEvent(evt, kind) {
    const event = usageRecord(evt);
    const data = usageRecord(event['data']);
    const sessionLimits = usageRecord(data['sessionLimits']);
    const maxAiCredits = usageNumber(data['maxAiCredits']) ?? usageNumber(sessionLimits['maxAiCredits']);
    const usedAiCredits = usageNumber(data['usedAiCredits']);
    const totalNanoAiu = usageNumber(data['totalNanoAiu']);
    const totalPremiumRequests = usageNumber(data['totalPremiumRequests']);
    return {
        ts: Date.now(),
        kind,
        ...(maxAiCredits !== undefined ? { maxAiCredits } : {}),
        ...(usedAiCredits !== undefined ? { usedAiCredits } : {}),
        ...(totalNanoAiu !== undefined ? { totalNanoAiu } : {}),
        ...(totalPremiumRequests !== undefined
            ? { legacyBilling: { totalPremiumRequests, source: 'sdk_explicit' } }
            : {}),
    };
}

/**
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @param {Pick<import('./contracts.js').SessionWirerCallbacks, 'emit'>} cb
 * @returns {() => void}
 */
export function wireUsageEvent(session, { emit }) {
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
        onSessionEvent(session, SESSION_EVENTS.SESSION_LIMITS_CHANGED, (evt) => {
            emit(EMITTER_SESSION_LIMITS_CHANGED, normalizeSessionUsageControlEvent(evt, 'limits_changed'));
        }),
        onSessionEvent(session, SESSION_EVENTS.SESSION_USAGE_CHECKPOINT, (evt) => {
            emit(EMITTER_SESSION_USAGE_CHECKPOINT, normalizeSessionUsageControlEvent(evt, 'checkpoint'));
        }),
        onSessionEvent(session, SESSION_EVENTS.SESSION_LIMITS_EXHAUSTED_REQUESTED, (evt) => {
            emit(
                EMITTER_SESSION_LIMITS_EXHAUSTED_REQUESTED,
                normalizeSessionUsageControlEvent(evt, 'exhausted_requested'),
            );
        }),
        onSessionEvent(session, SESSION_EVENTS.SESSION_LIMITS_EXHAUSTED_COMPLETED, (evt) => {
            emit(
                EMITTER_SESSION_LIMITS_EXHAUSTED_COMPLETED,
                normalizeSessionUsageControlEvent(evt, 'exhausted_completed'),
            );
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
            const copilotUsage =
                usageInfo['copilotUsage'] && typeof usageInfo['copilotUsage'] === 'object'
                    ? /** @type {Record<string, unknown>} */ (usageInfo['copilotUsage'])
                    : null;
            const totalNanoAiu =
                typeof copilotUsage?.['totalNanoAiu'] === 'number' ? copilotUsage['totalNanoAiu'] : undefined;
            log(
                modelMismatch ? 'WARN' : 'DEBUG',
                `[AlwaysAlive] Telemetria LLM: attribution=${classification.classification} reason=${classification.attributionReason} billingSource=${classification.billingSource} billedModel=${billedModel ?? '?'} configuredModel=${configuredModel ?? '?'} effectiveModel=${effectiveModel ?? '?'} cost=${cost ?? '?'} totalNanoAiu=${totalNanoAiu ?? '?'}${modelMismatch ? ' [MODEL_MISMATCH]' : ''}`,
            );
        }),
    ];
    return () => {
        for (const cleanup of cleanups) cleanup();
    };
}
