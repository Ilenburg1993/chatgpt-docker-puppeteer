// @ts-check
import jwt from 'jsonwebtoken';
import { log } from '#core/logger';

/**
 * Middleware de autenticação JWT para proteger rotas do dashboard
 * Verifica se o token JWT é válido e adiciona informações do usuário à requisição
 *
 * @param {import('express').Request} req - Requisição Express
 * @param {import('express').Response} res - Resposta Express
 * @param {import('express').NextFunction} next - Próxima função middleware
 * @returns {void}
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
        // Verificar token JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-change-in-production');

        // Adicionar informações do usuário à requisição
        req.user = {
            id: decoded.id,
            username: decoded.username,
            role: decoded.role || 'user',
            iat: decoded.iat,
            exp: decoded.exp,
        };

        log('DEBUG', `[AUTH] User authenticated: ${req.user.username}`, req.id);
        next();
    } catch (error) {
        log('WARN', `[AUTH] Token verification failed: ${error.message}`, req.id);

        if (error.name === 'TokenExpiredError') {
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
 * Middleware opcional de autenticação - permite acesso público mas adiciona user se token válido
 * Útil para funcionalidades públicas que podem ser aprimoradas com autenticação
 *
 * @param {import('express').Request} req - Requisição Express
 * @param {import('express').Response} res - Resposta Express
 * @param {import('express').NextFunction} next - Próxima função middleware
 * @returns {void}
 * @sideEffects - Adiciona req.user se token for válido, mas nunca bloqueia
 */
export function optionalAuthenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-change-in-production');
            req.user = {
                id: decoded.id,
                username: decoded.username,
                role: decoded.role || 'user',
                iat: decoded.iat,
                exp: decoded.exp,
            };
            log('DEBUG', `[AUTH] Optional auth successful: ${req.user.username}`, req.id);
        } catch (error) {
            // Ignorar erro - autenticação opcional
            log('DEBUG', `[AUTH] Optional auth failed, continuing without user`, req.id);
        }
    }

    next();
}

/**
 * Middleware para verificar se usuário tem role específico
 * Deve ser usado após authenticate()
 *
 * @param {string|string[]} requiredRoles - Role(s) necessária(s)
 * @returns {function} Middleware function
 * @sideEffects - Pode enviar resposta de erro 403 se autorização falhar
 */
export function requireRole(requiredRoles) {
    return (req, res, next) => {
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
                req.id
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
