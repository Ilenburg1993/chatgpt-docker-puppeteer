import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectSecurityFindings } from '../../../scripts/audit/collectors/security.mjs';

test('collectSecurityFindings detecta superfície HTTP sem auth e ausência de headers', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-security-'));
    const serverDir = path.join(rootDir, 'src', 'server');
    await fs.mkdir(serverDir, { recursive: true });
    await fs.writeFile(
        path.join(serverDir, 'routes.js'),
        [
            "import express from 'express';",
            'const app = express();',
            "app.get('/health', (_req, res) => res.json({ ok: true }));",
            'export default app;',
            '',
        ].join('\n'),
        'utf8'
    );

    const result = await collectSecurityFindings({
        rootDir,
        contracts: [],
    });

    assert.equal(result.errors.length, 0);
    assert.ok(result.telemetry.files_scanned >= 1);
    assert.ok(result.findings.some(item => item.source_tool === 'security-http-surface'));
    assert.ok(result.findings.some(item => item.source_tool === 'security-headers'));
});
