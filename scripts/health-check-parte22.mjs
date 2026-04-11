#!/usr/bin/env node
/**
 * scripts/health-check-parte22.mjs
 * Verificação consolidada dos critérios PARTE-22 — critérios rigorosos
 * Score máximo: 100 pontos distribuídos em 12 critérios C1-C12
 *
 * Uso: node scripts/health-check-parte22.mjs [--json]
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

const argv = process.argv.slice(2);
const jsonOutput = argv.includes('--json');

const results = {};
let totalScore = 0;
const maxScore = 100;

/**
 * Registra e executa um critério de verificação
 * @param {string} id
 * @param {string} label
 * @param {number} weight
 * @param {() => {score: number, detail: string}} fn
 */
function check(id, label, weight, fn) {
    try {
        const { score, detail } = fn();
        const capped = Math.min(score, weight);
        results[id] = { label, weight, score: capped, detail, pass: capped >= weight };
        totalScore += capped;
    } catch (e) {
        results[id] = { label, weight, score: 0, detail: `ERROR: ${e.message}`, pass: false };
    }
}

/**
 * Executa comando shell e retorna stdout como string
 * @param {string} cmd
 * @returns {string}
 */
function sh(cmd) {
    return execSync(cmd, { encoding: 'utf8', shell: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

// ─── C1: Zero god files >250 LoC ────────────────────────────────────────────
check('C1', 'Zero god files >250 LoC', 20, () => {
    const out = sh(
        "find src/copilot -name '*.js' " +
        "! -name 'index.js' ! -name 'types.js' ! -name 'constants.js' ! -name '*.test.js' " +
        "| xargs wc -l 2>/dev/null | awk '$1>250{print $2}' | grep -v total || true"
    );
    const violations = out ? out.split('\n').filter(Boolean) : [];
    return {
        score: violations.length === 0 ? 20 : Math.max(0, 20 - violations.length),
        detail: `${violations.length} violação(ões)${violations.length > 0 ? ': ' + violations.slice(0, 3).join(', ') : ''}`,
    };
});

// ─── C2: Zero EventEmitter direto ───────────────────────────────────────────
check('C2', 'Zero EventEmitter direto', 10, () => {
    const out = sh(
        "grep -rl 'new EventEmitter\\|extends EventEmitter' src/copilot/ " +
        "--include='*.js' 2>/dev/null | grep -v '\\.test\\.' | wc -l"
    );
    const count = parseInt(out) || 0;
    return { score: count === 0 ? 10 : 0, detail: `${count} arquivo(s) com EventEmitter direto` };
});

// ─── C3: EventBus adoption ≥ 80% ────────────────────────────────────────────
check('C3', 'EventBus adoption ≥ 80%', 10, () => {
    const ebFiles = parseInt(sh(
        "grep -rl 'getEventBus\\|EventBus' src/copilot/ --include='*.js' 2>/dev/null | grep -v '\\.test\\.' | wc -l"
    )) || 0;
    const totalFiles = parseInt(sh("find src/copilot -name '*.js' ! -name '*.test.js' | wc -l")) || 1;
    const pct = (ebFiles / totalFiles) * 100;
    const score = pct >= 80 ? 10 : pct >= 40 ? 5 : 0;
    return { score, detail: `${ebFiles}/${totalFiles} = ${pct.toFixed(1)}% (meta: ≥80%)` };
});

// ─── C4: DI tokens ≥ 40 ─────────────────────────────────────────────────────
check('C4', 'DI tokens ≥ 40', 8, () => {
    let tokens = 0;
    try {
        const json = JSON.parse(sh('node scripts/arch-health.mjs --json 2>/dev/null'));
        tokens = json.diTokens ?? 0;
    } catch {
        tokens = parseInt(sh("grep -c 'Symbol(' src/copilot/core/di-tokens.js 2>/dev/null || echo 0")) || 0;
    }
    const score = tokens >= 40 ? 8 : tokens >= 25 ? 4 : tokens >= 13 ? 2 : 0;
    return { score, detail: `${tokens} tokens (meta: ≥40)` };
});

// ─── C5: Zero deep imports ───────────────────────────────────────────────────
check('C5', 'Zero deep imports', 5, () => {
    let deep = 0;
    try {
        const json = JSON.parse(sh('node scripts/arch-health.mjs --json 2>/dev/null'));
        deep = json.deepImports?.refined ?? 99;
    } catch {
        deep = parseInt(sh(
            "grep -rh \"from '#copilot/\" src/copilot/ --include='*.js' 2>/dev/null | " +
            "grep -oP \"from '#copilot/[^']*'\" | grep -P \"#copilot/[^/']+/[^'\\\"]+\" | wc -l"
        )) || 99;
    }
    return { score: deep === 0 ? 5 : 0, detail: `${deep} deep imports (meta: 0)` };
});

// ─── C6: Zero typecheck errors ───────────────────────────────────────────────
check('C6', 'Zero typecheck errors (node)', 7, () => {
    const out = sh('npm run typecheck:node 2>&1 | grep "error TS" | wc -l');
    const count = parseInt(out) || 0;
    return { score: count === 0 ? 7 : 0, detail: `${count} erro(s) TypeScript (meta: 0)` };
});

// ─── C7: Test coverage ≥ 70% ────────────────────────────────────────────────
check('C7', 'Test coverage ≥ 70% por módulo crítico', 15, () => {
    // Heurística: verifica ratio de test files por módulo
    const criticalModules = ['agent', 'sdk', 'terminal', 'tools', 'observability', 'hooks', 'bridges', 'api', 'services'];
    let covered = 0;
    for (const mod of criticalModules) {
        const prodFiles = parseInt(sh(`find src/copilot/${mod} -name '*.js' ! -name '*.test.js' 2>/dev/null | wc -l`)) || 0;
        const testFiles = parseInt(sh(`find tests -name '*${mod}*' -o -name '*${mod.replace('-', '_')}*' 2>/dev/null | wc -l`)) || 0;
        const testRatio = prodFiles > 0 ? testFiles / prodFiles : 0;
        if (testRatio >= 0.35) covered++;  // heurística: ≥35% de test files = indício de ≥70% coverage funcional
    }
    const pct = (covered / criticalModules.length) * 100;
    const score = covered >= criticalModules.length ? 15 : Math.floor((covered / criticalModules.length) * 15);
    return { score, detail: `${covered}/${criticalModules.length} módulos com cobertura heurística ≥35%` };
});

// ─── C8: Fan-out máximo ≤ 8 ─────────────────────────────────────────────────
check('C8', 'Fan-out máximo ≤ 8 por módulo', 5, () => {
    let maxFanOut = 0;
    let worstModule = 'unknown';
    try {
        const json = JSON.parse(sh('node scripts/arch-health.mjs --json 2>/dev/null'));
        const details = json.fanOut?.details || {};
        for (const [mod, fo] of Object.entries(details)) {
            if (fo > maxFanOut) { maxFanOut = fo; worstModule = mod; }
        }
    } catch {
        maxFanOut = 99;
    }
    return {
        score: maxFanOut <= 8 ? 5 : maxFanOut <= 10 ? 2 : 0,
        detail: `max=${maxFanOut} (${worstModule}) — meta: ≤8`,
    };
});

// ─── C9: Singletons lazy-init ≤ 15 ──────────────────────────────────────────
check('C9', 'Singletons lazy-init ≤ 15', 5, () => {
    let refined = 99;
    try {
        const json = JSON.parse(sh('node scripts/arch-health.mjs --json 2>/dev/null'));
        refined = json.singletons?.refined ?? 99;
    } catch {
        refined = parseInt(sh(
            "grep -rn '^let ' src/copilot/ --include='*.js' 2>/dev/null | " +
            "grep -E '= null;$|= false;$|= 0;$' | grep -v log | wc -l"
        )) || 99;
    }
    const score = refined <= 15 ? 5 : refined <= 30 ? 2 : 0;
    return { score, detail: `${refined} singletons refined (meta: ≤15)` };
});

// ─── C10: services/ fachada cobrindo api/ + terminal/ ────────────────────────
check('C10', 'services/ facade — api/ e terminal/ não importam L4 direto', 7, () => {
    const apiViolations = parseInt(sh(
        "grep -rl \"from '#copilot/agent\\|from '#copilot/conversation-hub\\|from '#copilot/channel\" " +
        "src/copilot/api/ --include='*.js' 2>/dev/null | grep -v '\\.test\\.' | wc -l"
    )) || 0;
    const termViolations = parseInt(sh(
        "grep -rl \"from '#copilot/agent\\|from '#copilot/conversation-hub\\|from '#copilot/channel\" " +
        "src/copilot/terminal/ --include='*.js' 2>/dev/null | grep -v '\\.test\\.' | wc -l"
    )) || 0;
    const total = apiViolations + termViolations;
    return {
        score: total === 0 ? 7 : 0,
        detail: `${total} bypass(es) direto(s) de L4 em api/(${apiViolations}) + terminal/(${termViolations})`,
    };
});

// ─── C11: events/ module adoption ───────────────────────────────────────────
check('C11', 'events/ module — zero strings de evento inline', 5, () => {
    const eventsModuleExists = existsSync('src/copilot/events');
    if (!eventsModuleExists) {
        return { score: 0, detail: 'src/copilot/events/ não existe ainda' };
    }
    const inline = parseInt(sh(
        "grep -rn \"'agent:\\|'hub:\\|'terminal:\\|'system:\\|'dialog:\\|'audit:\\|'rpc:\" " +
        "src/copilot/ --include='*.js' 2>/dev/null | grep -v '\\.test\\.' | grep -v \"#copilot/events\" | wc -l"
    )) || 0;
    return { score: inline === 0 ? 5 : 0, detail: `${inline} strings de evento inline (meta: 0)` };
});

// ─── C12: Circuit breakers ≥ 6 ───────────────────────────────────────────────
check('C12', 'Circuit breakers ≥ 6 ativos', 3, () => {
    const cbFiles = parseInt(sh(
        "grep -rl 'CircuitBreaker\\|circuitBreaker\\|circuit_breaker' src/copilot/ " +
        "--include='*.js' 2>/dev/null | grep -v '\\.test\\.' | wc -l"
    )) || 0;
    const score = cbFiles >= 6 ? 3 : cbFiles >= 3 ? 1 : 0;
    return { score, detail: `${cbFiles} arquivo(s) com circuit breaker (meta: ≥6)` };
});

// ─── OUTPUT ──────────────────────────────────────────────────────────────────

const percentage = (totalScore / maxScore * 100).toFixed(1);
const grade = totalScore >= 95 ? 'A+' : totalScore >= 85 ? 'A' : totalScore >= 75 ? 'B' :
    totalScore >= 65 ? 'C' : totalScore >= 55 ? 'D' : 'F';

if (jsonOutput) {
    console.log(JSON.stringify({ score: totalScore, max: maxScore, percentage: parseFloat(percentage), grade, results }, null, 2));
} else {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║        PARTE-22 HEALTH CHECK — Critérios Rigorosos        ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    Object.entries(results).forEach(([id, r]) => {
        const icon = r.pass ? '✅' : '❌';
        const bar = r.weight > 0 ? `(${r.score}/${r.weight}pt)` : '';
        console.log(`${icon} ${id} ${bar}: ${r.label}`);
        console.log(`   → ${r.detail}`);
    });

    console.log('\n' + '─'.repeat(60));
    console.log(`SCORE PARTE-22: ${totalScore}/${maxScore} (${percentage}%) — Nota: ${grade}`);
    console.log('─'.repeat(60));

    if (grade === 'F') {
        console.log('\n⚠️  Execute as Faixas O1~O7 da PARTE-22C para começar a melhorar o score.\n');
    }
}

process.exit(totalScore >= maxScore * 0.9 ? 0 : 1);
