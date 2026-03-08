// @ts-check
import { upsertAuditFinding } from '#infra/db/audit_finding_repo';
import { createAuditJob, getAuditJobById, listAuditJobs, upsertAuditJobSnapshot } from '#infra/db/audit_job_repo';
import { createAuditJobRun, updateAuditJobRun } from '#infra/db/audit_job_run_repo';
import { createAuditPatchProposal } from '#infra/db/audit_patch_repo';

/**
 * @typedef {object} AuditAgentDbStore
 * @property {(job: Record<string, unknown>) => unknown} saveJob
 * @property {(job: Record<string, unknown>) => unknown} onRunStart
 * @property {(job: Record<string, unknown>) => unknown} onRunFinish
 * @property {(jobId: string, findings?: Record<string, unknown>[]) => unknown[]} saveFindings
 * @property {(jobId: string, patches?: Record<string, unknown>[]) => unknown[]} savePatchProposals
 * @property {typeof listAuditJobs} listJobs
 * @property {typeof getAuditJobById} getJobById
 */

/**
 * Store persistente (SQLite) para snapshots de jobs e runs do Audit Agent. É um sink incremental: o runtime em memória
 * continua sendo fonte de execução na V0.
 *
 * @returns {AuditAgentDbStore}
 */
export function createAuditAgentDbStore() {
    return {
        /**
         * @param {Record<string, unknown>} job
         */
        saveJob(job) {
            const existing = getAuditJobById(String(job?.id || ''));
            if (!existing) {
                return createAuditJob(/** @type {any} */ (job));
            }
            return upsertAuditJobSnapshot(/** @type {any} */ (job));
        },
        /**
         * @param {Record<string, unknown>} job
         */
        onRunStart(job) {
            if (!job?.current_run_id) return null;
            try {
                return createAuditJobRun({
                    id: String(job.current_run_id),
                    job_id: String(job.id || ''),
                    attempt_seq: Number(job.attempt_seq) || undefined,
                    status: String(job.status || ''),
                    executor: 'audit-agent',
                    started_at_ms: Number(job.updated_at_ms || job.started_at_ms) || Date.now(),
                    metrics_json: { skeleton: true },
                });
            } catch {
                return null;
            }
        },
        /**
         * @param {Record<string, unknown>} job
         */
        onRunFinish(job) {
            if (!job?.current_run_id) return null;
            try {
                return updateAuditJobRun(String(job.current_run_id), {
                    status: String(job.status || ''),
                    completed_at_ms: Number(job.completed_at_ms ?? job.updated_at_ms) || Date.now(),
                    metrics_json: {
                        skeleton: true,
                        current_step: job.current_step || null,
                    },
                    error_json: job.error_json ?? null,
                });
            } catch {
                return null;
            }
        },
        /**
         * @param {string} jobId
         * @param {Record<string, unknown>[]} [findings=[]] Default is `[]`
         */
        saveFindings(jobId, findings = []) {
            const rows = [];
            for (const item of findings) {
                try {
                    rows.push(
                        upsertAuditFinding({
                            job_id: jobId,
                            severity: String(item.severity || 'info'),
                            category: String(item.category || 'generic'),
                            title: String(item.title || 'finding'),
                            source: String(item.source || 'audit-agent'),
                            contract_id: item.contract_id ? String(item.contract_id) : undefined,
                            dedup_key: item.dedup_key ? String(item.dedup_key) : undefined,
                            status: String(item.status || 'open'),
                            evidence: item.evidence || item.evidence_json || {},
                        }),
                    );
                } catch {
                    // best effort per finding
                }
            }
            return rows;
        },
        /**
         * @param {string} jobId
         * @param {Record<string, unknown>[]} [patches=[]] Default is `[]`
         */
        savePatchProposals(jobId, patches = []) {
            const rows = [];
            for (const p of patches) {
                try {
                    rows.push(
                        createAuditPatchProposal({
                            job_id: jobId,
                            status: String(p.status || 'draft'),
                            patch_unified_diff: String(p.patch_unified_diff || ''),
                            patch_summary: p.patch_summary || {},
                            risk_score: p.risk_score != null ? Number(p.risk_score) : null,
                            dry_run_result_json: p.dry_run_result_json ?? null,
                            approval_required: p.approval_required !== false,
                            rollback_patch: p.rollback_patch ? String(p.rollback_patch) : undefined,
                        }),
                    );
                } catch {
                    // best effort per patch
                }
            }
            return rows;
        },
        listJobs: listAuditJobs,
        getJobById: getAuditJobById,
    };
}
