// @ts-check
/**
 * @module copilot/event-handlers/token-budget
 * @see EventBus
 * F62.4: Handler de eventos de token budget da sessão SDK.
 */

import { CONTEXT_UTIL_WARN_THRESHOLD } from '#copilot/config';
import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { onSessionEvent } from '#copilot/events/sdk-events';

/**
 * @param {{ currentTokens: number; tokenLimit: number }} usageData
 * @param {boolean} isResumed
 * @param {boolean} firstCheck
 * @param {(event: string, payload?: unknown) => void} emit
 */
function checkAndEmitTokenBudgetWarning({ currentTokens, tokenLimit }, isResumed, firstCheck, emit) {
    const ratio = Math.round((currentTokens / tokenLimit) * 100);
    if (firstCheck && isResumed && currentTokens / tokenLimit > 0.7) {
        log(
            'WARN',
            `[AlwaysAlive] Sessão retomada com contexto pesado (${ratio}% — ${currentTokens}/${tokenLimit}). Compaction automática pode ocorrer em breve.`,
        );
        emit('session.token_budget_warning', { currentTokens, tokenLimit, ratio, reason: 'startup_heavy' });
    } else if (currentTokens / tokenLimit > CONTEXT_UTIL_WARN_THRESHOLD) {
        log(
            'WARN',
            `[AlwaysAlive] Token budget em ${ratio}% (${currentTokens}/${tokenLimit}) — emitindo token_budget_warning`,
        );
        emit('session.token_budget_warning', { currentTokens, tokenLimit, ratio });
    }
}

/**
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @param {boolean} isResumed
 * @param {Pick<
 *     import('./contracts.js').SessionWirerCallbacks,
 *     'emit' | 'onContextState'
 * >} cb
 * @returns {(() => void)[]}
 */
export function wireTokenBudgetEvents(session, isResumed, { emit, onContextState }) {
    let firstUsageChecked = false;
    return [
        onSessionEvent(session, SESSION_EVENTS.SESSION_USAGE_INFO, (evt) => {
            const data = evt?.data ?? {};
            emit('session.usage', data);
            const currentTokens = /** @type {number} */ (data['currentTokens'] ?? 0);
            const tokenLimit = /** @type {number} */ (data['tokenLimit'] ?? 0);
            if (tokenLimit > 0) {
                onContextState({ tokens: currentTokens, tokenLimit, utilization: currentTokens / tokenLimit });
                checkAndEmitTokenBudgetWarning({ currentTokens, tokenLimit }, isResumed, !firstUsageChecked, emit);
                firstUsageChecked = true;
            }
        }),
    ];
}
