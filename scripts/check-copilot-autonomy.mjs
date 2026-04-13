#!/usr/bin/env node
// @ts-check
/**
 * scripts/check-copilot-autonomy.mjs
 *
 * Smoke test: garante que nenhum arquivo em src/copilot/ importa de fora do módulo copilot
 * (especificamente, `#core/`, `#nerv/`, `#infra/`, `#driver/`, `#kernel/`, `#server/`).
 *
 * Exit code 0 = autônomo. Exit code 1 = imports externos encontrados.
 *
 * Uso: node scripts/check-copilot-autonomy.mjs
 */

import { execSync } from 'node:child_process';

const FORBIDDEN_PATTERNS = [
    '#core/',
    '#nerv/',
    '#infra/',
    '#driver/',
    '#kernel/',
    '#server/',
];

const pattern = FORBIDDEN_PATTERNS.map((p) => `from '${p}`).join('|');

let output = '';
try {
    output = execSync(
        `rg -n "${pattern}" src/copilot/ --type js --no-heading`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
} catch (/** @type {any} */ e) {
    // rg exit code 1 = no matches (good), 2+ = real error
    if (e.status === 1) {
        console.log('✅ src/copilot/ é autônomo — zero imports externos proibidos.');
        process.exit(0);
    }
    throw e;
}

if (output.trim()) {
    console.error('❌ Imports externos encontrados em src/copilot/:');
    console.error(output);
    process.exit(1);
} else {
    console.log('✅ src/copilot/ é autônomo — zero imports externos proibidos.');
    process.exit(0);
}
