import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../../../scripts/audit/lib/exec.mjs';
import { validateAuditRun } from '../../../scripts/audit/lib/schema.mjs';
import { publishSnapshot } from '../../../scripts/audit/publish_snapshot.mjs';

test('audit runner emits valid AuditRunV3 payload', async () => {
    const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-runner-'));
    const run = await runCommand(
        'node',
        [
            'scripts/audit/runner.mjs',
            '--profile',
            'quick',
            '--json',
            '--publish-master',
            'false',
            '--publish-snapshot',
            'false',
            '--output-dir',
            tmpOut,
        ],
        { timeoutMs: 600000 }
    );

    assert.equal(run.ok, true, run.stderr || run.stdout);

    const payload = JSON.parse(run.stdout);
    assert.ok(payload.report, 'runner must return report object');

    const validation = validateAuditRun(payload.report);
    assert.equal(validation.ok, true, `schema errors: ${validation.errors.join('; ')}`);
    assert.equal(payload.report.schema_version, '3.2');
    assert.equal(typeof payload.report.summary.partial, 'boolean');
    assert.equal(typeof payload.report.summary.total_primary, 'number');
    assert.equal(typeof payload.report.summary.total_backlog, 'number');
    assert.equal(typeof payload.report.duration_ms_total, 'number');
    assert.equal(typeof payload.report.run_outcome, 'string');
    assert.equal(typeof payload.report.abort_reason, 'string');
    assert.ok(Array.isArray(payload.report.remaining_step_keys), 'remaining_step_keys should be array');
    assert.ok(payload.report.log_stats && typeof payload.report.log_stats === 'object');
    assert.ok(Array.isArray(payload.report.primary_findings), 'primary findings should be array');
    assert.ok(Array.isArray(payload.report.backlog_findings), 'backlog findings should be array');
    assert.ok(Array.isArray(payload.report.findings), 'findings should be array');
    assert.ok(payload.report.contract_coverage && typeof payload.report.contract_coverage === 'object');
    assert.ok(payload.report.contract_drift && typeof payload.report.contract_drift === 'object');
    assert.ok(payload.report.gate_decision && typeof payload.report.gate_decision === 'object');
    assert.ok(payload.report.chaos_summary && typeof payload.report.chaos_summary === 'object');
    assert.ok(payload.outputs?.json, 'json output path must be present');
    assert.equal(fs.existsSync(payload.outputs.json), true, 'json artifact should exist');
});

test('check:forbidden executes without fs runtime crash', async () => {
    const result = await runCommand('npm', ['run', 'check:forbidden'], { timeoutMs: 120000 });
    const combined = `${result.stdout}\n${result.stderr}`;

    assert.equal(/ReferenceError:\s*fs is not defined/.test(combined), false, 'fs runtime crash must be fixed');
    assert.ok(result.exitCode === 0 || result.exitCode === 2, `unexpected exit code ${result.exitCode}`);
});

test('triage fallback is deterministic when MCP is unavailable', async () => {
    const mod = await import(`../../../scripts/audit/triage_llm.mjs?cachebust=${Date.now()}`);
    const finding = {
        id: 'BUG-20990101-001',
        severity: 'P1',
        status: 'confirmado',
        type: 'bug',
        source_tool: 'mcp:diagnose',
        file: null,
        line: null,
        evidence: 'mcp failed',
        impact: null,
        root_cause: null,
        suggested_patch: null,
        test_strategy: null,
        regression_risk: null,
        fingerprint: 'abc123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    const result = await mod.triageFindings([finding], { enabled: false });
    assert.equal(result.degraded, true);
    assert.equal(result.usedMcp, false);
    assert.ok(result.findings[0].root_cause, 'fallback root cause should be filled');
    assert.ok(result.findings[0].suggested_patch, 'fallback patch should be filled');
    assert.ok(result.findings[0].test_strategy, 'fallback test strategy should be filled');
});

test('publishSnapshot creates immutable markdown copy from master', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-publish-'));
    const masterPath = path.join(tmpDir, 'BUG_AUDIT_MASTER.md');
    const snapshotsDir = path.join(tmpDir, 'rodadas');

    fs.writeFileSync(masterPath, '# MASTER\nconteudo\n', 'utf8');
    const out = publishSnapshot({ masterPath, snapshotsDir, now: new Date('2026-02-15T10:00:00Z') });

    assert.ok(fs.existsSync(out.path), 'snapshot file should exist');
    const content = fs.readFileSync(out.path, 'utf8');
    assert.equal(content, '# MASTER\nconteudo\n');
    assert.match(path.basename(out.path), /^BUG_AUDIT_2026-02-15_\d{2}-\d{2}\.md$/);
});
