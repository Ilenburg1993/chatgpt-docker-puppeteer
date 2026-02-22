// @ts-check
import { execFileSync } from 'node:child_process';
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
    getAuditPatchProposalById,
    updateAuditPatchProposal,
} from '#infra/db/audit_patch_repo';
import { getAuditWatchRuleById, upsertAuditWatchRule } from '#infra/db/audit_watch_rule_repo';
import { upsertInferenceProfile } from '#infra/db/inference_profile_repo';
import { getInferenceBackendById, setInferenceBackendEnabled, upsertInferenceBackend } from '#infra/db/inference_backend_repo';
import { getInferenceModelById, setInferenceModelEnabled, upsertInferenceModel } from '#infra/db/inference_model_repo';
import {
    getInferenceClientPolicyByTag,
    upsertInferenceClientPolicy,
} from '#infra/db/inference_client_policy_repo';
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
import { normalizeInferenceClientTag } from '../../inference_gateway/client_tags.js';
import { resolveInferencePolicy, validateInferenceRoute } from '../../inference_gateway/policy_config.js';

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
    AUDIT_JOB_CREATE: 'AUDIT_JOB_CREATE',
    AUDIT_JOB_RUN: 'AUDIT_JOB_RUN',
    AUDIT_JOB_CANCEL: 'AUDIT_JOB_CANCEL',
    AUDIT_JOB_RETRY: 'AUDIT_JOB_RETRY',
    AUDIT_PATCH_APPROVE: 'AUDIT_PATCH_APPROVE',
    AUDIT_PATCH_REJECT: 'AUDIT_PATCH_REJECT',
    AUDIT_PATCH_APPLY_VALIDATE: 'AUDIT_PATCH_APPLY_VALIDATE',
    AUDIT_PATCH_APPLY: 'AUDIT_PATCH_APPLY',
    AUDIT_WATCH_RULE_UPSERT: 'AUDIT_WATCH_RULE_UPSERT',
    AUDIT_WATCH_RULE_TOGGLE: 'AUDIT_WATCH_RULE_TOGGLE',
    INFERENCE_PROFILE_VALIDATE: 'INFERENCE_PROFILE_VALIDATE',
    INFERENCE_BACKEND_UPSERT: 'INFERENCE_BACKEND_UPSERT',
    INFERENCE_BACKEND_TOGGLE: 'INFERENCE_BACKEND_TOGGLE',
    INFERENCE_MODEL_UPSERT: 'INFERENCE_MODEL_UPSERT',
    INFERENCE_MODEL_TOGGLE: 'INFERENCE_MODEL_TOGGLE',
    INFERENCE_PROFILE_UPSERT: 'INFERENCE_PROFILE_UPSERT',
    INFERENCE_CLIENT_POLICY_UPSERT: 'INFERENCE_CLIENT_POLICY_UPSERT',
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
    [COMMANDS.AUDIT_JOB_CREATE]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.AUDIT_JOB_RUN]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.AUDIT_JOB_CANCEL]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.AUDIT_JOB_RETRY]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.AUDIT_PATCH_APPROVE]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.AUDIT_PATCH_REJECT]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.AUDIT_PATCH_APPLY_VALIDATE]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.AUDIT_PATCH_APPLY]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.AUDIT_WATCH_RULE_UPSERT]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.AUDIT_WATCH_RULE_TOGGLE]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.INFERENCE_PROFILE_VALIDATE]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.INFERENCE_BACKEND_UPSERT]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.INFERENCE_BACKEND_TOGGLE]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.INFERENCE_MODEL_UPSERT]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.INFERENCE_MODEL_TOGGLE]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.INFERENCE_PROFILE_UPSERT]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
    [COMMANDS.INFERENCE_CLIENT_POLICY_UPSERT]: RBAC_PERMISSIONS.CONTROL_EXECUTE,
});

const COMMAND_REQUIRES_IF_VERSION = new Set([
    COMMANDS.MISSION_PATCH,
    COMMANDS.MISSION_SET_POLICY,
    COMMANDS.MISSION_REORDER_STEPS,
    COMMANDS.TASK_PATCH,
    COMMANDS.TASK_REASSIGN_MISSION,
]);

/** @type {Set<string>} */
const COMMAND_OPTIONAL_ENTITY_ID = new Set([
    COMMANDS.MISSION_CREATE,
    COMMANDS.TASK_CREATE,
    COMMANDS.AUDIT_JOB_CREATE,
    COMMANDS.INFERENCE_PROFILE_VALIDATE,
    COMMANDS.INFERENCE_BACKEND_UPSERT,
    COMMANDS.INFERENCE_BACKEND_TOGGLE,
    COMMANDS.INFERENCE_MODEL_UPSERT,
    COMMANDS.INFERENCE_MODEL_TOGGLE,
    COMMANDS.AUDIT_WATCH_RULE_UPSERT,
    COMMANDS.INFERENCE_PROFILE_UPSERT,
    COMMANDS.INFERENCE_CLIENT_POLICY_UPSERT,
]);

function _boolEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const value = String(raw).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    return fallback;
}

function _positiveIntEnv(name, fallback) {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function _csvEnv(name) {
    const raw = String(process.env[name] || '').trim();
    if (!raw) return [];
    return raw
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

function _asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function _safeGitCurrentBranch() {
    try {
        return String(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }) || '').trim() || null;
    } catch {
        return null;
    }
}

function _safeGitWorktreeStatus() {
    try {
        const out = String(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }) || '');
        const lines = out
            .split(/\r?\n/)
            .map(v => v.trimEnd())
            .filter(Boolean);
        return {
            ok: true,
            clean: lines.length === 0,
            changes_count: lines.length,
            sample: lines.slice(0, 20),
        };
    } catch (error) {
        return {
            ok: false,
            clean: false,
            changes_count: null,
            sample: [],
            error: error?.message || String(error),
        };
    }
}

function _readPatchCandidateFiles(patch) {
    const patchSummary = _asRecord(patch?.patch_summary_json);
    const candidates = Array.isArray(patchSummary.candidate_files)
        ? patchSummary.candidate_files.map(v => String(v || '').trim()).filter(Boolean)
        : [];
    return [...new Set(candidates)].slice(0, 100);
}

function _validateAuditPatchApplyGuards(patch) {
    const currentBranch = _safeGitCurrentBranch();
    const allowedBranches = _csvEnv('AUDIT_PATCH_APPLY_ALLOWED_BRANCHES');
    const allowedPrefixes = _csvEnv('AUDIT_PATCH_APPLY_ALLOWED_PATH_PREFIXES');
    const candidateFiles = _readPatchCandidateFiles(patch);
    const branchOk = allowedBranches.length === 0 ? true : !!currentBranch && allowedBranches.includes(currentBranch);
    const pathViolations =
        allowedPrefixes.length === 0
            ? []
            : candidateFiles.filter(file => !allowedPrefixes.some(prefix => String(file).startsWith(prefix)));
    const worktree = _safeGitWorktreeStatus();
    const requireClean = _boolEnv('AUDIT_PATCH_APPLY_REQUIRE_CLEAN_WORKTREE', false);
    const worktreeOk = requireClean ? worktree.ok && worktree.clean : true;
    return {
        branch: {
            current: currentBranch,
            configured: allowedBranches.length > 0,
            allowed: allowedBranches,
            ok: branchOk,
        },
        paths: {
            configured: allowedPrefixes.length > 0,
            allowed_prefixes: allowedPrefixes,
            candidate_files: candidateFiles,
            violations: pathViolations,
            ok: pathViolations.length === 0,
        },
        worktree: {
            ...worktree,
            require_clean: requireClean,
            ok: worktreeOk,
        },
    };
}

function _evaluateAuditPatchApplyReadiness(patch) {
    const patchId = String(patch?.id || '');
    const approved = patch?.approval_required ? Boolean(patch?.approved_at_ms || patch?.approved_by) : true;
    const statusApproved = String(patch?.status || '') === 'approved';
    const approvalOk = approved && statusApproved;

    const dryRun = _asRecord(patch?.dry_run_result_json);
    const hasDryRun = Object.keys(dryRun).length > 0;
    const dryRunOkFlag = dryRun.ok === true;
    const validatedAtMs = Number(dryRun.validated_at_ms ?? dryRun.ts ?? 0);
    const ttlMs = Number(dryRun.ttl_ms ?? _positiveIntEnv('AUDIT_PATCH_DRY_RUN_MAX_AGE_MS', 10 * 60 * 1000));
    const timestampOk = Number.isFinite(validatedAtMs) && validatedAtMs > 0;
    const ttlOk = Number.isFinite(ttlMs) && ttlMs > 0;
    const ageMs = timestampOk ? Math.max(0, Date.now() - validatedAtMs) : null;
    const notExpired = Boolean(timestampOk && ttlOk && ageMs !== null && ageMs <= ttlMs);
    const dryRunReady = hasDryRun && dryRunOkFlag && timestampOk && ttlOk && notExpired;

    const guards = _validateAuditPatchApplyGuards(patch);
    const applyEnabled = _boolEnv('AUDIT_AGENT_PATCH_APPLY_ENABLE_UNSAFE_LOCAL', false);

    /** @type {string[]} */
    const blockingReasons = [];
    if (!approvalOk) blockingReasons.push('approval_required_or_status_not_approved');
    if (!hasDryRun) blockingReasons.push('dry_run_missing');
    else {
        if (!dryRunOkFlag) blockingReasons.push('dry_run_failed_or_not_ok');
        if (!timestampOk) blockingReasons.push('dry_run_timestamp_invalid');
        if (!ttlOk) blockingReasons.push('dry_run_ttl_invalid');
        if (timestampOk && ttlOk && !notExpired) blockingReasons.push('dry_run_expired');
    }
    if (!guards.branch.ok) blockingReasons.push('branch_not_allowed');
    if (!guards.paths.ok) blockingReasons.push('patch_paths_outside_allowlist');
    if (!guards.worktree.ok) blockingReasons.push('worktree_dirty_or_unavailable');
    if (!applyEnabled) blockingReasons.push('apply_mode_propose_only');

    return {
        patch_id: patchId,
        ready: blockingReasons.length === 0,
        mode: applyEnabled ? 'unsafe_local_enabled' : 'propose_only',
        approval: {
            ok: approvalOk,
            approval_required: patch?.approval_required !== false,
            status: String(patch?.status || ''),
            approved_by: patch?.approved_by || null,
            approved_at_ms: Number(patch?.approved_at_ms || 0) || null,
        },
        dry_run: {
            ok: dryRunReady,
            present: hasDryRun,
            raw_ok: dryRunOkFlag,
            validated_at_ms: timestampOk ? validatedAtMs : null,
            ttl_ms: ttlOk ? ttlMs : null,
            age_ms: ageMs,
            expires_at_ms: timestampOk && ttlOk ? validatedAtMs + ttlMs : null,
            pending: dryRun.pending === true,
            reason: dryRun.reason ? String(dryRun.reason) : null,
        },
        guards,
        blocking_reasons: blockingReasons,
        will_execute_real_apply: applyEnabled && blockingReasons.length === 0,
    };
}

function _normalizeCommand(command) {
    return String(command || '')
        .trim()
        .toUpperCase();
}

function _asEntity(command, payload = {}) {
    if (command.startsWith('AUDIT_')) {
        if (command.startsWith('AUDIT_PATCH_')) {
            return {
                entityType: 'audit_patch',
                entityId: String(payload.patch_id || payload.id || ''),
            };
        }
        if (command.startsWith('AUDIT_WATCH_RULE_')) {
            return {
                entityType: 'audit_watch_rule',
                entityId: String(payload.watch_rule_id || payload.id || ''),
            };
        }
        return {
            entityType: 'audit_job',
            entityId: String(payload.audit_job_id || payload.job_id || payload.id || ''),
        };
    }

    if (command.startsWith('INFERENCE_')) {
        return {
            entityType: 'inference',
            entityId: String(
                payload.profile_id ||
                    payload.client_tag ||
                    payload.clientTag ||
                    payload.backend_id ||
                    payload.model_id ||
                    payload.alias ||
                    payload.name ||
                    payload.id ||
                    ''
            ),
        };
    }

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

function _getAuditAgentBaseUrl() {
    const host = process.env.AUDIT_AGENT_HOST || '127.0.0.1';
    const port = Number(process.env.AUDIT_AGENT_PORT || 3098);
    return `http://${host}:${port}`;
}

function _getInferenceGatewayBaseUrl() {
    const host = process.env.INFERENCE_GATEWAY_HOST || '127.0.0.1';
    const port = Number(process.env.INFERENCE_GATEWAY_PORT || 3099);
    return `http://${host}:${port}`;
}

async function _fetchJson(url, init = {}, timeoutMs = 5000) {
    const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
}

async function _postJson(url, body, timeoutMs = 5000) {
    return _fetchJson(
        url,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
        },
        timeoutMs
    );
}

async function _dispatchAuditCommand(command, payload) {
    const baseUrl = _getAuditAgentBaseUrl();
    try {
        switch (command) {
            case COMMANDS.AUDIT_JOB_CREATE: {
                const upstream = await _postJson(`${baseUrl}/jobs`, payload.job || payload, 4000);
                if (!upstream.ok) {
                    const err = new Error('Falha ao criar audit job no audit-agent');
                    err.statusCode = upstream.status || 503;
                    err.code = 'AUDIT_AGENT_CREATE_FAILED';
                    err.details = upstream.json || upstream.text || null;
                    throw err;
                }
                const job = upstream.json?.job || null;
                return {
                    before: null,
                    after: job,
                    metadata: {
                        source: 'audit-agent',
                        audit_job_id: job?.id || null,
                        upstream_status: upstream.status,
                    },
                };
            }
            case COMMANDS.AUDIT_JOB_RUN:
            case COMMANDS.AUDIT_JOB_RETRY: {
                const jobId = String(payload.audit_job_id || payload.job_id || payload.id || '').trim();
                if (!jobId) {
                    const err = new Error('audit_job_id é obrigatório');
                    err.statusCode = 422;
                    err.code = 'AUDIT_JOB_ID_REQUIRED';
                    throw err;
                }
                const upstream = await _postJson(`${baseUrl}/jobs/${encodeURIComponent(jobId)}/run`, {}, 5000);
                if (!upstream.ok) {
                    const err = new Error('Falha ao disparar execução do audit job');
                    err.statusCode = upstream.status || 503;
                    err.code = upstream.status === 404 ? 'AUDIT_JOB_NOT_FOUND' : 'AUDIT_AGENT_RUN_FAILED';
                    err.details = upstream.json || upstream.text || null;
                    throw err;
                }
                return {
                    before: null,
                    after: upstream.json?.job || null,
                    metadata: {
                        source: 'audit-agent',
                        action: command === COMMANDS.AUDIT_JOB_RETRY ? 'retry' : 'run',
                        audit_job_id: upstream.json?.job?.id || jobId,
                        upstream_status: upstream.status,
                    },
                };
            }
            case COMMANDS.AUDIT_JOB_CANCEL: {
                const jobId = String(payload.audit_job_id || payload.job_id || payload.id || '').trim();
                if (!jobId) {
                    const err = new Error('audit_job_id é obrigatório');
                    err.statusCode = 422;
                    err.code = 'AUDIT_JOB_ID_REQUIRED';
                    throw err;
                }
                const upstream = await _postJson(
                    `${baseUrl}/jobs/${encodeURIComponent(jobId)}/cancel`,
                    { reason: payload.reason || 'control_command_cancel' },
                    4000
                );
                if (!upstream.ok) {
                    const err = new Error('Falha ao cancelar audit job');
                    err.statusCode = upstream.status || 503;
                    err.code = upstream.status === 404 ? 'AUDIT_JOB_NOT_FOUND' : 'AUDIT_AGENT_CANCEL_FAILED';
                    err.details = upstream.json || upstream.text || null;
                    throw err;
                }
                return {
                    before: null,
                    after: upstream.json?.job || null,
                    metadata: {
                        source: 'audit-agent',
                        action: 'cancel',
                        audit_job_id: upstream.json?.job?.id || jobId,
                        upstream_status: upstream.status,
                    },
                };
            }
            default: {
                const err = new Error(`Comando audit não suportado: ${command}`);
                err.statusCode = 422;
                err.code = 'AUDIT_COMMAND_UNSUPPORTED';
                throw err;
            }
        }
    } catch (err) {
        if (err?.code) throw err;
        const wrapped = new Error(`Audit Agent indisponível: ${err?.message || String(err)}`);
        wrapped.statusCode = 503;
        wrapped.code = 'AUDIT_AGENT_UNAVAILABLE';
        wrapped.details = { base_url: baseUrl };
        throw wrapped;
    }
}

async function _dispatchAuditPatchCommand(command, payload, actor) {
    const patchId = String(payload.patch_id || payload.id || '').trim();
    if (!patchId) {
        const err = new Error('patch_id é obrigatório');
        err.statusCode = 422;
        err.code = 'AUDIT_PATCH_ID_REQUIRED';
        throw err;
    }

    const before = getAuditPatchProposalById(patchId);
    if (!before) {
        const err = new Error('Audit patch proposal não encontrado');
        err.statusCode = 404;
        err.code = 'AUDIT_PATCH_NOT_FOUND';
        throw err;
    }

    const actorId = actor?.id || actor?.username || null;
    const now = Date.now();

    if (command === COMMANDS.AUDIT_PATCH_APPROVE) {
        const after = updateAuditPatchProposal(patchId, {
            status: 'approved',
            approved_by: actorId,
            approved_at_ms: now,
        });
        return {
            before,
            after,
            metadata: {
                source: 'control-plane-local',
                audit_patch_id: patchId,
                action: 'approve',
            },
        };
    }

    if (command === COMMANDS.AUDIT_PATCH_REJECT) {
        const after = updateAuditPatchProposal(patchId, {
            status: 'rejected',
        });
        return {
            before,
            after,
            metadata: {
                source: 'control-plane-local',
                audit_patch_id: patchId,
                action: 'reject',
            },
        };
    }

    if (command === COMMANDS.AUDIT_PATCH_APPLY_VALIDATE) {
        return {
            before,
            after: before,
            metadata: {
                source: 'control-plane-local',
                audit_patch_id: patchId,
                action: 'apply_validate',
                validation: _evaluateAuditPatchApplyReadiness(before),
            },
        };
    }

    if (command === COMMANDS.AUDIT_PATCH_APPLY) {
        const applyReadiness = _evaluateAuditPatchApplyReadiness(before);
        if (!applyReadiness.approval.ok) {
            const err = new Error('Audit patch precisa estar aprovado antes do apply');
            err.statusCode = 409;
            err.code = 'AUDIT_PATCH_APPLY_REQUIRES_APPROVAL';
            err.details = applyReadiness;
            throw err;
        }
        if (!applyReadiness.dry_run.present || applyReadiness.dry_run.raw_ok !== true) {
            const err = new Error('dry-run recente/valido é obrigatório antes do apply');
            err.statusCode = 409;
            err.code = 'AUDIT_PATCH_APPLY_REQUIRES_DRY_RUN';
            err.details = applyReadiness;
            throw err;
        }
        if (applyReadiness.dry_run.validated_at_ms === null) {
            const err = new Error('dry-run sem timestamp de validação');
            err.statusCode = 409;
            err.code = 'AUDIT_PATCH_APPLY_DRY_RUN_TIMESTAMP_REQUIRED';
            err.details = applyReadiness;
            throw err;
        }
        if (applyReadiness.dry_run.ttl_ms === null) {
            const err = new Error('TTL de dry-run inválido');
            err.statusCode = 409;
            err.code = 'AUDIT_PATCH_APPLY_DRY_RUN_TTL_INVALID';
            err.details = applyReadiness;
            throw err;
        }
        if (applyReadiness.dry_run.ok !== true) {
            const err = new Error('dry-run expirado; revalidação obrigatória');
            err.statusCode = 409;
            err.code = 'AUDIT_PATCH_APPLY_DRY_RUN_EXPIRED';
            err.details = applyReadiness;
            throw err;
        }
        if (!applyReadiness.guards.branch.ok) {
            const err = new Error('branch atual não permitido para AUDIT_PATCH_APPLY');
            err.statusCode = 409;
            err.code = 'AUDIT_PATCH_APPLY_BRANCH_NOT_ALLOWED';
            err.details = applyReadiness;
            throw err;
        }
        if (!applyReadiness.guards.paths.ok) {
            const err = new Error('patch proposal contém paths fora da allowlist para apply');
            err.statusCode = 409;
            err.code = 'AUDIT_PATCH_APPLY_PATH_NOT_ALLOWED';
            err.details = applyReadiness;
            throw err;
        }
        if (!applyReadiness.guards.worktree.ok) {
            const err = new Error('worktree local precisa estar limpo para AUDIT_PATCH_APPLY');
            err.statusCode = 409;
            err.code = 'AUDIT_PATCH_APPLY_WORKTREE_DIRTY';
            err.details = applyReadiness;
            throw err;
        }
        if (applyReadiness.mode !== 'unsafe_local_enabled') {
            const err = new Error('AUDIT_PATCH_APPLY desabilitado (modo propose_only)');
            err.statusCode = 409;
            err.code = 'AUDIT_PATCH_APPLY_DISABLED';
            err.details = {
                ...applyReadiness,
                required_env: 'AUDIT_AGENT_PATCH_APPLY_ENABLE_UNSAFE_LOCAL=true',
            };
            throw err;
        }

        const err = new Error('AUDIT_PATCH_APPLY ainda não implementado (guardado)');
        err.statusCode = 501;
        err.code = 'AUDIT_PATCH_APPLY_NOT_IMPLEMENTED';
        throw err;
    }

    const err = new Error(`Comando audit patch não suportado: ${command}`);
    err.statusCode = 422;
    err.code = 'AUDIT_PATCH_COMMAND_UNSUPPORTED';
    throw err;
}

async function _dispatchAuditWatchRuleCommand(command, payload) {
    if (command === COMMANDS.AUDIT_WATCH_RULE_UPSERT) {
        const before = payload.id || payload.watch_rule_id ? getAuditWatchRuleById(payload.id || payload.watch_rule_id) : null;
        const after = upsertAuditWatchRule({
            id: payload.id || payload.watch_rule_id || null,
            enabled: payload.enabled,
            name: payload.name,
            trigger_type: payload.trigger_type || payload.triggerType,
            scope_json: payload.scope_json ?? payload.scope,
            schedule_cron: payload.schedule_cron ?? payload.scheduleCron,
            debounce_ms: payload.debounce_ms ?? payload.debounceMs,
            cooldown_ms: payload.cooldown_ms ?? payload.cooldownMs,
            action_policy_json: payload.action_policy_json ?? payload.action_policy ?? payload.actionPolicy,
        });
        return {
            before,
            after,
            metadata: { source: 'control-plane-local', watch_rule_id: after?.id || null, action: 'upsert' },
        };
    }

    if (command === COMMANDS.AUDIT_WATCH_RULE_TOGGLE) {
        const ruleId = String(payload.watch_rule_id || payload.id || '').trim();
        if (!ruleId) {
            const err = new Error('watch_rule_id é obrigatório');
            err.statusCode = 422;
            err.code = 'AUDIT_WATCH_RULE_ID_REQUIRED';
            throw err;
        }
        const before = getAuditWatchRuleById(ruleId);
        if (!before) {
            const err = new Error('Watch rule não encontrada');
            err.statusCode = 404;
            err.code = 'AUDIT_WATCH_RULE_NOT_FOUND';
            throw err;
        }
        const enabled = payload.enabled === undefined ? !before.enabled : Boolean(payload.enabled);
        const after = upsertAuditWatchRule({
            ...before,
            id: ruleId,
            enabled,
        });
        return {
            before,
            after,
            metadata: { source: 'control-plane-local', watch_rule_id: ruleId, action: 'toggle' },
        };
    }

    const err = new Error(`Comando watch rule não suportado: ${command}`);
    err.statusCode = 422;
    err.code = 'AUDIT_WATCH_RULE_COMMAND_UNSUPPORTED';
    throw err;
}

async function _refreshInferenceGatewayPolicies() {
    try {
        const upstream = await _postJson(`${_getInferenceGatewayBaseUrl()}/v1/policies/reload`, {}, 2500);
        return {
            ok: upstream.ok,
            status: upstream.status,
            result: upstream.json || null,
        };
    } catch (err) {
        return {
            ok: false,
            status: null,
            error: err?.message || String(err),
        };
    }
}

async function _dispatchInferenceCommand(command, payload) {
    if (command === COMMANDS.INFERENCE_BACKEND_UPSERT) {
        const before = null;
        const backend = upsertInferenceBackend({
            id: payload.id || payload.backend_id || null,
            name: payload.name,
            kind: payload.kind,
            enabled: payload.enabled,
            base_url: payload.base_url ?? payload.baseUrl,
            auth_ref: payload.auth_ref ?? payload.authRef,
            health_policy_json: payload.health_policy_json ?? payload.health_policy,
            transport_policy_json: payload.transport_policy_json ?? payload.transport_policy,
        });
        const reload = await _refreshInferenceGatewayPolicies();
        return {
            before,
            after: backend,
            metadata: { source: 'control-plane-local', command, reload_gateway: reload },
        };
    }

    if (command === COMMANDS.INFERENCE_MODEL_UPSERT) {
        const before = null;
        const model = upsertInferenceModel({
            id: payload.id || payload.model_id || null,
            backend_id: payload.backend_id ?? payload.backendId,
            model_name: payload.model_name ?? payload.modelName,
            alias: payload.alias,
            enabled: payload.enabled,
            capabilities_json: payload.capabilities_json ?? payload.capabilities,
            resource_profile_json: payload.resource_profile_json ?? payload.resource_profile,
            safety_profile_json: payload.safety_profile_json ?? payload.safety_profile,
            default_params_json: payload.default_params_json ?? payload.default_params,
        });
        const reload = await _refreshInferenceGatewayPolicies();
        return {
            before,
            after: model,
            metadata: { source: 'control-plane-local', command, reload_gateway: reload },
        };
    }

    if (command === COMMANDS.INFERENCE_BACKEND_TOGGLE) {
        const backendId = String(payload.backend_id || payload.id || '').trim();
        const before = getInferenceBackendById(backendId);
        if (!before) {
            const err = new Error('Inference backend não encontrado');
            err.statusCode = 404;
            err.code = 'INFERENCE_BACKEND_NOT_FOUND';
            throw err;
        }
        const after = setInferenceBackendEnabled(backendId, payload.enabled === undefined ? !before.enabled : Boolean(payload.enabled));
        const reload = await _refreshInferenceGatewayPolicies();
        return {
            before,
            after,
            metadata: { source: 'control-plane-local', command, reload_gateway: reload, action: 'toggle' },
        };
    }

    if (command === COMMANDS.INFERENCE_MODEL_TOGGLE) {
        const modelId = String(payload.model_id || payload.id || '').trim();
        const before = getInferenceModelById(modelId);
        if (!before) {
            const err = new Error('Inference model não encontrado');
            err.statusCode = 404;
            err.code = 'INFERENCE_MODEL_NOT_FOUND';
            throw err;
        }
        const after = setInferenceModelEnabled(modelId, payload.enabled === undefined ? !before.enabled : Boolean(payload.enabled));
        const reload = await _refreshInferenceGatewayPolicies();
        return {
            before,
            after,
            metadata: { source: 'control-plane-local', command, reload_gateway: reload, action: 'toggle' },
        };
    }

    if (command === COMMANDS.INFERENCE_PROFILE_UPSERT) {
        const before = payload.id ? null : null;
        const profile = upsertInferenceProfile({
            id: payload.id || payload.profile_id || null,
            name: payload.name,
            purpose: payload.purpose,
            enabled: payload.enabled,
            preferred_backend_id: payload.preferred_backend_id,
            preferred_model_id: payload.preferred_model_id,
            fallback_chain_json: payload.fallback_chain_json ?? payload.fallback_chain,
            generation_params_json: payload.generation_params_json ?? payload.generation_params,
            budget_policy_json: payload.budget_policy_json ?? payload.budget_policy,
            validation_policy_json: payload.validation_policy_json ?? payload.validation_policy,
        });
        const reload = await _refreshInferenceGatewayPolicies();
        return {
            before,
            after: profile,
            metadata: {
                source: 'control-plane-local',
                command,
                reload_gateway: reload,
            },
        };
    }

    if (command === COMMANDS.INFERENCE_CLIENT_POLICY_UPSERT) {
        const clientTag = String(payload.client_tag || payload.clientTag || '').trim();
        const before = clientTag ? getInferenceClientPolicyByTag(clientTag) : null;
        const policy = upsertInferenceClientPolicy({
            id: payload.id || null,
            client_tag: clientTag,
            enabled: payload.enabled,
            profile_id: payload.profile_id,
            allowed_backends_json: payload.allowed_backends_json ?? payload.allowed_backends,
            allowed_models_json: payload.allowed_models_json ?? payload.allowed_models,
            max_parallel: payload.max_parallel ?? payload.maxParallel,
            rate_limit_json: payload.rate_limit_json ?? payload.rate_limit,
            timeout_ms: payload.timeout_ms ?? payload.timeoutMs,
            token_budget_json: payload.token_budget_json ?? payload.token_budget,
            priority: payload.priority,
            degraded_behavior_json: payload.degraded_behavior_json ?? payload.degraded_behavior,
            approval_policy_json: payload.approval_policy_json ?? payload.approval_policy,
        });
        const reload = await _refreshInferenceGatewayPolicies();
        return {
            before,
            after: policy,
            metadata: {
                source: 'control-plane-local',
                command,
                reload_gateway: reload,
            },
        };
    }

    if (command !== COMMANDS.INFERENCE_PROFILE_VALIDATE) {
        const err = new Error(`Comando inference não suportado: ${command}`);
        err.statusCode = 422;
        err.code = 'INFERENCE_COMMAND_UNSUPPORTED';
        throw err;
    }

    const resolved = resolveInferencePolicy({
        clientTag: normalizeInferenceClientTag(payload.client_tag || payload.clientTag || 'fallback_generic'),
        defaults: payload.defaults || null,
        envPolicy: payload.env_policy || payload.envPolicy || null,
        globalPolicy: payload.global_policy || payload.globalPolicy || null,
        profilePolicy: payload.profile || payload.profile_policy || payload.profilePolicy || null,
        clientPolicy: payload.client_policy || payload.clientPolicy || null,
        overrides: payload.overrides || null,
    });

    const routeCheck = validateInferenceRoute(resolved.effective, {
        model: payload.model || null,
        backend: payload.backend || null,
    });
    if (!routeCheck.ok) {
        const err = new Error(routeCheck.reason || 'Rota de inferência não permitida');
        err.statusCode = 422;
        err.code = 'INFERENCE_ROUTE_NOT_ALLOWED';
        throw err;
    }

    let modelsProbe = null;
    if (payload.probe_models === true || payload.probeModels === true) {
        try {
            const upstream = await _postJson(`${_getInferenceGatewayBaseUrl()}/v1/models`, { clientTag: resolved.clientTag }, 3000);
            modelsProbe = {
                ok: upstream.ok,
                status: upstream.status,
                models_count: Array.isArray(upstream.json?.models) ? upstream.json.models.length : null,
            };
        } catch (err) {
            modelsProbe = { ok: false, status: null, error: err?.message || String(err) };
        }
    }

    return {
        before: null,
        after: null,
        metadata: {
            source: 'control-plane-local-validation',
            command,
            validation: {
                client_tag: resolved.clientTag,
                sources_applied: resolved.sourcesApplied,
                effective: resolved.effective,
                route: {
                    backend: payload.backend || null,
                    model: payload.model || null,
                    ok: true,
                },
                probe_models: modelsProbe,
            },
        },
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
        const socketHub = await import('#server/engine/socket');
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
        case COMMANDS.AUDIT_JOB_CREATE:
        case COMMANDS.AUDIT_JOB_RUN:
        case COMMANDS.AUDIT_JOB_CANCEL:
        case COMMANDS.AUDIT_JOB_RETRY:
            return _dispatchAuditCommand(command, payload);
        case COMMANDS.AUDIT_PATCH_APPROVE:
        case COMMANDS.AUDIT_PATCH_REJECT:
        case COMMANDS.AUDIT_PATCH_APPLY_VALIDATE:
        case COMMANDS.AUDIT_PATCH_APPLY:
            return _dispatchAuditPatchCommand(command, payload, actor);
        case COMMANDS.AUDIT_WATCH_RULE_UPSERT:
        case COMMANDS.AUDIT_WATCH_RULE_TOGGLE:
            return _dispatchAuditWatchRuleCommand(command, payload);
        case COMMANDS.INFERENCE_PROFILE_VALIDATE:
        case COMMANDS.INFERENCE_BACKEND_UPSERT:
        case COMMANDS.INFERENCE_BACKEND_TOGGLE:
        case COMMANDS.INFERENCE_MODEL_UPSERT:
        case COMMANDS.INFERENCE_MODEL_TOGGLE:
        case COMMANDS.INFERENCE_PROFILE_UPSERT:
        case COMMANDS.INFERENCE_CLIENT_POLICY_UPSERT:
            return _dispatchInferenceCommand(command, payload);
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
        if (!entity.entityId && !COMMAND_OPTIONAL_ENTITY_ID.has(normalized)) {
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

    if (!entity.entityId && !COMMAND_OPTIONAL_ENTITY_ID.has(normalized)) {
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
        const result = await _dispatch(normalized, payload, actorNormalized);
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
