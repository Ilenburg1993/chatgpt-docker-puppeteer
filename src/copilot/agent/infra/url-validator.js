// @ts-check
/**
 * src/copilot/agent/infra/url-validator.js
 *
 * F71 (GAP-R3): Validação de URLs reutilizável — extraída de webhook-manager.js.
 *
 * - `validateWebhookUrl()`: valida protocolo HTTP(S) e bloqueia hosts privados/loopback (SSRF)
 * - `checkResolvedIp()`: mitiga DNS rebinding verificando IP resolvido
 * - `isPrivateIp()`: verifica se um endereço IP é privado/loopback
 *
 * @module copilot/agent/infra/url-validator
 */

import { WEBHOOK_ALLOW_PRIVATE_HOSTS } from '#copilot/config/env';
import { ConfigError } from '#copilot/core/errors';
import dns from 'node:dns/promises';

/**
 * Regex patterns para IPs privados/loopback.
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

/**
 * Verifica se um endereço IP é privado, loopback ou link-local.
 *
 * @param {string} address - Endereço IP (IPv4 ou IPv6)
 * @returns {boolean}
 */
export function isPrivateIp(address) {
    if (address === '127.0.0.1' || address === '0.0.0.0') return true;
    return PRIVATE_IP_PATTERNS.some((re) => re.test(address));
}

/**
 * Valida se uma URL de webhook é segura (protocolo HTTP/HTTPS, sem IPs privados/loopback exceto quando explicitamente
 * permitido via WEBHOOK_ALLOW_PRIVATE_HOSTS=true).
 *
 * G2-SEC-01: prevenção de SSRF básica — bloqueia acesso a RFC-1918 e loopback.
 *
 * @param {string} url
 * @param {{ allowPrivate?: boolean }} [opts]
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
        const hostname = parsed.hostname;
        if (hostname === 'localhost' || hostname === '0.0.0.0' || isPrivateIp(hostname)) {
            throw new ConfigError(
                `[URLValidator] Host privado/loopback bloqueado por segurança: ${hostname}. Use WEBHOOK_ALLOW_PRIVATE_HOSTS=true para permitir em dev.`,
            );
        }
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

    let address;
    try {
        const result = await dns.lookup(hostname, { family: 4 });
        address = result.address;
    } catch {
        try {
            const result = await dns.lookup(hostname, { family: 6 });
            address = result.address;
        } catch {
            return; // Não conseguiu resolver — deixa o fetch falhar naturalmente
        }
    }
    if (isPrivateIp(address)) {
        throw new ConfigError(
            `[URLValidator] DNS rebinding bloqueado: ${hostname} resolveu para IP privado ${address}.`,
        );
    }
}
