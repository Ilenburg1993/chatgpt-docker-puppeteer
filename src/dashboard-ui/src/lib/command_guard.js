/**
 * Função exportada: requireReason.
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
 * Função exportada: confirmTwoStepAction.
 * @returns {any}
 */
export function confirmTwoStepAction({ actionLabel, reason, firstMessage = null, secondMessage = null }) {
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
