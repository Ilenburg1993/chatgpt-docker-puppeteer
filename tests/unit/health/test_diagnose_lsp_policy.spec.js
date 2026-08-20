// @ts-check
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('diagnóstico LSP encerra com sucesso e sem rede quando desativado por padrão', async () => {
    const script = path.resolve('scripts/health/diagnose-lsp.mjs');
    const env = { ...process.env };
    delete env['LSP_ENABLED'];
    const { stdout } = await execFileAsync(process.execPath, [script, '--json'], { env, timeout: 5_000 });
    const report = JSON.parse(stdout);
    assert.equal(report.ok, true);
    assert.equal(report.enabled, false);
    assert.equal(report.disabled_by_policy, true);
    assert.equal(report.status, 'disabled-by-policy');
    assert.equal(report.lsp_tools_present, false);
    assert.equal(report.lsp_functional_ok, true);
});
