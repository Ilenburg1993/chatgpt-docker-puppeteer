#!/usr/bin/env node
// @ts-check
/**
 * Architecture-health report aligned with the Copilot 2.1 topology.
 *
 * The report intentionally measures governed boundaries rather than rewarding root mega-barrels, exact package-map
 * imports rather than penalizing semantic sub-entrypoints, real module-scope mutable bindings rather than every `let`
 * inside functions, and the canonical global architecture checker rather than maintaining a third layer-rule table.
 *
 * @module scripts/arch-health
 */

import { resolveBabelParserOptions } from '#copilot/infra/public/diagnostic/code-analysis';
import { parse } from '@babel/parser';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { checkGlobalArchitecture } from './check-copilot-global-architecture.mjs';
import { buildCopilotBoundaryReport, buildCopilotExactImportReport } from './lib/copilot-package-imports.mjs';
import { listSourceFilesSync } from './lib/source-tree.mjs';

const COPILOT_ROOT = 'src/copilot';
const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const quiet = args.includes('--quiet');

/** @param {string} dir */
function walkJs(dir) {
    return listSourceFilesSync(dir, { extensions: ['.js', '.mjs', '.cjs'] });
}

function exactImportGovernance() {
    const report = buildCopilotExactImportReport({
        roots: ['src', 'scripts', 'tools'],
        forbiddenPrefixes: ['#copilot/testing/'],
    });
    const exactUsageCount = report.usages.length - report.nonExactUsages.length;
    return Object.freeze({
        scannedFiles: report.scannedFiles,
        parsedFiles: report.parsedFiles,
        usageCount: report.usages.length,
        uniqueSpecifiers: report.uniqueSpecifiers.length,
        exactUsageCount,
        nonExactUsageCount: report.nonExactUsages.length,
        nonExactSpecifiers: report.nonExactSpecifiers,
        wildcardAliases: report.wildcardAliases,
        parseErrors: report.parseErrors,
        forbiddenUsages: report.forbiddenUsages,
        success: report.success,
        usages: report.usages,
    });
}

/** @param {unknown} node */
function moduleVariableDeclaration(node) {
    if (!node || typeof node !== 'object') return null;
    const value = /** @type {Record<string,any>} */ (node);
    if (value['type'] === 'VariableDeclaration') return value;
    if (value['type'] === 'ExportNamedDeclaration' && value['declaration']?.type === 'VariableDeclaration') {
        return value['declaration'];
    }
    return null;
}

/**
 * Count actual `let`/`var` bindings in Program.body. Function-local control variables no longer masquerade as
 * process/global singletons.
 */
function moduleMutableState() {
    const files = walkJs(COPILOT_ROOT);
    /** @type {{file:string;bindings:number}[]} */
    const details = [];
    /** @type {{file:string;message:string}[]} */
    const parseErrors = [];
    let bindings = 0;

    for (const file of files) {
        const source = readFileSync(file, 'utf8');
        try {
            const extension = extname(file).toLowerCase();
            const lang = ['.ts', '.mts', '.cts'].includes(extension) ? 'ts' : 'js';
            const ast = parse(source, resolveBabelParserOptions(file, lang, { profile: 'structure' }));
            let fileBindings = 0;
            for (const statement of ast.program.body) {
                const declaration = moduleVariableDeclaration(statement);
                if (!declaration || (declaration.kind !== 'let' && declaration.kind !== 'var')) continue;
                fileBindings += declaration.declarations.length;
            }
            if (fileBindings > 0) {
                bindings += fileBindings;
                details.push({ file: file.replace(`${COPILOT_ROOT}/`, ''), bindings: fileBindings });
            }
        } catch (error) {
            parseErrors.push({ file, message: error instanceof Error ? error.message : String(error) });
        }
    }
    details.sort((left, right) => right.bindings - left.bindings || left.file.localeCompare(right.file));
    return Object.freeze({
        bindings,
        files: details.length,
        totalFiles: files.length,
        fileRatio: files.length > 0 ? Math.round((details.length / files.length) * 1000) / 10 : 0,
        maxPerFile: details[0]?.bindings ?? 0,
        details: Object.freeze(details),
        parseErrors: Object.freeze(parseErrors),
    });
}

/** @param {ReturnType<typeof exactImportGovernance>} importGovernance */
function fanOut(importGovernance) {
    const modules = Object.keys(buildCopilotBoundaryReport({ copilotRoot: COPILOT_ROOT }).details);
    /** @type {Record<string,Set<string>>} */
    const dependencies = Object.fromEntries(modules.map((module) => [module, new Set()]));
    for (const usage of importGovernance.usages) {
        const match = usage.file.match(/^src\/copilot\/([^/]+)\//u);
        const target = usage.specifier.match(/^#copilot\/([^/]+)/u)?.[1];
        const from = match?.[1];
        if (from && target && target !== from && dependencies[from]) dependencies[from].add(target);
    }
    const details = Object.fromEntries(Object.entries(dependencies).map(([module, targets]) => [module, targets.size]));
    const values = Object.values(details);
    return Object.freeze({
        max: values.length > 0 ? Math.max(...values) : 0,
        avg:
            values.length > 0
                ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
                : 0,
        details: Object.freeze(details),
    });
}

function localEmitterCount() {
    const bridged = new Set([
        'agent/always-alive.js',
        'hooks/bus.js',
        'agent/dialog/loop-manager.js',
        'agent/infra/handoff-manager.js',
    ]);
    const files = [];
    for (const file of walkJs(COPILOT_ROOT)) {
        if (!/\bextends\s+BaseEmitter\b/u.test(readFileSync(file, 'utf8'))) continue;
        const relative = file.replace(`${COPILOT_ROOT}/`, '');
        if (!bridged.has(relative)) files.push(relative);
    }
    return Object.freeze({ count: files.length, files: Object.freeze(files.sort()) });
}

function architectureFindings() {
    const findings = checkGlobalArchitecture();
    const bySeverity = {
        hard: findings.filter((finding) => finding.severity === 'hard'),
        soft: findings.filter((finding) => finding.severity === 'soft'),
        info: findings.filter((finding) => finding.severity === 'info'),
    };
    return Object.freeze({
        hard: bySeverity.hard.length,
        soft: bySeverity.soft.length,
        info: bySeverity.info.length,
        total: findings.length,
        findings: Object.freeze(findings),
    });
}

function diTokenCount() {
    let total = 0;
    for (const file of walkJs(COPILOT_ROOT).filter((entry) => entry.endsWith('di-tokens.js'))) {
        total += readFileSync(file, 'utf8').match(/export const \w+ = createToken/gu)?.length ?? 0;
    }
    return total;
}

function testCount() {
    return walkJs('tests/unit/copilot').filter((file) => file.endsWith('.spec.js')).length;
}

/**
 * Score is intentionally secondary to the raw metrics. It rewards governed boundaries/exact imports and penalizes
 * actual hard findings, unusually broad module fan-out, widespread module-scope mutability and unbridged emitters.
 */
/**
 * @param {{
 *   boundaries: ReturnType<typeof buildCopilotBoundaryReport>;
 *   imports: ReturnType<typeof exactImportGovernance>;
 *   mutable: ReturnType<typeof moduleMutableState>;
 *   fan: ReturnType<typeof fanOut>;
 *   architecture: ReturnType<typeof architectureFindings>;
 *   localEmitters: ReturnType<typeof localEmitterCount>;
 * }} metrics
 */
function calcHealthScore(metrics) {
    const { boundaries, imports, mutable, fan, architecture, localEmitters } = metrics;
    let score = 100;
    score -= Math.min(20, boundaries.uncovered.length * 5);
    score -= Math.min(
        20,
        imports.nonExactUsageCount * 2 +
            imports.wildcardAliases.length * 5 +
            imports.parseErrors.length * 5 +
            imports.forbiddenUsages.length * 5,
    );
    score -= Math.min(25, architecture.hard * 5);
    score -= Math.min(10, architecture.soft * 0.5);
    score -= Math.min(10, Math.max(0, mutable.fileRatio - 10));
    score -= Math.min(10, Math.max(0, fan.max - 12) * 1.5);
    score -= Math.min(10, localEmitters.count * 1.5);
    score = Math.round(Math.max(0, Math.min(100, score)));
    const grade =
        score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : score >= 50 ? 'E' : 'F';
    return Object.freeze({ score, grade });
}

const boundaries = buildCopilotBoundaryReport({ copilotRoot: COPILOT_ROOT });
const imports = exactImportGovernance();
const mutable = moduleMutableState();
const fan = fanOut(imports);
const architecture = architectureFindings();
const localEmitters = localEmitterCount();
const diTokens = diTokenCount();
const tests = testCount();
const health = calcHealthScore({ boundaries, imports, mutable, fan, architecture, localEmitters });

const report = Object.freeze({
    timestamp: new Date().toISOString(),
    boundaries,
    imports: Object.freeze({
        scannedFiles: imports.scannedFiles,
        parsedFiles: imports.parsedFiles,
        usageCount: imports.usageCount,
        uniqueSpecifiers: imports.uniqueSpecifiers,
        exactUsageCount: imports.exactUsageCount,
        nonExactUsageCount: imports.nonExactUsageCount,
        nonExactSpecifiers: imports.nonExactSpecifiers,
        wildcardAliases: imports.wildcardAliases,
        parseErrors: imports.parseErrors,
        forbiddenUsages: imports.forbiddenUsages,
        success: imports.success,
    }),
    moduleMutableState: mutable,
    fanOut: fan,
    architecture,
    diTokens,
    tests,
    localEmitters,
    health,
});

if (jsonOnly) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
    if (!quiet) {
        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║          COPILOT 2.1 ARCHITECTURE HEALTH REPORT             ║');
        console.log('╚══════════════════════════════════════════════════════════════╝\n');
        console.log(`  Boundary coverage:  ${boundaries.covered}/${boundaries.total} (${boundaries.ratio}%)`);
        console.log(`  Exact imports:      ${imports.exactUsageCount}/${imports.usageCount} usages`);
        console.log(`  Wildcard aliases:   ${imports.wildcardAliases.length}`);
        console.log(
            `  Module mutable:     ${mutable.bindings} bindings / ${mutable.files} files (${mutable.fileRatio}%)`,
        );
        console.log(`  Fan-out max/avg:    ${fan.max}/${fan.avg}`);
        console.log(
            `  Architecture:       hard=${architecture.hard} soft=${architecture.soft} info=${architecture.info}`,
        );
        console.log(`  DI tokens:          ${diTokens}`);
        console.log(`  Test files:         ${tests}`);
        console.log(`  Local emitters:     ${localEmitters.count}`);
        console.log(`\n  ★ Health Score:     ${health.score}/100 (${health.grade})\n`);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
