import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../../../scripts/audit/lib/exec.mjs';

test('semantic preflight returns structured readiness report', async () => {
    const result = await runCommand('node', ['scripts/audit/preflight_semantic.mjs', '--json', '--no-fail'], {
        timeoutMs: 600000,
    });

    assert.equal(result.ok, true, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(typeof payload.ok, 'boolean');
    assert.ok(payload.components && typeof payload.components === 'object');
    assert.ok(payload.components.pm2 && typeof payload.components.pm2.ok === 'boolean');
    assert.ok(payload.components.mcp && typeof payload.components.mcp.ok === 'boolean');
    assert.ok(payload.components.rag && typeof payload.components.rag.ok === 'boolean');
    assert.ok(payload.components.lsp && typeof payload.components.lsp.ok === 'boolean');
    assert.ok(Array.isArray(payload.issues));
});
