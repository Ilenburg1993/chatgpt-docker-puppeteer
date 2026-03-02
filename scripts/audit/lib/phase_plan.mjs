import { AUDIT_PHASES } from './event_types.mjs';

/**
 * @param {{
 *   profile: 'quick'|'deep'|'nightly',
 *   refreshContextMode: 'smart'|'force'|'skip',
 *   auditMode?: 'observability'|'reactive_bug'|'exploratory_bug'|'contracts'|'security'|'performance'|'architecture'
 * }} options
 */
export function buildPhasePlan(options) {
    const phases = [];
    const auditMode = options.auditMode || 'reactive_bug';
    const includeStatic = ['reactive_bug', 'exploratory_bug', 'contracts', 'security', 'architecture'].includes(
        auditMode
    );
    const includeRuntime = [
        'observability',
        'reactive_bug',
        'exploratory_bug',
        'security',
        'performance',
        'architecture',
    ].includes(auditMode);
    const includeTests = ['observability', 'reactive_bug', 'exploratory_bug', 'security', 'performance'].includes(
        auditMode
    );
    const includeChaos =
        options.profile === 'nightly' &&
        ['exploratory_bug', 'reactive_bug', 'security', 'performance'].includes(auditMode);
    const includeSecurity = auditMode === 'security';
    const includePerformance = ['exploratory_bug', 'performance'].includes(auditMode);
    const includeArchitecture = ['exploratory_bug', 'performance', 'architecture'].includes(auditMode);
    const includeNormalize = true;
    const includeTriage = ['reactive_bug', 'exploratory_bug', 'security', 'performance'].includes(auditMode);

    phases.push({
        id: AUDIT_PHASES.PREFLIGHT,
        planned_steps: [
            'preflight.node_version',
            'preflight.npm_version',
            'preflight.git_version',
            'preflight.semantic_preflight',
            'preflight.contract_registry',
            'preflight.contract_parity',
        ],
    });

    if (
        options.profile === 'nightly' ||
        options.refreshContextMode === 'force' ||
        options.refreshContextMode === 'skip'
    ) {
        phases.push({
            id: AUDIT_PHASES.CONTEXT_REFRESH,
            planned_steps: ['context.rag_health', 'context.rag_index_core', 'context.rag_index_docs'],
        });
    }

    phases.push({
        id: AUDIT_PHASES.COLLECT_QUALITY,
        planned_steps:
            options.profile === 'quick'
                ? [
                      'quality.plan_resolution',
                      'quality.fallback_resolution',
                      'quality.node_check',
                      'quality.entrypoint_import_smoke',
                      'quality.lint',
                      'quality.typecheck_node',
                      'quality.typecheck_browser',
                      'quality.prettier_check',
                      'quality.jsdoc_delta',
                      'quality.ts_ignore_scan',
                  ]
                : [
                      'quality.plan_resolution',
                      'quality.fallback_resolution',
                      'quality.node_check',
                      'quality.entrypoint_import_smoke',
                      'quality.lint',
                      'quality.typecheck_node',
                      'quality.typecheck_browser',
                      'quality.prettier_check',
                      'quality.jsdoc_full',
                      'quality.ts_ignore_scan',
                  ],
    });

    phases.push({
        id: AUDIT_PHASES.COLLECT_STATIC,
        planned_steps: includeStatic
            ? options.profile === 'quick'
                ? ['static.syntax', 'static.forbidden']
                : [
                      'static.forbidden',
                      'static.lint',
                      'static.typecheck',
                      'static.madge',
                      'static.depcruise',
                      'static.jscpd',
                      'static.semgrep',
                  ]
            : [],
    });

    phases.push({
        id: AUDIT_PHASES.COLLECT_RUNTIME,
        planned_steps: includeRuntime
            ? [
                  'runtime.mcp_diagnose',
                  'runtime.rag_health',
                  'runtime.lsp_health',
                  ...(options.profile === 'quick' ? [] : ['runtime.smoke']),
              ]
            : [],
    });

    phases.push({
        id: AUDIT_PHASES.COLLECT_TESTS,
        planned_steps: !includeTests
            ? []
            : options.profile === 'quick'
              ? ['tests.smoke']
              : options.profile === 'deep'
                ? ['tests.unit']
                : ['tests.unit', 'tests.integration', 'tests.regression'],
    });

    phases.push({
        id: AUDIT_PHASES.COLLECT_CHAOS,
        planned_steps: includeChaos ? ['chaos.contract_nightly'] : [],
    });

    phases.push({
        id: AUDIT_PHASES.COLLECT_SECURITY,
        planned_steps: includeSecurity ? ['security.contracts', 'security.http_surface', 'security.headers'] : [],
    });

    phases.push({
        id: AUDIT_PHASES.COLLECT_PERFORMANCE,
        planned_steps: includePerformance ? ['performance.analysis'] : [],
    });

    phases.push({
        id: AUDIT_PHASES.COLLECT_ARCHITECTURE,
        planned_steps: includeArchitecture ? ['architecture.analysis'] : [],
    });

    phases.push({
        id: AUDIT_PHASES.NORMALIZE_CORRELATE,
        planned_steps: includeNormalize ? ['normalize.findings', 'normalize.evidence_graph'] : [],
    });
    phases.push({ id: AUDIT_PHASES.TRIAGE_INTELLIGENCE, planned_steps: includeTriage ? ['triage.enrich'] : [] });
    phases.push({
        id: AUDIT_PHASES.PUBLISH,
        planned_steps: ['publish.json', 'publish.master', 'publish.snapshot', 'publish.contract_reports'],
    });

    return phases;
}

/**
 * @param {Array<{ id: string, planned_steps: string[] }>} phases
 */
export function flattenPlannedStepKeys(phases) {
    const keys = [];
    for (const phase of phases) {
        for (const step of phase.planned_steps || []) {
            keys.push(step);
        }
    }
    return keys;
}
