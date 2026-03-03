// @ts-check
/**
 * @param {{ runId: string, profile: string, progress: unknown, eta: unknown, phase: string, message: string }} payload
  * @returns {void}
 */
export function printProgress(payload) {
    const pct = Number(payload.progress?.progress_pct || 0).toFixed(2);
    const remaining = payload.progress?.remaining_steps ?? 0;
    const etaSec = Math.max(0, Math.round((payload.eta?.eta_ms || 0) / 1000));
    const activeStep = payload.progress?.step_id ? String(payload.progress.step_id) : null;
    const activeText = activeStep ? ` ativo=${activeStep}` : '';
    const remainingKeys = Array.isArray(payload.progress?.remaining_step_keys)
        ? payload.progress.remaining_step_keys.slice(0, 4).join(', ')
        : '';
    const pendingText = remainingKeys ? ` pendentes=[${remainingKeys}]` : '';
    console.log(
        `[audit][${payload.profile}] ${pct}% fase=${payload.phase} restantes=${remaining} eta=${etaSec}s${activeText}${pendingText} ${payload.message}`
    );
}

/**
 * @param {import('../lib/schema.mjs').AuditRunV3} report
 * @param {{ jsonPath: string, masterPath?: string|null, snapshotPath?: string|null }} outputs
  * @returns {void}
 */
export function printFinalReport(report, outputs) {
    console.log('=== Audit Automation Report v3.2 ===');
    console.log(`run_id: ${report.run_id}`);
    console.log(`profile: ${report.profile}`);
    console.log(`audit_mode: ${report.audit_mode}`);
    console.log(`focus: ${report.focus_mode}`);
    console.log(`focus_area: ${report.focus_area}`);
    console.log(`contracts_mode: ${report.contracts_mode}`);
    console.log(`enforce_level: ${report.enforce_level}`);
    console.log(`proposal_depth: ${report.proposal_depth}`);
    console.log(`findings(total): ${report.summary.total_findings}`);
    console.log(`findings(primary): ${report.summary.total_primary}`);
    console.log(`findings(backlog): ${report.summary.total_backlog}`);
    console.log(`errors(count): ${report.errors_count ?? report.errors?.length ?? 0}`);
    console.log(`warnings(count): ${report.warnings_count ?? report.warnings?.length ?? 0}`);
    console.log(`partial: ${report.summary.partial}`);
    console.log(`run_outcome: ${report.run_outcome}`);
    console.log(`abort_reason: ${report.abort_reason}`);
    console.log(`duration_ms_total: ${report.duration_ms_total}`);
    console.log(`progress: ${report.progress.progress_pct}%`);
    console.log(`eta_ms(final): ${report.eta.eta_ms}`);
    console.log(`eta_error_ms: ${report.eta.eta_error_ms ?? 'n/a'}`);
    console.log(`MCP: ${report.telemetry.mcp.ok ? 'OK' : 'FAIL'}`);
    console.log(`RAG: ${report.telemetry.rag.ok ? 'OK' : 'FAIL'}`);
    console.log(`LSP: ${report.telemetry.lsp.ok ? 'OK' : 'WARN'}`);
    console.log(`semantic_preflight_ok: ${report.semantic_preflight?.ok === true}`);
    console.log(`shadow_would_block: ${report.shadow_gate?.would_block === true}`);
    console.log(`security_enabled: ${report.security_execution?.enabled === true}`);
    console.log(`security_findings: ${report.security_execution?.findings || 0}`);
    console.log(`performance_enabled: ${report.performance_execution?.enabled === true}`);
    console.log(`performance_score: ${report.performance_execution?.score ?? 'n/a'}`);
    console.log(`gate_blocking: ${report.gate_decision.blocking}`);
    console.log(`chaos_enabled: ${report.chaos_summary.enabled}`);
    console.log(`chaos_violations: ${report.chaos_summary.violations}`);
    console.log(`json: ${outputs.jsonPath}`);
    if (outputs.masterPath) console.log(`master: ${outputs.masterPath}`);
    if (outputs.snapshotPath) console.log(`snapshot: ${outputs.snapshotPath}`);
}
