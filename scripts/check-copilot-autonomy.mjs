#!/usr/bin/env node
// @ts-check
/**
 * scripts/check-copilot-autonomy.mjs
 *
 * Smoke test: garante que:
 * 1. Nenhum arquivo em src/copilot/ importa de fora do módulo copilot
 * 2. Os 3 entry points de boot existem e exportam corretamente
 * 3. PM2 entry points resolvem para arquivos existentes
 *
 * Exit code 0 = tudo ok. Exit code 1 = problemas encontrados.
 *
 * Uso: node scripts/check-copilot-autonomy.mjs
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let errors = 0;

// ── Check 1: zero imports externos proibidos ────────────────────────────────

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
    if (e.status !== 1) throw e;
    // status 1 = no matches = good
}

if (output.trim()) {
    console.error('❌ Check 1 FALHOU — imports externos encontrados:');
    console.error(output);
    errors++;
} else {
    console.log('✅ Check 1: zero imports externos proibidos.');
}

// ── Check 2: entry points existem ───────────────────────────────────────────

const ENTRY_POINTS = [
    'src/copilot/bootstrap.js',
    'src/copilot/agent.js',
    'src/copilot/terminal/bootstrap.js',
];

for (const entry of ENTRY_POINTS) {
    const full = resolve(entry);
    if (existsSync(full)) {
        console.log(`✅ Check 2: ${entry} existe.`);
    } else {
        console.error(`❌ Check 2 FALHOU — ${entry} não encontrado.`);
        errors++;
    }
}

// ── Check 3: PM2 entry points resolvem ──────────────────────────────────────

const PM2_ENTRIES = [
    { name: 'copilot-sdk-agent', script: './src/copilot/agent.js' },
    { name: 'llm-b-terminal', script: './src/copilot/terminal/bootstrap.js' },
];

for (const { name, script } of PM2_ENTRIES) {
    const full = resolve(script);
    if (existsSync(full)) {
        console.log(`✅ Check 3: PM2 "${name}" → ${script} existe.`);
    } else {
        console.error(`❌ Check 3 FALHOU — PM2 "${name}" → ${script} não encontrado.`);
        errors++;
    }
}

// ── Check 4: server/wiring.js existe ─────────────────────────────────────────

const SERVER_WIRING = 'src/copilot/server/wiring.js';
if (existsSync(resolve(SERVER_WIRING))) {
    console.log(`✅ Check 4: ${SERVER_WIRING} existe.`);
} else {
    console.error(`❌ Check 4 FALHOU — ${SERVER_WIRING} não encontrado.`);
    errors++;
}

// ── Resultado ───────────────────────────────────────────────────────────────

if (errors > 0) {
    console.error(`\n❌ ${errors} problema(s) encontrado(s).`);
    process.exit(1);
} else {
    console.log('\n✅ src/copilot/ — autonomia e boot entries verificados com sucesso.');
    process.exit(0);
}
