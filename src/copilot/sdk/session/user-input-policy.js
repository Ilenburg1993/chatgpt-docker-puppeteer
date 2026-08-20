// @ts-check
/**
 * Politica canônica de input humano para a LLM-B.
 *
 * Choices são sugestões e atalhos. O operador sempre pode responder com texto livre, mesmo quando chamadas antigas
 * pedem `allowFreeform=false` ou `requires_selection=true`.
 *
 * @module copilot/sdk/session/user-input-policy
 */

export const USER_INPUT_FREEFORM_POLICY = Object.freeze({
    mode: 'freeform_always',
    choicesAreSuggestions: true,
    requiredSelectionIsLegacy: true,
});

/**
 * @param {unknown} [_]
 * @returns {true}
 */
export function resolveEffectiveUserInputAllowFreeform(_) {
    return true;
}

/**
 * @param {unknown} choices
 * @returns {string[]}
 */
export function normalizeUserInputChoices(choices) {
    return Array.isArray(choices)
        ? choices
              .map((choice) => (typeof choice === 'string' ? choice.trim() : ''))
              .filter((choice) => choice.length > 0)
        : [];
}
