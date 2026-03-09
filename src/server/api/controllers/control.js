// @ts-check
import { getControlOperationById, listControlOperations } from '#infra/db/control_operation_repo';
import { recordEvent } from '#infra/db/events_repo';
import { RBAC_PERMISSIONS, RBAC_ROLES, getRbacUserByUsername, upsertRbacUser } from '#infra/db/rbac_repo';
import { getUserPreferences, upsertUserPreferences } from '#infra/db/user_pref_repo';
import { COMMANDS, executeCommand, validateCommand } from '#server/domain/control_command_service';
import express from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/authorize.js';
import schemaGuard from '../../middleware/schema_guard.js';

/** Constante/valor exportado: default. */
const router = express.Router();
const typedRouter = /** @type {any} */ (router);

const commandSchema = z.object({
    command: z.string().min(3).max(80),
    payload: z.record(z.any()).default({}),
});

const validateSchema = z.object({
    command: z.string().min(3).max(80),
    payload: z.record(z.any()).default({}),
});

const prefsPatchSchema = z.object({
    layout: z.record(z.any()).optional(),
    columns: z.record(z.any()).optional(),
    filters: z.record(z.any()).optional(),
    density: z.enum(['compact', 'comfortable', 'spacious']).optional(),
    shortcuts: z.record(z.any()).optional(),
    alerts: z.record(z.any()).optional(),
});

const rbacPatchSchema = z.object({
    password: z.string().min(12),
    role: z.enum([RBAC_ROLES.OWNER, RBAC_ROLES.ADMIN, RBAC_ROLES.OPERATOR, RBAC_ROLES.VIEWER]),
    active: z.boolean().optional(),
});

typedRouter.post(
    '/commands',
    authenticate,
    requirePermission(RBAC_PERMISSIONS.CONTROL_EXECUTE),
    schemaGuard(commandSchema),
    async (/** @type {any} */ req, /** @type {any} */ res) => {
        try {
            const output = await executeCommand({
                command: req.body.command,
                payload: req.body.payload || {},
                actor: req.user,
                dryRun: false,
            });

            res.status(202).json({
                success: true,
                command: String(req.body.command || '').toUpperCase(),
                replay: Boolean(output.replay),
                operation: output.operation,
                result: output.result,
                request_id: req.id,
            });
        } catch (/** @type {any} */ err) {
            const _e = /** @type {any} */ (err);
            res.status(Number(_e?.statusCode || 500)).json({
                success: false,
                code: _e?.code || 'CONTROL_COMMAND_FAILED',
                error: _e?.message || 'Falha ao executar comando',
                details: _e?.details || null,
                operation: _e?.operation || null,
                request_id: req.id,
            });
        }
    },
);

typedRouter.post(
    '/validate',
    authenticate,
    requirePermission(RBAC_PERMISSIONS.CONTROL_VALIDATE),
    schemaGuard(validateSchema),
    (/** @type {any} */ req, /** @type {any} */ res) => {
        const validation = validateCommand({
            command: req.body.command,
            payload: req.body.payload || {},
            actor: req.user,
        });

        res.status(validation.ok ? 200 : Number(validation.statusCode || 422)).json({
            success: validation.ok,
            validation,
            request_id: req.id,
        });
    },
);

typedRouter.get(
    '/commands/:id',
    authenticate,
    requirePermission(RBAC_PERMISSIONS.TASK_READ),
    (/** @type {any} */ req, /** @type {any} */ res) => {
        const id = String(req.params.id || '').trim();
        const operation = getControlOperationById(id);
        if (!operation) {
            return res.status(404).json({
                success: false,
                error: 'Operação não encontrada',
                request_id: req.id,
            });
        }

        return res.json({
            success: true,
            operation,
            request_id: req.id,
        });
    },
);

typedRouter.get(
    '/commands',
    authenticate,
    requirePermission(RBAC_PERMISSIONS.TASK_READ),
    (/** @type {any} */ req, /** @type {any} */ res) => {
        const limit = Number(req.query.limit || 100) || 100;
        const entityType = req.query.entity_type ? String(req.query.entity_type) : null;
        const entityId = req.query.entity_id ? String(req.query.entity_id) : null;

        const items = listControlOperations({ limit, entityType, entityId });
        return res.json({
            success: true,
            items,
            total: items.length,
            request_id: req.id,
        });
    },
);

typedRouter.get(
    '/commands/catalog',
    authenticate,
    requirePermission(RBAC_PERMISSIONS.CONTROL_VALIDATE),
    (/** @type {any} */ _req, /** @type {any} */ res) => {
        return res.json({
            success: true,
            commands: Object.values(COMMANDS),
        });
    },
);

typedRouter.get('/preferences/me', authenticate, (/** @type {any} */ req, /** @type {any} */ res) => {
    const userId = req.user?.username || req.user?.id;
    const prefs = getUserPreferences(userId) || {
        user_id: userId,
        layout: {},
        columns: {},
        filters: {},
        density: 'comfortable',
        shortcuts: {},
        alerts: {},
        updated_at_ms: 0,
    };

    res.json({
        success: true,
        preferences: prefs,
        request_id: req.id,
    });
});

typedRouter.patch(
    '/preferences/me',
    authenticate,
    schemaGuard(prefsPatchSchema),
    (/** @type {any} */ req, /** @type {any} */ res) => {
        const userId = req.user?.username || req.user?.id;
        const prefs = upsertUserPreferences(userId, req.body || {});

        recordEvent({
            entityType: 'user',
            entityId: String(userId),
            eventType: 'USER_PREFERENCES_UPDATED',
            actorType: 'user',
            actorId: userId,
            payload: { fields: Object.keys(req.body || {}) },
        });

        res.json({
            success: true,
            preferences: prefs,
            request_id: req.id,
        });
    },
);

typedRouter.get(
    '/rbac/users/:username',
    authenticate,
    requirePermission(RBAC_PERMISSIONS.RBAC_MANAGE),
    (/** @type {any} */ req, /** @type {any} */ res) => {
        const user = getRbacUserByUsername(String(req.params.username));
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Usuário RBAC não encontrado',
                request_id: req.id,
            });
        }

        return res.json({
            success: true,
            user,
            request_id: req.id,
        });
    },
);

typedRouter.put(
    '/rbac/users/:username',
    authenticate,
    requirePermission(RBAC_PERMISSIONS.RBAC_MANAGE),
    schemaGuard(rbacPatchSchema),
    (/** @type {any} */ req, /** @type {any} */ res) => {
        const updated = upsertRbacUser({
            username: String(req.params.username),
            password: req.body.password,
            role: req.body.role,
            active: req.body.active !== false,
        });

        recordEvent({
            entityType: 'rbac_user',
            entityId: String(req.params.username),
            eventType: 'RBAC_USER_UPSERTED',
            actorType: 'user',
            actorId: req.user?.username || req.user?.id,
            payload: { role: req.body.role, active: req.body.active !== false },
        });

        res.json({
            success: true,
            user: updated,
            request_id: req.id,
        });
    },
);

export default router;
