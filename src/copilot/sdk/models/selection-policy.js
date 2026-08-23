// @ts-check
/**
 * Helpers puros para interpretar seleção/configuração de modelo sem depender do SDK ou do terminal.
 *
 * @module copilot/sdk/models/selection-policy
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAutoModelSelector(value) {
    return typeof value === 'string' && value.trim().toLowerCase() === 'auto';
}

/**
 * `auto` é seletor deliberado do SDK, não modelo concreto. Quando o SDK resolve `auto` para um modelo cobrado
 * diferente, isso é seleção efetiva, não mismatch.
 *
 * @param {{
 *     configuredModel?: string | null | undefined;
 *     billedModel?: string | null | undefined;
 *     effectiveModel?: string | null | undefined;
 *     explicitMismatch?: boolean | null;
 * }} input
 * @returns {boolean}
 */
export function resolveModelSelectionMismatch(input) {
    const configuredModel = input.configuredModel ?? null;
    if (!configuredModel || isAutoModelSelector(configuredModel)) return false;
    const billedModel = input.billedModel ?? null;
    const effectiveModel = input.effectiveModel ?? null;
    return (
        Boolean(input.explicitMismatch) ||
        Boolean(billedModel && billedModel !== configuredModel) ||
        Boolean(effectiveModel && effectiveModel !== configuredModel)
    );
}
