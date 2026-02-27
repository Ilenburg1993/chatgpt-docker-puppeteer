import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditAgentRuntime } from '../../../src/audit_agent/runtime.js';
import { createAuditAgentDbStore } from '../../../src/audit_agent/db_store.js';
import { closeDb, getDb } from '../../../src/infra/db/sqlite.js';
import { getAuditJobById, listAuditJobs } from '../../../src/infra/db/audit_job_repo.js';
import { listAuditJobRunsByJobId } from '../../../src/infra/db/audit_job_run_repo.js';
import { listAuditFindingsByJobId } from '../../../src/infra/db/audit_finding_repo.js';
import { listAuditPatchProposalsByJobId } from '../../../src/infra/db/audit_patch_repo.js';
import { listAuditWatchRules, upsertAuditWatchRule } from '../../../src/infra/db/audit_watch_rule_repo.js';
import { listInferenceProfiles, upsertInferenceProfile } from '../../../src/infra/db/inference_profile_repo.js';
import {
    listInferenceBackends,
    setInferenceBackendEnabled,
    upsertInferenceBackend,
} from '../../../src/infra/db/inference_backend_repo.js';
import {
    listInferenceModels,
    setInferenceModelEnabled,
    upsertInferenceModel,
} from '../../../src/infra/db/inference_model_repo.js';
import {
    getInferenceClientPolicyByTag,
    listInferenceClientPolicies,
    upsertInferenceClientPolicy,
} from '../../../src/infra/db/inference_client_policy_repo.js';

function withTempDb(fn) {
    return async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-agent-db-'));
        const dbPath = path.join(tmpDir, 'maestro.sqlite');
        const prev = process.env.MAESTRO_DB_PATH;
        process.env.MAESTRO_DB_PATH = dbPath;
        try {
            getDb(); // apply migrations
            await fn({ dbPath, tmpDir });
        } finally {
            closeDb();
            if (prev === undefined) delete process.env.MAESTRO_DB_PATH;
            else process.env.MAESTRO_DB_PATH = prev;
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    };
}

test(
    'audit agent db store persists jobs and runs snapshots from runtime',
    withTempDb(async () => {
        const store = createAuditAgentDbStore();
        const rt = new AuditAgentRuntime({ store });
        const job = rt.createJob({ kind: 'quick_audit', trigger_type: 'manual', created_by: 'unit-test' });
        rt.queueJob(job.id);
        await rt.tick();

        const persisted = getAuditJobById(job.id);
        assert.ok(persisted);
        assert.equal(persisted.status, 'COMPLETED');
        assert.equal(persisted.kind, 'quick_audit');

        const runs = listAuditJobRunsByJobId(job.id);
        assert.equal(runs.length, 1);
        assert.equal(runs[0].status, 'COMPLETED');

        const list = listAuditJobs({ limit: 10 });
        assert.ok(list.some(item => item.id === job.id));
    })
);

test(
    'audit agent db store persists patch-like jobs waiting approval',
    withTempDb(async () => {
        const rt = new AuditAgentRuntime({
            store: createAuditAgentDbStore(),
            contextBuilder: {
                async collectQuickContext() {
                    return {
                        context: {
                            mode: 'test',
                            mcp_tools: {
                                lsp_diagnostics: { diagnostics_count: 2 },
                                lsp_references: { locations_count: 3 },
                                lsp_document_symbols: { symbols_count: 4 },
                                budget: { limit: 5, used: 4, remaining: 1 },
                            },
                            mcp_tool_payloads: {
                                rag_search: {
                                    result: {
                                        structuredContent: {
                                            data: {
                                                backend: 'lexical',
                                                degraded: false,
                                                results: [{ chunk_id: 'c1', score: 0.9, path: 'src/main.js' }],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        findings: [
                            {
                                severity: 'warning',
                                category: 'runtime',
                                title: 'Synthetic finding',
                                dedup_key: 'test:synthetic',
                                evidence: { foo: 'bar' },
                            },
                        ],
                        patches: [],
                    };
                },
            },
        });
        const job = rt.createJob({ kind: 'patch_suggest', trigger_type: 'manual' });
        rt.queueJob(job.id);
        await rt.tick();

        const persisted = getAuditJobById(job.id);
        assert.equal(persisted.status, 'WAITING_APPROVAL');

        const runs = listAuditJobRunsByJobId(job.id);
        assert.equal(runs.length, 1);
        assert.equal(runs[0].status, 'WAITING_APPROVAL');

        const findings = listAuditFindingsByJobId(job.id);
        assert.equal(findings.length, 1);
        assert.equal(findings[0].title, 'Synthetic finding');

        const patches = listAuditPatchProposalsByJobId(job.id);
        assert.equal(patches.length, 1);
        assert.equal(patches[0].status, 'draft');
        assert.equal(patches[0].approval_required, true);
        assert.equal(patches[0].patch_summary_json?.context_signals?.diagnostics_count, 2);
        assert.equal(patches[0].patch_summary_json?.context_budget?.remaining, 1);
        assert.equal(patches[0].dry_run_result_json?.pending, true);
    })
);

test(
    'inference profile and client policy repos support basic upsert/list/get',
    withTempDb(async () => {
        const profile = upsertInferenceProfile({
            name: 'patch_safe',
            purpose: 'patch generation',
            generation_params: { temperature: 0.1, top_p: 0.9 },
            fallback_chain: [{ model: 'small' }],
        });
        assert.equal(profile.name, 'patch_safe');

        const policy = upsertInferenceClientPolicy({
            client_tag: 'audit_agent_patch',
            profile_id: profile.id,
            allowed_models: ['qwen2.5-coder'],
            allowed_backends: ['ollama_local'],
            max_parallel: 1,
            timeout_ms: 120000,
        });
        assert.equal(policy.client_tag, 'audit_agent_patch');
        assert.equal(policy.profile_id, profile.id);

        const profiles = listInferenceProfiles();
        assert.ok(profiles.some(p => p.id === profile.id));
        const policies = listInferenceClientPolicies();
        assert.ok(policies.some(p => p.client_tag === 'audit_agent_patch'));

        const loaded = getInferenceClientPolicyByTag('audit_agent_patch');
        assert.equal(loaded.allowed_models_json[0], 'qwen2.5-coder');
        assert.equal(loaded.allowed_backends_json[0], 'ollama_local');
    })
);

test(
    'inference backend and model repos support basic upsert/list/get',
    withTempDb(async () => {
        const backend = upsertInferenceBackend({
            name: 'ollama_local',
            kind: 'ollama',
            base_url: 'http://host.docker.internal:11434',
            transport_policy: { timeout_ms: 30000 },
        });
        assert.equal(backend.name, 'ollama_local');

        const model = upsertInferenceModel({
            backend_id: backend.id,
            model_name: 'qwen2.5-coder:7b',
            alias: 'patch_model_strong',
            capabilities: { supports_code_patch: true, supports_json_strict: true },
            default_params: { temperature: 0.1, top_p: 0.9 },
        });
        assert.equal(model.alias, 'patch_model_strong');
        assert.equal(model.backend_id, backend.id);

        const backends = listInferenceBackends();
        const models = listInferenceModels({ backendId: backend.id });
        assert.ok(backends.some(item => item.id === backend.id));
        assert.ok(models.some(item => item.id === model.id));

        const backendDisabled = setInferenceBackendEnabled(backend.id, false);
        const modelDisabled = setInferenceModelEnabled(model.id, false);
        assert.equal(backendDisabled?.enabled, false);
        assert.equal(modelDisabled?.enabled, false);
    })
);

test(
    'audit runtime hydrates snapshots from db store and watch rules repo persists rows',
    withTempDb(async () => {
        const store = createAuditAgentDbStore();
        const rt1 = new AuditAgentRuntime({ store });
        const j = rt1.createJob({ kind: 'quick_audit', trigger_type: 'manual' });
        rt1.queueJob(j.id);
        await rt1.tick();

        const rt2 = new AuditAgentRuntime({ store });
        const hydration = rt2.hydrateFromStore();
        assert.equal(hydration.hydrated >= 1, true);
        const loaded = rt2.getJob(j.id);
        assert.ok(loaded);
        assert.equal(loaded.status, 'COMPLETED');

        upsertAuditWatchRule({
            name: 'Probe MCP health',
            trigger_type: 'schedule',
            schedule_cron: '*/5 * * * *',
            scope: { kind: 'runtime_probe' },
        });
        const rules = listAuditWatchRules();
        assert.equal(rules.length, 1);
        assert.equal(rules[0].trigger_type, 'schedule');
    })
);
