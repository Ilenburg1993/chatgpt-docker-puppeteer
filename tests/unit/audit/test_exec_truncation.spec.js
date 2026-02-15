import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../../../scripts/audit/lib/exec.mjs';

test('runCommand truncates oversized stdout and reports metadata', async () => {
    const result = await runCommand(
        'node',
        ['-e', 'process.stdout.write("x".repeat(200000))'],
        { maxStdoutBytes: 32768, timeoutMs: 30000 }
    );

    assert.equal(result.ok, true);
    assert.equal(result.stdoutTruncated, true);
    assert.equal(result.stderrTruncated, false);
    assert.ok(result.stdout.includes('[stdout truncated]'));
    assert.ok(result.stdoutBytes >= 200000);
});
