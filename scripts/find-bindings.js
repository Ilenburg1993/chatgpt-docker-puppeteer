#!/usr/bin/env node'use strict';
// @ts-check

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || path.join(process.cwd(), 'src');
const EXT = new Set(['.js', '.ts', '.cjs', '.mjs', '.jsx', '.tsx']);
const issues = /** @type {any[]} */ ([]);

/**
 * @param {string} dir
 * @returns {void}
 */
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
            if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
            walk(full);
        } else {
            if (!EXT.has(path.extname(e.name))) continue;
            let content;
            try {
                content = fs.readFileSync(full, 'utf8');
            } catch (_) {
                continue;
            }

            // Patterns: .listen(..., '127.0.0.1'|'localhost')
            const regex = /\.listen\s*\([^)]*['"`](127\\.0\\.0\\.1|localhost)['"`]/g;
            let m;
            while ((m = regex.exec(content)) !== null) {
                const before = content.substr(0, m.index);
                const line = before.split('\n').length;
                issues.push({ file: full, line, match: m[0].trim() });
            }

            // More generous pattern including createServer..listen
            const regex2 = /createServer[\s\S]{0,200}\.listen\s*\([^)]*['"`](127\\.0\\.0\\.1|localhost)['"`]/g;
            while ((m = regex2.exec(content)) !== null) {
                const before = content.substr(0, m.index);
                const line = before.split('\n').length;
                issues.push({ file: full, line, match: m[0].trim().slice(0, 200) });
            }

            const regex3 = /\.listen\s*\(\s*[^,]+,\s*['"`](127\\.0\\.0\\.1|localhost)['"`]/g;
            while ((m = regex3.exec(content)) !== null) {
                const before = content.substr(0, m.index);
                const line = before.split('\n').length;
                issues.push({ file: full, line, match: m[0].trim() });
            }
        }
    }
}

if (!fs.existsSync(ROOT)) {
    console.warn(`[WARN] Root ${ROOT} does not exist`);
    process.exit(0);
}

walk(ROOT);
if (issues.length === 0) {
    console.log('[OK] No explicit localhost bindings found under', ROOT);
    process.exit(0);
} else {
    console.log('[FAIL] Found explicit localhost bindings:');
    for (const it of issues) {
        console.log(` - ${it.file}:${it.line} -> ${it.match}`);
    }
    process.exit(1);
}
