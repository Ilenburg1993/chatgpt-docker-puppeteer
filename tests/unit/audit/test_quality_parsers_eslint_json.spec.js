// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEslintJsonOutput, parseTypecheckOutput } from '../../../scripts/audit/collectors/quality.mjs';

test('quality parser parses ESLint JSON findings from mixed output', () => {
    const payload = [
        '(node:1) warning',
        JSON.stringify([
            {
                filePath: '/repo/src/a.js',
                messages: [
                    { ruleId: 'no-unused-vars', severity: 2, line: 10, message: 'x is defined but never used' },
                    { ruleId: 'no-console', severity: 1, line: 11, message: 'Unexpected console statement' },
                ],
            },
        ]),
    ].join('\n');

    const findings = parseEslintJsonOutput(payload);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].source_tool, 'quality:eslint');
    assert.equal(findings[0].file, '/repo/src/a.js');
    assert.equal(findings[0].rule, 'no-unused-vars');
    assert.equal(findings[0].severity_hint, 'P1');
    assert.equal(findings[1].severity_hint, 'P2');
});

test('quality parser parses tsc output lines into findings', () => {
    const output = [
        "src/foo.js(12,3): error TS2339: Property 'x' does not exist on type '{}'.",
        'noise line',
        "src/bar.js(1,1): error TS2305: Module has no exported member 'Y'.",
    ].join('\n');

    const findings = parseTypecheckOutput(output);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].file, 'src/foo.js');
    assert.equal(findings[0].rule, 'TS2339');
    assert.equal(findings[0].contract_id, 'CONTRACT-QUALITY-TYPECHECK-NODE');
    assert.equal(findings[1].rule, 'TS2305');
});
