import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeJSDocCoverage, collectJsSourceFiles } from '../../../scripts/analysis/jsdoc_coverage_engine.mjs';

test('jsdoc engine detects exports and computes coverage by file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdoc-engine-exports-'));
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const fileA = path.join(srcDir, 'a.js');
    fs.writeFileSync(
        fileA,
        [
            '/** soma */',
            '/** @returns {number} */',
            'export function sum() { return 1; }',
            'export const FLAG = true;',
            '/** classe */',
            'export class Foo {}',
            '',
        ].join('\n'),
        'utf8'
    );

    const fileB = path.join(srcDir, 'b.js');
    fs.writeFileSync(fileB, 'const x = 1;\nexport default x;\n', 'utf8');

    const report = analyzeJSDocCoverage({
        scope: 'full',
        files: [fileA, fileB],
    });

    assert.equal(report.files_scanned, 2);
    assert.equal(report.files_with_exports, 2);
    assert.equal(report.exports_total, 4);
    assert.equal(report.exports_with_jsdoc, 2);
    assert.equal(report.coverage_pct, 50);

    const aReport = report.files.find(item => item.file.endsWith('/a.js'));
    assert.ok(aReport);
    assert.equal(aReport.exports_total, 3);
    assert.equal(aReport.exports_with_jsdoc, 2);

    const names = aReport.exported_symbols.map(s => s.export_name).sort();
    assert.deepEqual(names, ['FLAG', 'Foo', 'sum']);
});

test('collectJsSourceFiles skips nested dist directories and collects js/mjs/cjs recursively', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdoc-engine-walk-'));
    const root = path.join(tmpDir, 'root');
    fs.mkdirSync(path.join(root, 'src', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'dist'), { recursive: true });

    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'nested', 'b.mjs'), 'export const b = 1;\n', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'nested', 'c.cjs'), 'exports.c = 1;\n', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'dist', 'ignored.js'), 'export const bad = 1;\n', 'utf8');

    const prevCwd = process.cwd();
    process.chdir(root);
    try {
        const files = collectJsSourceFiles(['src']).sort();
        assert.ok(files.includes('src/a.js'));
        assert.ok(files.includes('src/nested/b.mjs'));
        assert.ok(files.includes('src/nested/c.cjs'));
        assert.ok(!files.includes('src/dist/ignored.js'));
    } finally {
        process.chdir(prevCwd);
    }
});
