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
 * 4. Arquivos de boot e entrada compatível existem
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
import {
    BOOT_CONFIG_ENV_KEYS,
    COPILOT_BOOT_MODE,
    COPILOT_CANONICAL_BOOT_ENTRYPOINT,
    COPILOT_CANONICAL_PM2_PROCESS,
    COPILOT_COMPAT_BOOT_ENTRYPOINT,
    COPILOT_COMPAT_PM2_ENV_FLAG,
    COPILOT_COMPAT_PM2_PROCESS,
    COPILOT_TERMINAL_PM2_ENV_FLAG,
    SDK_VANILLA_CAPABILITY_BASELINE,
} from '../src/copilot/boot/index.js';

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
// agent.js = entrypoint compatível operacional (não é segundo runtime)
const ENTRY_POINTS = [
    { path: 'src/copilot/bootstrap.js', note: 'delegante (modo único)' },
    { path: COPILOT_COMPAT_BOOT_ENTRYPOINT, note: 'compat operacional PM2/manual' },
    { path: COPILOT_CANONICAL_BOOT_ENTRYPOINT, note: 'CANÔNICO — boot via terminal:llm-b' },
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
    { name: COPILOT_COMPAT_PM2_PROCESS, script: `./${COPILOT_COMPAT_BOOT_ENTRYPOINT}` },
    { name: COPILOT_CANONICAL_PM2_PROCESS, script: `./${COPILOT_CANONICAL_BOOT_ENTRYPOINT}` },
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

// ── Check 3b: PM2 compat não pode competir com boot canônico ────────────────

const ecosystemSrc = readFileSync(resolve('ecosystem.config.cjs'), 'utf-8');
const hasCompatFlag = ecosystemSrc.includes(`process.env.${COPILOT_COMPAT_PM2_ENV_FLAG} === 'true'`);
const excludesTerminalProcess = ecosystemSrc.includes(`process.env.${COPILOT_TERMINAL_PM2_ENV_FLAG} !== 'true'`);
const canonicalPm2UsesTerminalBootstrap = new RegExp(
    `name:\\s*['"]${COPILOT_CANONICAL_PM2_PROCESS}['"][\\s\\S]*?script:\\s*['"]\\./${COPILOT_CANONICAL_BOOT_ENTRYPOINT}['"]`,
).test(ecosystemSrc);

if (hasCompatFlag && excludesTerminalProcess && canonicalPm2UsesTerminalBootstrap) {
    console.log(
        `✅ Check 3b: PM2 compat é opt-in por ${COPILOT_COMPAT_PM2_ENV_FLAG} e não compete com ${COPILOT_CANONICAL_PM2_PROCESS}.`,
    );
} else {
    console.error('❌ Check 3b FALHOU — PM2 compat/canônico não seguem o contrato de boot único.');
    errors++;
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
const hasModeProp =
    /\bmode\s*[=:]\s*['"]/.test(bootstrapSrc.replaceAll(COPILOT_BOOT_MODE, '')) || /CopilotBootMode/.test(bootstrapSrc);
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

// ── Check 10: src/copilot/api removido ──────────────────────────────────────

const API_DIR = 'src/copilot/api';
if (existsSync(resolve(API_DIR))) {
    console.error(`❌ Check 10 FALHOU — ${API_DIR}/ ainda existe; rotas canônicas vivem em server/routes/.`);
    errors++;
} else {
    console.log(`✅ Check 10: ${API_DIR}/ removido; server/routes/ é a única borda HTTP canônica.`);
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
    'audit',
    'boot',
    'bridges',
    'channel',
    'config',
    'conversation-hub',
    'core',
    'db',
    'event-handlers',
    'events',
    'hooks',
    'infra',
    'observability',
    'plugins',
    'presentation',
    'sdk',
    'server',
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

// ── Check 14: server/routes não importa bordas removidas ────────────────────

let removedRouteImports = '';
try {
    removedRouteImports = execSync(
        `rg -n "^\\s*import .*src/copilot/api|^\\s*import .*#copilot/api|from ['"][^'"]*api/(express|sse)" src/copilot/server/routes/ --type js --no-heading`,
        {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        },
    );
} catch (/** @type {any} */ e) {
    if (e.status !== 1) throw e;
}

if (removedRouteImports.trim()) {
    console.error('❌ Check 14 FALHOU — server/routes ainda importa bordas removidas:');
    console.error(removedRouteImports);
    errors++;
} else {
    console.log('✅ Check 14: server/routes não importa api/express nem api/sse.');
}

// ── Check 14b: SDK routes têm composition root explícito ───────────────────

let sdkRouteDeps = '';
try {
    sdkRouteDeps = execSync(
        'rg -l "composition root|server/routes/sdk/\\*" src/copilot/server/routes/sdk/deps.js --no-heading',
        {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        },
    );
} catch (/** @type {any} */ e) {
    if (e.status !== 1) throw e;
}

if (sdkRouteDeps.trim()) {
    console.log('✅ Check 14b: server/routes/sdk/deps.js é o composition root do SDK API.');
} else {
    console.error('❌ Check 14b FALHOU — server/routes/sdk/deps.js não documenta composição das rotas SDK.');
    errors++;
}

// ── Check 15: infra/sse/state.js não importa estado de UI do terminal ───────

const SSE_STATE = 'src/copilot/infra/sse/state.js';
if (existsSync(resolve(SSE_STATE))) {
    const sseStateSrc = readFileSync(resolve(SSE_STATE), 'utf-8');
    if (/from.*terminal\/state/.test(sseStateSrc)) {
        console.error(`❌ Check 15 FALHOU — ${SSE_STATE} ainda importa estado de UI do terminal.`);
        errors++;
    } else {
        console.log(`✅ Check 15: ${SSE_STATE} é implementação independente de estado de UI do terminal.`);
    }
} else {
    console.error(`❌ Check 15 FALHOU — ${SSE_STATE} não encontrado.`);
    errors++;
}

// ── Check 16: server/routes expõe superfície HTTP suficiente ───────────────

let routeCount = 0;
try {
    const routesOut = execSync(
        'rg -n "router\\.(get|post|put|delete|patch)\\(" src/copilot/server/routes/ --type js --no-heading',
        {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        },
    );
    routeCount = routesOut.split('\n').filter((line) => line.trim()).length;
} catch (/** @type {any} */ e) {
    if (e.status !== 1) throw e;
}

if (routeCount >= 50) {
    console.log(`✅ Check 16: server/routes tem ${routeCount} handlers HTTP declarados (>= 50 esperados).`);
} else {
    console.error(`❌ Check 16 FALHOU — server/routes tem apenas ${routeCount} handlers HTTP declarados.`);
    errors++;
}

// ── Check 17: contrato de boot documenta baseline SDK vanilla ──────────────

const REQUIRED_SDK_BASELINE = [
    'client.start',
    'client.stop',
    'client.forceStop',
    'client.ping',
    'client.listModels',
    'client.listSessions',
    'client.getLastSessionId',
    'client.deleteSession',
    'client.getForegroundSessionId',
    'client.setForegroundSessionId',
    'session.create',
    'session.resume',
    'session.send',
    'session.sendAndWait',
    'session.streamEvents',
    'session.getMessages',
    'session.abort',
    'session.setModel',
    'session.log',
    'session.disconnect',
    'session.rpc',
    'session.permissions',
    'session.userInput',
    'session.hooks',
    'session.customTools',
    'session.systemMessage.customize',
    'session.infiniteSessions',
    'session.attachments.blob',
    'session.customProvider',
    'session.mcpServers',
    'session.customAgents',
    'session.skills',
    'telemetry.otel',
    'telemetry.traceContext',
];
const missingSdkBaseline = REQUIRED_SDK_BASELINE.filter(
    (capability) => !SDK_VANILLA_CAPABILITY_BASELINE.includes(capability),
);

if (missingSdkBaseline.length === 0) {
    console.log(`✅ Check 17: boot/contract cobre baseline SDK vanilla (${REQUIRED_SDK_BASELINE.length} capacidades).`);
} else {
    console.error(`❌ Check 17 FALHOU — boot/contract sem capacidades SDK: ${missingSdkBaseline.join(', ')}`);
    errors++;
}

// ── Check 18: SDK HTTP adapter expõe campos JSON-serializáveis do SDK ──────

const sdkSessionMiddlewareSrc = readFileSync(resolve('src/copilot/server/routes/sdk/session-middleware.js'), 'utf-8');
const sdkSessionMessagingSrc = readFileSync(resolve('src/copilot/server/routes/sdk/session-messaging.js'), 'utf-8');
const REQUIRED_SDK_ROUTE_FIELDS = [
    'configDir',
    'mcpServers',
    'agent',
    'skillDirectories',
    'disabledSkills',
    'infiniteSessions',
    'provider',
    'reasoningEffort',
    'LogMessageBodySchema',
];
const missingRouteFields = REQUIRED_SDK_ROUTE_FIELDS.filter(
    (field) => !sdkSessionMiddlewareSrc.includes(field) && !sdkSessionMessagingSrc.includes(field),
);

if (missingRouteFields.length === 0 && sdkSessionMessagingSrc.includes("router.post('/sessions/:id/log'")) {
    console.log('✅ Check 18: /sdk/sessions cobre configuração SDK JSON e session.log().');
} else {
    console.error(
        `❌ Check 18 FALHOU — /sdk/sessions sem campos/rotas SDK: ${missingRouteFields.join(', ') || 'session.log'}`,
    );
    errors++;
}

// ── Check 19: boot config centraliza variáveis operacionais ────────────────

const bootFiles = [
    'src/copilot/boot/index.js',
    'src/copilot/boot/config.js',
    'src/copilot/boot/workspace.js',
    'src/copilot/boot/skills.js',
    'src/copilot/boot/plan.js',
];
const missingBootFiles = bootFiles.filter((file) => !existsSync(resolve(file)));
const requiredBootEnvKeys = [
    'COPILOT_WORKING_DIRECTORY',
    'COPILOT_SKILL_DIRECTORIES',
    'COPILOT_PINNED_CONTEXT_DIRS',
    'LLM_B_TERMINAL_HOST',
    'LLM_B_TERMINAL_PORT',
    'COPILOT_CLI_URL',
];
const missingBootEnvKeys = requiredBootEnvKeys.filter((key) => !BOOT_CONFIG_ENV_KEYS.includes(key));
const terminalIndexSrc = readFileSync(resolve('src/copilot/terminal/index.js'), 'utf-8');
const sessionSetupSrc = readFileSync(resolve('src/copilot/agent/lifecycle/setup/session-setup.js'), 'utf-8');
const terminalStillHardcodesPinnedContext =
    terminalIndexSrc.includes("'.github', 'skills'") || terminalIndexSrc.includes("'.github', 'instructions'");
const sessionSetupStillUsesProcessCwd = sessionSetupSrc.includes('.workingDirectory(process.cwd())');

if (
    missingBootFiles.length === 0 &&
    missingBootEnvKeys.length === 0 &&
    !terminalStillHardcodesPinnedContext &&
    !sessionSetupStillUsesProcessCwd
) {
    console.log('✅ Check 19: boot/ centraliza workspace, skills, portas e contexto pinado.');
} else {
    console.error(
        `❌ Check 19 FALHOU — boot incompleto: files=${missingBootFiles.join(', ') || 'ok'} env=${missingBootEnvKeys.join(', ') || 'ok'} terminalPinned=${terminalStillHardcodesPinnedContext} sessionCwd=${sessionSetupStillUsesProcessCwd}`,
    );
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
