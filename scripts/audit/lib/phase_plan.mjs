import { AUDIT_PHASES } from './event_types.mjs';

/**
 * @param {{ profile: 'quick'|'deep'|'nightly', refreshContextMode: 'smart'|'force'|'skip' }} options
 */
export function buildPhasePlan(options) {
    const phases = [];

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

    if (options.profile === 'nightly' || options.refreshContextMode === 'force') {
        phases.push({
            id: AUDIT_PHASES.CONTEXT_REFRESH,
            planned_steps: ['context.rag_health', 'context.rag_index_core', 'context.rag_index_docs'],
        });
    }

    phases.push({
        id: AUDIT_PHASES.COLLECT_STATIC,
        planned_steps: options.profile === 'quick'
            ? ['static.syntax', 'static.forbidden']
            : ['static.forbidden', 'static.lint', 'static.typecheck', 'static.madge', 'static.depcruise', 'static.jscpd', 'static.semgrep'],
    });

    phases.push({
        id: AUDIT_PHASES.COLLECT_RUNTIME,
        planned_steps: ['runtime.mcp_diagnose', 'runtime.rag_health', 'runtime.lsp_health', ...(options.profile === 'quick' ? [] : ['runtime.smoke'])],
    });

    phases.push({
        id: AUDIT_PHASES.COLLECT_TESTS,
        planned_steps:
            options.profile === 'quick'
                ? ['tests.smoke']
                : options.profile === 'deep'
                    ? ['tests.unit']
                    : ['tests.unit', 'tests.integration', 'tests.regression'],
    });

    phases.push({
        id: AUDIT_PHASES.COLLECT_CHAOS,
        planned_steps: options.profile === 'nightly' ? ['chaos.contract_nightly'] : [],
    });

    phases.push({ id: AUDIT_PHASES.NORMALIZE_CORRELATE, planned_steps: ['normalize.findings', 'normalize.evidence_graph'] });
    phases.push({ id: AUDIT_PHASES.TRIAGE_INTELLIGENCE, planned_steps: ['triage.enrich'] });
    phases.push({ id: AUDIT_PHASES.PUBLISH, planned_steps: ['publish.json', 'publish.master', 'publish.snapshot', 'publish.contract_reports'] });

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
