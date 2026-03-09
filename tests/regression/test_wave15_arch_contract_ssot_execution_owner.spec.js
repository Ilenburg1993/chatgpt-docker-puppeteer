// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('wave15: contrato de ownership SSOT de dispatch está registrado em architecture.json', async () => {
    const filePath = path.join(process.cwd(), 'contracts/domains/architecture.json');
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);

    const contract = Array.isArray(parsed?.contracts)
        ? parsed.contracts.find((/** @type {any} */ item) => item?.id === 'CONTRACT-ARCH-SSOT-EXECUTION-OWNER')
        : null;

    assert.ok(contract, 'contrato CONTRACT-ARCH-SSOT-EXECUTION-OWNER deve existir');
    assert.equal(contract.domain, 'architecture');
    assert.equal(contract.kind, 'static');
    assert.equal(contract.enforcement?.level, 'warn');

    assert.match(
        String(contract.matcher?.pattern || ''),
        /kernel\\\.executeTask/,
        'matcher deve vigiar dispatch direto',
    );
    assert.ok(
        Array.isArray(contract.allowlist?.files) && contract.allowlist.files.includes('src/agent/queue_worker.js'),
        'QueueWorker deve estar explicitamente allowlisted como owner legítimo de dispatch',
    );
});
