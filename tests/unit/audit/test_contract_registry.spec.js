import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadContractRegistry } from '../../../scripts/audit/contracts/load_registry.mjs';

test('contract registry loads active contracts from default path', () => {
    const registry = loadContractRegistry();
    assert.equal(Array.isArray(registry.contracts), true);
    assert.ok(registry.contracts.length > 0, 'registry must load at least one contract');
    assert.equal(registry.byId.size, registry.contracts.length);
    assert.equal(Array.isArray(registry.errors), true);
});

test('contract registry rejects duplicate ids', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-registry-dup-'));
    const domainsDir = path.join(tmpDir, 'contracts', 'domains');
    fs.mkdirSync(domainsDir, { recursive: true });

    const domainPath = path.join(domainsDir, 'runtime.json');
    fs.writeFileSync(
        domainPath,
        JSON.stringify(
            {
                domain: 'runtime',
                contracts: [
                    {
                        id: 'CONTRACT-DUPLICATE',
                        title: 'A',
                        domain: 'runtime',
                        description: 'A',
                        kind: 'runtime',
                        severity_default: 'P1',
                        type_default: 'falha de contrato',
                        matcher: { engine: 'signal', signals: ['a'] },
                        test_recipe: ['echo a'],
                        owner: 'qa',
                        status: 'active',
                        version: 1,
                    },
                    {
                        id: 'CONTRACT-DUPLICATE',
                        title: 'B',
                        domain: 'runtime',
                        description: 'B',
                        kind: 'runtime',
                        severity_default: 'P1',
                        type_default: 'falha de contrato',
                        matcher: { engine: 'signal', signals: ['b'] },
                        test_recipe: ['echo b'],
                        owner: 'qa',
                        status: 'active',
                        version: 1,
                    },
                ],
            },
            null,
            2
        ),
        'utf8'
    );

    const registryPath = path.join(tmpDir, 'contracts', 'registry.json');
    fs.writeFileSync(
        registryPath,
        JSON.stringify(
            {
                schema_version: '1.0',
                domains: ['domains/runtime.json'],
            },
            null,
            2
        ),
        'utf8'
    );

    const result = loadContractRegistry({ registryPath });
    assert.equal(result.errors.some(message => message.includes('duplicado')), true);
});
