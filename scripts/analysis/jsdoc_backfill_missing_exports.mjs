#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

/** @typedef {{ export_name: string; kind: string; has_jsdoc: boolean; line: number }} MissingExport */

const { values } = parseArgs({
    options: {
        report: { type: 'string', default: 'jsdoc-coverage-report.json' },
        apply: { type: 'boolean', default: false },
        limit: { type: 'string', default: '0' },
        include: { type: 'string', default: '' },
        exclude: { type: 'string', default: '' },
        json: { type: 'boolean', default: false },
    },
    strict: false,
});

/**
 * @param {string} text
 * @returns {string[]}
 */
function splitCsv(text) {
    return String(text || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * @param {string} file
 * @param {string[]} includes
 * @param {string[]} excludes
 */
function allowFile(file, includes, excludes) {
    const normalized = String(file || '').replace(/\\/g, '/');
    if (includes.length > 0 && !includes.some((prefix) => normalized.startsWith(prefix))) return false;
    if (excludes.some((prefix) => normalized.startsWith(prefix))) return false;
    return true;
}

/**
 * @param {string} indent
 * @param {MissingExport[]} exportsAtLine
 * @returns {string[]}
 */
function buildCommentLines(indent, exportsAtLine) {
    const kinds = new Set(exportsAtLine.map((item) => item.kind));

    let text = 'Export público do módulo.';
    if (exportsAtLine.length > 1) {
        text =
            kinds.size === 1 && kinds.has('reexport')
                ? 'Reexports públicos deste módulo (barrel de compatibilidade).'
                : `Exports públicos deste módulo (${exportsAtLine.length} símbolos).`;
    } else {
        const item = /** @type {any} */ (exportsAtLine[0]);
        const name = item.export_name === 'default' ? 'default' : item.export_name;
        if (item.kind === 'function') text = `Função exportada: ${name}.`;
        else if (item.kind === 'class') text = `Classe exportada: ${name}.`;
        else if (item.kind === 'const') text = `Constante/valor exportado: ${name}.`;
        else if (item.kind === 'reexport') text = `Reexport público: ${name}.`;
        else text = `Export público: ${name}.`;
    }

    return [`${indent}/** ${text} */`];
}

/**
 * @param {string[]} lines
 * @param {number} lineIndexZeroBased
 * @returns {boolean}
 */
function hasNearbyJsDoc(lines, lineIndexZeroBased) {
    let i = lineIndexZeroBased - 1;
    while (i >= 0 && (lines[i] ?? '').trim() === '') i -= 1;
    if (i < 0) return false;
    const line = (lines[i] ?? '').trim();
    if (line.startsWith('/**')) return true;
    if (line.endsWith('*/')) {
        while (i >= 0) {
            if ((lines[i] ?? '').includes('/**')) return true;
            if (i === 0) break;
            i -= 1;
        }
    }
    return false;
}

/**
 * @param {string} filePath
 * @param {MissingExport[]} missingExports
 * @returns {{ changed: boolean; insertions: number; content: string }}
 */
function patchFile(filePath, missingExports) {
    const original = fs.readFileSync(filePath, 'utf8');
    const lines = original.split('\n');

    /** @type {Map<number, MissingExport[]>} */
    const byLine = new Map();
    for (const item of missingExports) {
        if (!Number.isInteger(item.line) || item.line < 1 || item.line > lines.length) continue;
        const arr = byLine.get(item.line) || [];
        arr.push(item);
        byLine.set(item.line, arr);
    }

    let insertions = 0;
    const targetLinesDesc = [...byLine.keys()].sort((a, b) => b - a);
    for (const lineNumber of targetLinesDesc) {
        const idx = lineNumber - 1;
        if (hasNearbyJsDoc(lines, idx)) continue;
        const indent = (lines[idx]?.match(/^\s*/) || [''])[0];
        const commentLines = buildCommentLines(indent, byLine.get(lineNumber) || []);
        lines.splice(idx, 0, ...commentLines);
        insertions += 1;
    }

    const content = lines.join('\n');
    return {
        changed: content !== original,
        insertions,
        content,
    };
}

const reportPath = path.resolve(String(values.report || 'jsdoc-coverage-report.json'));
const applyMode = Boolean(values.apply);
const limit = Math.max(0, Number.parseInt(String(values.limit || '0'), 10) || 0);
const includePrefixes = splitCsv(String(values.include || ''));
const excludePrefixes = splitCsv(String(values.exclude || ''));

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
/** @type {{ file: string; exported_symbols: MissingExport[] }[]} */
const fileEntries = Array.isArray(report.files) ? report.files : [];

/** @type {{ file: string; missing: MissingExport[] }[]} */
const targets = [];
for (const entry of fileEntries) {
    const file = String(entry.file || '');
    if (!file || !fs.existsSync(file)) continue;
    if (!allowFile(file, includePrefixes, excludePrefixes)) continue;
    const missing = (entry.exported_symbols || []).filter(
        (item) => item && !item.has_jsdoc && Number.isInteger(item.line),
    );
    if (missing.length === 0) continue;
    targets.push({ file, missing });
}

targets.sort((a, b) => b.missing.length - a.missing.length || a.file.localeCompare(b.file));
const selected = limit > 0 ? targets.slice(0, limit) : targets;

let filesChanged = 0;
let insertionsTotal = 0;
/** @type {{ file: string; missing: number; insertions: number; changed: boolean }[]} */
const summary = [];

for (const item of selected) {
    const patched = patchFile(item.file, item.missing);
    if (patched.changed && applyMode) {
        fs.writeFileSync(item.file, patched.content, 'utf8');
    }
    if (patched.changed) filesChanged += 1;
    insertionsTotal += patched.insertions;
    summary.push({
        file: item.file,
        missing: item.missing.length,
        insertions: patched.insertions,
        changed: patched.changed,
    });
}

const out = {
    mode: 'triage-only',
    schema_version: String(report.schema_version || 'unknown'),
    report: path.relative(process.cwd(), reportPath).replace(/\\/g, '/'),
    apply: applyMode,
    total_candidate_files: targets.length,
    selected_files: selected.length,
    files_changed: filesChanged,
    insertions_total: insertionsTotal,
    include_prefixes: includePrefixes,
    exclude_prefixes: excludePrefixes,
    sample: summary.slice(0, 50),
};

if (values.json) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
} else {
    console.log(out);
}
