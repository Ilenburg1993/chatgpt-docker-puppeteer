// @ts-check
import { COMMANDS, executeCommand, validateCommand } from '#server/domain/control_command_service';
import { RBAC_PERMISSIONS, RBAC_ROLES, getRbacUserByUsername, upsertRbacUser } from '#infra/db/rbac_repo';
import { getUserPreferences, upsertUserPreferences } from '#infra/db/user_pref_repo';
import {
    getControlOperationById,
    listControlOperations,
} from '#infra/db/control_operation_repo';
import express from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/authorize.js';
import schemaGuard from '../../middleware/schema_guard.js';

const router = express.Router();

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

router.post(
    '/commands',
    authenticate,
    requirePermission(RBAC_PERMISSIONS.CONTROL_EXECUTE),
    schemaGuard(commandSchema),
    async (req, res) => {
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
        } catch (err) {
            res.status(Number(err?.statusCode || 500)).json({
                success: false,
                code: err?.code || 'CONTROL_COMMAND_FAILED',
                error: err?.message || 'Falha ao executar comando',
                details: err?.details || null,
                operation: err?.operation || null,
                request_id: req.id,
            });
        }
    }
);

router.post(
    '/validate',
    authenticate,
    requirePermission(RBAC_PERMISSIONS.CONTROL_VALIDATE),
    schemaGuard(validateSchema),
    (req, res) => {
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
    }
);

router.get('/commands/:id', authenticate, requirePermission(RBAC_PERMISSIONS.TASK_READ), (req, res) => {
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
});

router.get('/commands', authenticate, requirePermission(RBAC_PERMISSIONS.TASK_READ), (req, res) => {
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
});

router.get('/commands/catalog', authenticate, requirePermission(RBAC_PERMISSIONS.CONTROL_VALIDATE), (_req, res) => {
    return res.json({
        success: true,
        commands: Object.values(COMMANDS),
    });
});

router.get('/preferences/me', authenticate, (req, res) => {
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

router.patch('/preferences/me', authenticate, schemaGuard(prefsPatchSchema), (req, res) => {
    const userId = req.user?.username || req.user?.id;
    const prefs = upsertUserPreferences(userId, req.body || {});

    res.json({
        success: true,
        preferences: prefs,
        request_id: req.id,
    });
});

router.get('/rbac/users/:username', authenticate, requirePermission(RBAC_PERMISSIONS.RBAC_MANAGE), (req, res) => {
    const user = getRbacUserByUsername(req.params.username);
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
});

router.put(
    '/rbac/users/:username',
    authenticate,
    requirePermission(RBAC_PERMISSIONS.RBAC_MANAGE),
    schemaGuard(rbacPatchSchema),
    (req, res) => {
        const updated = upsertRbacUser({
            username: req.params.username,
            password: req.body.password,
            role: req.body.role,
            active: req.body.active !== false,
        });

        res.json({
            success: true,
            user: updated,
            request_id: req.id,
        });
    }
);

export default router;
