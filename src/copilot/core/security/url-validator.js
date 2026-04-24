// @ts-check
/**
 * src/copilot/core/security/url-validator.js
 *
 * SSOT canônico para validação de URLs — anti-SSRF.
 *
 * Unifica `agent/infra/url-validator.js` (throws API, DNS rebinding) e `sdk/url-validator.js` (functional API `{ safe,
 * reason }`).
 *
 * Prevenção de SSRF alinhada com OWASP A10 (Server-Side Request Forgery).
 *
 * L0 (core) — não importa camadas superiores. Lê WEBHOOK_ALLOW_PRIVATE_HOSTS de process.env.
 *
 * @module copilot/core/security/url-validator
 * @see EventBus
 */

import { ConfigError } from '#copilot/core';
import dns from 'node:dns/promises';

/**
 * Leitura direta de env para evitar import de config (L2) em core (L0).
 *
 * @type {boolean}
 */
const WEBHOOK_ALLOW_PRIVATE_HOSTS = process.env['WEBHOOK_ALLOW_PRIVATE_HOSTS'] === 'true';

// ─── Patterns de IP privado/loopback ────────────────────────────────────────

/**
 * Regex patterns para IPs privados/loopback (IPv4 e IPv6).
 *
 * @type {ReadonlyArray<RegExp>}
 */
const PRIVATE_IP_PATTERNS = [
    /^127\./,
    /^::1$/,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^fe80:/i,
    /^f[cd]/i,
    /^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/,
];

/** Regex de hostname privado/loopback/IMDS. */
const PRIVATE_HOST_RE =
    /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|::1|fd[0-9a-f]{2}:|metadata\.google\.internal$)/i;

/** Esquemas de URL bloqueados. */
const BLOCKED_SCHEMES = new Set(['file:', 'ftp:', 'data:', 'javascript:']);

// ─── API funcional (retorna { safe, reason }) ────────────────────────────────

/**
 * Verifica se um endereço IP é privado, loopback ou link-local.
 *
 * @param {string} address - Endereço IP (IPv4 ou IPv6)
 * @returns {boolean}
 */
export function isPrivateIp(address) {
    if (address === '127.0.0.1' || address === '0.0.0.0') return true;
    const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
    if (mapped) {
        const first = Number.parseInt(mapped[1] ?? '0', 16);
        const a = (first >> 8) & 0xff;
        const b = first & 0xff;
        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168)
        );
    }
    return PRIVATE_IP_PATTERNS.some((re) => re.test(address));
}

/**
 * Valida se uma URL parseada é segura para fetch (anti-SSRF). Retorna objeto `{ safe, reason }` — não lança exceção.
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
    // Bloquear IPs numéricos IPv4 privados que possam bypassar regex de hostname
    const ipv4Parts = url.hostname.split('.');
    if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
        const ipNums = ipv4Parts.map(Number);
        const a = ipNums[0] ?? -1;
        const b = ipNums[1] ?? -1;
        if (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168)
        ) {
            return { safe: false, reason: `Endereço IP privado/link-local bloqueado: ${url.hostname}` };
        }
    }
    // IPv6 loopback, link-local (fe80::), ULA (fc00::/7), IPv4-mapped privados
    const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
        h === '::1' ||
        h === '0:0:0:0:0:0:0:1' ||
        h.startsWith('fd') ||
        h.startsWith('fc') ||
        h.startsWith('fe80:') ||
        isPrivateIp(h) ||
        h.startsWith('::ffff:10.') ||
        /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(h) ||
        h.startsWith('::ffff:192.168.') ||
        h.startsWith('::ffff:127.') ||
        h === '::ffff:0:0'
    ) {
        return { safe: false, reason: `IPv6 privado/loopback bloqueado: ${url.hostname}` };
    }
    return { safe: true };
}

/**
 * Valida uma URL em formato string: parseia e aplica validação anti-SSRF. Retorna objeto `{ safe, reason, parsed }` —
 * não lança exceção.
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

// ─── API imperativa (lança ConfigError) ─────────────────────────────────────

/**
 * Valida se uma URL de webhook é segura (protocolo HTTP/HTTPS, sem IPs privados/loopback exceto quando explicitamente
 * permitido via `WEBHOOK_ALLOW_PRIVATE_HOSTS=true`).
 *
 * G2-SEC-01: prevenção de SSRF básica — bloqueia acesso a RFC-1918 e loopback.
 *
 * @param {string} url
 * @param {{ allowPrivate?: boolean }} [opts]
 * @returns {void}
 * @throws {ConfigError} Se a URL for inválida ou insegura
 */
export function validateWebhookUrl(url, opts) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new ConfigError(`[URLValidator] URL inválida: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ConfigError(`[URLValidator] Protocolo não permitido: ${parsed.protocol}. Use http ou https.`);
    }
    const allowPrivate = opts?.allowPrivate ?? WEBHOOK_ALLOW_PRIVATE_HOSTS;
    if (!allowPrivate) {
        const result = validateUrl(parsed);
        if (!result.safe) {
            if (result.reason?.includes('privado') || result.reason?.includes('interno')) {
                throw new ConfigError(
                    `[URLValidator] Host privado/loopback bloqueado por segurança: ${parsed.hostname}. ${result.reason}`,
                );
            }
            throw new ConfigError(`[URLValidator] ${result.reason}`);
        }
        return;
    }
}

/**
 * SEC-AGENT-005: Verifica se o IP resolvido para um hostname é privado/loopback. Mitiga DNS rebinding — atacante usa
 * hostname público que resolve para IP interno.
 *
 * @param {string} hostname
 * @param {{ allowPrivate?: boolean }} [opts]
 * @returns {Promise<void>}
 * @throws {ConfigError} Se o IP resolvido for privado/loopback
 */
export async function checkResolvedIp(hostname, opts) {
    const allowPrivate = opts?.allowPrivate ?? WEBHOOK_ALLOW_PRIVATE_HOSTS;
    if (allowPrivate) return;

    /** @type {{ address: string; family: number }[]} */
    let records;
    try {
        records = await dns.lookup(hostname, { all: true });
    } catch {
        return; // Não conseguiu resolver — deixa o fetch falhar naturalmente
    }
    const privateRecord = records.find((record) => isPrivateIp(record.address));
    if (privateRecord) {
        throw new ConfigError(
            `[URLValidator] DNS rebinding bloqueado: ${hostname} resolveu para IP privado ${privateRecord.address}.`,
        );
    }
}
