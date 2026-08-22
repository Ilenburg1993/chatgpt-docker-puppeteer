#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { listSourceFilesSync } from './lib/source-tree.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET = path.join(ROOT, 'src', 'copilot');
const ALLOWED_SEGMENT = `${path.sep}src${path.sep}copilot${path.sep}sdk${path.sep}`;

/** @typedef {{ file: string; line: number; kind: string; text: string }} Finding */

/** @type {{ kind: string; regex: RegExp }[]} */
const RULES = [
    {
        kind: 'import from @github/copilot-sdk',
        regex: /\bimport\s+[^;]*\s+from\s+['"]@github\/copilot-sdk['"]/,
    },
    {
        kind: 'dynamic import @github/copilot-sdk',
        regex: /\bimport\s*\(\s*['"]@github\/copilot-sdk['"]\s*\)/,
    },
    {
        kind: 'require @github/copilot-sdk',
        regex: /\brequire\s*\(\s*['"]@github\/copilot-sdk['"]\s*\)/,
    },
];

/** @param {string} dir */
function walk(dir) {
    return listSourceFilesSync(dir, { extensions: ['.js', '.mjs', '.cjs'] });
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isCommentOnly(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('*/');
}

/** @type {Finding[]} */
const findings = [];

for (const file of walk(TARGET)) {
    if (file.includes(ALLOWED_SEGMENT)) continue;

    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
        if (isCommentOnly(line)) return;
        for (const rule of RULES) {
            if (rule.regex.test(line)) {
                findings.push({ file: rel, line: index + 1, kind: rule.kind, text: line.trim() });
            }
        }
    });
}

if (findings.length === 0) {
    console.log('[check-copilot-sdk-boundary] OK — @github/copilot-sdk importado apenas em src/copilot/sdk/.');
    process.exit(0);
}

console.error('[check-copilot-sdk-boundary] Falhas encontradas:');
for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.kind}] ${finding.text}`);
}
console.error('Regra: somente src/copilot/sdk/** pode importar @github/copilot-sdk diretamente.');
process.exit(2);
