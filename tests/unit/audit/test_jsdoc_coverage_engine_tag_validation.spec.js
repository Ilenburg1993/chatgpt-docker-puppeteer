// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeJSDocCoverage } from '../../../scripts/analysis/jsdoc_coverage_engine.mjs';

test('jsdoc engine marks exported function without returns tag as minimal and reports missing tag', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdoc-engine-tags-'));
    const file = path.join(tmpDir, 'fn.js');
    fs.writeFileSync(
        file,
        [
            '/**',
            ' * descricao sem returns',
            ' * @param {unknown} x',
            ' */',
            'export function f(x) { return x; }',
            '',
        ].join('\n'),
        'utf8',
    );

    const report = analyzeJSDocCoverage({ files: [file], scope: 'full' });
    assert.equal(report.exports_total, 1);
    const sym = /** @type {any} */ (report.files[0]).exported_symbols[0];
    assert.equal(sym.export_name, 'f');
    assert.equal(sym.kind, 'function');
    assert.equal(sym.has_jsdoc, true);
    assert.equal(sym.quality_level, 'minimal');
    assert.ok(sym.missing_tags.includes('returns'));
});

test('jsdoc engine marks exported function with returns tag as complete', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdoc-engine-tags-ok-'));
    const file = path.join(tmpDir, 'fn.js');
    fs.writeFileSync(
        file,
        ['/**', ' * descricao', ' * @returns {number}', ' */', 'export function f() { return 1; }', ''].join('\n'),
        'utf8',
    );

    const report = analyzeJSDocCoverage({ files: [file], scope: 'full' });
    const sym = /** @type {any} */ (report.files[0]).exported_symbols[0];
    assert.equal(sym.has_jsdoc, true);
    assert.equal(sym.quality_level, 'complete');
    assert.deepEqual(sym.missing_tags, []);
    assert.ok(sym.tags_present.includes('returns'));
});
