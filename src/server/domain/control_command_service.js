// @ts-check
import { log } from '#core/logger';
import { insertAuditDiff } from '#infra/db/audit_diff_repo';
import {
    CONTROL_OPERATION_STATUS,
    createControlOperation,
    getControlOperationById,
    getControlOperationByIdempotencyKey,
    updateControlOperation,
} from '#infra/db/control_operation_repo';
import { recordEvent } from '#infra/db/events_repo';
import { RBAC_PERMISSIONS } from '#infra/db/rbac_repo';
import {
    cancelMissionCommand,
    createMissionCommand,
    executeMissionCommand,
    patchMissionCommand,
    pauseMissionCommand,
    reorderMissionStepsCommand,
    resumeMissionCommand,
    setMissionPolicyCommand,
} from './mission_control_service.js';
import {
    bulkTaskActionCommand,
    cancelTaskCommand,
    createTaskCommand,
    patchTaskCommand,
    pauseTaskCommand,
    purgeTaskCommand,
    reassignTaskMissionCommand,
    resumeTaskCommand,
    retryTaskCommand,
} from './task_control_service.js';
import { assertPermission, normalizeActor } from './rbac_policy.js';

/** Constante/valor exportado: COMMANDS. */
const COMMANDS = Object.freeze({
    MISSION_CREATE: 'MISSION_CREATE',
    MISSION_EXECUTE: 'MISSION_EXECUTE',
    MISSION_PAUSE: 'MISSION_PAUSE',
    MISSION_RESUME: 'MISSION_RESUME',
    MISSION_CANCEL: 'MISSION_CANCEL',
    MISSION_PATCH: 'MISSION_PATCH',
    MISSION_SET_POLICY: 'MISSION_SET_POLICY',
    MISSION_REORDER_STEPS: 'MISSION_REORDER_STEPS',
    TASK_CREATE: 'TASK_CREATE',
    TASK_PATCH: 'TASK_PATCH',
    TASK_REASSIGN_MISSION: 'TASK_REASSIGN_MISSION',
    TASK_PAUSE: 'TASK_PAUSE',
    TASK_RESUME: 'TASK_RESUME',
    TASK_UNBLOCK: 'TASK_UNBLOCK',
    TASK_RETRY: 'TASK_RETRY',
    TASK_CANCEL: 'TASK_CANCEL',
    TASK_PURGE: 'TASK_PURGE',
    TASK_BULK_ACTION: 'TASK_BULK_ACTION',
});

const COMMAND_PERMISSION = Object.freeze({
    [COMMANDS.MISSION_CREATE]: RBAC_PERMISSIONS.MISSION_CREATE,
    [COMMANDS.MISSION_EXECUTE]: RBAC_PERMISSIONS.MISSION_EXECUTE,
    [COMMANDS.MISSION_PAUSE]: RBAC_PERMISSIONS.MISSION_PAUSE,
    [COMMANDS.MISSION_RESUME]: RBAC_PERMISSIONS.MISSION_RESUME,
    [COMMANDS.MISSION_CANCEL]: RBAC_PERMISSIONS.MISSION_CANCEL,
    [COMMANDS.MISSION_PATCH]: RBAC_PERMISSIONS.MISSION_EDIT,
    [COMMANDS.MISSION_SET_POLICY]: RBAC_PERMISSIONS.MISSION_POLICY,
    [COMMANDS.MISSION_REORDER_STEPS]: RBAC_PERMISSIONS.MISSION_REORDER,
    [COMMANDS.TASK_CREATE]: RBAC_PERMISSIONS.TASK_CREATE,
    [COMMANDS.TASK_PATCH]: RBAC_PERMISSIONS.TASK_EDIT,
    [COMMANDS.TASK_REASSIGN_MISSION]: RBAC_PERMISSIONS.TASK_EDIT,
    [COMMANDS.TASK_PAUSE]: RBAC_PERMISSIONS.TASK_PAUSE,
    [COMMANDS.TASK_RESUME]: RBAC_PERMISSIONS.TASK_RESUME,
    [COMMANDS.TASK_UNBLOCK]: RBAC_PERMISSIONS.TASK_RESUME,
    [COMMANDS.TASK_RETRY]: RBAC_PERMISSIONS.TASK_RETRY,
    [COMMANDS.TASK_CANCEL]: RBAC_PERMISSIONS.TASK_CANCEL,
    [COMMANDS.TASK_PURGE]: RBAC_PERMISSIONS.TASK_PURGE,
    [COMMANDS.TASK_BULK_ACTION]: RBAC_PERMISSIONS.TASK_BULK,
});

const COMMAND_REQUIRES_IF_VERSION = new Set([
    COMMANDS.MISSION_PATCH,
    COMMANDS.MISSION_SET_POLICY,
    COMMANDS.MISSION_REORDER_STEPS,
    COMMANDS.TASK_PATCH,
    COMMANDS.TASK_REASSIGN_MISSION,
]);

function _boolEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const value = String(raw).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    return fallback;
}

function _normalizeCommand(command) {
    return String(command || '')
        .trim()
        .toUpperCase();
}

function _asEntity(command, payload = {}) {
    if (command.startsWith('MISSION_')) {
        return {
            entityType: 'mission',
            entityId: String(payload.mission_id || payload.missionId || payload.id || ''),
        };
    }

    return {
        entityType: 'task',
        entityId: String(payload.task_id || payload.taskId || payload.id || ''),
    };
}

function _assertBaseCommandGuards(command, payload) {
    const requireReason = _boolEnv('CONTROL_REQUIRE_REASON', true);
    const requireIdempotency = _boolEnv('CONTROL_REQUIRE_IDEMPOTENCY_KEY', true);

    const reason = String(payload?.reason || '').trim();
    const idempotencyKey = String(payload?.idempotency_key || '').trim();

    if (requireReason && !reason) {
        const err = new Error('reason é obrigatório');
        err.statusCode = 422;
        err.code = 'CONTROL_REASON_REQUIRED';
        throw err;
    }

    if (requireIdempotency && !idempotencyKey) {
        const err = new Error('idempotency_key é obrigatório');
        err.statusCode = 422;
        err.code = 'CONTROL_IDEMPOTENCY_REQUIRED';
        throw err;
    }

    if (COMMAND_REQUIRES_IF_VERSION.has(command)) {
        if (payload?.if_version === undefined || payload?.if_version === null) {
            const err = new Error('if_version é obrigatório para mutações de edição');
            err.statusCode = 412;
            err.code = 'CONTROL_IF_VERSION_REQUIRED';
            throw err;
        }
    }

    return { reason, idempotencyKey };
}

async function _emitCommandStatus(statusPayload) {
    try {
        const socketHub = await import('#server/engine/socket.js');
        if (typeof socketHub?.notify === 'function') {
            socketHub.notify('control:command_status', statusPayload);
        }
    } catch (err) {
        log('DEBUG', `[ControlCommandService] notify(control:command_status) skipped: ${err?.message || String(err)}`);
    }
}

function _dispatch(command, payload, actor) {
    switch (command) {
        case COMMANDS.MISSION_CREATE:
            return createMissionCommand({
                actor,
                reason: payload.reason,
                payload: payload.mission || payload,
            });
        case COMMANDS.MISSION_EXECUTE:
            return executeMissionCommand({
                missionId: payload.mission_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
                command,
            });
        case COMMANDS.MISSION_PAUSE:
            return pauseMissionCommand({
                missionId: payload.mission_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
            });
        case COMMANDS.MISSION_RESUME:
            return resumeMissionCommand({
                missionId: payload.mission_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
            });
        case COMMANDS.MISSION_CANCEL:
            return cancelMissionCommand({
                missionId: payload.mission_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
            });
        case COMMANDS.MISSION_PATCH:
            return patchMissionCommand({
                missionId: payload.mission_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
                patch: payload.patch || {},
            });
        case COMMANDS.MISSION_SET_POLICY:
            return setMissionPolicyCommand({
                missionId: payload.mission_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
                policy: payload.policy || null,
                autonomyMode: payload.autonomy_mode || payload.autonomyMode || null,
            });
        case COMMANDS.MISSION_REORDER_STEPS:
            return reorderMissionStepsCommand({
                missionId: payload.mission_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
                stepOrder: Array.isArray(payload.step_order) ? payload.step_order : [],
            });
        case COMMANDS.TASK_CREATE:
            return createTaskCommand({
                actor,
                reason: payload.reason,
                payload: payload.task || payload,
                ifNotExists: Boolean(payload.if_not_exists),
            });
        case COMMANDS.TASK_PATCH:
            return patchTaskCommand({
                taskId: payload.task_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
                patch: payload.patch || {},
            });
        case COMMANDS.TASK_REASSIGN_MISSION:
            return reassignTaskMissionCommand({
                taskId: payload.task_id,
                missionId: payload.mission_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
            });
        case COMMANDS.TASK_PAUSE:
            return pauseTaskCommand({
                taskId: payload.task_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
            });
        case COMMANDS.TASK_RESUME:
        case COMMANDS.TASK_UNBLOCK:
            return resumeTaskCommand({
                taskId: payload.task_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
            });
        case COMMANDS.TASK_RETRY:
            return retryTaskCommand({
                taskId: payload.task_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
            });
        case COMMANDS.TASK_CANCEL:
            return cancelTaskCommand({
                taskId: payload.task_id,
                actor,
                reason: payload.reason,
                ifVersion: payload.if_version,
            });
        case COMMANDS.TASK_PURGE:
            return purgeTaskCommand({
                taskId: payload.task_id,
                actor,
                reason: payload.reason,
            });
        case COMMANDS.TASK_BULK_ACTION:
            return bulkTaskActionCommand({
                ids: payload.ids,
                action: payload.action,
                params: payload.params || {},
                actor,
                reason: payload.reason,
            });
        default: {
            const err = new Error(`Command não suportado: ${command}`);
            err.statusCode = 422;
            err.code = 'CONTROL_COMMAND_UNSUPPORTED';
            throw err;
        }
    }
}

/** Função exportada: validateCommand. */
function validateCommand({ command, payload = {}, actor = null }) {
    const normalized = _normalizeCommand(command);

    try {
        if (!Object.prototype.hasOwnProperty.call(COMMAND_PERMISSION, normalized)) {
            return {
                ok: false,
                code: 'CONTROL_COMMAND_UNSUPPORTED',
                statusCode: 422,
                errors: ['Comando não suportado'],
            };
        }

        const actorNormalized = normalizeActor(actor || {});
        const permission = COMMAND_PERMISSION[normalized];
        assertPermission(actorNormalized, permission);

        _assertBaseCommandGuards(normalized, payload);

        const entity = _asEntity(normalized, payload);
        if (!entity.entityId && normalized !== COMMANDS.TASK_CREATE && normalized !== COMMANDS.MISSION_CREATE) {
            return {
                ok: false,
                code: 'CONTROL_ENTITY_ID_REQUIRED',
                statusCode: 422,
                errors: ['entity_id obrigatório para o comando'],
            };
        }

        return {
            ok: true,
            code: 'CONTROL_COMMAND_VALID',
            statusCode: 200,
            errors: [],
        };
    } catch (err) {
        return {
            ok: false,
            code: err?.code || 'CONTROL_COMMAND_INVALID',
            statusCode: err?.statusCode || 422,
            errors: [err?.message || String(err)],
        };
    }
}

/** Função exportada: executeCommand. */
async function executeCommand({ command, payload = {}, actor = null, dryRun = false }) {
    const normalized = _normalizeCommand(command);

    const actorNormalized = normalizeActor(actor || {});
    const permission = COMMAND_PERMISSION[normalized];
    if (!permission) {
        const err = new Error(`Comando não suportado: ${normalized}`);
        err.statusCode = 422;
        err.code = 'CONTROL_COMMAND_UNSUPPORTED';
        throw err;
    }

    assertPermission(actorNormalized, permission);

    const { reason, idempotencyKey } = _assertBaseCommandGuards(normalized, payload);
    const entity = _asEntity(normalized, payload);

    if (!entity.entityId && normalized !== COMMANDS.TASK_CREATE && normalized !== COMMANDS.MISSION_CREATE) {
        const err = new Error('entity_id obrigatório');
        err.statusCode = 422;
        err.code = 'CONTROL_ENTITY_ID_REQUIRED';
        throw err;
    }

    if (dryRun) {
        return {
            success: true,
            dry_run: true,
            command: normalized,
            entity_type: entity.entityType,
            entity_id: entity.entityId || null,
            reason,
        };
    }

    const existing = idempotencyKey ? getControlOperationByIdempotencyKey(idempotencyKey) : null;
    if (existing) {
        return {
            success: existing.status === CONTROL_OPERATION_STATUS.SUCCEEDED,
            replay: true,
            operation: existing,
            result: existing.result,
        };
    }

    const operation = createControlOperation({
        command: normalized,
        entityType: entity.entityType,
        entityId: entity.entityId || (entity.entityType === 'mission' ? 'mission:new' : 'task:new'),
        actorId: actorNormalized.id || actorNormalized.username || null,
        actorRole: actorNormalized.role,
        reason,
        idempotencyKey,
        payload,
    });

    updateControlOperation(operation.id, {
        status: CONTROL_OPERATION_STATUS.RUNNING,
    });

    await _emitCommandStatus({
        operation_id: operation.id,
        command: normalized,
        status: CONTROL_OPERATION_STATUS.RUNNING,
        entity_type: entity.entityType,
        entity_id: entity.entityId,
        actor: {
            id: actorNormalized.id || actorNormalized.username || null,
            role: actorNormalized.role,
        },
    });

    try {
        const result = _dispatch(normalized, payload, actorNormalized);
        const finalEntityId = entity.entityId || result?.after?.meta?.id || result?.after?.id || 'task:new';

        const updatedOperation = updateControlOperation(operation.id, {
            status: CONTROL_OPERATION_STATUS.SUCCEEDED,
            result: {
                command: normalized,
                entity_type: entity.entityType,
                entity_id: finalEntityId,
                metadata: result?.metadata || {},
            },
        });

        if (result?.before !== undefined || result?.after !== undefined) {
            try {
                insertAuditDiff({
                    operationId: operation.id,
                    entityType: entity.entityType,
                    entityId: finalEntityId,
                    before: result?.before ?? null,
                    after: result?.after ?? null,
                });
            } catch (err) {
                log('WARN', `[ControlCommandService] insertAuditDiff failed: ${err?.message || String(err)}`);
            }
        }

        try {
            recordEvent({
                entityType: 'control_operation',
                entityId: operation.id,
                actorType: 'user',
                actorId: actorNormalized.id || actorNormalized.username || null,
                eventType: 'CONTROL_COMMAND_SUCCEEDED',
                payload: {
                    command: normalized,
                    entity_type: entity.entityType,
                    entity_id: finalEntityId,
                    reason,
                },
                dedupKey: `control:${operation.id}:succeeded`,
            });
        } catch (err) {
            void err;
            // Best-effort audit event; command success path must continue.
        }

        await _emitCommandStatus({
            operation_id: operation.id,
            command: normalized,
            status: CONTROL_OPERATION_STATUS.SUCCEEDED,
            entity_type: entity.entityType,
            entity_id: finalEntityId,
            metadata: result?.metadata || {},
        });

        return {
            success: true,
            replay: false,
            operation: updatedOperation || getControlOperationById(operation.id),
            result,
        };
    } catch (err) {
        const failedOperation = updateControlOperation(operation.id, {
            status: CONTROL_OPERATION_STATUS.FAILED,
            error_code: err?.code || 'CONTROL_COMMAND_FAILED',
            error_message: err?.message || String(err),
            result: {
                command: normalized,
                entity_type: entity.entityType,
                entity_id: entity.entityId,
            },
        });

        try {
            recordEvent({
                entityType: 'control_operation',
                entityId: operation.id,
                actorType: 'user',
                actorId: actorNormalized.id || actorNormalized.username || null,
                eventType: 'CONTROL_COMMAND_FAILED',
                payload: {
                    command: normalized,
                    entity_type: entity.entityType,
                    entity_id: entity.entityId,
                    reason,
                    code: err?.code || 'CONTROL_COMMAND_FAILED',
                    error: err?.message || String(err),
                },
                dedupKey: `control:${operation.id}:failed`,
            });
        } catch (err) {
            void err;
            // Best-effort audit event; failure path telemetry must not mask original error.
        }

        await _emitCommandStatus({
            operation_id: operation.id,
            command: normalized,
            status: CONTROL_OPERATION_STATUS.FAILED,
            entity_type: entity.entityType,
            entity_id: entity.entityId,
            error: {
                code: err?.code || 'CONTROL_COMMAND_FAILED',
                message: err?.message || String(err),
            },
        });

        const wrapped = new Error(err?.message || 'Falha ao executar comando de controle');
        wrapped.statusCode = err?.statusCode || 500;
        wrapped.code = err?.code || 'CONTROL_COMMAND_FAILED';
        wrapped.details = err?.details || null;
        /** @type {any} */ (wrapped).operation = failedOperation;
        throw wrapped;
    }
}

export { COMMANDS, executeCommand, validateCommand };
