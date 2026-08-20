// @ts-check
import { log } from '#core/logger';
import { listAuditFindingsByJobId } from '#infra/db/audit_finding_repo';
import { getAuditJobById, listAuditJobs } from '#infra/db/audit_job_repo';
import { getAuditPatchProposalById, listAuditPatchProposalsByJobId } from '#infra/db/audit_patch_repo';
import { listAuditWatchRules } from '#infra/db/audit_watch_rule_repo';
import { COMMANDS, executeCommand } from '#server/domain/control_command_service';
import express from 'express';
import { authenticate } from '../../middleware/auth.js';
import { fail, ok } from '../utils/api_envelope.js';

/** @type {ReturnType<typeof express.Router>} */
const router = express.Router();

function _actorFromReq(/** @type {any} */ req) {
    return req.user || { id: req.ip || null, username: req.ip || null, role: 'admin', permissions: [] };
}

async function _runControl(
    /** @type {any} */ req,
    /** @type {any} */ res,
    /** @type {any} */ command,
    /** @type {Record<string, any>} */ payload = {},
) {
    try {
        const result = await executeCommand({
            command,
            payload: {
                ...payload,
                reason:
                    payload['reason'] || req.body?.reason || `${String(command).toLowerCase()} via /api/dashboard/audit`,
                idempotency_key:
                    payload['idempotency_key'] ||
                    req.body?.idempotency_key ||
                    `${req.id}:${command}:${payload['id'] || payload['audit_job_id'] || payload['patch_id'] || payload['watch_rule_id'] || 'n/a'}`,
            },
            actor: _actorFromReq(req),
        });
        return result;
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        fail(res, req, Number(_e?.statusCode || 500), {
            code: _e?.code || 'AUDIT_CONTROL_COMMAND_FAILED',
            error: _e?.message || 'Falha em comando de auditoria',
            details: _e?.details || null,
        });
        return null;
    }
}

function _positiveIntEnv(/** @type {any} */ name, /** @type {any} */ fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function _computeDryRunState(/** @type {any} */ patch) {
    const dryRun = patch?.dry_run_result_json;
    if (!dryRun || typeof dryRun !== 'object') {
        return { state: 'missing', reason: 'no_dry_run_result' };
    }
    if (dryRun.pending === true) {
        return { state: 'pending', reason: String(dryRun.reason || 'pending') };
    }
    const validatedAtMs = Number(dryRun.validated_at_ms ?? dryRun.ts ?? 0);
    const ttlMs = Number(dryRun.ttl_ms ?? _positiveIntEnv('AUDIT_PATCH_DRY_RUN_MAX_AGE_MS', 10 * 60 * 1000));
    if (!Number.isFinite(validatedAtMs) || validatedAtMs <= 0) {
        return { state: 'invalid', reason: 'missing_timestamp' };
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        return { state: 'invalid', reason: 'invalid_ttl' };
    }
    const ageMs = Math.max(0, Date.now() - validatedAtMs);
    const expiresAtMs = validatedAtMs + ttlMs;
    return {
        state: ageMs <= ttlMs && dryRun.ok === true ? 'fresh' : ageMs <= ttlMs ? 'failed' : 'stale',
        ok: dryRun.ok === true,
        age_ms: ageMs,
        ttl_ms: ttlMs,
        validated_at_ms: validatedAtMs,
        expires_at_ms: expiresAtMs,
        reason: dryRun.reason || null,
    };
}

function _enrichPatch(/** @type {any} */ patch) {
    const summary = _safeObject(patch?.patch_summary_json);
    const proposedChanges = Array.isArray(summary?.proposed_changes)
        ? summary.proposed_changes
              .map((/** @type {any} */ v) => String(v || '').trim())
              .filter(Boolean)
              .slice(0, 20)
        : [];
    const candidateFiles = Array.isArray(summary?.candidate_files)
        ? summary.candidate_files
              .map((/** @type {any} */ v) => String(v || '').trim())
              .filter(Boolean)
              .slice(0, 20)
        : [];
    const llmMeta = {
        source: summary?.source ? String(summary.source) : null,
        llm_provider: summary?.llm_provider ? String(summary.llm_provider) : null,
        llm_model: summary?.llm_model ? String(summary.llm_model) : null,
        profile_name: summary?.profile_name ? String(summary.profile_name) : null,
        risk_level: summary?.risk_level ? String(summary.risk_level) : null,
        summary: summary?.summary ? String(summary.summary) : null,
        candidate_files: candidateFiles,
        proposed_changes: proposedChanges,
        mode: summary?.mode ? String(summary.mode) : null,
    };
    return {
        ...patch,
        dry_run_state: _computeDryRunState(patch),
        llm_patch_summary: llmMeta,
    };
}

/**
 * @typedef {object} FetchApplyReadinessActor
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Avalia readiness de apply para um patch usando o control plane. Retorna null se patch não for encontrado ou em caso
 * de erro.
 *
 * @param {string} patchId
 * @param {FetchApplyReadinessActor} actor
 * @returns {Promise<object | null>}
 */
async function _fetchApplyReadiness(patchId, actor) {
    try {
        const result = await executeCommand({
            command: COMMANDS.AUDIT_PATCH_APPLY_VALIDATE,
            payload: {
                patch_id: patchId,
                reason: 'read apply readiness for patch enrichment',
                idempotency_key: `enrich:${patchId}:${Date.now()}`,
            },
            actor,
        });
        return result?.result?.metadata?.validation || null;
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('WARN', `[dashboard_audit] _fetchApplyReadiness failed for ${patchId}: ${_e?.message || String(_e)}`);
        return null;
    }
}

function _safeObject(/** @type {any} */ value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function _deriveLlmTriageSummary(/** @type {any} */ job) {
    const result = _safeObject(job?.result_json);
    const triage = _safeObject(result?.llm_triage);
    if (!triage) return null;
    const parsed = _safeObject(triage.parsed);
    const nextActions = Array.isArray(parsed?.next_actions)
        ? parsed.next_actions
              .map((/** @type {any} */ v) => String(v || '').trim())
              .filter(Boolean)
              .slice(0, 5)
        : [];
    return {
        present: true,
        ok: triage.ok === true,
        skipped: triage.skipped === true,
        model: triage.model ? String(triage.model) : null,
        profile_name: triage.profile_name ? String(triage.profile_name) : null,
        risk_level: parsed?.risk_level ? String(parsed.risk_level) : null,
        summary: parsed?.summary ? String(parsed.summary) : null,
        next_actions: nextActions,
        error: triage.error ? String(triage.error) : null,
        ts: Number(triage.ts || 0) || null,
    };
}

function _deriveLlmPatchAuthorSummary(/** @type {any} */ job) {
    const result = _safeObject(job?.result_json);
    const patchAuthor = _safeObject(result?.llm_patch_author);
    if (!patchAuthor) return null;
    const parsed = _safeObject(patchAuthor.parsed);
    const validation = _safeObject(patchAuthor.validation);
    const candidateFiles = Array.isArray(parsed?.candidate_files)
        ? parsed.candidate_files
              .map((/** @type {any} */ v) => String(v || '').trim())
              .filter(Boolean)
              .slice(0, 10)
        : [];
    const proposedChanges = Array.isArray(parsed?.proposed_changes)
        ? parsed.proposed_changes
              .map((/** @type {any} */ v) => String(v || '').trim())
              .filter(Boolean)
              .slice(0, 10)
        : [];
    return {
        present: true,
        ok: patchAuthor.ok === true,
        skipped: patchAuthor.skipped === true,
        model: patchAuthor.model ? String(patchAuthor.model) : null,
        profile_name: patchAuthor.profile_name ? String(patchAuthor.profile_name) : null,
        risk_level: parsed?.risk_level ? String(parsed.risk_level) : null,
        summary: parsed?.summary ? String(parsed.summary) : null,
        candidate_files: candidateFiles,
        proposed_changes: proposedChanges,
        validation: validation || null,
        error: patchAuthor.error ? String(patchAuthor.error) : null,
        ts: Number(patchAuthor.ts || 0) || null,
    };
}

function _enrichAuditJob(/** @type {any} */ job) {
    if (!job || typeof job !== 'object') return job;
    return {
        ...job,
        llm_triage_summary: _deriveLlmTriageSummary(job),
        llm_patch_author_summary: _deriveLlmPatchAuthorSummary(job),
    };
}

function getAuditAgentBaseUrl() {
    const host = process.env['AUDIT_AGENT_HOST'] || '127.0.0.1';
    const port = Number(process.env['AUDIT_AGENT_PORT'] || 3098);
    return `http://${host}:${port}`;
}

/**
 * Check if job kind is diagnostic
 *
 * @param {string} kind
 * @returns {boolean}
 */
function _isDiagnosticKind(kind) {
    return String(kind || '').startsWith('diagnostic_');
}

/**
 * Filter diagnostic jobs from list
 *
 * @param {unknown[]} jobs
 * @returns {unknown[]}
 */
function _filterDiagnosticJobs(jobs) {
    return (jobs || []).filter((/** @type {any} */ job) => _isDiagnosticKind(job.kind));
}

async function safeFetchJson(/** @type {any} */ url, timeoutMs = 2000, init = undefined) {
    try {
        const res = await fetch(url, {
            .../** @type {any} */ (init),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }
        return { ok: res.ok, status: res.status, json, text };
    } catch (/** @type {any} */ error) {
        const _e = /** @type {any} */ (error);
        return { ok: false, status: null, json: null, text: null, error: _e?.message || String(_e) };
    }
}

async function _fetchAuditJobWithFallback(/** @type {any} */ id) {
    const baseUrl = getAuditAgentBaseUrl();
    const upstream = await safeFetchJson(`${baseUrl}/jobs/${encodeURIComponent(String(id || ''))}`, 2500);
    if (upstream.ok) {
        return { ok: true, status: 200, source: 'audit-agent', job: upstream.json?.job || null, upstream };
    }
    const fromDb = getAuditJobById(id);
    if (fromDb) {
        return {
            ok: true,
            status: 200,
            source: 'audit-job-repo-fallback',
            job: fromDb,
            upstream,
        };
    }
    return {
        ok: false,
        status: Number(upstream.status || 503),
        source: null,
        job: null,
        upstream,
    };
}

router.get('/audit/runtime', authenticate, async (req, res) => {
    try {
        const appLocals = req.app?.locals || {};
        const runtimeSummary =
            typeof appLocals['getRuntimeResourcesStatus'] === 'function' ? appLocals['getRuntimeResourcesStatus']() : null;
        const baseUrl = getAuditAgentBaseUrl();
        const [health, metrics] = await Promise.all([
            safeFetchJson(`${baseUrl}/health`, 1500),
            safeFetchJson(`${baseUrl}/metrics`, 1500),
        ]);

        const resources = Array.isArray(runtimeSummary?.resources)
            ? runtimeSummary.resources.filter((/** @type {any} */ item) => ['audit_agent'].includes(String(item.id)))
            : [];

        ok(
            res,
            req,
            {
                resources,
                probes: { audit_agent: health },
                metrics,
                endpoints: { auditAgent: baseUrl },
            },
            { readiness_status: runtimeSummary?.status || 'unknown' },
        );
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[DASHBOARD_API] audit runtime failed: ${_e?.message || String(_e)}`, req.id);
        fail(res, req, 500, {
            code: 'AUDIT_RUNTIME_FAILED',
            error: 'Erro ao recuperar runtime do audit agent',
            details: _e?.message || String(_e),
        });
    }
});

router.get('/audit/jobs', authenticate, async (req, res) => {
    try {
        const baseUrl = getAuditAgentBaseUrl();
        const url = new URL(`${baseUrl}/jobs`);
        if (req.query['status']) url.searchParams.set('status', String(req.query['status']));
        if (req.query['limit']) url.searchParams.set('limit', String(req.query['limit']));

        const upstream = await safeFetchJson(url.toString(), 2500);
        if (!upstream.ok) {
            // Fallback to DB snapshots when local runtime is unavailable.
            const items = listAuditJobs({
                status: req.query['status'] ? String(req.query['status']) : null,
                limit: req.query['limit'] ? Number(req.query['limit']) : 100,
            });
            return ok(res, req, items.map(_enrichAuditJob), {
                source: 'audit-job-repo-fallback',
                upstream_available: false,
                upstream_error: upstream.error || upstream.json || upstream.text || null,
            });
        }

        return ok(res, req, (upstream.json?.items || []).map(_enrichAuditJob), { source: 'audit-agent' });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 500, {
            code: 'AUDIT_JOBS_LIST_FAILED',
            error: 'Erro ao listar jobs do audit agent',
            details: _e?.message || String(_e),
        });
    }
});

router.get('/audit/jobs/:id', authenticate, async (req, res) => {
    const result = await _fetchAuditJobWithFallback(req.params['id']);
    if (!result.ok) {
        return fail(res, req, result.status, {
            code: result.upstream?.status === 404 ? 'AUDIT_JOB_NOT_FOUND' : 'AUDIT_AGENT_UNAVAILABLE',
            error: result.upstream?.status === 404 ? 'Audit job não encontrado' : 'Audit Agent indisponível',
            details: result.upstream?.error || result.upstream?.json || result.upstream?.text || null,
        });
    }
    return ok(res, req, _enrichAuditJob(result.job), {
        source: result.source,
        upstream_available: result.source === 'audit-agent',
        upstream_error:
            result.source === 'audit-agent'
                ? null
                : result.upstream?.error || result.upstream?.json || result.upstream?.text || null,
    });
});

router.get('/audit/jobs/:id/llm-triage', authenticate, async (req, res) => {
    const result = await _fetchAuditJobWithFallback(req.params['id']);
    if (!result.ok) {
        return fail(res, req, result.status, {
            code: result.upstream?.status === 404 ? 'AUDIT_JOB_NOT_FOUND' : 'AUDIT_AGENT_UNAVAILABLE',
            error: result.upstream?.status === 404 ? 'Audit job não encontrado' : 'Audit Agent indisponível',
            details: result.upstream?.error || result.upstream?.json || result.upstream?.text || null,
        });
    }
    const job = result.job || null;
    const llmTriage = _safeObject(_safeObject(job?.result_json)?.llm_triage);
    if (!llmTriage) {
        return ok(res, req, null, {
            source: result.source,
            audit_job_id: String(req.params['id'] || ''),
            present: false,
        });
    }
    return ok(
        res,
        req,
        {
            summary: _deriveLlmTriageSummary(job),
            parsed: _safeObject(llmTriage.parsed) || null,
            raw_response: typeof llmTriage.raw_response === 'string' ? llmTriage.raw_response : null,
            preflight: _safeObject(llmTriage.preflight) || null,
            policy: _safeObject(llmTriage.policy) || null,
            provider: llmTriage.provider ? String(llmTriage.provider) : null,
            client_tag: llmTriage.client_tag ? String(llmTriage.client_tag) : null,
            error: llmTriage.error ? String(llmTriage.error) : null,
            skipped: llmTriage.skipped === true,
            ok: llmTriage.ok === true,
            ts: Number(llmTriage.ts || 0) || null,
        },
        {
            source: result.source,
            audit_job_id: String(req.params['id'] || ''),
            present: true,
        },
    );
});

router.get('/audit/jobs/:id/llm-patch-author', authenticate, async (req, res) => {
    const result = await _fetchAuditJobWithFallback(req.params['id']);
    if (!result.ok) {
        return fail(res, req, result.status, {
            code: result.upstream?.status === 404 ? 'AUDIT_JOB_NOT_FOUND' : 'AUDIT_AGENT_UNAVAILABLE',
            error: result.upstream?.status === 404 ? 'Audit job não encontrado' : 'Audit Agent indisponível',
            details: result.upstream?.error || result.upstream?.json || result.upstream?.text || null,
        });
    }
    const job = result.job || null;
    const llmPatch = _safeObject(_safeObject(job?.result_json)?.llm_patch_author);
    if (!llmPatch) {
        return ok(res, req, null, {
            source: result.source,
            audit_job_id: String(req.params['id'] || ''),
            present: false,
        });
    }
    return ok(
        res,
        req,
        {
            summary: _deriveLlmPatchAuthorSummary(job),
            parsed: _safeObject(llmPatch.parsed) || null,
            raw_response: typeof llmPatch.raw_response === 'string' ? llmPatch.raw_response : null,
            preflight: _safeObject(llmPatch.preflight) || null,
            policy: _safeObject(llmPatch.policy) || null,
            validation: _safeObject(llmPatch.validation) || null,
            patch_proposal: _safeObject(llmPatch.patch_proposal) || null,
            provider: llmPatch.provider ? String(llmPatch.provider) : null,
            client_tag: llmPatch.client_tag ? String(llmPatch.client_tag) : null,
            error: llmPatch.error ? String(llmPatch.error) : null,
            skipped: llmPatch.skipped === true,
            ok: llmPatch.ok === true,
            ts: Number(llmPatch.ts || 0) || null,
        },
        {
            source: result.source,
            audit_job_id: String(req.params['id'] || ''),
            present: true,
        },
    );
});

router.get('/audit/jobs/:id/findings', authenticate, (req, res) => {
    const items = listAuditFindingsByJobId(String(req.params['id'] || ''), {
        limit: req.query['limit'] ? Number(req.query['limit']) : 200,
    });
    return ok(res, req, items, {
        source: 'audit-finding-repo',
        audit_job_id: String(req.params['id'] || ''),
    });
});

router.get('/audit/jobs/:id/patches', authenticate, async (req, res) => {
    const items = listAuditPatchProposalsByJobId(String(req.params['id'] || ''), {
        limit: req.query['limit'] ? Number(req.query['limit']) : 50,
    });
    const includeReadiness =
        String(req.query['include_readiness'] || req.query['includeReadiness'] || 'false').toLowerCase() === 'true';
    const actor = _actorFromReq(req);
    // Se include_readiness, buscar readiness para cada patch em paralelo
    const enriched = await Promise.all(
        items.map(async (patch) => {
            const enrichedPatch = _enrichPatch(patch);
            if (includeReadiness && patch.id) {
                const readiness = await _fetchApplyReadiness(String(patch.id), actor);
                if (readiness) {
                    enrichedPatch.apply_readiness = readiness;
                }
            }
            return enrichedPatch;
        }),
    );
    const counts = enriched.reduce(
        (acc, item) => {
            const state = String(item?.dry_run_state?.state || 'unknown');
            acc.total += 1;
            acc.by_status[String(item.status || 'unknown')] =
                (acc.by_status[String(item.status || 'unknown')] || 0) + 1;
            acc.dry_run[state] = (acc.dry_run[state] || 0) + 1;
            return acc;
        },
        { total: 0, by_status: {}, dry_run: {} },
    );
    return ok(res, req, enriched, {
        source: 'audit-patch-repo',
        audit_job_id: String(req.params['id'] || ''),
        summary: counts,
        include_readiness: includeReadiness,
    });
});

router.get('/audit/patches/:id', authenticate, async (req, res) => {
    const patch = getAuditPatchProposalById(String(req.params['id'] || ''));
    if (!patch) {
        return fail(res, req, 404, {
            code: 'AUDIT_PATCH_NOT_FOUND',
            error: 'Audit patch proposal não encontrado',
        });
    }
    const enriched = _enrichPatch(patch);
    const includeReadiness =
        String(req.query['include_readiness'] || req.query['includeReadiness'] || 'false').toLowerCase() === 'true';
    if (includeReadiness) {
        const readiness = await _fetchApplyReadiness(String(req.params['id'] || ''), _actorFromReq(req));
        if (readiness) {
            enriched.apply_readiness = readiness;
        }
    }
    return ok(res, req, enriched, {
        source: 'audit-patch-repo',
        audit_patch_id: String(req.params['id'] || ''),
        include_readiness: includeReadiness,
    });
});

router.get('/audit/patches/:id/apply-readiness', authenticate, async (req, res) => {
    try {
        const result = await executeCommand({
            command: COMMANDS.AUDIT_PATCH_APPLY_VALIDATE,
            payload: {
                patch_id: req.params['id'],
                reason: String(req.query['reason'] || 'read apply readiness via /api/dashboard/audit'),
                idempotency_key: `${req.id}:${COMMANDS.AUDIT_PATCH_APPLY_VALIDATE}:${String(req.params['id'] || '')}`,
            },
            actor: _actorFromReq(req),
        });
        return ok(
            res,
            req,
            {
                patch: result.result?.after ? _enrichPatch(result.result.after) : null,
                validation: result.result?.metadata?.validation || null,
            },
            {
                source: 'control-plane',
                command: COMMANDS.AUDIT_PATCH_APPLY_VALIDATE,
                operation_id: result.operation?.id || null,
            },
        );
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, Number(_e?.statusCode || 500), {
            code: _e?.code || 'AUDIT_PATCH_APPLY_VALIDATE_FAILED',
            error: _e?.message || 'Falha ao validar readiness de apply',
            details: _e?.details || null,
        });
    }
});

router.get('/audit/jobs/:id/patches/:patchId', authenticate, async (req, res) => {
    const patch = getAuditPatchProposalById(String(req.params['patchId'] || ''));
    if (!patch || String(patch.job_id) !== String(req.params['id'] || '')) {
        return fail(res, req, 404, {
            code: 'AUDIT_PATCH_NOT_FOUND',
            error: 'Audit patch proposal não encontrado para este job',
        });
    }
    const enriched = _enrichPatch(patch);
    const includeReadiness =
        String(req.query['include_readiness'] || req.query['includeReadiness'] || 'false').toLowerCase() === 'true';
    if (includeReadiness) {
        const readiness = await _fetchApplyReadiness(String(req.params['patchId'] || ''), _actorFromReq(req));
        if (readiness) {
            enriched.apply_readiness = readiness;
        }
    }
    return ok(res, req, enriched, {
        source: 'audit-patch-repo',
        audit_patch_id: String(req.params['patchId'] || ''),
        audit_job_id: String(req.params['id'] || ''),
        include_readiness: includeReadiness,
    });
});

router.post('/audit/jobs', authenticate, async (req, res) => {
    const body = req.body || {};
    const createResult = await _runControl(req, res, COMMANDS.AUDIT_JOB_CREATE, body);
    if (!createResult) return;
    const createdJob = createResult.result?.after || createResult.result || null;
    const runNow = body.run_now === true || body.runNow === true;
    if (!runNow || !createdJob?.id) {
        return ok(
            res,
            req,
            { job: createdJob, run: null },
            {
                source: 'control-plane',
                command: COMMANDS.AUDIT_JOB_CREATE,
                operation_id: createResult.operation?.id || null,
            },
        );
    }

    const runResult = await _runControl(req, res, COMMANDS.AUDIT_JOB_RUN, {
        audit_job_id: createdJob.id,
        reason: body.reason || 'run newly created audit job',
    });
    if (!runResult) return;
    return ok(
        res,
        req,
        {
            job: runResult.result?.after || createdJob,
            create: createResult.result || null,
            run: runResult.result || null,
        },
        {
            source: 'control-plane',
            command: `${COMMANDS.AUDIT_JOB_CREATE}+${COMMANDS.AUDIT_JOB_RUN}`,
            operation_id: runResult.operation?.id || createResult.operation?.id || null,
        },
    );
});

router.post('/audit/jobs/:id/run', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.AUDIT_JOB_RUN, {
        ...(req.body || {}),
        audit_job_id: req.params['id'],
    });
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.AUDIT_JOB_RUN,
        operation_id: result.operation?.id || null,
    });
});

router.post('/audit/jobs/:id/cancel', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.AUDIT_JOB_CANCEL, {
        ...(req.body || {}),
        audit_job_id: req.params['id'],
    });
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.AUDIT_JOB_CANCEL,
        operation_id: result.operation?.id || null,
    });
});

router.post('/audit/patches/:id/approve', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.AUDIT_PATCH_APPROVE, {
        ...(req.body || {}),
        patch_id: req.params['id'],
    });
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.AUDIT_PATCH_APPROVE,
        operation_id: result.operation?.id || null,
    });
});

router.post('/audit/patches/:id/reject', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.AUDIT_PATCH_REJECT, {
        ...(req.body || {}),
        patch_id: req.params['id'],
    });
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.AUDIT_PATCH_REJECT,
        operation_id: result.operation?.id || null,
    });
});

router.post('/audit/patches/:id/apply', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.AUDIT_PATCH_APPLY, {
        ...(req.body || {}),
        patch_id: req.params['id'],
    });
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.AUDIT_PATCH_APPLY,
        operation_id: result.operation?.id || null,
    });
});

router.post('/audit/patches/:id/apply/validate', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.AUDIT_PATCH_APPLY_VALIDATE, {
        ...(req.body || {}),
        patch_id: req.params['id'],
    });
    if (!result) return;
    return ok(
        res,
        req,
        {
            patch: result.result?.after ? _enrichPatch(result.result.after) : null,
            validation: result.result?.metadata?.validation || null,
        },
        {
            source: 'control-plane',
            command: COMMANDS.AUDIT_PATCH_APPLY_VALIDATE,
            operation_id: result.operation?.id || null,
        },
    );
});

router.post('/audit/watch-rules', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.AUDIT_WATCH_RULE_UPSERT, req.body || {});
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.AUDIT_WATCH_RULE_UPSERT,
        operation_id: result.operation?.id || null,
    });
});

router.post('/audit/watch-rules/:id/toggle', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.AUDIT_WATCH_RULE_TOGGLE, {
        ...(req.body || {}),
        watch_rule_id: req.params['id'],
    });
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.AUDIT_WATCH_RULE_TOGGLE,
        operation_id: result.operation?.id || null,
    });
});

router.get('/audit/watch-rules', authenticate, (_req, res) => {
    const items = listAuditWatchRules({
        enabledOnly: String(_req.query['enabled_only'] || 'false').toLowerCase() === 'true',
        limit: _req.query['limit'] ? Number(_req.query['limit']) : 100,
    });
    return ok(res, _req, items, { source: 'audit-watch-rule-repo' });
});

// ===========================================
// Diagnostic Agent Endpoints (via Audit Agent)
// ===========================================

/** Valid diagnostic job kinds */
const DIAGNOSTIC_JOB_KINDS = [
    'diagnostic_health',
    'diagnostic_system',
    'diagnostic_models',
    'diagnostic_verify',
    'diagnostic_report',
];

/**
 * GET /audit/diagnostic/runtime Check Diagnostic Agent availability (routed via Audit Agent) Note: Diagnostic Agent was
 * consolidated into Audit Agent
 */
router.get('/audit/diagnostic/runtime', authenticate, async (req, res) => {
    try {
        // Diagnostic jobs now route through Audit Agent
        const diagBaseUrl = getAuditAgentBaseUrl();
        const [health, models] = await Promise.all([
            safeFetchJson(`${diagBaseUrl}/health`, 2000),
            safeFetchJson(`${diagBaseUrl}/models`, 2000),
        ]);

        return ok(
            res,
            req,
            {
                available: health.ok === true,
                endpoints: {
                    diagnostic: diagBaseUrl,
                    health: `${diagBaseUrl}/health`,
                    models: `${diagBaseUrl}/models`,
                    execute: `${diagBaseUrl}/execute`,
                },
                health: health.json || { ok: health.ok, status: health.status },
                models: models.json || null,
                probe: {
                    health_status: health.status,
                    models_status: models.status,
                },
                routing: 'Diagnostic jobs now processed by Audit Agent',
            },
            { source: 'audit-agent', routing_note: 'diagnostic consolidated into audit-agent' },
        );
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 503, {
            code: 'DIAGNOSTIC_TO_AUDIT_AGENT_FAILED',
            error: 'Falha ao rotear Diagnostic para Audit Agent',
            details: _e?.message || String(_e),
        });
    }
});

/**
 * GET /audit/diagnostic/jobs List diagnostic jobs (filtered from audit jobs)
 */
router.get('/audit/diagnostic/jobs', authenticate, async (req, res) => {
    try {
        const baseUrl = getAuditAgentBaseUrl();
        const url = new URL(`${baseUrl}/jobs`);
        if (req.query['status']) url.searchParams.set('status', String(req.query['status']));
        if (req.query['limit']) url.searchParams.set('limit', String(req.query['limit']));

        const upstream = await safeFetchJson(url.toString(), 2500);
        if (!upstream.ok) {
            // Fallback to DB
            const allJobs = listAuditJobs({
                status: req.query['status'] ? String(req.query['status']) : null,
                limit: req.query['limit'] ? Number(req.query['limit']) : 100,
            });
            const diagJobs = _filterDiagnosticJobs(allJobs);
            return ok(res, req, diagJobs, {
                source: 'audit-job-repo-fallback',
                upstream_available: false,
                count: diagJobs.length,
            });
        }

        const allJobs = upstream.json?.items || [];
        const diagJobs = _filterDiagnosticJobs(allJobs);
        return ok(res, req, diagJobs, {
            source: 'audit-agent',
            count: diagJobs.length,
            total_filtered: allJobs.length,
        });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 500, {
            code: 'DIAGNOSTIC_JOBS_LIST_FAILED',
            error: 'Erro ao listar jobs diagnósticos',
            details: _e?.message || String(_e),
        });
    }
});

/**
 * GET /audit/diagnostic/jobs/:id Get diagnostic job by ID
 */
router.get('/audit/diagnostic/jobs/:id', authenticate, async (req, res) => {
    const result = await _fetchAuditJobWithFallback(req.params['id']);
    if (!result.ok) {
        return fail(res, req, result.status, {
            code: result.upstream?.status === 404 ? 'DIAGNOSTIC_JOB_NOT_FOUND' : 'DIAGNOSTIC_AGENT_UNAVAILABLE',
            error: result.upstream?.status === 404 ? 'Diagnostic job não encontrado' : 'Diagnostic Agent indisponível',
            details: result.upstream?.error || result.upstream?.json || result.upstream?.text || null,
        });
    }

    // Verify it's a diagnostic job
    if (!_isDiagnosticKind(result.job?.kind)) {
        return fail(res, req, 404, {
            code: 'NOT_A_DIAGNOSTIC_JOB',
            error: 'Job encontrado mas não é um job diagnóstico',
        });
    }

    return ok(res, req, result.job, {
        source: result.source,
    });
});

/**
 * GET /audit/diagnostic/jobs/:id/result Get diagnostic result from job
 */
router.get('/audit/diagnostic/jobs/:id/result', authenticate, async (req, res) => {
    const result = await _fetchAuditJobWithFallback(req.params['id']);
    if (!result.ok) {
        return fail(res, req, result.status, {
            code: result.upstream?.status === 404 ? 'DIAGNOSTIC_JOB_NOT_FOUND' : 'DIAGNOSTIC_AGENT_UNAVAILABLE',
            error: result.upstream?.status === 404 ? 'Diagnostic job não encontrado' : 'Diagnostic Agent indisponível',
            details: result.upstream?.error || result.upstream?.json || result.upstream?.text || null,
        });
    }

    if (!_isDiagnosticKind(result.job?.kind)) {
        return fail(res, req, 404, {
            code: 'NOT_A_DIAGNOSTIC_JOB',
            error: 'Job encontrado mas não é um job diagnóstico',
        });
    }

    const diagnosticResult = result.job?.result_json?.diagnostic_result || null;
    return ok(res, req, diagnosticResult, {
        source: result.source,
        audit_job_id: String(req.params['id'] || ''),
        job_status: result.job?.status,
    });
});

/**
 * POST /audit/diagnostic/jobs Create diagnostic job
 */
router.post('/audit/diagnostic/jobs', authenticate, async (req, res) => {
    const body = req.body || {};
    const kind = body.kind || body.job?.kind;

    // Validate job kind
    if (!kind || !DIAGNOSTIC_JOB_KINDS.includes(kind)) {
        return fail(res, req, 400, {
            code: 'INVALID_DIAGNOSTIC_JOB_KIND',
            error: 'Tipo de job diagnóstico inválido ou ausente',
            valid_kinds: DIAGNOSTIC_JOB_KINDS,
        });
    }

    // Create job via control plane
    const createResult = await _runControl(req, res, COMMANDS.DIAGNOSTIC_JOB_CREATE, {
        kind,
        scope_json: body.scope_json || body.scope || {},
        trigger_type: body.trigger_type || 'manual',
        run_now: body.run_now === true || body.runNow === true,
    });

    if (!createResult) return;

    const createdJob = createResult.result?.after || createResult.result || null;
    return ok(
        res,
        req,
        { job: createdJob },
        {
            source: 'control-plane',
            command: COMMANDS.DIAGNOSTIC_JOB_CREATE,
            operation_id: createResult.operation?.id || null,
        },
    );
});

/**
 * POST /audit/diagnostic/jobs/:id/run Run (execute) diagnostic job
 */
router.post('/audit/diagnostic/jobs/:id/run', authenticate, async (req, res) => {
    // First verify it's a diagnostic job
    const jobCheck = await _fetchAuditJobWithFallback(req.params['id']);
    if (!jobCheck.ok) {
        return fail(res, req, jobCheck.status, {
            code: 'DIAGNOSTIC_JOB_NOT_FOUND',
            error: 'Diagnostic job não encontrado',
        });
    }

    if (!_isDiagnosticKind(jobCheck.job?.kind)) {
        return fail(res, req, 400, {
            code: 'NOT_A_DIAGNOSTIC_JOB',
            error: 'Job encontrado mas não é um job diagnóstico',
        });
    }

    const result = await _runControl(req, res, COMMANDS.DIAGNOSTIC_JOB_RUN, {
        ...(req.body || {}),
        diagnostic_job_id: req.params['id'],
    });
    if (!result) return;

    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.DIAGNOSTIC_JOB_RUN,
        operation_id: result.operation?.id || null,
    });
});

/**
 * POST /audit/diagnostic/jobs/:id/cancel Cancel diagnostic job
 */
router.post('/audit/diagnostic/jobs/:id/cancel', authenticate, async (req, res) => {
    // First verify it's a diagnostic job
    const jobCheck = await _fetchAuditJobWithFallback(req.params['id']);
    if (!jobCheck.ok) {
        return fail(res, req, jobCheck.status, {
            code: 'DIAGNOSTIC_JOB_NOT_FOUND',
            error: 'Diagnostic job não encontrado',
        });
    }

    if (!_isDiagnosticKind(jobCheck.job?.kind)) {
        return fail(res, req, 400, {
            code: 'NOT_A_DIAGNOSTIC_JOB',
            error: 'Job encontrado mas não é um job diagnóstico',
        });
    }

    const result = await _runControl(req, res, COMMANDS.DIAGNOSTIC_JOB_CANCEL, {
        ...(req.body || {}),
        diagnostic_job_id: req.params['id'],
    });
    if (!result) return;

    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.DIAGNOSTIC_JOB_CANCEL,
        operation_id: result.operation?.id || null,
    });
});

/**
 * POST /audit/diagnostic/jobs/:id/retry Retry diagnostic job
 */
router.post('/audit/diagnostic/jobs/:id/retry', authenticate, async (req, res) => {
    // First verify it's a diagnostic job
    const jobCheck = await _fetchAuditJobWithFallback(req.params['id']);
    if (!jobCheck.ok) {
        return fail(res, req, jobCheck.status, {
            code: 'DIAGNOSTIC_JOB_NOT_FOUND',
            error: 'Diagnostic job não encontrado',
        });
    }

    if (!_isDiagnosticKind(jobCheck.job?.kind)) {
        return fail(res, req, 400, {
            code: 'NOT_A_DIAGNOSTIC_JOB',
            error: 'Job encontrado mas não é um job diagnóstico',
        });
    }

    const result = await _runControl(req, res, COMMANDS.DIAGNOSTIC_JOB_RETRY, {
        ...(req.body || {}),
        diagnostic_job_id: req.params['id'],
    });
    if (!result) return;

    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.DIAGNOSTIC_JOB_RETRY,
        operation_id: result.operation?.id || null,
    });
});

export default router;
