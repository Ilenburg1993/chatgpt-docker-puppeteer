import fs from 'node:fs';
import path from 'node:path';

const MARKER_START = '<!-- AUDIT_AUTOMATION_V3_START -->';
const MARKER_END = '<!-- AUDIT_AUTOMATION_V3_END -->';
const PLAN_PATH = 'DOCUMENTAÇÃO/AUDITORIAS/BUGS/PLANO_MESTRE_CONTRATOS_V3.md';

/**
 * @param {import('./lib/schema.mjs').AuditRunV3} report
 */
function topModules(report) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const finding of report.primary_findings) {
        if (!finding.file) continue;
        const token = finding.file.replace(/\\/g, '/').split('/').slice(0, 2).join('/');
        counts.set(token, (counts.get(token) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([module, count]) => ({ module, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
}

/**
 * @param {Record<string, { total: number, violated: number, covered: number, covered_by_run?: number, covered_by_tests?: number }>} coverage
 */
function coverageLines(coverage) {
    const domains = Object.keys(coverage || {}).sort();
    if (domains.length === 0) {
        return '- Sem cobertura de contrato registrada.';
    }
    return domains
        .map(domain => {
            const item = coverage[domain] || {
                total: 0,
                violated: 0,
                covered: 0,
                covered_by_run: 0,
                covered_by_tests: 0,
            };
            const coveredByRun = Number.isFinite(item.covered_by_run) ? item.covered_by_run : item.covered;
            const coveredByTests = Number.isFinite(item.covered_by_tests) ? item.covered_by_tests : 0;
            return `- ${domain}: total=${item.total}, cobertos_run=${coveredByRun}, cobertos_testes=${coveredByTests}, violados=${item.violated}`;
        })
        .join('\n');
}

/**
 * @param {import('./lib/schema.mjs').AuditRunV3} report
 */
function findingLines(report) {
    const primary = report.primary_findings.slice(0, 50).map(item => {
        const location = item.file ? `${item.file}${item.line ? `:${item.line}` : ''}` : 'n/a';
        return [
            `- ${item.id} | ${item.severity} | ${item.type} | ${item.contract_id || item.source_tool} | ${location}`,
            `  - Evidência: ${item.evidence}`,
            `  - Proposta: ${item.proposal?.summary || item.suggested_patch || 'n/a'}`,
        ].join('\n');
    });
    const backlog = report.backlog_findings.slice(0, 30).map(item => {
        const location = item.file ? `${item.file}${item.line ? `:${item.line}` : ''}` : 'n/a';
        return `- ${item.id} | ${item.severity} | ${item.type} | ${item.contract_id || item.source_tool} | ${location}`;
    });
    return {
        primary: primary.length > 0 ? primary.join('\n') : '- Nenhum P0/P1 ativo.',
        backlog: backlog.length > 0 ? backlog.join('\n') : '- Nenhum backlog técnico.',
    };
}

/**
 * @param {import('./lib/schema.mjs').AuditRunV3} report
 */
function buildAutomationSection(report) {
    const modules = topModules(report);
    const findings = findingLines(report);
    const modulesText =
        modules.length > 0
            ? modules.map(item => `- ${item.module}: ${item.count}`).join('\n')
            : '- Sem concentração de risco.';
    const staleContracts = report.contract_drift.stale_contracts || [];
    const unowned = report.contract_drift.unowned_critical || [];
    const testsWithoutContract = report.contract_drift.tests_without_contract || [];

    return [
        MARKER_START,
        '## Automação Audit v3.2 (Auto-gerado)',
        '',
        `- schema_version: ${report.schema_version}`,
        `- run_id: ${report.run_id}`,
        `- profile: ${report.profile}`,
        `- audit_mode: ${report.audit_mode}`,
        `- focus_mode: ${report.focus_mode}`,
        `- focus_area: ${report.focus_area}`,
        `- contracts_mode: ${report.contracts_mode}`,
        `- enforce_level: ${report.enforce_level}`,
        `- proposal_depth: ${report.proposal_depth}`,
        `- run_outcome: ${report.run_outcome}`,
        `- abort_reason: ${report.abort_reason}`,
        `- partial: ${report.summary.partial}`,
        `- duration_ms_total: ${report.duration_ms_total}`,
        `- total_findings: ${report.summary.total_findings}`,
        `- total_primary: ${report.summary.total_primary}`,
        `- total_backlog: ${report.summary.total_backlog}`,
        `- errors_count: ${report.errors_count ?? report.errors.length}`,
        `- warnings_count: ${report.warnings_count ?? report.warnings.length}`,
        `- plano_canônico: \`${PLAN_PATH}\``,
        '',
        '### Progresso e ETA',
        `- progress: ${report.progress.progress_pct}% (${report.progress.steps_done}/${report.progress.steps_total})`,
        `- remaining_steps: ${report.progress.remaining_steps}`,
        `- remaining_step_keys: ${(report.remaining_step_keys || []).slice(0, 8).join(', ') || 'none'}`,
        `- eta_ms: ${report.eta.eta_ms}`,
        `- eta_error_ms: ${report.eta?.eta_error_ms ?? 'n/a'}`,
        `- eta_confidence_reason: ${report.eta?.confidence_reason || 'n/a'}`,
        '',
        '### Telemetria',
        `- MCP: ${report.telemetry.mcp.ok ? 'OK' : 'FAIL'} (${report.telemetry.mcp.details || 'n/a'})`,
        `- RAG: ${report.telemetry.rag.ok ? 'OK' : 'FAIL'} (available=${String(report.telemetry.rag.available)} degraded=${String(report.telemetry.rag.degraded)})`,
        `- LSP: ${report.telemetry.lsp.ok ? 'OK' : 'WARN'} (${report.telemetry.lsp.details || 'n/a'})`,
        `- Semantic Preflight: ${report.semantic_preflight?.ok ? 'OK' : 'FAIL'} (issues=${(report.semantic_preflight?.issues || []).length})`,
        `- Shadow Gate Would Block: ${report.shadow_gate?.would_block === true}`,
        `- Telemetry Noise: ignored_warning_lines=${report.telemetry_noise?.ignored_warning_lines || 0}`,
        `- Log Stats: stdout_bytes=${report.log_stats?.stdout_bytes_total || 0} stderr_bytes=${report.log_stats?.stderr_bytes_total || 0} overflow_steps=${report.log_stats?.steps_with_overflow || 0}`,
        `- Collector Plan: active=${(report.collector_plan?.active_phases || []).join(', ') || 'none'} skipped=${(report.collector_plan?.skipped_phases || []).join(', ') || 'none'}`,
        '',
        '### Gate Decision',
        `- blocking: ${report.gate_decision.blocking}`,
        `- enforce_level: ${report.gate_decision.enforce_level}`,
        `- blocking_findings: ${report.gate_decision.blocking_findings.length}`,
        '',
        '### Chaos Summary',
        `- enabled: ${report.chaos_summary.enabled}`,
        `- profile: ${report.chaos_summary.profile}`,
        `- scenarios_executed: ${report.chaos_summary.scenarios_executed}`,
        `- violations: ${report.chaos_summary.violations}`,
        '',
        '### Security / Performance',
        `- security_enabled: ${report.security_execution?.enabled === true}`,
        `- security_findings: ${report.security_execution?.findings || 0}`,
        `- performance_enabled: ${report.performance_execution?.enabled === true}`,
        `- performance_score: ${report.performance_execution?.score ?? 'n/a'}`,
        '',
        '### Contract Coverage',
        coverageLines(report.contract_coverage),
        '',
        '### Contract Drift',
        `- stale_contracts: ${staleContracts.length}`,
        `- unowned_critical: ${unowned.length}`,
        `- tests_without_contract: ${testsWithoutContract.length}`,
        '',
        '### Top módulos críticos',
        modulesText,
        '',
        '### P0/P1 Ativos (Bug/GAP/Contrato)',
        findings.primary,
        '',
        '### Backlog técnico P2/P3',
        findings.backlog,
        '',
        MARKER_END,
        '',
    ].join('\n');
}

/**
 * @param {string} content
 * @param {string} section
 */
function upsert(content, section) {
    const start = content.indexOf(MARKER_START);
    const end = content.indexOf(MARKER_END);
    if (start !== -1 && end !== -1 && end > start) {
        const before = content.slice(0, start).trimEnd();
        const after = content.slice(end + MARKER_END.length).trimStart();
        return `${before}\n\n${section}\n${after}`.trimEnd() + '\n';
    }
    return `${content.trimEnd()}\n\n${section}`.trimEnd() + '\n';
}

/**
 * @param {{ masterPath: string }} options
 */
function ensureMaster(options) {
    if (fs.existsSync(options.masterPath)) {
        return;
    }
    fs.mkdirSync(path.dirname(options.masterPath), { recursive: true });
    fs.writeFileSync(
        options.masterPath,
        [
            '# BUG_AUDIT_MASTER',
            '',
            '- Ultima atualizacao: n/a',
            '- Rodada: n/a',
            '- Escopo: auditoria automatizada v3.2',
            '- Modo de entrega: automacao bug-first + contract-system',
            '',
            '## Taxonomia',
            '- Severidade: `P0`, `P1`, `P2`, `P3`',
            '- Status: `novo`, `confirmado`, `patch-proposto`, `corrigido`, `validado`, `descartado`',
            '- Tipo: `bug`, `gap`, `falha de contrato`, `incompletude`, `upgrade`',
            '',
            '## Changelog do Arquivo',
            '',
        ].join('\n'),
        'utf8'
    );
}

/**
 * @param {import('./lib/schema.mjs').AuditRunV3} report
 * @param {{ masterPath: string }} options
 * @returns {{ path: string }}
 */
export function publishMasterMarkdown(report, options) {
    ensureMaster(options);
    const current = fs.readFileSync(options.masterPath, 'utf8');
    const section = buildAutomationSection(report);
    let next = upsert(current, section);

    const changelog = `- ${new Date().toISOString()}: execução ${report.run_id} (${report.profile}) findings=${report.summary.total_findings} primary=${report.summary.total_primary} blocking=${report.gate_decision.blocking}.`;
    const header = '## Changelog do Arquivo';
    if (next.includes(header)) {
        const idx = next.indexOf(header);
        const before = next.slice(0, idx + header.length);
        const after = next.slice(idx + header.length).trimStart();
        next = `${before}\n${changelog}\n\n${after}`;
    } else {
        next += `\n## Changelog do Arquivo\n${changelog}\n`;
    }

    next = next.replace(/- Ultima atualizacao: .*/g, `- Ultima atualizacao: ${new Date().toISOString()}`);
    next = next.replace(/- Rodada: .*/g, `- Rodada: ${report.run_id}`);

    fs.writeFileSync(options.masterPath, next, 'utf8');
    return { path: options.masterPath };
}
