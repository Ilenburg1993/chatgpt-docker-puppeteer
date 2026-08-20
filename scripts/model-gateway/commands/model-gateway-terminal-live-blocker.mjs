// @ts-check

/**
 * Classify startup failures that make an LLM-B live scenario impossible before its prompt is dispatched.
 *
 * The terminal intentionally remains alive after SDK boot failures so a human can inspect local diagnostics. The
 * automated live harness has a different contract: once the terminal itself has declared the conversation boot blocked,
 * waiting for the full scenario timeout adds no evidence. This classifier lets the harness collect local diagnostics
 * and exit early without conflating an upstream outage with invalid credentials.
 *
 * @param {string} plain
 * @returns {{ id: string; detail: string } | null}
 */
export function classifyModelGatewayTerminalStartupBlocker(plain) {
    const text = String(plain ?? '');
    const bootBlocked =
        /Boot da conversa bloque/i.test(text) ||
        /Boot\s+falha ao iniciar conversa/i.test(text) ||
        /Dialog loop bootstrap error/i.test(text) ||
        /ensureDialogLoop falhou após \d+ tentativas/i.test(text) ||
        /Autentica(?:ç|c)[aã]o do SDK bloqueou o dialog loop/i.test(text) ||
        /Falha transitória do SDK; a política permite retry\/backoff local/i.test(text);
    if (!bootBlocked) return null;

    if (
        /Failed to validate SDK token \(5\d\d\)/i.test(text) ||
        /No server is currently available to service your request/i.test(text) ||
        /service unavailable/i.test(text) ||
        /temporarily unavailable/i.test(text)
    ) {
        return {
            id: 'sdk-upstream-unavailable',
            detail: 'GitHub Copilot SDK upstream was unavailable during session bootstrap; scenario prompt was not dispatched',
        };
    }

    if (/\[sdk auth\]/i.test(text) || /session\.create[^\n]*\(auth\)/i.test(text)) {
        return {
            id: 'sdk-auth-failed',
            detail: 'GitHub Copilot SDK authentication blocked session bootstrap before scenario dispatch',
        };
    }

    if (/\[sdk rede\]/i.test(text) || /session\.create[^\n]*\(network\)/i.test(text)) {
        return {
            id: 'sdk-network-unavailable',
            detail: 'GitHub Copilot SDK network bootstrap failed before scenario dispatch',
        };
    }

    return null;
}
