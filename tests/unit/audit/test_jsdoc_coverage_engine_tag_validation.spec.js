// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { analyzeJSDocCoverage } from '../../../scripts/analysis/jsdoc_coverage_engine.mjs';

/** @param {string} source */
function analyzeTempSource(source) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdoc-engine-structural-'));
    const file = path.join(tmpDir, 'fixture.js');
    fs.writeFileSync(file, source, 'utf8');
    try {
        return analyzeJSDocCoverage({ files: [file], scope: 'full' });
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

test('jsdoc engine preserves TypeScript hierarchy for typedef properties and nested params', () => {
    const report = analyzeTempSource(`
/**
 * @typedef {object} Options
 * @property {string} value
 */
/**
 * @param {Options} options
 * @param {string} options.value
 * @returns {boolean}
 */
export function check(options) { return Boolean(options.value); }
`);
    const symbol = report.files[0]?.exported_symbols[0];
    assert.deepEqual(symbol?.tags_present, ['param', 'returns']);
    assert.equal(symbol?.param_count, 1);
    assert.equal(symbol?.param_tags_count, 1);
    assert.equal(symbol?.has_complete_param_tags, true);
});

test('jsdoc engine parses compact same-line tags and preserves overload ordering', () => {
    const report = analyzeTempSource(`
/** @overload @param {string} value @returns {string} */
/** @param {string} value @returns {string} */
export function compact(value) { return value; }
`);
    const symbol = report.files[0]?.exported_symbols[0];
    assert.deepEqual(symbol?.tags_present, ['overload', 'param', 'returns']);
    assert.equal(symbol?.param_tags_count, 1);
});

test('jsdoc engine does not infer options from a parenthesized typed object default', () => {
    const report = analyzeTempSource(`
/** @typedef {object} Input @property {string} value */
/** @param {Input} input @returns {string} */
export function typedDefault(input = /** @type {Input} */ ({})) { return input.value ?? ''; }
`);
    const symbol = report.files[0]?.exported_symbols[0];
    assert.equal(symbol?.has_options_param, false);
    assert.equal(symbol?.has_options_typedef, false);
});

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
