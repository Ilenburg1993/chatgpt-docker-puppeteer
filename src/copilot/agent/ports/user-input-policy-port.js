// @ts-check
/**
 * Agent-local port for the SDK user-input policy.
 *
 * Dialog wiring consumes this narrow semantic boundary instead of importing the SDK or the broad Agent SDK facade.
 * The SDK dependency therefore remains confined to the authorized `agent/ports` integration layer.
 *
 * @module copilot/agent/ports/user-input-policy-port
 * @internal
 */

import { resolveEffectiveUserInputAllowFreeform } from '#copilot/sdk/session';

/**
 * Resolve whether free-form input is effectively allowed under the SDK policy.
 *
 * @param {boolean | undefined} requested
 * @returns {boolean}
 */
export function resolveAgentUserInputAllowFreeform(requested) {
    return resolveEffectiveUserInputAllowFreeform(requested);
}
