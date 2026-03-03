#!/usr/bin/env node'use strict';
// @ts-check

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || path.join(process.cwd(), 'src');
const APPLY = process.argv.includes('--apply');
const REPORT_DIR = path.join(process.cwd(), 'diagnostics');
const REPORT_PATH = path.join(REPORT_DIR, 'fix-bindings-report.json');
const EXT = new Set(['.js', '.ts', '.cjs', '.mjs', '.jsx', '.tsx']);
const IGNORES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

let edits = [];

function walk(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
        return;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (IGNORES.has(e.name)) continue;
            walk(full);
        } else {
            if (!EXT.has(path.extname(e.name))) continue;
            processFile(full);
        }
    }
}

function processFile(file) {
    let content;
    try {
        content = fs.readFileSync(file, 'utf8');
    } catch (_) {
        return;
    }
    const _original = content;
    let changed = false;
    const changesHere = [];

    // 1) Replace host literals used directly as listen args: server.listen(PORT, '127.0.0.1', ...)
    const listenArgRegex = /(\.listen\s*\(\s*[^\)]*?)(['\"])(127\.0\.0\.1|localhost)\2([^\)]*?\))/gs;
    content = content.replace(listenArgRegex, (m, before, quote, host, after) => {
        changesHere.push({ type: 'listen-arg', host, snippet: m.trim() });
        changed = true;
        return `${before}${quote}0.0.0.0${quote}${after}`;
    });

    // 2) Replace host property in option objects: { host: '127.0.0.1' }
    const hostPropRegex = /(\bhost\s*:\s*)(['\"])(127\.0\.0\.1|localhost)\2/g;
    content = content.replace(hostPropRegex, (m, prefix, quote, host) => {
        changesHere.push({ type: 'host-prop', host, snippet: m.trim() });
        changed = true;
        return `${prefix}${quote}0.0.0.0${quote}`;
    });

    // 3) Replace hosts arrays: hosts: ['127.0.0.1', 'localhost']
    const hostsArrayRegex = /(\bhosts\s*:\s*\[)([\s\S]*?)(\])/g;
    content = content.replace(hostsArrayRegex, (m, start, inner, end) => {
        const replaced = inner.replace(/(['\"])(127\.0\.0\.1|localhost)\1/g, (mm, q, h) => {
            changesHere.push({ type: 'hosts-array', host: h, snippet: mm });
            changed = true;
            return `${q}0.0.0.0${q}`;
        });
        return `${start}${replaced}${end}`;
    });

    // 4) Replace host:port string occurrences e.g. '127.0.0.1:9224' or "localhost:3000"
    const hostPortStringRegex = /(['\"])(127\.0\.0\.1|localhost)(:\d+)?\1/g;
    content = content.replace(hostPortStringRegex, (m, quote, host, port = '') => {
        changesHere.push({ type: 'host-port-string', host, port: port || '', snippet: m });
        changed = true;
        return `${quote}0.0.0.0${port}${quote}`;
    });

    if (changed) {
        edits.push({ file, changes: changesHere.length, details: changesHere });
        if (APPLY) {
            try {
                // write backup
                fs.copyFileSync(file, file + '.bak');
                fs.writeFileSync(file, content, 'utf8');
            } catch (e) {
                console.error(`[ERROR] Failed to write file ${file}:`, e.message);
            }
        }
    }
}

if (!fs.existsSync(ROOT)) {
    console.warn(`[WARN] Root ${ROOT} does not exist`);
    process.exit(0);
}

walk(ROOT);

// Ensure diagnostics dir exists when applying or reporting
if (!fs.existsSync(REPORT_DIR)) {
    try {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
    } catch (_) {
        /* ignore */
    }
}

if (edits.length === 0) {
    console.log('[OK] No explicit localhost bindings found under', ROOT);
    process.exit(0);
}

// Create report
const report = {
    timestamp: new Date().toISOString(),
    root: ROOT,
    apply: !!APPLY,
    changed_files: edits.map(e => ({ file: path.relative(process.cwd(), e.file), changes: e.changes })),
};

try {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log('[INFO] Report written to', REPORT_PATH);
} catch (e) {
    console.error('[WARN] Could not write report:', e.message);
}

console.log('[INFO] Detected binding occurrences:');
for (const e of edits) {
    console.log(` - ${e.file} (${e.changes} change(s))`);
}

if (APPLY) {
    console.log('\n[APPLY] Changes written. Backups created as .bak. Review and commit.');
    process.exit(0);
} else {
    console.log('\n[DRY RUN] No files modified. Re-run with --apply to apply changes.');
    process.exit(1);
}
