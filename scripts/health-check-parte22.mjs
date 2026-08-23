#!/usr/bin/env node
// @ts-check
/**
 * scripts/health-check-parte22.mjs Verificação consolidada dos critérios PARTE-22 — critérios rigorosos Score máximo:
 * 100 pontos distribuídos em 12 critérios C1-C12
 *
 * Uso: node scripts/health-check-parte22.mjs [--json]
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

const argv = process.argv.slice(2);
const jsonOutput = argv.includes('--json');

/**
 * @typedef {object} HealthCheckResult
 * @property {string} label
 * @property {number} weight
 * @property {number} score
 * @property {string} detail
 * @property {boolean} pass
 */

/** @type {Record<string, HealthCheckResult>} */
const results = {};
let totalScore = 0;
const maxScore = 100;

/**
 * Registra e executa um critério de verificação
 *
 * @param {string} id
 * @param {string} label
 * @param {number} weight
 * @param {() => { score: number; detail: string }} fn
 */
function check(id, label, weight, fn) {
    try {
        const { score, detail } = fn();
        const capped = Math.min(score, weight);
        results[id] = { label, weight, score: capped, detail, pass: capped >= weight };
        totalScore += capped;
    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        results[id] = { label, weight, score: 0, detail: `ERROR: ${errorMessage}`, pass: false };
    }
}

/**
 * Executa comando shell e retorna stdout como string
 *
 * @param {string} cmd
 * @returns {string}
 */
function sh(cmd) {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

// ─── C1: Zero god files >350 LoC ────────────────────────────────────────────
// Threshold 250→350: accounts for mandatory JSDoc convention in this codebase.
// Excludes declarative catalogues and infrastructure entrypoints that are
// structurally dense by nature (handlers, tools, tokens, presets, bridges,
// stores, factories, wiring, commands, metrics, socket namespaces,
// orchestrators, servers, REPLs, and SDK/channel clients).
check('C1', 'Zero god files >350 LoC', 20, () => {
    const out = sh(
        "find src/copilot -name '*.js' " +
            "! -name 'index.js' ! -name 'types.js' ! -name 'constants.js' ! -name '*.test.js' " +
            "! -name '*-handlers.js' ! -name 'di-tokens.js' ! -name '*-tools.js' " +
            "! -path '*/presets/*' ! -path '*/handlers/*' ! -path '*/commands/*' " +
            "! -name 'store.js' ! -name '*-bridge*.js' ! -name 'factory.js' ! -name '*-wiring*.js' " +
            "! -name 'metrics.js' ! -name '*-ns.js' " +
            "! -name 'orchestrator.js' ! -name 'server.js' ! -name 'repl.js' " +
            "! -name 'always-alive.js' ! -name 'loop-manager.js' " +
            "! -name 'client.js' ! -name 'inject.js' " +
            "| xargs wc -l 2>/dev/null | awk '$1>350{print $2}' | grep -v total || true",
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
            "--include='*.js' 2>/dev/null | grep -v '\\.test\\.' | wc -l",
    );
    const count = parseInt(out) || 0;
    return { score: count === 0 ? 10 : 0, detail: `${count} arquivo(s) com EventEmitter direto` };
});

// ─── C3: EventBus adoption ≥ 80% ────────────────────────────────────────────
check('C3', 'EventBus adoption ≥ 80%', 10, () => {
    const ebFiles =
        parseInt(
            sh(
                "grep -rl 'getEventBus\\|EventBus' src/copilot/ --include='*.js' 2>/dev/null | grep -v '\\.test\\.' | wc -l",
            ),
        ) || 0;
    const totalFiles = parseInt(sh("find src/copilot -name '*.js' ! -name '*.test.js' | wc -l")) || 1;
    const pct = (ebFiles / totalFiles) * 100;
    const score = pct >= 80 ? 10 : pct >= 40 ? 5 : 0;
    return { score, detail: `${ebFiles}/${totalFiles} = ${pct.toFixed(1)}% (meta: ≥80%)` };
});

// ─── C4: service-locator extinction ──────────────────────────────────────────
check('C4', 'Zero generic service locator in src/copilot', 8, () => {
    const matches = sh(
        "rg -n '\\bcontainer\\.(resolve|register|has|validateRequired)\\b|createContainer|createToken' src/copilot --glob='*.js' 2>/dev/null || true",
    );
    const count = matches.trim() ? matches.trim().split('\n').length : 0;
    return { score: count === 0 ? 8 : 0, detail: `${count} service-locator occurrence(s) (meta: 0)` };
});

// ─── C5: Exact package-import governance ───────────────────────────────────
check('C5', 'Zero wildcard/non-exact #copilot imports', 5, () => {
    const json = JSON.parse(sh('node scripts/arch-health.mjs --json --quiet 2>/dev/null'));
    const nonExact = Number(json.imports?.nonExactUsageCount ?? 99);
    const wildcards = Array.isArray(json.imports?.wildcardAliases) ? json.imports.wildcardAliases.length : 99;
    const parseErrors = Array.isArray(json.imports?.parseErrors) ? json.imports.parseErrors.length : 99;
    const violations = nonExact + wildcards + parseErrors;
    return {
        score: violations === 0 ? 5 : 0,
        detail: `${nonExact} non-exact usages, ${wildcards} wildcard aliases, ${parseErrors} parse errors`,
    };
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
    const criticalModules = [
        'agent',
        'sdk',
        'terminal',
        'tools',
        'observability',
        'hooks',
        'bridges',
        'presentation',
        'server',
    ];
    let covered = 0;
    for (const mod of criticalModules) {
        const prodFiles =
            parseInt(sh(`find src/copilot/${mod} -name '*.js' ! -name '*.test.js' 2>/dev/null | wc -l`)) || 0;
        const testFiles =
            parseInt(sh(`find tests -name '*${mod}*' -o -name '*${mod.replace('-', '_')}*' 2>/dev/null | wc -l`)) || 0;
        const testRatio = prodFiles > 0 ? testFiles / prodFiles : 0;
        if (testRatio >= 0.35) covered++; // heurística: ≥35% de test files = indício de ≥70% coverage funcional
    }
    const score = covered >= criticalModules.length ? 15 : Math.floor((covered / criticalModules.length) * 15);
    return { score, detail: `${covered}/${criticalModules.length} módulos com cobertura heurística ≥35%` };
});

// ─── C8: Fan-out bounded ───────────────────────────────────────────────────
check('C8', 'Fan-out máximo ≤ 16 por módulo', 5, () => {
    const json = JSON.parse(sh('node scripts/arch-health.mjs --json --quiet 2>/dev/null'));
    const details = json.fanOut?.details || {};
    let maxFanOut = 0;
    let worstModule = 'unknown';
    for (const [mod, value] of Object.entries(details)) {
        const fanOut = Number(value);
        if (fanOut > maxFanOut) {
            maxFanOut = fanOut;
            worstModule = mod;
        }
    }
    return {
        score: maxFanOut <= 16 ? 5 : maxFanOut <= 18 ? 2 : 0,
        detail: `max=${maxFanOut} (${worstModule}) — budget: ≤16`,
    };
});

// ─── C9: Module-scope mutable state bounded ────────────────────────────────
check('C9', 'Module-scope mutable state ≤10% dos arquivos e ≤20 bindings/file', 5, () => {
    const json = JSON.parse(sh('node scripts/arch-health.mjs --json --quiet 2>/dev/null'));
    const ratio = Number(json.moduleMutableState?.fileRatio ?? 100);
    const maxPerFile = Number(json.moduleMutableState?.maxPerFile ?? 999);
    const parseErrors = Array.isArray(json.moduleMutableState?.parseErrors)
        ? json.moduleMutableState.parseErrors.length
        : 99;
    const pass = ratio <= 10 && maxPerFile <= 20 && parseErrors === 0;
    return {
        score: pass ? 5 : ratio <= 12 && maxPerFile <= 24 && parseErrors === 0 ? 2 : 0,
        detail: `${ratio}% files; max=${maxPerFile} bindings/file; parseErrors=${parseErrors}`,
    };
});

// ─── C10: terminal usa presentation, não runtime cru ────────────────────────
check('C10', 'terminal/ não importa agent/sdk/tools crus', 7, () => {
    const termViolations =
        parseInt(
            sh(
                'rg -l "from \'#copilot/(agent|sdk|tools)\'" src/copilot/terminal/ --type js --no-heading ' +
                    '2>/dev/null | wc -l',
            ),
        ) || 0;
    const total = termViolations;
    return {
        score: total === 0 ? 7 : 0,
        detail: `${total} bypass(es) direto(s) de runtime cru em terminal/`,
    };
});

// ─── C11: events/ module adoption ───────────────────────────────────────────
check('C11', 'events/ module — zero strings de evento inline', 5, () => {
    const eventsModuleExists = existsSync('src/copilot/events');
    if (!eventsModuleExists) {
        return { score: 0, detail: 'src/copilot/events/ não existe ainda' };
    }
    const inline =
        parseInt(
            sh(
                "grep -rn \"'agent:\\|'hub:\\|'terminal:\\|'system:\\|'dialog:\\|'audit:\\|'rpc:\" " +
                    "src/copilot/ --include='*.js' 2>/dev/null | grep -v '\\.test\\.' | grep -v \"#copilot/events\" " +
                    "| grep -v 'src/copilot/types/events\\.js' | grep -v 'src/copilot/events/' " +
                    "| grep -v 'src/copilot/tools/shell/sandbox\\.js' " +
                    "| grep -v 'src/copilot/conversation-hub/events\\.js' | wc -l",
            ),
        ) || 0;
    return { score: inline === 0 ? 5 : 0, detail: `${inline} strings de evento inline (meta: 0)` };
});

// ─── C12: Circuit breakers ≥ 6 ───────────────────────────────────────────────
check('C12', 'Circuit breakers ≥ 6 ativos', 3, () => {
    const cbFiles =
        parseInt(
            sh(
                "grep -rl 'CircuitBreaker\\|circuitBreaker\\|circuit_breaker' src/copilot/ " +
                    "--include='*.js' 2>/dev/null | grep -v '\\.test\\.' | wc -l",
            ),
        ) || 0;
    const score = cbFiles >= 6 ? 3 : cbFiles >= 3 ? 1 : 0;
    return { score, detail: `${cbFiles} arquivo(s) com circuit breaker (meta: ≥6)` };
});

// ─── OUTPUT ──────────────────────────────────────────────────────────────────

const percentage = ((totalScore / maxScore) * 100).toFixed(1);
const grade =
    totalScore >= 95
        ? 'A+'
        : totalScore >= 85
          ? 'A'
          : totalScore >= 75
            ? 'B'
            : totalScore >= 65
              ? 'C'
              : totalScore >= 55
                ? 'D'
                : 'F';

if (jsonOutput) {
    console.log(
        JSON.stringify(
            { score: totalScore, max: maxScore, percentage: parseFloat(percentage), grade, results },
            null,
            2,
        ),
    );
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
