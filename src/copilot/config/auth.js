// @ts-check
/**
 * src/copilot/config/auth.js — Configuração JWT internalizada.
 *
 * Reproduz a superfície de `src/core/jwt_config.js` dentro de `src/copilot/` para eliminar a dependência externa. O
 * módulo externo continua existindo para consumidores fora de copilot.
 *
 * @module copilot/config/auth
 */

/** @import {VerifyOptions} from "jsonwebtoken" */

/** @type {string | null} */
let _cachedSecret = null;

/**
 * Retorna o JWT secret configurado via `JWT_SECRET`.
 *
 * @returns {string} JWT secret válido
 * @throws {Error} Se JWT_SECRET não estiver configurada ou for insegura (< 32 chars)
 */
export function getJwtSecret() {
    if (_cachedSecret) return _cachedSecret;

    const secret = process.env['JWT_SECRET'];

    if (!secret || secret.trim().length === 0) {
        throw new Error(
            '[AUTH] JWT_SECRET não está definida. ' +
                'Configure a variável de ambiente JWT_SECRET antes de iniciar o sistema.',
        );
    }

    if (secret.length < 32) {
        throw new Error(`[AUTH] JWT_SECRET é muito curta (${secret.length} chars). Mínimo: 32 caracteres.`);
    }

    _cachedSecret = secret;
    return _cachedSecret;
}

/**
 * Reseta o cache do secret (útil para testes unitários). NÃO usar em produção.
 *
 * @returns {void}
 */
export function _resetSecretCache() {
    _cachedSecret = null;
}

/**
 * Opções padrão para `jwt.sign()`.
 *
 * @type {unknown}
 */
export const JWT_SIGN_OPTIONS = /** @type {unknown} */ (
    Object.freeze({
        expiresIn: process.env['JWT_EXPIRY'] || '24h',
        algorithm: 'HS256',
    })
);

/**
 * Opções padrão para `jwt.verify()`. Restringe a HS256.
 *
 * @type {VerifyOptions}
 */
export const JWT_VERIFY_OPTIONS = /** @type {VerifyOptions} */ (
    Object.freeze({
        algorithms: ['HS256'],
    })
);
