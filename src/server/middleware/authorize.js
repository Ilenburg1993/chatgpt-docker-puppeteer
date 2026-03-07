// @ts-check
import { hasPermission } from '#server/domain/rbac_policy';

/**
 * Função exportada: requirePermission.
 * @param {*} permission
 * @returns {any}
 */
function requirePermission(permission) {
    return (/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Autenticação necessária',
                request_id: req.id,
            });
        }

        if (!hasPermission(req.user, permission)) {
            return res.status(403).json({
                success: false,
                error: 'Permissão insuficiente',
                code: 'FORBIDDEN',
                request_id: req.id,
            });
        }

        return next();
    };
}

export { requirePermission };
