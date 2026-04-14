#!/usr/bin/env node
// @ts-check
/**
 * scripts/check-copilot-autonomy.mjs
 *
 * Smoke test: garante que:
 *
 * 1. Nenhum arquivo em src/copilot/ importa de fora do módulo copilot
 * 2. Os entry points de boot existem e exportam corretamente
 * 3. PM2 entry points resolvem para arquivos existentes
 * 4. Arquivos de wiring e agent.js existem (mesmo que deprecated)
 * 5. bootstrap.js implementa modo único (sem parâmetro mode/context)
 *
 * Arquitetura Onda 2.7: copilot é ferramenta DEV-only. Boot canônico: terminal/bootstrap.js → bootCopilot() →
 * startTerminalServer()
 *
 * Exit code 0 = tudo ok. Exit code 1 = problemas encontrados.
 *
 * Uso: node scripts/check-copilot-autonomy.mjs
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

let errors = 0;

// ── Check 1: zero imports externos proibidos ────────────────────────────────

const FORBIDDEN_PATTERNS = ['#core/', '#nerv/', '#infra/', '#driver/', '#kernel/', '#server/'];

const pattern = FORBIDDEN_PATTERNS.map((p) => `from '${p}`).join('|');

let output = '';
try {
    output = execSync(`rg -n "${pattern}" src/copilot/ --type js --no-heading`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
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

// ── Check 4: server/wiring.js removido ou @deprecated ───────────────────────

const SERVER_WIRING = 'src/copilot/server/wiring.js';
if (existsSync(resolve(SERVER_WIRING))) {
    const wiringSrc = readFileSync(resolve(SERVER_WIRING), 'utf-8');
    if (/@deprecated/.test(wiringSrc)) {
        console.log(`✅ Check 4: ${SERVER_WIRING} existe mas está @deprecated. [aguardando remoção Onda 3.9]`);
    } else {
        console.error(`❌ Check 4 FALHOU — ${SERVER_WIRING} existe sem @deprecated.`);
        errors++;
    }
} else {
    // Removido na Onda 3.9 — OK
    console.log(`✅ Check 4: ${SERVER_WIRING} removido (Onda 3.9 aplicada).`);
}

// ── Check 5: bootstrap.js tem modo único (sem parâmetros mode/context) ──────

const bootstrapSrc = readFileSync(resolve('src/copilot/bootstrap.js'), 'utf-8');
const hasModeProp = /\bmode\s*[=:]\s*['"]/.test(bootstrapSrc) || /CopilotBootMode/.test(bootstrapSrc);
if (hasModeProp) {
    console.error('❌ Check 5 FALHOU — bootstrap.js ainda contém referência a "mode" ou "CopilotBootMode".');
    console.error('   Onda 2.7 exige modo único: bootCopilot() sem parâmetros.');
    errors++;
} else {
    console.log('✅ Check 5: bootstrap.js implementa modo único (sem mode/CopilotBootMode).');
}

// ── Check 6: server/index.js existe e exporta startCopilotServer ────────────

const SERVER_INDEX = 'src/copilot/server/index.js';
if (existsSync(resolve(SERVER_INDEX))) {
    const serverSrc = readFileSync(resolve(SERVER_INDEX), 'utf-8');
    if (
        /export.*startCopilotServer|export function startCopilotServer|export async function startCopilotServer/.test(
            serverSrc,
        )
    ) {
        console.log(`✅ Check 6: ${SERVER_INDEX} exporta startCopilotServer.`);
    } else {
        console.error(`❌ Check 6 FALHOU — ${SERVER_INDEX} não exporta startCopilotServer.`);
        errors++;
    }
} else {
    console.error(`❌ Check 6 FALHOU — ${SERVER_INDEX} não encontrado.`);
    errors++;
}

// ── Check 7: server/socket/hub-ns.js existe ─────────────────────────────────

const HUB_NS = 'src/copilot/server/socket/hub-ns.js';
if (existsSync(resolve(HUB_NS))) {
    console.log(`✅ Check 7: ${HUB_NS} existe (namespace /copilot).`);
} else {
    console.error(`❌ Check 7 FALHOU — ${HUB_NS} não encontrado.`);
    errors++;
}

// ── Check 8: terminal/server.js está @deprecated ────────────────────────────

const TERMINAL_SERVER = 'src/copilot/terminal/server.js';
if (existsSync(resolve(TERMINAL_SERVER))) {
    const termSrc = readFileSync(resolve(TERMINAL_SERVER), 'utf-8');
    if (/@deprecated/.test(termSrc)) {
        console.log(`✅ Check 8: ${TERMINAL_SERVER} está @deprecated.`);
    } else {
        console.error(`❌ Check 8 FALHOU — ${TERMINAL_SERVER} existe mas não está @deprecated.`);
        errors++;
    }
} else {
    // Removido na Onda 3.9 — também OK
    console.log(`✅ Check 8: ${TERMINAL_SERVER} removido (Onda 3.9 aplicada).`);
}

// ── Check 9: conversation-hub/socket-ns.js é re-export stub ─────────────────

const SOCKET_NS = 'src/copilot/conversation-hub/socket-ns.js';
if (existsSync(resolve(SOCKET_NS))) {
    const socketNsSrc = readFileSync(resolve(SOCKET_NS), 'utf-8');
    const isStub = socketNsSrc.length < 800 && /from.*server\/socket\/hub-ns/.test(socketNsSrc);
    if (isStub) {
        console.log(`✅ Check 9: ${SOCKET_NS} é re-export stub de server/socket/hub-ns.js.`);
    } else {
        console.error(`❌ Check 9 FALHOU — ${SOCKET_NS} ainda contém implementação completa (aguardando Onda 3.7).`);
        errors++;
    }
} else {
    // Removido na Onda 3.9 — também OK
    console.log(`✅ Check 9: ${SOCKET_NS} removido (Onda 3.9 aplicada).`);
}

// ── Check 10: api/sse/*.js são todos re-export stubs ────────────────────────

const API_SSE_DIR = 'src/copilot/api/sse';
if (existsSync(resolve(API_SSE_DIR))) {
    const sseFiles = readdirSync(resolve(API_SSE_DIR)).filter((f) => f.endsWith('.js'));
    let allStubs = true;
    for (const f of sseFiles) {
        const src = readFileSync(resolve(API_SSE_DIR, f), 'utf-8');
        if (!/@deprecated/.test(src)) {
            console.error(`❌ Check 10 FALHOU — ${API_SSE_DIR}/${f} não está @deprecated.`);
            allStubs = false;
            errors++;
        }
    }
    if (allStubs) {
        console.log(`✅ Check 10: api/sse/ — todos os ${sseFiles.length} arquivos são stubs @deprecated.`);
    }
} else {
    console.log(`✅ Check 10: ${API_SSE_DIR}/ removido (Onda 4.5+ aplicada).`);
}

// ── Check 11: server/routes/ tem ≥ 8 routers ───────────────────────────────

const ROUTES_DIR = 'src/copilot/server/routes';
if (existsSync(resolve(ROUTES_DIR))) {
    const routeFiles = readdirSync(resolve(ROUTES_DIR)).filter((f) => f.endsWith('.js'));
    if (routeFiles.length >= 8) {
        console.log(`✅ Check 11: server/routes/ tem ${routeFiles.length} routers (≥ 8).`);
    } else {
        console.error(`❌ Check 11 FALHOU — server/routes/ tem apenas ${routeFiles.length} routers (mínimo: 8).`);
        errors++;
    }
} else {
    console.error(`❌ Check 11 FALHOU — ${ROUTES_DIR} não existe.`);
    errors++;
}

// ── Check 12: zero require() em src/copilot/ ───────────────────────────────

let requireOutput = '';
try {
    requireOutput = execSync(
        'rg -n "\\brequire\\s*\\(" src/copilot/ --type js --no-heading -g "!*.spec.js" -g "!*.test.js"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
} catch (/** @type {any} */ e) {
    if (e.status !== 1) throw e;
}

// Filtrar falsos positivos: comentários e strings contendo "require("
const realRequires = requireOutput
    .split('\n')
    .filter((line) => line.trim())
    .filter((line) => !/^\s*\/\//.test(line.split(':').slice(2).join(':')))
    .filter((line) => !/^\s*\*/.test(line.split(':').slice(2).join(':')))
    .filter((line) => !/require\(\)/.test(line));

if (realRequires.length > 0) {
    console.error(`❌ Check 12 FALHOU — ${realRequires.length} require() encontrado(s) em src/copilot/:`);
    for (const r of realRequires.slice(0, 5)) console.error(`   ${r}`);
    errors++;
} else {
    console.log('✅ Check 12: zero require() em src/copilot/ (ESM completo).');
}

// ── Check 13: módulos copilot têm index.js ──────────────────────────────────

const EXPECTED_MODULES = [
    'agent',
    'api',
    'audit',
    'bridges',
    'channel',
    'config',
    'conversation-hub',
    'core',
    'db',
    'events',
    'hooks',
    'observability',
    'plugins',
    'sdk',
    'server',
    'services',
    'terminal',
    'tools',
    'types',
];

const missingBarrels = [];
for (const mod of EXPECTED_MODULES) {
    const indexPath = resolve(`src/copilot/${mod}/index.js`);
    if (!existsSync(indexPath)) {
        missingBarrels.push(mod);
    }
}

if (missingBarrels.length > 0) {
    console.error(`❌ Check 13 FALHOU — módulos sem index.js: ${missingBarrels.join(', ')}`);
    errors++;
} else {
    console.log(`✅ Check 13: todos os ${EXPECTED_MODULES.length} módulos copilot têm index.js.`);
}

// ── Check 14: services/ tem importador em server/routes/ ────────────────────

let servicesInRoutes = '';
try {
    servicesInRoutes = execSync('rg -l "#copilot/services" src/copilot/server/routes/ --type js --no-heading', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
} catch (/** @type {any} */ e) {
    if (e.status !== 1) throw e;
}

const routeImporters = servicesInRoutes.split('\n').filter((l) => l.trim());
if (routeImporters.length >= 1) {
    console.log(`✅ Check 14: services/ importado por ${routeImporters.length} arquivo(s) em server/routes/.`);
} else {
    console.error('❌ Check 14 FALHOU — services/ não é importado por nenhum arquivo em server/routes/.');
    errors++;
}

// ── Check 15: server/sse/state.js não re-exporta terminal/state.js ──────────

const SSE_STATE = 'src/copilot/server/sse/state.js';
if (existsSync(resolve(SSE_STATE))) {
    const sseStateSrc = readFileSync(resolve(SSE_STATE), 'utf-8');
    if (/from.*terminal\/state/.test(sseStateSrc)) {
        console.error(`❌ Check 15 FALHOU — ${SSE_STATE} ainda faz re-export de terminal/state.js.`);
        errors++;
    } else {
        console.log(`✅ Check 15: ${SSE_STATE} é implementação independente (sem re-export terminal/state).`);
    }
} else {
    console.error(`❌ Check 15 FALHOU — ${SSE_STATE} não encontrado.`);
    errors++;
}

// ── Check 16: openapi.json possui >= 80 paths (reflete server/routes/) ──────

const OPENAPI_PATH = 'src/copilot/api/openapi.json';
if (existsSync(resolve(OPENAPI_PATH))) {
    try {
        const openapiSpec = JSON.parse(readFileSync(resolve(OPENAPI_PATH), 'utf-8'));
        const pathCount = Object.keys(openapiSpec.paths || {}).length;
        if (pathCount >= 80) {
            console.log(`✅ Check 16: openapi.json tem ${pathCount} paths (>= 80 esperados).`);
        } else {
            console.error(`❌ Check 16 FALHOU — openapi.json tem apenas ${pathCount} paths (esperado >= 80).`);
            errors++;
        }
    } catch (/** @type {any} */ e) {
        console.error(`❌ Check 16 FALHOU — openapi.json parse error: ${e.message}`);
        errors++;
    }
} else {
    console.error(`❌ Check 16 FALHOU — ${OPENAPI_PATH} não encontrado.`);
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
