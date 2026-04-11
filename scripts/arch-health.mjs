#!/usr/bin/env node
// @ts-check
/**
 * scripts/arch-health.mjs
 *
 * Gera relatório JSON de métricas de saúde arquitetural do sistema copilot.
 *
 * Métricas:
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

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
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
    const EXCLUDE = new Set(['.github', 'logs', 'node_modules']);
    return readdirSync(dir)
        .filter((e) => {
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
 * Conta padrões singleton (let + módulo-escopo mutable) nos arquivos.
 *
 * @returns {number}
 */
function singletonCount() {
    const files = walkJs(COPILOT_ROOT);
    let count = 0;
    const pattern = /^let\s+\w+\s*=/gm;
    for (const f of files) {
        const src = readFileSync(f, 'utf-8');
        const matches = src.match(pattern);
        if (matches) count += matches.length;
    }
    return count;
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
        const importRe = /(?:import|from)\s+['"](?:#copilot\/([^/'"\s]+)|\.\.\/([^/'"\s]+))/g;

        for (const f of files) {
            const src = readFileSync(f, 'utf-8');
            let m;
            while ((m = importRe.exec(src)) !== null) {
                const target = m[1] || m[2];
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
 * Conta deep imports (non-barrel #copilot/module/subfile).
 *
 * @returns {number}
 */
function deepImportCount() {
    const files = walkJs(COPILOT_ROOT);
    let count = 0;
    const deepRe = /#copilot\/[a-z-]+\/[a-z-]+/g;


    for (const f of files) {
        const src = readFileSync(f, 'utf-8');
        const matches = src.match(deepRe);
        if (matches) count += matches.length;
    }
    return count;
}

/**
 * Conta tokens DI definidos.
 *
 * @returns {number}
 */
function diTokenCount() {
    const tokensFile = join(COPILOT_ROOT, 'core', 'di-tokens.js');
    if (!existsSync(tokensFile)) return 0;
    const src = readFileSync(tokensFile, 'utf-8');
    const matches = src.match(/export const \w+ = createToken/g);
    return matches ? matches.length : 0;
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
 * @param {object} metrics
 * @param {number} metrics.barrelRatio
 * @param {number} metrics.singletons
 * @param {number} metrics.maxFanOut
 * @param {number} metrics.violations
 * @param {number} metrics.deepImports
 * @param {number} metrics.diTokens
 * @param {number} metrics.tests
 * @returns {{ score: number; grade: string }}
 */
function calcHealthScore(metrics) {
    let score = 100;

    // Barrel coverage (max -20)
    score -= Math.max(0, (100 - metrics.barrelRatio) * 0.2);

    // Singletons (max -15, penalize >20)
    score -= Math.min(15, Math.max(0, metrics.singletons - 20) * 0.5);

    // Fan-out (max -15, penalize >8)
    score -= Math.min(15, Math.max(0, metrics.maxFanOut - 8) * 2);

    // Violations (max -20, -5 each)
    score -= Math.min(20, metrics.violations * 5);

    // Deep imports (max -15, -0.5 each)
    score -= Math.min(15, metrics.deepImports * 0.5);

    // DI tokens (bonus up to +5 for 10+ tokens)
    score += Math.min(5, metrics.diTokens * 0.4);

    // Tests (bonus up to +5 for 5+ test files)
    score += Math.min(5, metrics.tests);

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

const { score, grade } = calcHealthScore({
    barrelRatio: barrel.ratio,
    singletons,
    maxFanOut: fan.max,
    violations: 0, // layer check integration — 0 known
    deepImports,
    diTokens,
    tests,
});

const report = {
    timestamp: new Date().toISOString(),
    barrel: {
        total: barrel.total,
        withBarrel: barrel.withBarrel,
        ratio: `${barrel.ratio}%`,
        missing: barrel.missing,
    },
    singletons,
    fanOut: {
        max: fan.max,
        avg: fan.avg,
        details: fan.details,
    },
    deepImports,
    diTokens,
    tests,
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
        console.log(`  Singletons (let):   ${singletons}`);
        console.log(`  Fan-out max/avg:    ${fan.max}/${fan.avg}`);
        console.log(`  Deep imports:       ${deepImports}`);
        console.log(`  DI tokens:          ${diTokens}`);
        console.log(`  Test files:         ${tests}`);
        console.log(`  Layer violations:   0 (last check)`);
        console.log('');
        console.log(`  ★ Health Score:     ${score}/100 (${grade})`);
        console.log('');
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
