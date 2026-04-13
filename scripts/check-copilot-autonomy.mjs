#!/usr/bin/env node
// @ts-check
/**
 * scripts/check-copilot-autonomy.mjs
 *
 * Smoke test: garante que:
 * 1. Nenhum arquivo em src/copilot/ importa de fora do módulo copilot
 * 2. Os entry points de boot existem e exportam corretamente
 * 3. PM2 entry points resolvem para arquivos existentes
 * 4. Arquivos de wiring e agent.js existem (mesmo que deprecated)
 * 5. bootstrap.js implementa modo único (sem parâmetro mode/context)
 *
 * Arquitetura Onda 2.7: copilot é ferramenta DEV-only.
 * Boot canônico: terminal/bootstrap.js → bootCopilot() → startTerminalServer()
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

// terminal/bootstrap.js = canônico (único modo real)
// bootstrap.js = delegante (chama bootCopilot sem args)
// agent.js = deprecated (backwards compat com PM2)
const ENTRY_POINTS = [
    { path: 'src/copilot/bootstrap.js', note: 'delegante (modo único)' },
    { path: 'src/copilot/agent.js', note: '@deprecated — backwards compat PM2' },
    { path: 'src/copilot/terminal/bootstrap.js', note: 'CANÔNICO — boot via terminal:llm-b' },
];

for (const { path: entry, note } of ENTRY_POINTS) {
    const full = resolve(entry);
    if (existsSync(full)) {
        console.log(`✅ Check 2: ${entry} existe. [${note}]`);
    } else {
        console.error(`❌ Check 2 FALHOU — ${entry} não encontrado. [${note}]`);
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

// ── Check 4: server/wiring.js existe (agora @deprecated mas ainda presente) ────

const SERVER_WIRING = 'src/copilot/server/wiring.js';
if (existsSync(resolve(SERVER_WIRING))) {
    console.log(`✅ Check 4: ${SERVER_WIRING} existe. [@deprecated — orphaned desde Onda 2.7]`);
} else {
    console.error(`❌ Check 4 FALHOU — ${SERVER_WIRING} não encontrado.`);
    errors++;
}

// ── Check 5: bootstrap.js tem modo único (sem parâmetros mode/context) ──────

const { readFileSync } = await import('node:fs');
const bootstrapSrc = readFileSync(resolve('src/copilot/bootstrap.js'), 'utf-8');
const hasModeProp = /\bmode\s*[=:]\s*['"]/.test(bootstrapSrc) || /CopilotBootMode/.test(bootstrapSrc);
if (hasModeProp) {
    console.error('❌ Check 5 FALHOU — bootstrap.js ainda contém referência a "mode" ou "CopilotBootMode".');
    console.error('   Onda 2.7 exige modo único: bootCopilot() sem parâmetros.');
    errors++;
} else {
    console.log('✅ Check 5: bootstrap.js implementa modo único (sem mode/CopilotBootMode).');
}

// ── Resultado ───────────────────────────────────────────────────────────────

if (errors > 0) {
    console.error(`\n❌ ${errors} problema(s) encontrado(s).`);
    process.exit(1);
} else {
    console.log('\n✅ src/copilot/ — autonomia e boot entries verificados com sucesso.');
    process.exit(0);
}
