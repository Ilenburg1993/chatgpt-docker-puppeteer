// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPhasePlan } from '../../../scripts/audit/lib/phase_plan.mjs';
import { AUDIT_PHASES } from '../../../scripts/audit/lib/event_types.mjs';

function getPhase(plan, phaseId) {
    return plan.find(item => item.id === phaseId);
}

test('buildPhasePlan habilita collect-security apenas em audit_mode=security', () => {
    const plan = buildPhasePlan({
        profile: 'quick',
        refreshContextMode: 'smart',
        auditMode: 'security',
    });

    assert.deepEqual(getPhase(plan, AUDIT_PHASES.COLLECT_SECURITY)?.planned_steps, [
        'security.contracts',
        'security.http_surface',
        'security.headers',
    ]);
    assert.deepEqual(getPhase(plan, AUDIT_PHASES.COLLECT_PERFORMANCE)?.planned_steps, []);
    assert.deepEqual(getPhase(plan, AUDIT_PHASES.COLLECT_ARCHITECTURE)?.planned_steps, []);
    assert.deepEqual(getPhase(plan, AUDIT_PHASES.TRIAGE_INTELLIGENCE)?.planned_steps, ['triage.enrich']);
});

test('buildPhasePlan mantém observability enxuto e sem triage', () => {
    const plan = buildPhasePlan({
        profile: 'quick',
        refreshContextMode: 'smart',
        auditMode: 'observability',
    });

    assert.deepEqual(getPhase(plan, AUDIT_PHASES.COLLECT_STATIC)?.planned_steps, []);
    assert.deepEqual(getPhase(plan, AUDIT_PHASES.COLLECT_RUNTIME)?.planned_steps, [
        'runtime.mcp_diagnose',
        'runtime.rag_health',
        'runtime.lsp_health',
    ]);
    assert.deepEqual(getPhase(plan, AUDIT_PHASES.COLLECT_TESTS)?.planned_steps, ['tests.smoke']);
    assert.deepEqual(getPhase(plan, AUDIT_PHASES.TRIAGE_INTELLIGENCE)?.planned_steps, []);
    assert.deepEqual(getPhase(plan, AUDIT_PHASES.NORMALIZE_CORRELATE)?.planned_steps, [
        'normalize.findings',
        'normalize.evidence_graph',
    ]);
});
