// @ts-check
/**
 * Função exportada: requireReason.
 *
 * @param {any} reason
 * @param {any} [fallbackMessage]
 * @returns {any}
 */
export function requireReason(reason, fallbackMessage = 'Motivo operacional é obrigatório para este comando.') {
    const normalized = String(reason || '').trim();
    if (!normalized) {
        throw new Error(fallbackMessage);
    }
    return normalized;
}

/**
 * @typedef {object} ConfirmTwoStepActionOptions
 * @property {any} [actionLabel]
 * @property {any} [reason]
 * @property {any} [firstMessage]
 * @property {any} [secondMessage]
 */
/**
 * Função exportada: confirmTwoStepAction.
 *
 * @param {ConfirmTwoStepActionOptions} [options]
 * @returns {any}
 */
export function confirmTwoStepAction(
    /** @type {any} */ { actionLabel, reason, firstMessage = null, secondMessage = null } = {},
) {
    const normalizedReason = requireReason(reason);
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
        return true;
    }

    const step1 =
        firstMessage || `[Confirmação 1/2]\nExecutar: ${actionLabel}\nMotivo: ${normalizedReason}\n\nDeseja continuar?`;
    const step2 =
        secondMessage ||
        `[Confirmação 2/2]\nA ação "${actionLabel}" será registrada em auditoria.\n\nConfirmar execução?`;

    if (!window.confirm(step1)) return false;
    if (!window.confirm(step2)) return false;
    return true;
}
