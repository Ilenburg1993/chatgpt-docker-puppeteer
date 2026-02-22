// @ts-check - Type checking rigoroso habilitado
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './sqlite.js';

const RBAC_ROLES = Object.freeze({
    OWNER: 'owner',
    ADMIN: 'admin',
    OPERATOR: 'operator',
    VIEWER: 'viewer',
});

const RBAC_PERMISSIONS = Object.freeze({
    MISSION_READ: 'mission.read',
    MISSION_CREATE: 'mission.create',
    MISSION_EXECUTE: 'mission.execute',
    MISSION_PAUSE: 'mission.pause',
    MISSION_RESUME: 'mission.resume',
    MISSION_CANCEL: 'mission.cancel',
    MISSION_EDIT: 'mission.edit',
    MISSION_POLICY: 'mission.policy',
    MISSION_REORDER: 'mission.reorder',
    TASK_READ: 'task.read',
    TASK_CREATE: 'task.create',
    TASK_EDIT: 'task.edit',
    TASK_PAUSE: 'task.pause',
    TASK_RESUME: 'task.resume',
    TASK_CANCEL: 'task.cancel',
    TASK_RETRY: 'task.retry',
    TASK_PURGE: 'task.purge',
    TASK_BULK: 'task.bulk',
    CONTROL_VALIDATE: 'control.validate',
    CONTROL_EXECUTE: 'control.execute',
    DASHBOARD_COMMAND: 'dashboard.command',
    RBAC_MANAGE: 'rbac.manage',
    USER_PREFS_WRITE: 'user_prefs.write',
});

const ROLE_PERMISSION_MATRIX = Object.freeze({
    [RBAC_ROLES.OWNER]: Object.values(RBAC_PERMISSIONS),
    [RBAC_ROLES.ADMIN]: Object.values(RBAC_PERMISSIONS).filter(p => p !== RBAC_PERMISSIONS.RBAC_MANAGE),
    [RBAC_ROLES.OPERATOR]: [
        RBAC_PERMISSIONS.MISSION_READ,
        RBAC_PERMISSIONS.MISSION_EXECUTE,
        RBAC_PERMISSIONS.MISSION_PAUSE,
        RBAC_PERMISSIONS.MISSION_RESUME,
        RBAC_PERMISSIONS.MISSION_CANCEL,
        RBAC_PERMISSIONS.TASK_READ,
        RBAC_PERMISSIONS.TASK_CREATE,
        RBAC_PERMISSIONS.TASK_PAUSE,
        RBAC_PERMISSIONS.TASK_RESUME,
        RBAC_PERMISSIONS.TASK_CANCEL,
        RBAC_PERMISSIONS.TASK_RETRY,
        RBAC_PERMISSIONS.TASK_BULK,
        RBAC_PERMISSIONS.CONTROL_VALIDATE,
        RBAC_PERMISSIONS.CONTROL_EXECUTE,
        RBAC_PERMISSIONS.DASHBOARD_COMMAND,
        RBAC_PERMISSIONS.USER_PREFS_WRITE,
    ],
    [RBAC_ROLES.VIEWER]: [RBAC_PERMISSIONS.MISSION_READ, RBAC_PERMISSIONS.TASK_READ],
});

function _now() {
    return Date.now();
}

function _hashPassword(raw) {
    return crypto.createHash('sha256').update(String(raw || ''), 'utf8').digest('hex');
}

function _normalizeUsername(username) {
    return String(username || '')
        .trim()
        .toLowerCase();
}

function ensureBaseRbacData() {
    const db = getDb();
    const tx = db.transaction(() => {
        for (const roleName of Object.values(RBAC_ROLES)) {
            db.prepare(
                `
                INSERT OR IGNORE INTO rbac_roles (id, role_name, description)
                VALUES (@id, @role_name, @description)
            `
            ).run({
                id: `role-${roleName}`,
                role_name: roleName,
                description: `Role ${roleName}`,
            });
        }

        for (const permission of Object.values(RBAC_PERMISSIONS)) {
            db.prepare(
                `
                INSERT OR IGNORE INTO rbac_permissions (id, permission, description)
                VALUES (@id, @permission, @description)
            `
            ).run({
                id: `perm-${permission.replace(/[^a-zA-Z0-9]+/g, '-')}`,
                permission,
                description: permission,
            });
        }

        for (const [roleName, permissions] of Object.entries(ROLE_PERMISSION_MATRIX)) {
            const role = db.prepare('SELECT id FROM rbac_roles WHERE role_name = ?').get(roleName);
            if (!role) continue;
            for (const permission of permissions) {
                const perm = db.prepare('SELECT id FROM rbac_permissions WHERE permission = ?').get(permission);
                if (!perm) continue;
                db.prepare(
                    `
                    INSERT OR IGNORE INTO rbac_role_permission (role_id, permission_id)
                    VALUES (?, ?)
                `
                ).run(role.id, perm.id);
            }
        }
    });

    tx();
}

function upsertRbacUser({ username, password, role = RBAC_ROLES.VIEWER, active = true }) {
    const db = getDb();
    const name = _normalizeUsername(username);
    if (!name) throw new Error('username obrigatório');

    ensureBaseRbacData();

    const now = _now();
    const passwordHash = _hashPassword(password);
    const roleName = Object.values(RBAC_ROLES).includes(String(role)) ? String(role) : RBAC_ROLES.VIEWER;

    const existing = db.prepare('SELECT * FROM rbac_users WHERE username = ?').get(name);
    const userId = existing?.id || `usr-${uuidv4()}`;

    db.prepare(
        `
        INSERT INTO rbac_users (id, username, password_hash, active, created_at_ms, updated_at_ms)
        VALUES (@id, @username, @password_hash, @active, @created_at_ms, @updated_at_ms)
        ON CONFLICT(username) DO UPDATE SET
            password_hash = excluded.password_hash,
            active = excluded.active,
            updated_at_ms = excluded.updated_at_ms
    `
    ).run({
        id: userId,
        username: name,
        password_hash: passwordHash,
        active: active ? 1 : 0,
        created_at_ms: existing?.created_at_ms || now,
        updated_at_ms: now,
    });

    const roleRow = db.prepare('SELECT id FROM rbac_roles WHERE role_name = ?').get(roleName);
    if (roleRow) {
        db.prepare('DELETE FROM rbac_user_role WHERE user_id = ?').run(userId);
        db.prepare('INSERT OR IGNORE INTO rbac_user_role (user_id, role_id) VALUES (?, ?)').run(userId, roleRow.id);
    }

    return getRbacUserByUsername(name);
}

function getRbacUserByUsername(username) {
    const db = getDb();
    const name = _normalizeUsername(username);
    if (!name) return null;

    const row = db
        .prepare(
            `
            SELECT u.*,
                   GROUP_CONCAT(DISTINCT r.role_name) AS role_names,
                   GROUP_CONCAT(DISTINCT p.permission) AS permissions
            FROM rbac_users u
            LEFT JOIN rbac_user_role ur ON ur.user_id = u.id
            LEFT JOIN rbac_roles r ON r.id = ur.role_id
            LEFT JOIN rbac_role_permission rp ON rp.role_id = r.id
            LEFT JOIN rbac_permissions p ON p.id = rp.permission_id
            WHERE u.username = ?
            GROUP BY u.id
        `
        )
        .get(name);

    if (!row) return null;

    const roles = row.role_names ? String(row.role_names).split(',').filter(Boolean) : [];
    const permissions = row.permissions ? String(row.permissions).split(',').filter(Boolean) : [];

    return {
        id: String(row.id),
        username: String(row.username),
        active: Number(row.active) === 1,
        roles,
        role: roles[0] || RBAC_ROLES.VIEWER,
        permissions,
        created_at_ms: Number(row.created_at_ms) || 0,
        updated_at_ms: Number(row.updated_at_ms) || 0,
    };
}

function verifyRbacCredentials(username, password) {
    const db = getDb();
    const name = _normalizeUsername(username);
    if (!name || !password) return null;

    const row = db.prepare('SELECT * FROM rbac_users WHERE username = ?').get(name);
    if (!row || Number(row.active) !== 1) return null;

    const incomingHash = _hashPassword(password);
    const storedHash = String(row.password_hash || '');

    const left = Buffer.from(incomingHash, 'utf8');
    const right = Buffer.from(storedHash, 'utf8');
    if (left.length !== right.length) return null;
    if (!crypto.timingSafeEqual(left, right)) return null;

    return getRbacUserByUsername(name);
}

function bootstrapRbacFromEnv() {
    ensureBaseRbacData();

    const ownerUsername = _normalizeUsername(process.env.RBAC_BOOTSTRAP_OWNER_USERNAME || '');
    const ownerPassword = String(process.env.RBAC_BOOTSTRAP_OWNER_PASSWORD || '');

    if (ownerUsername && ownerPassword.length >= 12) {
        upsertRbacUser({ username: ownerUsername, password: ownerPassword, role: RBAC_ROLES.OWNER, active: true });
    }

    const dashboardUsername = _normalizeUsername(process.env.DASHBOARD_AUTH_USERNAME || 'admin');
    const dashboardPassword = String(process.env.DASHBOARD_AUTH_PASSWORD || 'admin123456789');
    if (dashboardUsername && dashboardPassword.length >= 12) {
        upsertRbacUser({ username: dashboardUsername, password: dashboardPassword, role: RBAC_ROLES.ADMIN, active: true });
    }
}

export {
    RBAC_PERMISSIONS,
    RBAC_ROLES,
    ROLE_PERMISSION_MATRIX,
    bootstrapRbacFromEnv,
    ensureBaseRbacData,
    getRbacUserByUsername,
    upsertRbacUser,
    verifyRbacCredentials,
};
