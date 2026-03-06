// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { AuditAgentRuntime } from '../../../src/audit_agent/runtime.js';

test('AuditAgentRuntime creates, queues and processes quick audit jobs to completed', async () => {
    const rt = new AuditAgentRuntime({
        now: (() => {
            let t = 1000;
            return () => ++t;
        })(),
    });
    const job = rt.createJob({ kind: 'quick_audit', trigger_type: 'manual' });
    assert.equal(job.status, 'PENDING');
    rt.queueJob(job.id);
    await rt.tick();
    const after = rt.getJob(job.id);
    assert.equal(after.status, 'COMPLETED');
    assert.equal(after.current_step, 'completed');
});

test('AuditAgentRuntime patch-like job ends in waiting approval', async () => {
    const rt = new AuditAgentRuntime();
    const job = rt.createJob({ kind: 'patch_suggest', trigger_type: 'api' });
    rt.queueJob(job.id);
    await rt.tick();
    const after = rt.getJob(job.id);
    assert.equal(after.status, 'WAITING_APPROVAL');
    assert.equal(after.result_json.patch_proposal_pending, true);
});

test('AuditAgentRuntime passes job to contextBuilder.collectQuickContext', async () => {
    /** @type {string|null} */
    let seenJobId = null;
    /** @type {any} */
    let seenScope = null;
    const rt = new AuditAgentRuntime({
        contextBuilder: {
            async collectQuickContext(job) {
                seenJobId = job?.id || null;
                seenScope = job?.scope_json || null;
                return { context: { ok: true }, findings: [], patches: [] };
            },
        },
    });
    const job = rt.createJob({
        kind: 'quick_audit',
        trigger_type: 'manual',
        scope: { filePath: 'src/main.js', query: 'AUDIT_AGENT' },
    });
    rt.queueJob(job.id);
    await rt.tick();
    assert.equal(seenJobId, job.id);
    assert.deepEqual(seenScope, { filePath: 'src/main.js', query: 'AUDIT_AGENT' });
});

test('AuditAgentRuntime executes triageClient and records llm triage result', async () => {
    let triageCalled = 0;
    const rt = new AuditAgentRuntime({
        contextBuilder: {
            async collectQuickContext() {
                return { context: { mode: 'test' }, findings: [], patches: [] };
            },
        },
        triageClient: {
            async runTriage(job, contextPack) {
                triageCalled += 1;
                assert.equal(job.kind, 'quick_audit');
                assert.equal(contextPack?.context?.mode, 'test');
                return {
                    ok: true,
                    provider: 'inference-gateway',
                    model: 'qwen-test',
                    profile_name: 'triage_fast',
                    raw_response: '{"summary":"ok","risk_level":"low","next_actions":["noop"]}',
                    parsed: { summary: 'ok', risk_level: 'low', next_actions: ['noop'] },
                };
            },
        },
    });

    const job = rt.createJob({ kind: 'quick_audit', trigger_type: 'manual' });
    rt.queueJob(job.id);
    await rt.tick();
    const after = rt.getJob(job.id);
    assert.equal(triageCalled, 1);
    assert.equal(after.status, 'COMPLETED');
    assert.equal(after.result_json?.llm_triage?.ok, true);
    assert.equal(after.result_json?.llm_triage?.model, 'qwen-test');
});

test('AuditAgentRuntime executes patchAuthorClient for patch-like job and records result', async () => {
    let patchAuthorCalled = 0;
    /** @type {any[]} */ const savedPatches = [];
    const rt = new AuditAgentRuntime({
        contextBuilder: {
            async collectQuickContext() {
                return { context: { mode: 'test' }, findings: [], patches: [] };
            },
        },
        patchAuthorClient: {
            async runPatchAuthor(job) {
                patchAuthorCalled += 1;
                assert.equal(job.kind, 'patch_suggest');
                return {
                    ok: true,
                    provider: 'inference-gateway',
                    model: 'patch-model',
                    profile_name: 'patch_safe',
                    parsed: { summary: 'patch', risk_level: 'low' },
                    patch_proposal: {
                        status: 'draft',
                        patch_unified_diff: '',
                        patch_summary: { source: 'audit-agent-patch-llm', candidate_files: ['src/main.js'] },
                        risk_score: 0.2,
                        dry_run_result_json: {
                            ok: false,
                            pending: true,
                            required: true,
                            reason: 'dry_run_not_executed_yet',
                        },
                        approval_required: true,
                    },
                };
            },
        },
        store: {
            saveJob() {},
            onRunStart() {},
            onRunFinish() {},
            saveFindings() {},
            savePatchProposals(_jobId, patches) {
                savedPatches.push(...patches);
            },
        },
    });

    const job = rt.createJob({ kind: 'patch_suggest', trigger_type: 'manual' });
    rt.queueJob(job.id);
    await rt.tick();
    const after = rt.getJob(job.id);
    assert.equal(after.status, 'WAITING_APPROVAL');
    assert.equal(patchAuthorCalled, 1);
    assert.equal(after.result_json?.llm_patch_author?.ok, true);
    assert.equal(savedPatches.length >= 1, true);
    assert.equal(savedPatches[0]?.patch_summary?.source, 'audit-agent-patch-llm');
});
