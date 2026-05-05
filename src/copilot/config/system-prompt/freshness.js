// @ts-check
/**
 * src/copilot/config/system-prompt/freshness.js
 *
 * Binding/freshness canônicos do system prompt para sessões SDK vivas. Permite correlacionar a revisão conhecida do
 * prompt com a sessão ativa sem reabrir lógica ad hoc nas bordas.
 *
 * @module copilot/config/system-prompt/freshness
 */

/**
 * @typedef {import('./status.js').SystemPromptStatus} SystemPromptStatus
 *
 * @typedef {{
 *     sessionId: string | null;
 *     digest: string;
 *     configuredMode: import('./user-config.js').SystemPromptMode;
 *     effectiveMode: import('./user-config.js').SystemPromptMode;
 *     effectiveLiveMode: import('./user-config.js').SystemPromptMode;
 *     liveReloadEnabled: boolean;
 *     liveReloadMechanism: 'sdk-transform' | 'static-snapshot';
 *     reloadStrategy: import('./user-config.js').SystemPromptReloadStrategy;
 *     boundAt: number;
 * }} SystemPromptBindingSnapshot
 *
 *
 * @typedef {{
 *     hasBinding: boolean;
 *     sessionMatches: boolean;
 *     digestMatches: boolean;
 *     liveReloadCoversEdits: boolean;
 *     isStale: boolean;
 *     reason: string;
 *     recommendedAction: 'none' | 'observe-live-reload' | 'resume-session';
 * }} SystemPromptFreshness
 */

/**
 * @param {SystemPromptStatus} status
 * @param {string | null | undefined} [sessionId]
 * @returns {SystemPromptBindingSnapshot}
 */
export function buildSystemPromptBindingSnapshot(status, sessionId = null) {
    return {
        sessionId: typeof sessionId === 'string' ? sessionId : null,
        digest: status.revision.digest,
        configuredMode: status.configuredMode,
        effectiveMode: status.effectiveMode,
        effectiveLiveMode: status.effectiveLiveMode,
        liveReloadEnabled: status.liveReloadEnabled,
        liveReloadMechanism: status.liveReloadMechanism,
        reloadStrategy: status.reloadStrategy,
        boundAt: Date.now(),
    };
}

/**
 * @param {SystemPromptStatus} status
 * @param {SystemPromptBindingSnapshot | null | undefined} binding
 * @param {string | null | undefined} [sessionId]
 * @returns {SystemPromptFreshness}
 */
export function evaluateSystemPromptFreshness(status, binding, sessionId = null) {
    if (!binding) {
        return {
            hasBinding: false,
            sessionMatches: false,
            digestMatches: false,
            liveReloadCoversEdits: status.liveReloadEnabled,
            isStale: true,
            reason: 'Sessão sem binding persistido do system prompt.',
            recommendedAction: status.liveReloadEnabled ? 'observe-live-reload' : 'resume-session',
        };
    }

    const normalizedSessionId = typeof sessionId === 'string' ? sessionId : null;
    const sessionMatches = binding.sessionId === normalizedSessionId;
    const digestMatches = binding.digest === status.revision.digest;
    const liveReloadCoversEdits = status.liveReloadEnabled;

    if (!sessionMatches) {
        return {
            hasBinding: true,
            sessionMatches,
            digestMatches,
            liveReloadCoversEdits,
            isStale: true,
            reason: 'Binding do system prompt pertence a outra sessão SDK.',
            recommendedAction: 'resume-session',
        };
    }

    if (digestMatches) {
        return {
            hasBinding: true,
            sessionMatches,
            digestMatches,
            liveReloadCoversEdits,
            isStale: false,
            reason: 'Binding persistido coincide com a revisão atual do system prompt.',
            recommendedAction: 'none',
        };
    }

    if (liveReloadCoversEdits) {
        return {
            hasBinding: true,
            sessionMatches,
            digestMatches,
            liveReloadCoversEdits,
            isStale: false,
            reason: 'Revisão mudou, mas o reload live via SDK cobre edições durante a sessão.',
            recommendedAction: 'observe-live-reload',
        };
    }

    return {
        hasBinding: true,
        sessionMatches,
        digestMatches,
        liveReloadCoversEdits,
        isStale: true,
        reason: 'Revisão mudou e a sessão atual depende de snapshot estático do system prompt.',
        recommendedAction: 'resume-session',
    };
}
