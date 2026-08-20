#!/usr/bin/env node
// @ts-check
/**
 * scripts/arch-health.mjs
 *
 * Gera relatório JSON de métricas de saúde arquitetural do sistema copilot.
 *
 * Métricas:
 *
 * - barrel_ratio: % de módulos com barrel index.js
 * - singleton_count: contagem de padrões singleton (global mutable)
 * - fan_out: fan-out máximo e médio por módulo
 * - violation_count: violações de camada
 * - deep_import_count: imports profundos (non-barrel)
 * - di_token_count: tokens DI registrados
 * - test_count: testes unitários encontrados
 * - health_score: score calculado (A-F)
 *
 * Uso: node scripts/arch-health.mjs [--json] [--quiet]
 *
 * @module scripts/arch-health
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const COPILOT_ROOT = 'src/copilot';
const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const quiet = args.includes('--quiet');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recursivamente lista todos os .js no diretório.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function walkJs(dir) {
    /** @type {string[]} */
    const results = [];
    if (!existsSync(dir)) return results;
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            results.push(...walkJs(full));
        } else if (entry.endsWith('.js')) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Lista subdiretórios de primeiro nível.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function listModules(dir) {
    if (!existsSync(dir)) return [];
    // Artefatos operacionais e documentação não são módulos de runtime e,
    // portanto, não participam da política de barrels do código-fonte.
    const EXCLUDE = new Set(['.ai', '.github', 'docs', 'logs', 'node_modules']);
    return readdirSync(dir).filter((e) => {
        if (EXCLUDE.has(e)) return false;
        const full = join(dir, e);
        return statSync(full).isDirectory();
    });
}

// ─── Métricas ────────────────────────────────────────────────────────────────

/**
 * Calcula barrel ratio: % de módulos com index.js.
 *
 * @returns {{ total: number; withBarrel: number; ratio: number; missing: string[] }}
 */
function barrelRatio() {
    const modules = listModules(COPILOT_ROOT);
    const missing = modules.filter((m) => !existsSync(join(COPILOT_ROOT, m, 'index.js')));
    const withBarrel = modules.length - missing.length;
    return {
        total: modules.length,
        withBarrel,
        ratio: modules.length > 0 ? Math.round((withBarrel / modules.length) * 100) : 0,
        missing,
    };
}

/**
 * Conta padrões singleton (let + módulo-escopo mutable) nos arquivos. Retorna contagem total e contagem refinada
 * (excluindo logger fallbacks e constantes de config).
 *
 * @returns {{ total: number; refined: number }}
 */
function singletonCount() {
    const files = walkJs(COPILOT_ROOT);
    let total = 0;
    let excluded = 0;
    const pattern = /^let\s+\w+\s*=/gm;
    // Patterns que NÃO são singletons reais — apenas primitivos de controle de fluxo:
    // logger fallbacks, boolean flags, counters, event-loop mutexes, config scalars.
    // NOTA (FAIXA-1C C9): objetos null-initialized que guardam instâncias reais (ex: _agent,
    // _client, _nerv, _tracer, _hub*) são singletons reais e NÃO devem ser excluídos.
    const excludeRe =
        /^let\s+(?:_?log\b|_logDir\b|configuredLevel\b|minLevel\b|_recordCompaction\b|_?broadcastSse\b|_idCounter\b|_pendingInputSeq\b|_sseEventIdCounter\b|_turnQueueDepth\b|_persistenceFailureCount\b|_flushScheduled\b|exitHandlerRegistered\b|_agentListenersRegistered\b|_beforeStopRegistered\b|_zodToJsonSchema\b|_mcpCircuitOpen\b|_mcpCircuitOpenAt\b|_bootAttemptCount\b|_permLogBytes\b|_backgroundCompactionThreshold\b|_stateDirReady\b|_fileCacheHits\b|_fileCacheMisses\b|_busy\b|_planMode\b|_showThinking\b|_showUsage\b|_showStreaming\b|_tokenSeq\b|shuttingDown\b|shutdownRegistered\b|_storeMutex\b|_sendTurnMutex\b|_writeQueue\b|_clearFn\b|_phase\b|_reflectionTimer\b|_registeredTools\b|_attachmentQueue\b|_injectHistory\b|_aliases\b|_infiniteSessionConfig\b|_toolsConfig\b|_startPromise\b|_rl\b|_deps\b)/;

    for (const f of files) {
        const src = readFileSync(f, 'utf-8');
        for (const line of src.split('\n')) {
            if (pattern.test(line)) {
                total++;
                if (excludeRe.test(line.trim())) {
                    excluded++;
                }
            }
            pattern.lastIndex = 0;
        }
    }
    return { total, refined: total - excluded };
}

/**
 * Calcula fan-out por módulo (unique imports de outros módulos).
 *
 * @returns {{ max: number; avg: number; details: Record<string, number> }}
 */
function fanOut() {
    const modules = listModules(COPILOT_ROOT);
    /** @type {Record<string, Set<string>>} */
    const deps = {};

    for (const mod of modules) {
        deps[mod] = new Set();
        const files = walkJs(join(COPILOT_ROOT, mod));
        // Conta apenas imports #copilot/ (inter-módulo) — ignora imports relativos intra-módulo
        const importRe = /(?:import|from)\s+['"]#copilot\/([^/'"\s]+)/g;

        for (const f of files) {
            const src = readFileSync(f, 'utf-8');
            let m;
            while ((m = importRe.exec(src)) !== null) {
                const target = m[1];
                if (target && target !== mod) {
                    deps[mod].add(target);
                }
            }
        }
    }

    /** @type {Record<string, number>} */
    const details = {};
    let max = 0;
    let sum = 0;
    for (const [mod, set] of Object.entries(deps)) {
        details[mod] = set.size;
        if (set.size > max) max = set.size;
        sum += set.size;
    }
    const avg = modules.length > 0 ? Math.round((sum / modules.length) * 10) / 10 : 0;

    return { max, avg, details };
}

/**
 * Conta deep imports (non-barrel #copilot/module/subfile/...). Retorna total e refinado (excluindo allow-list).
 *
 * FAIXA-1C C5: regex agora captura imports com 2+ segmentos após o módulo-raiz (ex: #copilot/a/b/c). A regex anterior
 * só capturava exatamente 2 segmentos, ignorando paths com 3+ partes.
 *
 * @returns {{ total: number; refined: number }}
 */
function deepImportCount() {
    const files = walkJs(COPILOT_ROOT);
    let total = 0;
    let allowListed = 0;
    // C5: capturar qualquer caminho com pelo menos 2 segmentos após #copilot/
    const deepRe = /#copilot\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9_./-]+)+/g;
    // Allow-list: imports justificáveis (typedef-only, logger ou sdk/types)
    const allowListRe = /#copilot\/(?:observability\/logger|sdk\/types)(?:\/|$)/;

    for (const f of files) {
        const src = readFileSync(f, 'utf-8');
        for (const line of src.split('\n')) {
            const trimmed = line.trim();
            // Exclui linhas de comentário/JSDoc (não são imports reais)
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
                continue;
            }
            // Exclui linhas que são apenas @typedef (JSDoc type-only imports)
            if (trimmed.startsWith('@typedef') || trimmed.includes('@typedef {import(')) {
                continue;
            }
            deepRe.lastIndex = 0;
            let m;
            while ((m = deepRe.exec(trimmed)) !== null) {
                total++;
                if (allowListRe.test(m[0])) allowListed++;
            }
        }
    }
    return { total, refined: total - allowListed };
}

/**
 * Conta emissores locais (classes que estendem BaseEmitter em vez de emitir via EventBus).
 *
 * FAIXA-1C C2: este padrão indica que eventos não passam pelo EventBus central, tornando subscribers impossíveis de
 * adicionar sem modificar o emissor.
 *
 * @returns {{ localEmitterCount: number; files: string[] }}
 */
function localEmitterCount() {
    const files = walkJs(COPILOT_ROOT);
    const extendsRe = /\bextends\s+BaseEmitter\b/;
    // Emitters que têm bridge configurado via bridgeEmitter() — não penalizar
    // FAIXA-2A: always-alive.js → agent + dialogLoop + handoff bridge
    //           entry.js        → HookBus (hooks/bus.js) bridge
    const BRIDGED = new Set([
        'agent/always-alive.js', // bridges: agent, dialogLoop, handoff
        'hooks/bus.js', // bridge: HookBus → EventBus (via entry.js)
        'agent/dialog/loop-manager.js', // bridge: dialogLoop → EventBus (via always-alive.js)
        'agent/infra/handoff-manager.js', // bridge: handoff → EventBus (via always-alive.js)
    ]);
    /** @type {string[]} */
    const found = [];
    for (const f of files) {
        const src = readFileSync(f, 'utf-8');
        if (extendsRe.test(src)) {
            const rel = f.replace(COPILOT_ROOT + '/', '');
            if (!BRIDGED.has(rel)) {
                found.push(rel);
            }
        }
    }
    return { localEmitterCount: found.length, files: found };
}

/**
 * Detecta violações de camada via imports proibidos.
 *
 * FAIXA-1C violations: substitui o hardcoded 0 por detecção real de padrões como: core/ importando de agent/, services/
 * importando de terminal/api/, events/ importando de qualquer módulo de nível > L1.
 *
 * @returns {number} contagem de violações detectadas
 */
function layerViolations() {
    /** @type {{ module: string; forbids: RegExp }[]} */
    const rules = [
        // L0: core/ não pode importar de módulos higher-level
        {
            module: 'core',
            forbids:
                /#copilot\/(?:agent|terminal|api|services|bridges|hooks|tools|observability|conversation-hub|channel|sdk)/,
        },
        // L0: events/ não pode importar de módulos higher-level
        {
            module: 'events',
            forbids:
                /#copilot\/(?:agent|terminal|api|services|bridges|hooks|tools|observability|conversation-hub|channel|sdk)/,
        },
        // L0: db/ não pode importar de módulos higher-level
        {
            module: 'db',
            forbids:
                /#copilot\/(?:agent|terminal|api|services|bridges|hooks|tools|observability|conversation-hub|channel|sdk)/,
        },
        // L1: audit/ não pode importar de L3+
        {
            module: 'audit',
            forbids: /#copilot\/(?:agent|terminal|api|services|bridges|hooks|tools|conversation-hub|channel)/,
        },
    ];

    let violations = 0;
    for (const rule of rules) {
        const dir = join(COPILOT_ROOT, rule.module);
        if (!existsSync(dir)) continue;
        const files = walkJs(dir);
        for (const f of files) {
            const src = readFileSync(f, 'utf-8');
            for (const line of src.split('\n')) {
                const t = line.trim();
                if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
                if (!t.includes('#copilot/')) continue;
                if (rule.forbids.test(t)) violations++;
            }
        }
    }
    return violations;
}

/**
 * Conta tokens DI definidos em todos os módulos copilot que expõem `di-tokens.js`.
 *
 * @returns {number}
 */
function diTokenCount() {
    const files = walkJs(COPILOT_ROOT).filter((file) => file.endsWith('di-tokens.js'));
    let total = 0;
    for (const file of files) {
        const src = readFileSync(file, 'utf-8');
        const matches = src.match(/export const \w+ = createToken/g);
        total += matches ? matches.length : 0;
    }
    return total;
}

/**
 * Conta testes unitários.
 *
 * @returns {number}
 */
function testCount() {
    const testDir = 'tests/unit/copilot';
    if (!existsSync(testDir)) return 0;
    const files = walkJs(testDir);
    return files.filter((f) => f.endsWith('.spec.js')).length;
}

// ─── Health Score ────────────────────────────────────────────────────────────

/**
 * Calcula health score de A a F.
 *
 * FAIXA-1C: pesos recalibrados para refletir estado real:
 *
 * - singletons: threshold baixado (>10 penaliza; antes >20) para capturar os ~25 reais
 * - fan-out: mantido (>8 penaliza)
 * - violations: agora calculado real (não hardcoded 0)
 * - deepImports: peso aumentado (-0.5 por item; antes -0.25)
 * - localEmitters: nova penalidade para emissores locais (não passam pelo EventBus)
 * - tests: bonus reduzido (cap 5 pts, escala por 100 arquivos; antes cap 10 por 200 arquivos)
 *
 * @param {object} metrics
 * @param {number} metrics.barrelRatio
 * @param {number} metrics.singletons
 * @param {number} metrics.maxFanOut
 * @param {number} metrics.violations
 * @param {number} metrics.deepImports
 * @param {number} metrics.diTokens
 * @param {number} metrics.tests
 * @param {number} metrics.localEmitters
 * @returns {{ score: number; grade: string }}
 */
function calcHealthScore(metrics) {
    let score = 100;

    // Barrel coverage (max -20)
    score -= Math.max(0, (100 - metrics.barrelRatio) * 0.2);

    // Singletons (max -15, penalize >10 — threshold calibrado para realidade)
    score -= Math.min(15, Math.max(0, metrics.singletons - 10) * 1.0);

    // Fan-out (max -15, penalize >8)
    score -= Math.min(15, Math.max(0, metrics.maxFanOut - 8) * 2);

    // Violations (max -20, -5 each)
    score -= Math.min(20, metrics.violations * 5);

    // Deep imports — refined only (max -15, -0.5 each — peso dobrado para refletir impacto real)
    score -= Math.min(15, metrics.deepImports * 0.5);

    // Local emitters (max -10, -1.5 each — emissores que não usam EventBus)
    score -= Math.min(10, metrics.localEmitters * 1.5);

    // DI tokens (bonus up to +5 for 14+ tokens)
    score += Math.min(5, metrics.diTokens * 0.36);

    // Tests (bonus up to +5 for 100+ test files — reduzido de 10 para 5)
    score += Math.min(5, metrics.tests * 0.05);

    score = Math.round(Math.max(0, Math.min(100, score)));

    /** @type {string} */
    let grade;
    if (score >= 90) grade = 'A';
    else if (score >= 80) grade = 'B';
    else if (score >= 70) grade = 'C';
    else if (score >= 60) grade = 'D';
    else if (score >= 50) grade = 'E';
    else grade = 'F';

    return { score, grade };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const barrel = barrelRatio();
const singletons = singletonCount();
const fan = fanOut();
const deepImports = deepImportCount();
const diTokens = diTokenCount();
const tests = testCount();
const localEmitters = localEmitterCount();
const violations = layerViolations();

const { score, grade } = calcHealthScore({
    barrelRatio: barrel.ratio,
    singletons: singletons.refined,
    maxFanOut: fan.max,
    violations,
    deepImports: deepImports.refined,
    diTokens,
    tests,
    localEmitters: localEmitters.localEmitterCount,
});

const report = {
    timestamp: new Date().toISOString(),
    barrel: {
        total: barrel.total,
        withBarrel: barrel.withBarrel,
        ratio: `${barrel.ratio}%`,
        missing: barrel.missing,
    },
    singletons: { total: singletons.total, refined: singletons.refined },
    fanOut: {
        max: fan.max,
        avg: fan.avg,
        details: fan.details,
    },
    deepImports,
    diTokens,
    tests,
    localEmitters,
    violations,
    health: { score, grade },
};

if (jsonOnly) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
    if (!quiet) {
        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║              ARCHITECTURE HEALTH REPORT                       ║');
        console.log('╚══════════════════════════════════════════════════════════════╝\n');
        console.log(`  Barrel coverage:    ${barrel.withBarrel}/${barrel.total} (${barrel.ratio}%)`);
        if (barrel.missing.length > 0) {
            console.log(`    Missing barrels:  ${barrel.missing.join(', ')}`);
        }
        console.log(`  Singletons (let):   ${singletons.total} (refined: ${singletons.refined})`);
        console.log(`  Fan-out max/avg:    ${fan.max}/${fan.avg}`);
        console.log(`  Deep imports:       ${deepImports.total} (refined: ${deepImports.refined})`);
        console.log(`  DI tokens:          ${diTokens}`);
        console.log(`  Test files:         ${tests}`);
        console.log(`  Local emitters:     ${localEmitters.localEmitterCount} (${localEmitters.files.join(', ')})`);
        console.log(`  Layer violations:   ${violations}`);
        console.log('');
        console.log(`  ★ Health Score:     ${score}/100 (${grade})`);
        console.log('');
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
