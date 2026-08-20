// @ts-check
/**
 * Apresentacao pura de falhas BYOK em turnos vivos do terminal.
 *
 * A camada humana nao deve expor `dialog.byok_*` ou a mensagem crua do provider por default. Esses detalhes seguem em
 * activity/SSE/health; aqui fica o resumo operacional acionavel.
 *
 * @module copilot/terminal/dialog/byok-turn-error-presentation
 */

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function optionalPart(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {string} text
 * @returns {string}
 */
function humanizeByokFailureLabel(text) {
    return text
        .replace(/\bprovider BYOK\b/giu, 'rota BYOK')
        .replace(/\bProvider BYOK\b/gu, 'Rota BYOK')
        .replace(/\bcredito\b/giu, 'crédito')
        .replace(/\bcota\b/giu, 'cota')
        .replace(/\bautenticacao\b/giu, 'autenticação');
}

/**
 * @param {number | null | undefined} seconds
 * @returns {string | null}
 */
function formatRetryAfter(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes}min`;
    const hours = Math.ceil(minutes / 60);
    return `${hours}h`;
}

/**
 * @param {{
 *     message: string;
 *     errorContext: string;
 *     provider: string | null;
 *     profile: string | null;
 *     model: string | null;
 *     failure: {
 *         kind: string;
 *         operatorLabel: string;
 *         operatorAction: string;
 *         statusCode: number | null;
 *         retryAfterSeconds?: number | null;
 *         resetAt?: string | null;
 *     };
 * }} descriptor
 * @returns {{
 *     title: string;
 *     summary: string;
 *     destination: string;
 *     action: string;
 *     window: string | null;
 *     technicalDetail: string;
 * }}
 */
export function presentByokTurnFailure(descriptor) {
    const retry = formatRetryAfter(descriptor.failure.retryAfterSeconds);
    const resetAt = optionalPart(descriptor.failure.resetAt);
    const windowParts = [retry ? `retry-after ${retry}` : null, resetAt ? `reset ${resetAt}` : null].filter(Boolean);
    const destination = [
        descriptor.profile ? `perfil ${descriptor.profile}` : null,
        descriptor.provider ? `provedor ${descriptor.provider}` : null,
        descriptor.model ? `modelo ${descriptor.model}` : null,
    ]
        .filter(Boolean)
        .join(' · ');
    return {
        title: 'Rota BYOK',
        summary: `${humanizeByokFailureLabel(descriptor.failure.operatorLabel)} · sem uso do GitHub Copilot/AI Credits`,
        destination: destination || 'destino BYOK não identificado',
        action: humanizeByokFailureLabel(descriptor.failure.operatorAction),
        window: windowParts.length > 0 ? windowParts.join(' · ') : null,
        technicalDetail:
            `${descriptor.errorContext} · ${descriptor.failure.kind}` +
            `${descriptor.failure.statusCode ? ` · HTTP ${descriptor.failure.statusCode}` : ''}` +
            ` · mensagem ${descriptor.message}`,
    };
}
