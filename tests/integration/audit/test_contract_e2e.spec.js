import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../../../scripts/audit/lib/exec.mjs';

test('check:forbidden emits structured contract payload in hybrid mode', async () => {
    const result = await runCommand(
        'node',
        ['scripts/check_forbidden_patterns.js', '--json', '--contracts-mode', 'hybrid'],
        {
            timeoutMs: 180000,
        }
    );
    assert.ok(result.exitCode === 0 || result.exitCode === 2, `unexpected exit code ${result.exitCode}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(typeof payload.ok, 'boolean');
    assert.equal(payload.mode, 'hybrid');
    assert.ok(payload.registry && typeof payload.registry.contracts_loaded === 'number');
    assert.ok(payload.summary && typeof payload.summary.total_findings === 'number');
    assert.ok(Array.isArray(payload.findings));
    if (payload.findings.length > 0) {
        assert.ok(payload.findings[0].contract_id, 'finding should contain contract_id');
    }
});
