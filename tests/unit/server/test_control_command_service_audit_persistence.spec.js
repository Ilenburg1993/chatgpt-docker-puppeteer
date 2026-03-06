// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { getDb, closeDb } from '../../../src/infra/db/sqlite.js';
import { RBAC_PERMISSIONS } from '../../../src/infra/db/rbac_repo.js';
import { COMMANDS, executeCommand } from '../../../src/server/domain/control_command_service.js';
import { createAuditJob } from '../../../src/infra/db/audit_job_repo.js';
import { createAuditPatchProposal, getAuditPatchProposalById } from '../../../src/infra/db/audit_patch_repo.js';
import { getAuditWatchRuleById } from '../../../src/infra/db/audit_watch_rule_repo.js';
import { getInferenceClientPolicyByTag } from '../../../src/infra/db/inference_client_policy_repo.js';
import { listInferenceProfiles } from '../../../src/infra/db/inference_profile_repo.js';
import { listInferenceBackends } from '../../../src/infra/db/inference_backend_repo.js';
import { listInferenceModels } from '../../../src/infra/db/inference_model_repo.js';

function actor() {
    return {
        id: 'usr-test',
        username: 'tester',
        role: 'admin',
        permissions: [RBAC_PERMISSIONS.CONTROL_EXECUTE, RBAC_PERMISSIONS.CONTROL_VALIDATE],
    };
}

function withTempDb(/** @type {() => Promise<void>} */ fn) {
    return async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-audit-persist-'));
        const dbPath = path.join(tmpDir, 'maestro.sqlite');
        const prevDb = process.env.MAESTRO_DB_PATH;
        process.env.MAESTRO_DB_PATH = dbPath;
        try {
            getDb();
            await fn();
        } finally {
            closeDb();
            if (prevDb === undefined) delete process.env.MAESTRO_DB_PATH;
            else process.env.MAESTRO_DB_PATH = prevDb;
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    };
}

async function listenJsonStub(/** @type {(req: any) => any} */ handler) {
    const server = http.createServer((req, res) => {
        Promise.resolve(handler(req))
            .then(body => {
                res.statusCode = 200;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(body));
            })
            .catch(err => {
                res.statusCode = 500;
                res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
            });
    });
    await /** @type {Promise<void>} */ (new Promise(resolve => server.listen(0, '127.0.0.1', resolve)));
    const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
    return { server, host: addr.address, port: addr.port };
}

test(
    'control commands approve/reject patch, upsert/toggle watch rule and upsert inference config',
    withTempDb(async () => {
        const prevGwHost = process.env.INFERENCE_GATEWAY_HOST;
        const prevGwPort = process.env.INFERENCE_GATEWAY_PORT;
        const stub = await listenJsonStub((/** @type {any} */ req) => {
            if ((req.url || '').startsWith('/v1/policies/reload')) {
                return { ok: true, reloaded: { ok: true } };
            }
            return { ok: true };
        });
        process.env.INFERENCE_GATEWAY_HOST = stub.host;
        process.env.INFERENCE_GATEWAY_PORT = String(stub.port);

        try {
            createAuditJob({
                id: 'ajb-test',
                kind: 'patch_suggest',
                trigger_type: 'manual',
            });
            /** @type {any} */
            const patch = createAuditPatchProposal({
                job_id: 'ajb-test',
                patch_unified_diff: 'diff --git a/x b/x',
                status: 'draft',
            });

            const approve = await executeCommand({
                command: COMMANDS.AUDIT_PATCH_APPROVE,
                payload: {
                    patch_id: patch.id,
                    reason: 'approve patch',
                    idempotency_key: `idem_${randomUUID()}`,
                },
                actor: actor(),
            });
            assert.equal(approve.success, true);
            assert.equal(getAuditPatchProposalById(patch.id)?.status, 'approved');

            const reject = await executeCommand({
                command: COMMANDS.AUDIT_PATCH_REJECT,
                payload: {
                    patch_id: patch.id,
                    reason: 'reject patch',
                    idempotency_key: `idem_${randomUUID()}`,
                },
                actor: actor(),
            });
            assert.equal(reject.success, true);
            assert.equal(getAuditPatchProposalById(patch.id)?.status, 'rejected');

            await assert.rejects(
                () =>
                    executeCommand({
                        command: COMMANDS.AUDIT_PATCH_APPLY,
                        payload: {
                            patch_id: patch.id,
                            reason: 'apply patch',
                            idempotency_key: `idem_${randomUUID()}`,
                        },
                        actor: actor(),
                    }),
                /aprovado/i
            );

            await executeCommand({
                command: COMMANDS.AUDIT_PATCH_APPROVE,
                payload: {
                    patch_id: patch.id,
                    reason: 'approve patch again',
                    idempotency_key: `idem_${randomUUID()}`,
                },
                actor: actor(),
            });
            // inject dry-run result directly in repo to satisfy guard and assert propose_only block
            const patched = getAuditPatchProposalById(patch.id);
            assert.ok(patched);

            const ruleOut = await executeCommand({
                command: COMMANDS.AUDIT_WATCH_RULE_UPSERT,
                payload: {
                    reason: 'create watch rule',
                    idempotency_key: `idem_${randomUUID()}`,
                    name: 'Probe Audit Agent',
                    trigger_type: 'schedule',
                    schedule_cron: '*/10 * * * *',
                    enabled: true,
                    scope: { kind: 'runtime_probe' },
                },
                actor: actor(),
            });
            assert.equal(ruleOut.success, true);
            const ruleId = ruleOut?.result?.after?.id;
            assert.ok(ruleId);
            assert.equal(getAuditWatchRuleById(ruleId)?.enabled, true);

            const toggled = await executeCommand({
                command: COMMANDS.AUDIT_WATCH_RULE_TOGGLE,
                payload: {
                    watch_rule_id: ruleId,
                    enabled: false,
                    reason: 'disable watch rule',
                    idempotency_key: `idem_${randomUUID()}`,
                },
                actor: actor(),
            });
            assert.equal(toggled.success, true);
            assert.equal(getAuditWatchRuleById(ruleId)?.enabled, false);

            const profileOut = await executeCommand({
                command: COMMANDS.INFERENCE_PROFILE_UPSERT,
                payload: {
                    reason: 'upsert profile',
                    idempotency_key: `idem_${randomUUID()}`,
                    name: 'patch_safe',
                    generation_params: { max_tokens: 256, temperature: 0.1 },
                    budget_policy: { timeout_ms: 15000 },
                    validation_policy: { allowed_models: ['qwen2.5-coder:7b'] },
                },
                actor: actor(),
            });
            assert.equal(profileOut.success, true);
            assert.ok(listInferenceProfiles().some(p => p.name === 'patch_safe'));

            const backendOut = await executeCommand({
                command: COMMANDS.INFERENCE_BACKEND_UPSERT,
                payload: {
                    reason: 'upsert backend',
                    idempotency_key: `idem_${randomUUID()}`,
                    name: 'ollama_local',
                    kind: 'ollama',
                    base_url: 'http://host.docker.internal:11434',
                },
                actor: actor(),
            });
            assert.equal(backendOut.success, true);
            const backend = listInferenceBackends().find(b => b.name === 'ollama_local');
            assert.ok(backend);

            const modelOut = await executeCommand({
                command: COMMANDS.INFERENCE_MODEL_UPSERT,
                payload: {
                    reason: 'upsert model',
                    idempotency_key: `idem_${randomUUID()}`,
                    backend_id: backend?.id,
                    model_name: 'qwen2.5-coder:7b',
                    alias: 'patch_model_strong',
                    capabilities: { supports_code_patch: true },
                },
                actor: actor(),
            });
            assert.equal(modelOut.success, true);
            const createdModel = listInferenceModels({ backendId: backend?.id }).find(
                m => m.alias === 'patch_model_strong'
            );
            assert.ok(createdModel);

            const backendToggleOut = await executeCommand({
                command: COMMANDS.INFERENCE_BACKEND_TOGGLE,
                payload: {
                    backend_id: backend?.id,
                    enabled: false,
                    reason: 'disable backend',
                    idempotency_key: `idem_${randomUUID()}`,
                },
                actor: actor(),
            });
            assert.equal(backendToggleOut.success, true);
            assert.equal(listInferenceBackends().find(b => b.id === backend?.id)?.enabled, false);

            const modelToggleOut = await executeCommand({
                command: COMMANDS.INFERENCE_MODEL_TOGGLE,
                payload: {
                    model_id: createdModel?.id,
                    enabled: false,
                    reason: 'disable model',
                    idempotency_key: `idem_${randomUUID()}`,
                },
                actor: actor(),
            });
            assert.equal(modelToggleOut.success, true);
            assert.equal(
                listInferenceModels({ backendId: backend?.id }).find(m => m.id === createdModel?.id)?.enabled,
                false
            );

            const createdProfile = listInferenceProfiles().find(p => p.name === 'patch_safe');
            const clientPolicyOut = await executeCommand({
                command: COMMANDS.INFERENCE_CLIENT_POLICY_UPSERT,
                payload: {
                    reason: 'upsert client policy',
                    idempotency_key: `idem_${randomUUID()}`,
                    client_tag: 'audit_agent_patch',
                    profile_id: createdProfile?.id,
                    allowed_models: ['qwen2.5-coder:7b'],
                    allowed_backends: ['ollama_local'],
                    max_parallel: 1,
                },
                actor: actor(),
            });
            assert.equal(clientPolicyOut.success, true);
            assert.equal(getInferenceClientPolicyByTag('audit_agent_patch')?.client_tag, 'audit_agent_patch');

            // Now satisfy dry-run guard and verify apply remains blocked in propose_only.
            const { updateAuditPatchProposal } = await import('../../../src/infra/db/audit_patch_repo.js');
            updateAuditPatchProposal(patch.id, {
                dry_run_result_json: { ok: true, ts: Date.now() },
                patch_summary_json: { candidate_files: ['src/main.js'] },
            });
            await assert.rejects(
                () =>
                    executeCommand({
                        command: COMMANDS.AUDIT_PATCH_APPLY,
                        payload: {
                            patch_id: patch.id,
                            reason: 'apply patch blocked',
                            idempotency_key: `idem_${randomUUID()}`,
                        },
                        actor: actor(),
                    }),
                /propose_only/i
            );

            const validateApply = await executeCommand({
                command: COMMANDS.AUDIT_PATCH_APPLY_VALIDATE,
                payload: {
                    patch_id: patch.id,
                    reason: 'validate apply readiness',
                    idempotency_key: `idem_${randomUUID()}`,
                },
                actor: actor(),
            });
            assert.equal(validateApply.success, true);
            assert.equal(validateApply.result?.after?.id, patch.id);
            assert.equal(validateApply.result?.metadata?.validation?.patch_id, patch.id);
            assert.equal(validateApply.result?.metadata?.validation?.approval?.ok, true);
            assert.equal(validateApply.result?.metadata?.validation?.dry_run?.present, true);
            assert.equal(validateApply.result?.metadata?.validation?.mode, 'propose_only');
            assert.equal(Array.isArray(validateApply.result?.metadata?.validation?.blocking_reasons), true);
            assert.equal(
                validateApply.result?.metadata?.validation?.blocking_reasons.includes('apply_mode_propose_only'),
                true
            );

            const prevApplyEnabled = process.env.AUDIT_AGENT_PATCH_APPLY_ENABLE_UNSAFE_LOCAL;
            const prevAllowedPrefixes = process.env.AUDIT_PATCH_APPLY_ALLOWED_PATH_PREFIXES;
            const prevAllowedBranches = process.env.AUDIT_PATCH_APPLY_ALLOWED_BRANCHES;
            const prevRequireClean = process.env.AUDIT_PATCH_APPLY_REQUIRE_CLEAN_WORKTREE;
            try {
                process.env.AUDIT_AGENT_PATCH_APPLY_ENABLE_UNSAFE_LOCAL = 'true';
                process.env.AUDIT_PATCH_APPLY_REQUIRE_CLEAN_WORKTREE = 'true';
                process.env.AUDIT_PATCH_APPLY_ALLOWED_PATH_PREFIXES = '';
                process.env.AUDIT_PATCH_APPLY_ALLOWED_BRANCHES = '';
                await assert.rejects(
                    () =>
                        executeCommand({
                            command: COMMANDS.AUDIT_PATCH_APPLY,
                            payload: {
                                patch_id: patch.id,
                                reason: 'apply patch blocked by dirty worktree',
                                idempotency_key: `idem_${randomUUID()}`,
                            },
                            actor: actor(),
                        }),
                    /worktree local precisa estar limpo/i
                );

                process.env.AUDIT_PATCH_APPLY_REQUIRE_CLEAN_WORKTREE = 'false';
                process.env.AUDIT_PATCH_APPLY_ALLOWED_PATH_PREFIXES = 'safe/';
                await assert.rejects(
                    () =>
                        executeCommand({
                            command: COMMANDS.AUDIT_PATCH_APPLY,
                            payload: {
                                patch_id: patch.id,
                                reason: 'apply patch blocked by path guard',
                                idempotency_key: `idem_${randomUUID()}`,
                            },
                            actor: actor(),
                        }),
                    /paths fora da allowlist/i
                );

                process.env.AUDIT_PATCH_APPLY_ALLOWED_PATH_PREFIXES = '';
                process.env.AUDIT_PATCH_APPLY_ALLOWED_BRANCHES = '__definitely_not_current_branch__';
                await assert.rejects(
                    () =>
                        executeCommand({
                            command: COMMANDS.AUDIT_PATCH_APPLY,
                            payload: {
                                patch_id: patch.id,
                                reason: 'apply patch blocked by branch guard',
                                idempotency_key: `idem_${randomUUID()}`,
                            },
                            actor: actor(),
                        }),
                    /branch atual não permitido/i
                );
            } finally {
                if (prevApplyEnabled === undefined) delete process.env.AUDIT_AGENT_PATCH_APPLY_ENABLE_UNSAFE_LOCAL;
                else process.env.AUDIT_AGENT_PATCH_APPLY_ENABLE_UNSAFE_LOCAL = prevApplyEnabled;
                if (prevAllowedPrefixes === undefined) delete process.env.AUDIT_PATCH_APPLY_ALLOWED_PATH_PREFIXES;
                else process.env.AUDIT_PATCH_APPLY_ALLOWED_PATH_PREFIXES = prevAllowedPrefixes;
                if (prevAllowedBranches === undefined) delete process.env.AUDIT_PATCH_APPLY_ALLOWED_BRANCHES;
                else process.env.AUDIT_PATCH_APPLY_ALLOWED_BRANCHES = prevAllowedBranches;
                if (prevRequireClean === undefined) delete process.env.AUDIT_PATCH_APPLY_REQUIRE_CLEAN_WORKTREE;
                else process.env.AUDIT_PATCH_APPLY_REQUIRE_CLEAN_WORKTREE = prevRequireClean;
            }
        } finally {
            if (prevGwHost === undefined) delete process.env.INFERENCE_GATEWAY_HOST;
            else process.env.INFERENCE_GATEWAY_HOST = prevGwHost;
            if (prevGwPort === undefined) delete process.env.INFERENCE_GATEWAY_PORT;
            else process.env.INFERENCE_GATEWAY_PORT = prevGwPort;
            await /** @type {Promise<void>} */ (
                new Promise(resolve => {
                    stub.server.close(() => resolve());
                })
            );
        }
    })
);
