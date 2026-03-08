// @ts-check
/** @import {
  NextFunction,
  Request,
  Response
} from "express" */
/** @import {VerifyOptions} from "jsonwebtoken" */
import { getJwtSecret, JWT_VERIFY_OPTIONS } from '#core/jwt_config';
import { log } from '#core/logger';
import { getRbacUserByUsername } from '#infra/db/rbac_repo';
import { isTokenRevoked } from '#infra/db/token_blocklist';
import jwt from 'jsonwebtoken';

/**
 * Middleware de autenticação JWT para proteger rotas do dashboard Verifica se o token JWT é válido e adiciona
 * informações do usuário à requisição
 *
 * @param {Request} req - Requisição Express
 * @param {Response} res - Resposta Express
 * @param {NextFunction} next - Próxima função middleware
 * @returns {Response | void}
 * @sideEffects - Pode enviar resposta de erro 401 se autenticação falhar
 */
export function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        log('WARN', `[AUTH] Missing or invalid authorization header`, req.id);
        return res.status(401).json({
            success: false,
            error: 'Token de autenticação necessário',
            request_id: req.id,
        });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
        // Verificar token JWT usando secret centralizado e validado
        const decoded = /** @type {{ [k: string]: unknown }} */ (
            jwt.verify(token, getJwtSecret(), /** @type {VerifyOptions} */ (JWT_VERIFY_OPTIONS))
        );

        // SEC-02 FIX: Verificar se o token foi revogado (logout explícito)
        const jti = decoded.jti;
        if (jti && isTokenRevoked(String(jti))) {
            log('WARN', `[AUTH] Token revogado apresentado pelo usuário: ${decoded.username}`, req.id);
            return res.status(401).json({
                success: false,
                error: 'Token revogado. Por favor, faça login novamente.',
                request_id: req.id,
            });
        }

        const tokenUsername = decoded.username ? String(decoded.username) : '';
        const rbacUser = tokenUsername ? getRbacUserByUsername(tokenUsername) : null;
        const permissions = Array.isArray(decoded.permissions)
            ? decoded.permissions.map((p) => String(p))
            : Array.isArray(rbacUser?.permissions)
              ? rbacUser.permissions
              : [];
        const role = decoded.role || rbacUser?.role || 'viewer';

        // Adicionar informações do usuário à requisição
        req.user = {
            id: decoded.id,
            username: tokenUsername || decoded.id,
            role,
            roles: Array.isArray(decoded.roles)
                ? decoded.roles
                : Array.isArray(rbacUser?.roles)
                  ? rbacUser.roles
                  : [role],
            permissions,
            jti: decoded.jti || null,
            iat: decoded.iat,
            exp: decoded.exp,
        };

        log('DEBUG', `[AUTH] User authenticated: ${req.user?.username}`, req.id);
        next();
    } catch (/** @type {any} */ error) {
        const _e = /** @type {any} */ (error);
        log('WARN', `[AUTH] Token verification failed: ${_e.message}`, req.id);

        if (_e.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expirado',
                request_id: req.id,
            });
        }

        return res.status(401).json({
            success: false,
            error: 'Token inválido',
            request_id: req.id,
        });
    }
}

/**
 * Middleware opcional de autenticação - permite acesso público mas adiciona user se token válido Útil para
 * funcionalidades públicas que podem ser aprimoradas com autenticação
 *
 * @param {Request} req - Requisição Express
 * @param {Response} res - Resposta Express
 * @param {NextFunction} next - Próxima função middleware
 * @returns {void}
 * @sideEffects - Adiciona req.user se token for válido, mas nunca bloqueia
 */
export function optionalAuthenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);

        try {
            const decoded = /** @type {{ [k: string]: unknown }} */ (
                jwt.verify(token, getJwtSecret(), /** @type {VerifyOptions} */ (JWT_VERIFY_OPTIONS))
            );
            const jti = decoded.jti;
            if (jti && isTokenRevoked(String(jti))) {
                log('DEBUG', '[AUTH] Optional auth ignored due to revoked token', req.id);
                return next();
            }
            const tokenUsername = decoded.username ? String(decoded.username) : '';
            const rbacUser = tokenUsername ? getRbacUserByUsername(tokenUsername) : null;
            const permissions = Array.isArray(decoded.permissions)
                ? decoded.permissions.map((p) => String(p))
                : Array.isArray(rbacUser?.permissions)
                  ? rbacUser.permissions
                  : [];
            const role = decoded.role || rbacUser?.role || 'viewer';

            req.user = {
                id: decoded.id,
                username: tokenUsername || decoded.id,
                role,
                roles: Array.isArray(decoded.roles)
                    ? decoded.roles
                    : Array.isArray(rbacUser?.roles)
                      ? rbacUser.roles
                      : [role],
                permissions,
                jti: decoded.jti || null,
                iat: decoded.iat,
                exp: decoded.exp,
            };
            log('DEBUG', `[AUTH] Optional auth successful: ${req.user?.username}`, req.id);
        } catch (/** @type {any} */ error) {
            const _e = /** @type {any} */ (error);
            // Ignorar erro - autenticação opcional
            log('DEBUG', `[AUTH] Optional auth failed, continuing without user`, req.id);
        }
    }

    next();
}

/**
 * Middleware para verificar se usuário tem role específico Deve ser usado após authenticate()
 *
 * @param {string | string[]} requiredRoles - Role(s) necessária(s)
 * @returns {function} Middleware function
 * @sideEffects - Pode enviar resposta de erro 403 se autorização falhar
 */
export function requireRole(requiredRoles) {
    return (/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Autenticação necessária',
                request_id: req.id,
            });
        }

        const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

        if (!roles.includes(req.user.role)) {
            log(
                'WARN',
                `[AUTH] Insufficient permissions. User: ${req.user.username}, Required: ${roles.join(',')}, Has: ${req.user.role}`,
                req.id,
            );
            return res.status(403).json({
                success: false,
                error: 'Permissões insuficientes',
                request_id: req.id,
            });
        }

        next();
    };
}
