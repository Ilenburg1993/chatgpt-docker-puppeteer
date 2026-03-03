// @ts-check
/**
 * @typedef {'P0'|'P1'|'P2'|'P3'} Severity
 * @typedef {'novo'|'confirmado'|'patch-proposto'|'corrigido'|'validado'|'descartado'} FindingStatus
 * @typedef {'bug'|'gap'|'falha de contrato'|'incompletude'|'upgrade'} FindingType
 * @typedef {'baixo'|'medio'|'alto'} BlastRadius
 * @typedef {'off'|'warn'|'p1'|'p0'} EnforcementState
 * @typedef {'observability'|'reactive_bug'|'exploratory_bug'|'contracts'|'security'|'performance'|'architecture'} AuditMode
 *
 * @typedef {{
 *   cause: string,
 *   score: number,
 * }} RootCauseCandidate
 *
 * @typedef {{
 *   depth: 'basic'|'standard'|'deep',
 *   summary: string|null,
 *   suggested_diff: string|null,
 *   files_touched: string[],
 *   test_plan: string[],
 *   rollback_hint: string|null,
 *   validation_commands: string[],
 * }} FindingProposalV3
 *
 * @typedef {{
 *   code_context_used: boolean,
 *   rag_scope: string|null,
 *   lsp_signal_quality: 'high'|'medium'|'low'|null,
 * }} FindingProposalContextV31
 *
 * @typedef {object} AuditFindingV3
 * @property {string} id
 * @property {string|null} contract_id
 * @property {string|null} domain
 * @property {string|null} owner
 * @property {Severity} severity
 * @property {FindingStatus} status
 * @property {FindingType} type
 * @property {string} source_tool
 * @property {string|null} file
 * @property {number|null} line
 * @property {string} evidence
 * @property {string|null} impact
 * @property {string|null} root_cause
 * @property {RootCauseCandidate[]} root_cause_candidates
 * @property {string|null} suggested_patch
 * @property {string|null} test_strategy
 * @property {string|null} regression_risk
 * @property {string} fingerprint
 * @property {string} created_at
 * @property {string} updated_at
 * @property {number} confidence_score
 * @property {BlastRadius} blast_radius
 * @property {string|null} evidence_graph_id
 * @property {FindingProposalV3} proposal
 * @property {FindingProposalContextV31} proposal_context
 * @property {EnforcementState} enforcement_state
 * @property {'primary'|'backlog'} finding_channel
 * @property {boolean} [partial]
 *
 * @typedef {{
 *   phase: string,
 *   status: 'pending'|'running'|'completed'|'failed'|'skipped',
 *   started_at: string|null,
 *   finished_at: string|null,
 *   elapsed_ms: number,
 * }} PhaseStatusEntry
 *
 * @typedef {{
 *   enabled: boolean,
 *   profile: 'off'|'light'|'full',
 *   scenarios_executed: number,
 *   violations: number,
 * }} ChaosSummary
 *
 * @typedef {object} AuditRunV3
 * @property {'3.2'} schema_version
 * @property {string} run_id
 * @property {'quick'|'deep'|'nightly'} profile
 * @property {AuditMode} audit_mode
 * @property {string} scope
 * @property {string} focus_area
 * @property {string} focus_mode
 * @property {string} contracts_mode
 * @property {string} enforce_level
 * @property {string} proposal_depth
 * @property {string} started_at
 * @property {string} finished_at
 * @property {Record<string,string>} tool_versions
 * @property {{ total_findings: number, total_primary: number, total_backlog: number, by_severity: Record<string,number>, by_status: Record<string,number>, partial: boolean }} summary
 * @property {{ steps_done: number, steps_total: number, progress_pct: number, remaining_steps: number }} progress
 * @property {{ eta_ms: number, eta_confidence: number, model: string, eta_error_ms?: number|null, confidence_reason?: string }} eta
 * @property {'success'|'partial'|'aborted'|'fatal'} run_outcome
 * @property {'signal'|'uncaught_exception'|'unhandled_rejection'|'manual'|'none'} abort_reason
 * @property {number} duration_ms_total
 * @property {string[]} remaining_step_keys
 * @property {{ active_phases: string[], skipped_phases: string[] }} collector_plan
 * @property {PhaseStatusEntry[]} phase_status
 * @property {{
 *   mcp: { ok: boolean, details?: string },
 *   rag: { ok: boolean, available?: boolean|null, degraded?: boolean|null },
 *   lsp: { ok: boolean, details?: string },
 * }} telemetry
 * @property {{
 *   ok: boolean,
 *   components: {
 *     pm2: { ok: boolean, details?: string },
 *     mcp: { ok: boolean, details?: string },
 *     rag: { ok: boolean, details?: string },
 *     lsp: { ok: boolean, details?: string },
 *   },
 *   issues: string[],
 * }} semantic_preflight
 * @property {{
 *   enabled: boolean,
 *   would_block: boolean,
 *   blocking_findings: string[],
 *   reason: string,
 * }} shadow_gate
 * @property {{
 *   ignored_warning_lines: number,
 *   normalized_warnings: number,
 * }} telemetry_noise
 * @property {{
 *   stdout_bytes_total: number,
 *   stderr_bytes_total: number,
 *   stdout_truncated_steps: string[],
 *   stderr_truncated_steps: string[],
 *   steps_with_overflow: number,
 *   max_stdout_bytes: number,
 *   max_stderr_bytes: number,
 * }} log_stats
 * @property {{
 *   mcp_degraded: boolean,
 *   rag_degraded: boolean,
 *   lsp_degraded: boolean,
 *   tooling_degraded: boolean,
 * }} degradation
 * @property {{
 *   forbidden_ok: boolean|null,
 *   typecheck_ok: boolean|null,
 *   node_check_ok?: boolean|null,
 *   entrypoint_import_smoke_ok?: boolean|null,
 *   lint_ok?: boolean|null,
 *   typecheck_node_ok?: boolean|null,
 *   typecheck_browser_ok?: boolean|null,
 *   prettier_ok?: boolean|null,
 *   jsdoc_delta_ok?: boolean|null,
 *   jsdoc_full_ok?: boolean|null,
 *   ts_ignore_ok?: boolean|null,
 *   runtime_smoke_ok: boolean|null,
 *   tests_ok: boolean|null,
 * }} quality_gates
 * @property {{
 *   strategy?: string,
 *   risk?: string,
 *   changed_files_count?: number,
 *   decision_reasons?: string[],
 *   fallbacks?: string[],
 *   steps_executed?: string[],
 *   steps_skipped?: Array<{step:string,reason:string}>,
 *   duration_ms_by_step?: Record<string,number>,
 *   impact?: Record<string, boolean|number|string|null>,
 *   jsdoc?: Record<string, boolean|number|string|null>,
 *   cache?: Record<string, unknown>,
 *   parallelism?: Record<string, unknown>,
 *   dedup?: Record<string, number>,
 * }} [quality_execution]
 * @property {{
 *   enabled: boolean,
 *   findings: number,
 *   contracts_scanned?: number,
 *   files_scanned?: number,
 *   checks: string[],
 * }} [security_execution]
 * @property {{
 *   enabled: boolean,
 *   findings: number,
 *   score: number|null,
 *   categories: Record<string, number>,
 * }} [performance_execution]
 * @property {Record<string, { total: number, violated: number, covered: number, covered_by_run?: number, covered_by_tests?: number }>} contract_coverage
 * @property {{ stale_contracts: string[], unowned_critical: string[], tests_without_contract: string[] }} contract_drift
 * @property {{ enforce_level: string, blocking: boolean, blocking_findings: string[] }} gate_decision
 * @property {ChaosSummary} chaos_summary
 * @property {{
 *   run_dir: string,
 *   events_jsonl: string,
 *   progress_json: string,
 *   phase_timeline_json: string,
 *   findings_raw_json: string,
 *   findings_normalized_json: string,
 *   proposals_json: string,
 *   audit_report_json: string,
 *   summary_md: string,
 *   contract_registry_snapshot_json: string,
 *   semantic_preflight_json?: string,
 *   log_stats_json?: string,
 *   contract_coverage_json: string,
 *   contract_drift_json: string,
 *   contract_parity_json?: string,
 *   evidence_graph_json: string,
 *   gate_decisions_json: string,
 *   chaos_events_jsonl: string,
 * }} artifacts
 * @property {AuditFindingV3[]} findings
 * @property {AuditFindingV3[]} primary_findings
 * @property {AuditFindingV3[]} backlog_findings
 * @property {Array<{ source: string, message: string }>} errors
 * @property {Array<{ source: string, message: string }>} warnings
 * @property {number} [errors_count]
 * @property {number} [warnings_count]
 */

export const SCHEMA_VERSION = /** @type {'3.2'} */ ('3.2');
/** Severidades canônicas aceitas no schema de findings da auditoria. */
export const SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
/** Estados de ciclo de vida suportados para findings no tracker/report. */
export const FINDING_STATUS = Object.freeze([
    'novo',
    'confirmado',
    'patch-proposto',
    'corrigido',
    'validado',
    'descartado',
]);
/** Tipos canônicos de finding usados no pipeline de auditoria. */
export const FINDING_TYPES = Object.freeze(['bug', 'gap', 'falha de contrato', 'incompletude', 'upgrade']);
/** Classificação de blast radius exibida em findings normalizados. */
export const BLAST_RADIUS = Object.freeze(['baixo', 'medio', 'alto']);
/** Níveis de enforcement reconhecidos pelos gates/contratos v3. */
export const ENFORCE_LEVELS = Object.freeze(['off', 'warn', 'p1', 'p0']);
/** Profundidades suportadas para geração de propostas/diffs automáticos. */
export const PROPOSAL_DEPTHS = Object.freeze(['basic', 'standard', 'deep']);
/** Resultados terminais possíveis do runner de auditoria. */
export const RUN_OUTCOMES = Object.freeze(['success', 'partial', 'aborted', 'fatal']);
/** Motivos canônicos de aborto/finalização antecipada do runner. */
export const ABORT_REASONS = Object.freeze(['signal', 'uncaught_exception', 'unhandled_rejection', 'manual', 'none']);

/**
 * @param {Partial<AuditRunV3>} run
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateAuditRun(run) {
    /** @type {string[]} */
    const errors = [];

    if (!run || typeof run !== 'object') {
        return { ok: false, errors: ['run must be an object'] };
    }

    if (run.schema_version !== SCHEMA_VERSION) errors.push('schema_version must be 3.2');
    if (!run.run_id) errors.push('run_id is required');
    if (!run.profile) errors.push('profile is required');
    if (!run.audit_mode) errors.push('audit_mode is required');
    if (!run.scope) errors.push('scope is required');
    if (!run.focus_area) errors.push('focus_area is required');
    if (!run.focus_mode) errors.push('focus_mode is required');
    if (!run.contracts_mode) errors.push('contracts_mode is required');
    if (!run.enforce_level) errors.push('enforce_level is required');
    if (!run.proposal_depth) errors.push('proposal_depth is required');
    if (!run.started_at) errors.push('started_at is required');
    if (!run.finished_at) errors.push('finished_at is required');
    if (!Array.isArray(run.findings)) errors.push('findings must be an array');
    if (!Array.isArray(run.primary_findings)) errors.push('primary_findings must be an array');
    if (!Array.isArray(run.backlog_findings)) errors.push('backlog_findings must be an array');
    if (!Array.isArray(run.errors)) errors.push('errors must be an array');
    if (!Array.isArray(run.warnings)) errors.push('warnings must be an array');
    if (run.errors_count != null && typeof run.errors_count !== 'number') errors.push('errors_count must be a number');
    if (run.warnings_count != null && typeof run.warnings_count !== 'number')
        errors.push('warnings_count must be a number');
    if (!Array.isArray(run.phase_status)) errors.push('phase_status must be an array');
    if (!run.contract_coverage || typeof run.contract_coverage !== 'object')
        errors.push('contract_coverage is required');
    if (!run.contract_drift || typeof run.contract_drift !== 'object') errors.push('contract_drift is required');
    if (!run.gate_decision || typeof run.gate_decision !== 'object') errors.push('gate_decision is required');
    if (!run.chaos_summary || typeof run.chaos_summary !== 'object') errors.push('chaos_summary is required');
    if (!run.semantic_preflight || typeof run.semantic_preflight !== 'object')
        errors.push('semantic_preflight is required');
    if (!run.shadow_gate || typeof run.shadow_gate !== 'object') errors.push('shadow_gate is required');
    if (!run.telemetry_noise || typeof run.telemetry_noise !== 'object') errors.push('telemetry_noise is required');
    if (!run.log_stats || typeof run.log_stats !== 'object') errors.push('log_stats is required');
    if (!run.run_outcome) errors.push('run_outcome is required');
    if (!run.abort_reason) errors.push('abort_reason is required');
    if (run.run_outcome && !RUN_OUTCOMES.includes(run.run_outcome)) errors.push('run_outcome invalid');
    if (run.abort_reason && !ABORT_REASONS.includes(run.abort_reason)) errors.push('abort_reason invalid');
    if (typeof run.duration_ms_total !== 'number') errors.push('duration_ms_total is required');
    if (!Array.isArray(run.remaining_step_keys)) errors.push('remaining_step_keys must be an array');
    if (!run.collector_plan || typeof run.collector_plan !== 'object') errors.push('collector_plan is required');

    if (Array.isArray(run.findings)) {
        run.findings.forEach((finding, index) => {
            if (!finding?.id) errors.push(`findings[${index}].id is required`);
            if (!SEVERITIES.includes(finding?.severity)) errors.push(`findings[${index}].severity invalid`);
            if (!FINDING_STATUS.includes(finding?.status)) errors.push(`findings[${index}].status invalid`);
            if (!FINDING_TYPES.includes(finding?.type)) errors.push(`findings[${index}].type invalid`);
            if (!finding?.source_tool) errors.push(`findings[${index}].source_tool is required`);
            if (!finding?.evidence) errors.push(`findings[${index}].evidence is required`);
            if (!finding?.fingerprint) errors.push(`findings[${index}].fingerprint is required`);
            if (!finding?.created_at) errors.push(`findings[${index}].created_at is required`);
            if (!finding?.updated_at) errors.push(`findings[${index}].updated_at is required`);
            if (typeof finding?.confidence_score !== 'number')
                errors.push(`findings[${index}].confidence_score is required`);
            if (!BLAST_RADIUS.includes(finding?.blast_radius)) errors.push(`findings[${index}].blast_radius invalid`);
            if (!finding?.proposal || typeof finding.proposal !== 'object')
                errors.push(`findings[${index}].proposal is required`);
            if (!finding?.proposal_context || typeof finding.proposal_context !== 'object')
                errors.push(`findings[${index}].proposal_context is required`);
            if (!['primary', 'backlog'].includes(finding?.finding_channel))
                errors.push(`findings[${index}].finding_channel invalid`);
            if (!ENFORCE_LEVELS.includes(finding?.enforcement_state))
                errors.push(`findings[${index}].enforcement_state invalid`);
            if (!Array.isArray(finding?.root_cause_candidates))
                errors.push(`findings[${index}].root_cause_candidates must be an array`);
            if (!PROPOSAL_DEPTHS.includes(finding?.proposal?.depth))
                errors.push(`findings[${index}].proposal.depth invalid`);
            if (!Array.isArray(finding?.proposal?.validation_commands))
                errors.push(`findings[${index}].proposal.validation_commands must be an array`);
        });
    }

    return { ok: errors.length === 0, errors };
}
