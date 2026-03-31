// @ts-check
/**
 * src/copilot/lib/url-validator.js
 *
 * Utilitário compartilhado para validação anti-SSRF de URLs. Centraliza a lógica de bloqueio de hosts
 * privados/internos, esquemas perigosos e IPs reservados.
 *
 * Usado por: web-tools.js, routes/webhooks.js, webhook-manager.js
 *
 * @module copilot/lib/url-validator
 */

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Regex de hosts internos/privados. Case-insensitive. Bloquear para prevenir SSRF (OWASP A10). */
const PRIVATE_HOST_RE =
    /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|::1|fd[0-9a-f]{2}:|metadata\.google\.internal$)/i;

/** Esquemas de URL bloqueados. */
const BLOCKED_SCHEMES = new Set(['file:', 'ftp:', 'data:', 'javascript:']);

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Valida se uma URL é segura para fetch (anti-SSRF).
 *
 * @param {URL} url - URL já parseada
 * @returns {{ safe: boolean; reason?: string }}
 */
export function validateUrl(url) {
    if (BLOCKED_SCHEMES.has(url.protocol)) {
        return { safe: false, reason: `Esquema bloqueado: ${url.protocol}` };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return { safe: false, reason: `Protocolo não permitido: ${url.protocol}` };
    }
    if (PRIVATE_HOST_RE.test(url.hostname)) {
        return { safe: false, reason: `Host interno/privado bloqueado: ${url.hostname}` };
    }
    // Block numeric IPv4 forms that may bypass hostname checks
    const ipv4Parts = url.hostname.split('.');
    if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
        const ipNums = ipv4Parts.map(Number);
        const a = ipNums[0] ?? -1;
        const b = ipNums[1] ?? -1;
        if (
            a === 0 || // 0.0.0.0/8 — rotas inválidas / unspec
            a === 10 ||
            a === 127 ||
            (a === 169 && b === 254) || // 169.254.x.x — IMDS link-local
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168)
        ) {
            return { safe: false, reason: `Endereço IP privado/link-local bloqueado: ${url.hostname}` };
        }
    }
    // Bloquear IPv6 loopback e ULA (fd00::/8)
    // URL.hostname retorna IPv6 com brackets: '[::1]' — normalizar removendo-os
    const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === '::1' || h === '0:0:0:0:0:0:0:1' || h.startsWith('fd') || h === 'fe80') {
        return { safe: false, reason: `IPv6 privado/loopback bloqueado: ${url.hostname}` };
    }
    return { safe: true };
}

/**
 * Valida uma string URL: parseia e aplica validação anti-SSRF.
 *
 * @param {string} urlStr - URL como string
 * @returns {{ safe: boolean; reason?: string; parsed?: URL }}
 */
export function validateUrlString(urlStr) {
    try {
        const parsed = new URL(urlStr);
        const result = validateUrl(parsed);
        return { ...result, parsed };
    } catch {
        return { safe: false, reason: 'URL inválida' };
    }
}
