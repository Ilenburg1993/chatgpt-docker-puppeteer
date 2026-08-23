// @ts-check
/**
 * Politica canônica de input humano para a LLM-B.
 *
 * Texto livre é permitido por padrão. Quando o caller declara `allowFreeform=false`, choices passam a ser restrição
 * semântica e a policy preserva essa decisão em todas as projections.
 *
 * @module copilot/sdk/session/user-input-policy
 */

export const USER_INPUT_FREEFORM_POLICY = Object.freeze({
    mode: 'caller_controlled_default_true',
    choicesAreSuggestionsByDefault: true,
    explicitFalseRequiresSelection: true,
});

/**
 * @param {unknown} [requested]
 * @returns {boolean}
 */
export function resolveEffectiveUserInputAllowFreeform(requested = undefined) {
    return requested !== false;
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
