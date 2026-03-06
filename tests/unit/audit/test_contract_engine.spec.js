// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateStaticContracts } from '../../../scripts/audit/contracts/evaluate_static.mjs';
import { getLegacyStaticContracts } from '../../../scripts/audit/contracts/legacy_adapter.mjs';
import { buildEvidenceGraph } from '../../../scripts/audit/contracts/evidence_graph.mjs';

test('static contract engine detects process.exit violation outside allowlist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-engine-static-'));
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const target = path.join(srcDir, 'module.js');
    fs.writeFileSync(target, 'function bad(){ process.exit(1); }\n', 'utf8');

    const contracts = getLegacyStaticContracts().filter(item => item.id === 'CONTRACT-STATIC-PROCESS-EXIT');
    const result = /** @type {any} */ (
        evaluateStaticContracts({
            rootDir: tmpDir,
            scanDir: srcDir,
            contracts,
            allowlists: {},
        })
    );

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].contract_id, 'CONTRACT-STATIC-PROCESS-EXIT');
    assert.equal(result.findings[0].line, 1);
});

test('static contract engine ignores hardcoded-port pattern inside template literal text', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-engine-template-'));
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const target = path.join(srcDir, 'module.js');
    fs.writeFileSync(
        target,
        [
            'const msg = `',
            'Proxy down on port 9224',
            '`;',
            'const proxyPort = CONFIG.CHROME_PROXY_PORT || 9224;',
            '',
        ].join('\n'),
        'utf8'
    );

    const contracts = getLegacyStaticContracts().filter(item => item.id === 'CONTRACT-STATIC-HARDCODED-PORTS');
    const result = /** @type {any} */ (
        evaluateStaticContracts({
            rootDir: tmpDir,
            scanDir: srcDir,
            contracts,
            allowlists: {},
        })
    );

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].line, 4);
});

test('evidence graph correlates findings into clusters', () => {
    const findings = [
        { id: 'BUG-1', contract_id: 'CONTRACT-A', source_tool: 'x', file: 'src/a.js', root_cause_candidates: [] },
        { id: 'BUG-2', contract_id: 'CONTRACT-A', source_tool: 'y', file: 'src/b.js', root_cause_candidates: [] },
        { id: 'BUG-3', contract_id: null, source_tool: 'z', file: 'src/a.js', root_cause_candidates: [] },
    ];
    const out = /** @type {any} */ (buildEvidenceGraph(findings));
    assert.ok(Array.isArray(out.graph.nodes));
    assert.ok(out.graph.nodes.length >= 2);
    assert.ok(
        out.findings.every((/** @type {any} */ item) => item.evidence_graph_id),
        'all findings should receive evidence_graph_id'
    );
});
