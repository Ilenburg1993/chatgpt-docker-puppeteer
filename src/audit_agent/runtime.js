// @ts-check

import { randomUUID } from 'node:crypto';
import {
    AUDIT_JOB_KIND,
    AUDIT_JOB_STATUS,
    AUDIT_JOB_TRIGGER_TYPE,
    isAuditJobKind,
    isAuditJobTriggerType,
} from './contracts.js';

function nowMs() {
    return Date.now();
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function normPriority(value, fallback = 50) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.trunc(n)));
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function _asArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * @param {Record<string, any>|null|undefined} job
 * @param {Record<string, any>|null|undefined} contextPack
 * @returns {any}
 */
function _derivePatchDraftFromContext(job, contextPack) {
    const context = contextPack?.context || {};
    const mcpTools = context.mcp_tools || {};
    const payloads = context.mcp_tool_payloads || {};
    const scope = job?.scope_json && typeof job.scope_json === 'object' ? job.scope_json : {};

    const targetFile = String(scope.filePath || scope.file_path || 'src/main.js');
    const ragResults = _asArray(payloads?.rag_search?.result?.structuredContent?.data?.results);
    const ragFirst = ragResults[0] || null;
    const referencesCount = Number(mcpTools?.lsp_references?.locations_count || 0);
    const diagnosticsCount = Number(mcpTools?.lsp_diagnostics?.diagnostics_count || 0);
    const symbolsCount = Number(mcpTools?.lsp_document_symbols?.symbols_count || 0);

    const patchSummary = {
        skeleton: true,
        mode: 'propose_only',
        source: 'audit-agent-runtime',
        reason: 'LLM patch generation ainda não integrado (fase pipeline pendente)',
        target_file: targetFile,
        candidate_files: [targetFile],
        context_signals: {
            diagnostics_count: diagnosticsCount,
            references_count: referencesCount,
            symbols_count: symbolsCount,
            rag_results_count: _asArray(ragResults).length,
            rag_backend: payloads?.rag_search?.result?.structuredContent?.data?.backend || null,
            rag_degraded: payloads?.rag_search?.result?.structuredContent?.data?.degraded ?? null,
        },
        context_budget: mcpTools?.budget || null,
        rag_anchor: ragFirst
            ? {
                  chunk_id: /** @type {Record<string, any>} */ (ragFirst).chunk_id || null,
                  score: /** @type {Record<string, any>} */ (ragFirst).score ?? null,
                  path:
                      /** @type {Record<string, any>} */ (ragFirst).path ||
                      /** @type {Record<string, any>} */ (ragFirst).file_path ||
                      null,
              }
            : null,
        recommended_next_actions: [
            'Executar geração de patch LLM com contexto MCP enriquecido',
            'Rodar dry-run determinístico (node/lint/typecheck/testes alvo)',
            'Requerer aprovação humana antes de apply',
        ],
    };

    return {
        status: 'draft',
        patch_unified_diff: '',
        patch_summary: patchSummary,
        risk_score: diagnosticsCount > 0 ? 0.35 : 0.2,
        dry_run_result_json: {
            ok: false,
            pending: true,
            required: true,
            reason: 'dry_run_not_executed_yet',
            validated_at_ms: null,
            ttl_ms: null,
        },
        approval_required: true,
    };
}

/**
 * @param {unknown} kind
 * @returns {void}
 */
function assertKind(kind) {
    if (!isAuditJobKind(kind)) {
        const err = /** @type {Error & { statusCode?: number, code?: string }} */ (
            new Error(`audit job kind inválido: ${String(kind)}`)
        );
        err.statusCode = 422;
        err.code = 'AUDIT_JOB_KIND_INVALID';
        throw err;
    }
}

/**
 * @param {unknown} triggerType
 * @returns {void}
 */
function assertTriggerType(triggerType) {
    if (!isAuditJobTriggerType(triggerType)) {
        const err = /** @type {Error & { statusCode?: number, code?: string }} */ (
            new Error(`audit job trigger_type inválido: ${String(triggerType)}`)
        );
        err.statusCode = 422;
        err.code = 'AUDIT_JOB_TRIGGER_INVALID';
        throw err;
    }
}

/**
 * Runtime de orquestração do Audit Agent.
 * Coordena fila de jobs, coleta de contexto, triagem e propostas de patch.
 */
export class AuditAgentRuntime {
    /**
     * @param {{
     *   now?: ()=>number,
     *   logger?: ((level:string, message:string, data?:unknown)=>void)|null,
     *   maxConcurrentJobs?: number,
     *   store?: {
     *     saveJob?: (job:any)=>unknown,
     *     onRunStart?: (job:any)=>unknown,
     *     onRunFinish?: (job:any)=>unknown
     *     saveFindings?: (jobId:string, findings:unknown[])=>unknown,
     *     savePatchProposals?: (jobId:string, patches:unknown[])=>unknown,
     *     listJobs?: (opts?:any)=>unknown[],
     *   }|null
     *   contextBuilder?: { collectQuickContext?: (job?:any)=>Promise<{context?:any, findings?:unknown[], patches?:unknown[]}> }|null
     *   triageClient?: { runTriage?: (job:any, contextPack:any)=>Promise<Record<string, any>>, isEnabled?: ()=>boolean }|null
     *   patchAuthorClient?: { runPatchAuthor?: (job:any, contextPack:any, llmTriage:any)=>Promise<Record<string, any>>, isEnabled?: ()=>boolean }|null
     *   diagnosticClient?: { runDiagnostic?: (jobKind:string, params?:any)=>Promise<{success:boolean, data?:any, error?:string, durationMs?:number}>, isEnabled?: ()=>boolean }|null
     * }} [options]
     */
    constructor(options = {}) {
        this.now = options.now || nowMs;
        this.logger = options.logger || null;
        this.maxConcurrentJobs = Math.max(
            1,
            Number(options.maxConcurrentJobs || process.env.AUDIT_AGENT_MAX_CONCURRENT_JOBS || 1)
        );
        this.store = options.store || null;
        this.contextBuilder = options.contextBuilder || null;
        this.triageClient = options.triageClient || null;
        this.patchAuthorClient = options.patchAuthorClient || null;
        this.diagnosticClient = options.diagnosticClient || null;
        /** @type {Map<string, any>} */
        this.jobs = new Map();
        this._tickInFlight = false;
        this._ticks = 0;
        this._completed = 0;
        this._failed = 0;
    }

    /**
     * @param {string} level
     * @param {string} message
     * @param {unknown} [data]
     * @returns {void}
     */
    _log(level, message, data) {
        if (this.logger) this.logger(level, message, data);
    }

    /**
     * @param {Record<string, any>|null|undefined} job
     * @returns {void}
     */
    _persistJob(job) {
        if (!this.store || typeof this.store.saveJob !== 'function' || !job) return;
        try {
            this.store.saveJob(job);
        } catch (/** @type {any} */ error) {
            this._log('WARN', '[audit-agent] saveJob failed', {
                id: job?.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * @param {Record<string, any>|null|undefined} job
     * @returns {void}
     */
    _persistRunStart(job) {
        if (!this.store || typeof this.store.onRunStart !== 'function' || !job) return;
        try {
            this.store.onRunStart(job);
        } catch (/** @type {any} */ error) {
            this._log('WARN', '[audit-agent] onRunStart failed', {
                id: job?.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * @param {Record<string, any>|null|undefined} job
     * @returns {void}
     */
    _persistRunFinish(job) {
        if (!this.store || typeof this.store.onRunFinish !== 'function' || !job) return;
        try {
            this.store.onRunFinish(job);
        } catch (/** @type {any} */ error) {
            this._log('WARN', '[audit-agent] onRunFinish failed', {
                id: job?.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * @param {string} jobId
     * @param {unknown[]} findings
     * @returns {void}
     */
    _persistFindings(jobId, findings) {
        if (!this.store || typeof this.store.saveFindings !== 'function') return;
        try {
            this.store.saveFindings(jobId, Array.isArray(findings) ? findings : []);
        } catch (/** @type {any} */ error) {
            this._log('WARN', '[audit-agent] saveFindings failed', {
                id: jobId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * @param {string} jobId
     * @param {unknown[]} patches
     * @returns {void}
     */
    _persistPatchProposals(jobId, patches) {
        if (!this.store || typeof this.store.savePatchProposals !== 'function') return;
        try {
            this.store.savePatchProposals(jobId, Array.isArray(patches) ? patches : []);
        } catch (/** @type {any} */ error) {
            this._log('WARN', '[audit-agent] savePatchProposals failed', {
                id: jobId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    hydrateFromStore({ limit = 200 } = {}) {
        if (!this.store || typeof this.store.listJobs !== 'function') {
            return { hydrated: 0, skipped: 0 };
        }
        let hydrated = 0;
        let skipped = 0;
        const rows = Array.isArray(this.store.listJobs({ limit })) ? this.store.listJobs({ limit }) : [];
        for (const row of /** @type {Record<string, any>[]} */ (rows)) {
            if (!row?.id) {
                skipped += 1;
                continue;
            }
            if (this.jobs.has(row.id)) {
                skipped += 1;
                continue;
            }
            const job = /** @type {Record<string, any>} */ ({
                ...row,
                history: Array.isArray(row.history) ? row.history : [],
                current_run_id: null,
            });
            this.jobs.set(job.id, job);
            hydrated += 1;
        }
        return { hydrated, skipped };
    }

    /**
     * @param {{ kind?: string, trigger_type?: string, scope?: unknown, priority?: number, created_by?: string }} input
     */
    createJob(input = {}) {
        const kind = input.kind || AUDIT_JOB_KIND.QUICK_AUDIT;
        const triggerType = input.trigger_type || AUDIT_JOB_TRIGGER_TYPE.MANUAL;
        assertKind(kind);
        assertTriggerType(triggerType);
        const id = `aj_${randomUUID()}`;
        const ts = this.now();
        const job = /** @type {Record<string, any>} */ ({
            id,
            kind,
            trigger_type: triggerType,
            status: AUDIT_JOB_STATUS.PENDING,
            priority: normPriority(input.priority, 50),
            scope_json: input.scope || {},
            created_by: input.created_by || 'system',
            created_at_ms: ts,
            updated_at_ms: ts,
            started_at_ms: null,
            completed_at_ms: null,
            current_step: null,
            attempt_seq: 0,
            result_json: null,
            error_json: null,
            history: /** @type {any[]} */ ([]),
        });
        job.history.push({ ts, event: 'created', status: job.status });
        this.jobs.set(id, job);
        this._persistJob(job);
        return { ...job };
    }

    /**
     * @param {{ status?: string|null, limit?: number }} [opts]
     * @returns {Record<string, any>[]}
     */
    listJobs({ status = null, limit = 100 } = {}) {
        const rows = [...this.jobs.values()]
            .filter(job => !status || job.status === status)
            .sort((a, b) => b.updated_at_ms - a.updated_at_ms || String(b.id).localeCompare(String(a.id)));
        return rows.slice(0, Math.max(1, Math.min(Number(limit) || 100, 500))).map(job => ({ ...job }));
    }

    /**
     * @param {string} id
     * @returns {Record<string, any>|null}
     */
    getJob(id) {
        const job = this.jobs.get(String(id));
        return job ? { ...job } : null;
    }

    /**
     * @param {string} id
     * @returns {Record<string, any>}
     */
    queueJob(id) {
        const job = this.jobs.get(String(id));
        if (!job) {
            const err = /** @type {Error & { statusCode?: number, code?: string }} */ (
                new Error('audit job não encontrado')
            );
            err.statusCode = 404;
            err.code = 'AUDIT_JOB_NOT_FOUND';
            throw err;
        }
        if ([AUDIT_JOB_STATUS.COMPLETED, AUDIT_JOB_STATUS.CANCELLED].includes(job.status)) {
            const err = /** @type {Error & { statusCode?: number, code?: string }} */ (
                new Error(`audit job em estado terminal: ${job.status}`)
            );
            err.statusCode = 409;
            err.code = 'AUDIT_JOB_TERMINAL';
            throw err;
        }
        const ts = this.now();
        job.status = AUDIT_JOB_STATUS.QUEUED;
        job.updated_at_ms = ts;
        job.history.push({ ts, event: 'queued', status: job.status });
        this._persistJob(job);
        return { ...job };
    }

    /**
     * @param {string} id
     * @param {string} [reason]
     * @returns {Record<string, any>}
     */
    cancelJob(id, reason = 'manual_cancel') {
        const job = this.jobs.get(String(id));
        if (!job) {
            const err = /** @type {Error & { statusCode?: number, code?: string }} */ (
                new Error('audit job não encontrado')
            );
            err.statusCode = 404;
            err.code = 'AUDIT_JOB_NOT_FOUND';
            throw err;
        }
        const ts = this.now();
        job.status = AUDIT_JOB_STATUS.CANCELLED;
        job.updated_at_ms = ts;
        job.completed_at_ms = ts;
        job.current_step = 'cancelled';
        job.history.push({ ts, event: 'cancelled', status: job.status, reason });
        this._persistJob(job);
        return { ...job };
    }

    _runningCount() {
        let n = 0;
        for (const job of this.jobs.values()) {
            if (job.status === AUDIT_JOB_STATUS.RUNNING) n += 1;
        }
        return n;
    }

    _nextQueuedJobs() {
        return [...this.jobs.values()]
            .filter(job => job.status === AUDIT_JOB_STATUS.QUEUED)
            .sort((a, b) => b.priority - a.priority || a.created_at_ms - b.created_at_ms);
    }

    /**
     * @param {Record<string, any>} job
     * @returns {Promise<void>}
     */
    async _processJob(job) {
        const startTs = this.now();
        job.status = AUDIT_JOB_STATUS.RUNNING;
        job.started_at_ms = job.started_at_ms || startTs;
        job.updated_at_ms = startTs;
        job.attempt_seq = (Number(job.attempt_seq) || 0) + 1;
        job.current_run_id = `ajrun_${randomUUID()}`;
        job.current_step = 'collect_context';
        job.history.push({ ts: startTs, event: 'running', status: job.status, attempt_seq: job.attempt_seq });
        this._persistJob(job);
        this._persistRunStart(job);

        let contextPack = null;
        const ts1 = this.now();
        job.current_step = 'deterministic_checks';
        job.history.push({ ts: ts1, event: 'step', step: job.current_step });
        this._persistJob(job);

        const ts2 = this.now();
        job.current_step = 'triage';
        job.history.push({ ts: ts2, event: 'step', step: job.current_step });
        this._persistJob(job);

        if (
            this.contextBuilder &&
            typeof this.contextBuilder.collectQuickContext === 'function' &&
            (job.kind === AUDIT_JOB_KIND.QUICK_AUDIT ||
                job.kind === AUDIT_JOB_KIND.BUG_HUNT ||
                job.kind === AUDIT_JOB_KIND.PATCH_SUGGEST ||
                job.kind === AUDIT_JOB_KIND.RUNTIME_PROBE)
        ) {
            try {
                contextPack = await this.contextBuilder.collectQuickContext(job);
            } catch (/** @type {any} */ error) {
                contextPack = {
                    context: {
                        mode: 'read_only_probe_v0',
                        error: error instanceof Error ? error.message : String(error),
                    },
                    findings: [
                        {
                            severity: 'warning',
                            category: 'context',
                            title: 'Falha ao coletar contexto do audit-agent',
                            source: 'audit-agent',
                            dedup_key: 'ctx:collect:error',
                            evidence: { error: error instanceof Error ? error.message : String(error) },
                        },
                    ],
                    patches: [],
                };
            }
        }

        const patchLike = job.kind === AUDIT_JOB_KIND.PATCH_SUGGEST || job.kind === AUDIT_JOB_KIND.BUG_HUNT;
        /** @type {Record<string, any>|null} */
        let llmTriage = null;
        if (this.triageClient && typeof this.triageClient.runTriage === 'function') {
            const tsTriage = this.now();
            job.current_step = 'triage_llm';
            job.history.push({ ts: tsTriage, event: 'step', step: job.current_step });
            this._persistJob(job);
            try {
                llmTriage = /** @type {Record<string, any>} */ (await this.triageClient.runTriage(job, contextPack));
            } catch (/** @type {any} */ error) {
                llmTriage = {
                    ok: false,
                    skipped: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }
        /** @type {Record<string, any>|null} */
        let llmPatchAuthor = null;
        if (patchLike && this.patchAuthorClient && typeof this.patchAuthorClient.runPatchAuthor === 'function') {
            const tsPatch = this.now();
            job.current_step = 'patch_author_llm';
            job.history.push({ ts: tsPatch, event: 'step', step: job.current_step });
            this._persistJob(job);
            try {
                llmPatchAuthor = /** @type {Record<string, any>} */ (
                    await this.patchAuthorClient.runPatchAuthor(job, contextPack, llmTriage)
                );
            } catch (/** @type {any} */ error) {
                llmPatchAuthor = {
                    ok: false,
                    skipped: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }

        // Handle diagnostic jobs (DIAGNOSTIC_HEALTH, DIAGNOSTIC_SYSTEM, etc.)
        const isDiagnosticJob =
            job.kind === AUDIT_JOB_KIND.DIAGNOSTIC_HEALTH ||
            job.kind === AUDIT_JOB_KIND.DIAGNOSTIC_SYSTEM ||
            job.kind === AUDIT_JOB_KIND.DIAGNOSTIC_MODELS ||
            job.kind === AUDIT_JOB_KIND.DIAGNOSTIC_VERIFY ||
            job.kind === AUDIT_JOB_KIND.DIAGNOSTIC_REPORT;

        /** @type {Record<string, any>|null} */
        let diagnosticResult = null;
        if (isDiagnosticJob && this.diagnosticClient && typeof this.diagnosticClient.runDiagnostic === 'function') {
            const tsDiag = this.now();
            job.current_step = 'diagnostic_execution';
            job.history.push({ ts: tsDiag, event: 'step', step: job.current_step });
            this._persistJob(job);
            try {
                diagnosticResult = await this.diagnosticClient.runDiagnostic(job.kind, job.scope_json);
            } catch (/** @type {any} */ error) {
                diagnosticResult = {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }

        const endTs = this.now();
        job.current_step = patchLike ? 'waiting_approval' : isDiagnosticJob ? 'diagnostic_completed' : 'completed';
        job.result_json = {
            skeleton: true,
            patch_proposal_pending: patchLike,
            is_diagnostic: isDiagnosticJob,
            notes: isDiagnosticJob
                ? 'Diagnostic job executed via Audit Agent (proxied to Diagnostic Agent)'
                : 'AuditAgentRuntime read-only probe execution (DB snapshots enabled)',
            context: contextPack?.context || null,
            llm_triage: llmTriage || null,
            llm_patch_author: llmPatchAuthor || null,
            diagnostic_result: diagnosticResult || null,
        };
        if (patchLike) {
            job.status = AUDIT_JOB_STATUS.WAITING_APPROVAL;
        } else {
            job.status = AUDIT_JOB_STATUS.COMPLETED;
            job.completed_at_ms = endTs;
            this._completed += 1;
        }
        job.updated_at_ms = endTs;
        job.history.push({ ts: endTs, event: 'done', status: job.status, step: job.current_step });
        this._persistJob(job);
        /** @type {unknown[]} */
        const findingsToPersist = Array.isArray(contextPack?.findings) ? [...contextPack.findings] : [];
        if (llmTriage?.ok) {
            findingsToPersist.push({
                severity: 'info',
                category: 'triage',
                title: 'Triage LLM executada via Inference Gateway',
                source: 'audit-agent-llm',
                dedup_key: `triage_llm:${job.id}:ok`,
                evidence: {
                    model: llmTriage.model || null,
                    profile_name: llmTriage.profile_name || null,
                    provider: llmTriage.provider || 'inference-gateway',
                    parsed: llmTriage.parsed || null,
                    raw_response: llmTriage.raw_response || null,
                },
            });
        } else if (llmTriage && !llmTriage.skipped) {
            findingsToPersist.push({
                severity: 'info',
                category: 'triage',
                title: 'Triage LLM não executada com sucesso (seguindo sem bloqueio)',
                source: 'audit-agent-llm',
                dedup_key: `triage_llm:${job.id}:fail`,
                evidence: llmTriage,
            });
        }
        if (llmPatchAuthor?.ok) {
            findingsToPersist.push({
                severity: 'info',
                category: 'patch_author',
                title: 'Patch author LLM executado via Inference Gateway',
                source: 'audit-agent-llm',
                dedup_key: `patch_author_llm:${job.id}:ok`,
                evidence: {
                    model: llmPatchAuthor.model || null,
                    profile_name: llmPatchAuthor.profile_name || null,
                    provider: llmPatchAuthor.provider || 'inference-gateway',
                    parsed: llmPatchAuthor.parsed || null,
                },
            });
        } else if (llmPatchAuthor && !llmPatchAuthor.skipped) {
            findingsToPersist.push({
                severity: 'info',
                category: 'patch_author',
                title: 'Patch author LLM nao executado com sucesso (seguindo sem bloqueio)',
                source: 'audit-agent-llm',
                dedup_key: `patch_author_llm:${job.id}:fail`,
                evidence: llmPatchAuthor,
            });
        }
        this._persistFindings(job.id, findingsToPersist);
        if (patchLike) {
            const defaultPatch = _derivePatchDraftFromContext(job, contextPack);
            /** @type {unknown[]} */
            const patches = [];
            if (
                llmPatchAuthor?.ok &&
                llmPatchAuthor.patch_proposal &&
                typeof llmPatchAuthor.patch_proposal === 'object'
            ) {
                patches.push(llmPatchAuthor.patch_proposal);
            }
            if (Array.isArray(contextPack?.patches) && contextPack.patches.length > 0) {
                patches.push(...contextPack.patches);
            }
            if (patches.length === 0) patches.push(defaultPatch);
            this._persistPatchProposals(job.id, patches);
        }
        this._persistRunFinish(job);
    }

    async tick() {
        if (this._tickInFlight) {
            return this.getMetrics();
        }
        this._tickInFlight = true;
        try {
            this._ticks += 1;
            const capacity = Math.max(0, this.maxConcurrentJobs - this._runningCount());
            if (capacity <= 0) return this.getMetrics();
            const queued = this._nextQueuedJobs().slice(0, capacity);
            for (const job of queued) {
                try {
                    await this._processJob(job);
                } catch (/** @type {any} */ error) {
                    this._failed += 1;
                    const ts = this.now();
                    job.status = AUDIT_JOB_STATUS.FAILED;
                    job.updated_at_ms = ts;
                    job.completed_at_ms = ts;
                    job.error_json = { message: error instanceof Error ? error.message : String(error) };
                    job.history.push({ ts, event: 'failed', status: job.status, error: job.error_json.message });
                    this._persistJob(job);
                    this._persistRunFinish(job);
                    this._log('WARN', '[audit-agent] job failed', { id: job.id, error: job.error_json.message });
                }
            }
            return this.getMetrics();
        } finally {
            this._tickInFlight = false;
        }
    }

    getMetrics() {
        const byStatus = /** @type {Record<string, number>} */ ({});
        for (const job of this.jobs.values()) {
            byStatus[job.status] = (byStatus[job.status] || 0) + 1;
        }
        return {
            ticks: this._ticks,
            jobs_total: this.jobs.size,
            jobs_completed: this._completed,
            jobs_failed: this._failed,
            running: this._runningCount(),
            byStatus,
            maxConcurrentJobs: this.maxConcurrentJobs,
        };
    }
}
