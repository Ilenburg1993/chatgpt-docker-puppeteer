// @ts-check
/**
 * CI gate: conta ocorrências de `@ts-expect-error` fora da allowlist formal
 * e falha com exit 1 se o total exceder o limite configurado (default: 0).
 *
 * Allowlist em `.github/ts-expect-error-allowlist.json`:
 * ```json
 * [{ "file": "src/foo/bar.js", "reason": "erro irrecuperável em lib externa" }]
 * ```
 *
 * @module check-ts-expect-error
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const ALLOWLIST_PATH = resolve('.github/ts-expect-error-allowlist.json');
const THRESHOLD = 0;

/** @typedef {{ file: string, reason: string }} AllowlistEntry */

/** @type {AllowlistEntry[]} */
const allowlist = existsSync(ALLOWLIST_PATH) ? JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) : [];

/** @type {Set<string>} */
const allowedFiles = new Set(allowlist.map(e => e.file));

/** @type {string} */
let rawOutput = '';

try {
    rawOutput = execSync(
        'rg --json "@ts-expect-error" --glob "*.{js,mjs,cjs,ts,tsx,vue}" ' +
            '--glob "!node_modules" --glob "!dist" --glob "!coverage" --glob "!tmp" .',
        { encoding: 'utf8' }
    );
} catch (/** @type {unknown} */ e) {
    // rg retorna exit 1 se não encontrou matches — isso é o resultado esperado (zero ocorrências).
    rawOutput = e.stdout ?? '';
}

/** @typedef {{ file: string, line: number, text: string }} Match */

/** @type {Match[]} */
const matches = [];

for (const line of rawOutput.trim().split('\n').filter(Boolean)) {
    try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'match') {
            const file = parsed.data.path.text;
            if (!allowedFiles.has(file)) {
                matches.push({
                    file,
                    line: parsed.data.line_number,
                    text: (parsed.data.lines.text ?? '').trim(),
                });
            }
        }
    } catch {
        /* skip malformed */
    }
}

if (matches.length > THRESHOLD) {
    console.error(
        `\n❌ check-ts-expect-error: ${matches.length} ocorrência(s) não-allowlistada(s) de @ts-expect-error:\n`
    );
    for (const m of matches) {
        console.error(`  ${m.file}:${m.line}  →  ${m.text}`);
    }
    console.error(`\nPara adicionar à allowlist: ${ALLOWLIST_PATH}`);
    console.error('Formato: [{ "file": "src/foo/bar.js", "reason": "motivo técnico explícito" }]');
    console.error('\nRef: DOCUMENTAÇÃO/PLANOS/TYPING_FULLSTRICT_ROADMAP.md — Fase 6\n');
    process.exit(1);
}

console.log(`✅ check-ts-expect-error: 0 ocorrências não-allowlistadas de @ts-expect-error.`);
