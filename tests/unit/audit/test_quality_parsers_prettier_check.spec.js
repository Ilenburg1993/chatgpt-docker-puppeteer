// @ts-check
import assert from 'node:assert/strict';

import { parsePrettierCheckOutput, parseTsIgnoreFindings } from '../../../scripts/audit/collectors/quality.mjs';

const TS_IGNORE_TOKEN = '@ts-' + 'ignore';

test('quality parser parses prettier --check warnings and ignores summary line', () => {
    const output = [
        '[warn] src/foo.js',
        '[warn] src/bar.md',
        '[warn] Code style issues found in 2 files. Run Prettier with --write to fix.',
    ].join('\n');

    const findings = parsePrettierCheckOutput(output);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].source_tool, 'quality:prettier');
    assert.equal(findings[0].file, 'src/foo.js');
    assert.equal(findings[0].contract_id, 'CONTRACT-QUALITY-PRETTIER-CHECK');
});

test('quality parser filters ts-ignore findings by scope files in quick mode', () => {
    const output = [
        `src/a.js:10:// ${TS_IGNORE_TOKEN} temporary`,
        `src/b.js:12:// ${TS_IGNORE_TOKEN} keep out of scope`,
        `scripts/x.mjs:5:// ${TS_IGNORE_TOKEN} something`,
    ].join('\n');

    const findings = parseTsIgnoreFindings(output, ['src/a.js', 'scripts/x.mjs']);
    assert.equal(findings.length, 2);
    assert.deepEqual(findings.map((f) => f.file).sort(), ['scripts/x.mjs', 'src/a.js']);
    assert.ok(findings.every((f) => f.contract_id === 'CONTRACT-QUALITY-TS-IGNORE-FORBIDDEN'));
});
