// @ts-check
/**
 * Canonical capability contract for changing a model route while preserving the current SDK session.
 *
 * The public Copilot SDK can change the model of a live session, but its current public session API does not expose a
 * provider-config rebind operation. Callers must never translate that missing capability into an implicit new session.
 *
 * @module copilot/model-gateway/session/live-route-switch-capability
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {{
 *     currentProviderId?: string | null;
 *     targetProviderId?: string | null;
 *     sessionAvailable?: boolean;
 *     modelSwitchAvailable?: boolean;
 *     providerRebindAvailable?: boolean;
 *     sameSessionReattachAvailable?: boolean;
 * }} input
 */
export function evaluateLiveRouteSwitchCapability(input) {
    const currentProviderId = text(input.currentProviderId);
    const targetProviderId = text(input.targetProviderId);
    const providerBoundaryKnown = currentProviderId !== null && targetProviderId !== null;
    const providerRebindRequired =
        targetProviderId !== null && (!providerBoundaryKnown || currentProviderId !== targetProviderId);
    if (input.sessionAvailable !== true) {
        return {
            supported: false,
            mode: 'blocked',
            sameSessionRequired: true,
            requiresNewSession: false,
            providerRebindRequired,
            providerBoundaryKnown,
            reason: 'live_session_unavailable',
        };
    }
    if (providerRebindRequired) {
        if (input.providerRebindAvailable === true || input.sameSessionReattachAvailable === true) {
            return {
                supported: true,
                mode: input.providerRebindAvailable === true ? 'provider_rebind' : 'same_session_reattach',
                sameSessionRequired: true,
                requiresNewSession: false,
                providerRebindRequired: true,
                providerBoundaryKnown,
                reason:
                    input.providerRebindAvailable === true
                        ? 'live_provider_rebind_supported'
                        : 'same_session_reattach_supported',
            };
        }
        return {
            supported: false,
            mode: 'provider_rebind',
            sameSessionRequired: true,
            requiresNewSession: false,
            providerRebindRequired: true,
            providerBoundaryKnown,
            reason: 'live_provider_rebind_capability_missing',
        };
    }
    if (input.modelSwitchAvailable !== true && input.sameSessionReattachAvailable !== true) {
        return {
            supported: false,
            mode: 'model_switch',
            sameSessionRequired: true,
            requiresNewSession: false,
            providerRebindRequired: false,
            providerBoundaryKnown,
            reason: 'live_model_switch_capability_missing',
        };
    }
    return {
        supported: true,
        mode: input.modelSwitchAvailable === true ? 'model_switch' : 'same_session_reattach',
        sameSessionRequired: true,
        requiresNewSession: false,
        providerRebindRequired: false,
        providerBoundaryKnown,
        reason: input.modelSwitchAvailable === true ? 'live_model_switch_supported' : 'same_session_reattach_supported',
    };
}
