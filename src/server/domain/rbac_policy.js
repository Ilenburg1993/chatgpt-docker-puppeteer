// @ts-check
import { RBAC_PERMISSIONS, RBAC_ROLES } from '#infra/db/rbac_repo';

function toArray(/** @type {any} */ value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

/**
 * Função exportada: hasPermission.
 *
 * @param {any} user
 * @param {any} permission
 * @returns {any}
 */
function hasPermission(user, permission) {
    if (!user) return false;
    const perms = new Set(toArray(user.permissions).map((p) => String(p)));
    if (perms.has(String(permission))) return true;

    const role = String(user.role || '').toLowerCase();
    if (role === RBAC_ROLES.OWNER) return true;
    if (role === RBAC_ROLES.ADMIN && permission !== RBAC_PERMISSIONS.RBAC_MANAGE) return true;

    return false;
}

/**
 * Função exportada: assertPermission.
 *
 * @param {any} user
 * @param {any} permission
 * @returns {void}
 */
function assertPermission(user, permission) {
    if (!hasPermission(user, permission)) {
        const error = new Error(`Permissão insuficiente: ${permission}`);
        error.code = 'FORBIDDEN';
        error.statusCode = 403;
        throw error;
    }
}

/**
 * Função exportada: normalizeActor.
 *
 * @param {any} user
 * @returns {any}
 */
function normalizeActor(user) {
    return {
        id: user?.id ? String(user.id) : null,
        username: user?.username ? String(user.username) : null,
        role: user?.role ? String(user.role) : RBAC_ROLES.VIEWER,
        permissions: toArray(user?.permissions).map((p) => String(p)),
    };
}

export { assertPermission, hasPermission, normalizeActor };
