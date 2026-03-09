/** @import {VerifyOptions} from "jsonwebtoken" */
// @ts-check - Type checking rigoroso habilitado (arquivo core)

/**
 * @module core/jwt_config
 * @file Módulo centralizado de configuração JWT.
 *
 *   Responsabilidade única: fornecer o secret JWT de forma segura, com validação rigorosa e falha rápida se não
 *   configurado corretamente.
 *
 *   ARQUITETURA DE SEGURANÇA:
 *
 *   - Nunca usa fallback hardcoded para o JWT_SECRET
 *   - Valida comprimento mínimo de 32 caracteres
 *   - Cacheia o secret após primeira validação
 *   - Todas as opções de sign/verify centralizadas aqui
 *
 *   Para gerar um secret seguro: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
 */

/** @type {string | null} */
let _cachedSecret = null;

/**
 * Retorna o JWT secret configurado via variável de ambiente. Lança erro se JWT_SECRET não estiver definida ou for muito
 * curta.
 *
 * @returns {string} JWT secret válido
 * @throws {Error} Se JWT_SECRET não estiver configurada ou for insegura
 */
export function getJwtSecret() {
    if (_cachedSecret) return _cachedSecret;

    const secret = process.env.JWT_SECRET;

    if (!secret || secret.trim().length === 0) {
        throw new Error(
            '[AUTH] JWT_SECRET não está definida. ' +
                'Configure a variável de ambiente JWT_SECRET antes de iniciar o sistema. ' +
                'Para gerar um secret seguro: ' +
                "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
        );
    }

    if (secret.length < 32) {
        throw new Error(
            `[AUTH] JWT_SECRET é muito curta (${secret.length} chars). ` +
                'Mínimo exigido: 32 caracteres. Recomendado: 64+ caracteres aleatórios. ' +
                'Para gerar: ' +
                "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
        );
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
 * Opções padrão para `jwt.sign()`. Centralizado para garantir consistência entre sign e verify.
 *
 * /** JWT sign options (cast to unknown to keep JSDoc simple).
 *
 * @type {unknown}
 */
export const JWT_SIGN_OPTIONS = /** @type {unknown} */ (
    Object.freeze({
        expiresIn: process.env.JWT_EXPIRY || '24h',
        algorithm: 'HS256',
    })
);

/**
 * Opções padrão para `jwt.verify()`. Restringe ao algoritmo HS256 para prevenir ataques de algorithm confusion.
 */
export const JWT_VERIFY_OPTIONS = /** @type {VerifyOptions} */ (
    Object.freeze({
        algorithms: ['HS256'],
    })
);
