// @ts-check
import { createAuditJob, getAuditJobById, listAuditJobs, upsertAuditJobSnapshot } from '#infra/db/audit_job_repo';
import { createAuditJobRun, updateAuditJobRun } from '#infra/db/audit_job_run_repo';
import { upsertAuditFinding } from '#infra/db/audit_finding_repo';
import { createAuditPatchProposal } from '#infra/db/audit_patch_repo';

/**
 * Store persistente (SQLite) para snapshots de jobs e runs do Audit Agent.
 * É um sink incremental: o runtime em memória continua sendo fonte de execução na V0.
 */
export function createAuditAgentDbStore() {
    return {
        /**
         * @param {any} job
         */
        saveJob(job) {
            const existing = getAuditJobById(job?.id);
            if (!existing) {
                return createAuditJob(job);
            }
            return upsertAuditJobSnapshot(job);
        },
        /**
         * @param {any} job
         */
        onRunStart(job) {
            if (!job?.current_run_id) return null;
            try {
                return createAuditJobRun({
                    id: job.current_run_id,
                    job_id: job.id,
                    attempt_seq: job.attempt_seq,
                    status: job.status,
                    executor: 'audit-agent',
                    started_at_ms: job.updated_at_ms || job.started_at_ms || Date.now(),
                    metrics_json: { skeleton: true },
                });
            } catch {
                return null;
            }
        },
        /**
         * @param {any} job
         */
        onRunFinish(job) {
            if (!job?.current_run_id) return null;
            try {
                return updateAuditJobRun(job.current_run_id, {
                    status: job.status,
                    completed_at_ms: job.completed_at_ms ?? job.updated_at_ms ?? Date.now(),
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
         * @param {Array<any>} findings
         */
        saveFindings(jobId, findings = []) {
            const rows = [];
            for (const item of findings) {
                try {
                    rows.push(
                        upsertAuditFinding({
                            job_id: jobId,
                            severity: item.severity || 'info',
                            category: item.category || 'generic',
                            title: item.title || 'finding',
                            source: item.source || 'audit-agent',
                            contract_id: item.contract_id || null,
                            dedup_key: item.dedup_key || null,
                            status: item.status || 'open',
                            evidence: item.evidence || item.evidence_json || {},
                        })
                    );
                } catch {
                    // best effort per finding
                }
            }
            return rows;
        },
        /**
         * @param {string} jobId
         * @param {Array<any>} patches
         */
        savePatchProposals(jobId, patches = []) {
            const rows = [];
            for (const p of patches) {
                try {
                    rows.push(
                        createAuditPatchProposal({
                            job_id: jobId,
                            status: p.status || 'draft',
                            patch_unified_diff: p.patch_unified_diff || '',
                            patch_summary: p.patch_summary || {},
                            risk_score: p.risk_score ?? null,
                            dry_run_result_json: p.dry_run_result_json ?? null,
                            approval_required: p.approval_required !== false,
                            rollback_patch: p.rollback_patch || null,
                        })
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
