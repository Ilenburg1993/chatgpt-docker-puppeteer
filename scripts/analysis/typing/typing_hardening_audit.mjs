#!/usr/bin/env node
// @ts-check
import { API as TypeScriptNativeAPI } from 'typescript/unstable/sync';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeJSDocCoverage, collectJsSourceFiles } from '../jsdoc_coverage_engine.mjs';
import { runStrictLaneAudit } from './strict_lane_audit.mjs';

const { values } = parseArgs({
    options: {
        format: { type: 'string', default: 'console' },
        scope: { type: 'string', default: 'full' },
        'show-gaps': { type: 'boolean', default: false },
    },
});

const AREA_THRESHOLDS = {
    src: 100,
    scripts: 95,
    tests: 90,
    overall: 100,
};

const PUBLIC_ROOTS = [
    'src/shared',
    'src/inference_gateway',
    'src/audit_agent',
    'src/server/api',
    'src/integration/lsp',
];

const STRICT_LANES_DIR = path.join('config', 'typing', 'strict');
const typeScriptNativeApi = new TypeScriptNativeAPI();

/** Descobre dinamicamente todas as lanes strict presentes na pasta dedicada. */
const STRICT_CONFIGS = fs
    .readdirSync(STRICT_LANES_DIR)
    .filter((f) => f.startsWith('tsconfig.strict.') && f.endsWith('.json'))
    .map((f) => path.join(STRICT_LANES_DIR, f))
    .sort();

/**
 * @param {string} file
 * @returns {boolean}
 */
function isLegacyFile(file) {
    const normalized = file.replace(/\\/g, '/');
    return (
        normalized.includes('/legacy/') ||
        normalized.startsWith('scripts/legacy/') ||
        normalized.startsWith('tests/legacy/')
    );
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function hasTsCheckDirective(file) {
    const text = fs.readFileSync(file, 'utf8');
    const head = text.split('\n').slice(0, 3).join('\n');
    return /@ts-check/.test(head);
}

/**
 * @param {string[]} files
 * @returns {{ total: number; withTsCheck: number; coveragePct: number }}
 */
function summarizeTsCheck(files) {
    const total = files.length;
    const withTsCheck = files.filter((file) => hasTsCheckDirective(file)).length;
    const coveragePct = total > 0 ? Number(((withTsCheck / total) * 100).toFixed(1)) : 100;
    return { total, withTsCheck, coveragePct };
}

/**
 * @param {string} configPath
 * @returns {{ files: number; fileNames: string[] }}
 */
function getStrictLaneFiles(configPath) {
    const absolutePath = path.resolve(configPath);
    const parsed = typeScriptNativeApi.parseConfigFile(absolutePath);
    return {
        files: parsed.fileNames.length,
        fileNames: parsed.fileNames.map((fileName) => path.relative(process.cwd(), fileName).replace(/\\/g, '/')),
    };
}

/**
 * @param {string[]} files
 * @returns {number}
 */
function countDirective(files) {
    let total = 0;
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        total += (text.match(/^\s*(?:\/\/|\/\*)\s*@ts-expect-error\b/gm) || []).length;
    }
    return total;
}

// Active files (excluindo legacy) para cálculo de cobertura de thresholds
const sourceFiles = collectJsSourceFiles(['src']).filter((file) => !isLegacyFile(file));
const scriptFiles = collectJsSourceFiles(['scripts']).filter((file) => !isLegacyFile(file));
const testFiles = collectJsSourceFiles(['tests']).filter((file) => !isLegacyFile(file));
const combinedFiles = [...new Set([...sourceFiles, ...scriptFiles, ...testFiles])];

// Legacy files rastreados como gap explícito (nunca ignorados)
const legacyFiles = [
    ...collectJsSourceFiles(['src']).filter(isLegacyFile),
    ...collectJsSourceFiles(['scripts']).filter(isLegacyFile),
    ...collectJsSourceFiles(['tests']).filter(isLegacyFile),
];

const requestedScope =
    String(values.scope || 'full')
        .trim()
        .toLowerCase() === 'public'
        ? 'public'
        : 'full';
const publicScopeFiles = collectJsSourceFiles(PUBLIC_ROOTS).filter((file) => !isLegacyFile(file));
const jsdocReport = analyzeJSDocCoverage({ files: combinedFiles, scope: 'full' });
const publicJSDocReport = analyzeJSDocCoverage({ files: publicScopeFiles, scope: 'full' });
const srcCoverage = summarizeTsCheck(sourceFiles);
const scriptsCoverage = summarizeTsCheck(scriptFiles);
const testsCoverage = summarizeTsCheck(testFiles);
const overallCoverage = summarizeTsCheck(combinedFiles);
const publicCoverage = summarizeTsCheck(publicScopeFiles);
const tsExpectErrorCount = countDirective(combinedFiles);

// Arquivos sem @ts-check (gap explícito)
const jsMissingTsCheck = combinedFiles.filter((file) => !hasTsCheckDirective(file));
const legacyMissingTsCheck = legacyFiles.filter((file) => !hasTsCheckDirective(file));
const allMissingTsCheck = [...jsMissingTsCheck, ...legacyMissingTsCheck];

// Análise de lanes strict
const strictLaneAudit = runStrictLaneAudit();

/** @type {Record<string, { files: number; fileNames: string[] }>} */
const strictLanes = {};
for (const config of STRICT_CONFIGS) {
    strictLanes[config] = getStrictLaneFiles(config);
}
typeScriptNativeApi.close();

const publicAnyTagsTotal = jsdocReport.files.reduce(
    (total, fileReport) =>
        total + fileReport.exported_symbols.reduce((fileTotal, symbol) => fileTotal + symbol.public_any_tags_count, 0),
    0,
);

const publicUnknownTagsTotal = jsdocReport.files.reduce(
    (total, fileReport) =>
        total +
        fileReport.exported_symbols.reduce((fileTotal, symbol) => fileTotal + symbol.public_unknown_tags_count, 0),
    0,
);

const publicScopePublicAnyTagsTotal = publicJSDocReport.files.reduce(
    (total, fileReport) =>
        total + fileReport.exported_symbols.reduce((fileTotal, symbol) => fileTotal + symbol.public_any_tags_count, 0),
    0,
);

const publicScopePublicUnknownTagsTotal = publicJSDocReport.files.reduce(
    (total, fileReport) =>
        total +
        fileReport.exported_symbols.reduce((fileTotal, symbol) => fileTotal + symbol.public_unknown_tags_count, 0),
    0,
);

const fullScopePasses =
    srcCoverage.coveragePct >= AREA_THRESHOLDS.src &&
    scriptsCoverage.coveragePct >= AREA_THRESHOLDS.scripts &&
    testsCoverage.coveragePct >= AREA_THRESHOLDS.tests &&
    overallCoverage.coveragePct >= AREA_THRESHOLDS.overall &&
    tsExpectErrorCount === 0;

const publicScopePasses =
    publicCoverage.coveragePct >= 100 &&
    publicJSDocReport.functions_missing_param_tags === 0 &&
    publicJSDocReport.functions_missing_options_typedef === 0 &&
    publicJSDocReport.unsafe_generic_tags_total === 0 &&
    publicScopePublicAnyTagsTotal === 0 &&
    tsExpectErrorCount === 0;

const passes = requestedScope === 'public' ? publicScopePasses : fullScopePasses;

const report = {
    scope: requestedScope,
    thresholds: AREA_THRESHOLDS,
    ts_check: {
        src: srcCoverage,
        scripts: scriptsCoverage,
        tests: testsCoverage,
        overall: overallCoverage,
    },
    js_files_missing_ts_check_total: allMissingTsCheck.length,
    js_files_missing_ts_check: allMissingTsCheck,
    strict_uncovered_files_total: strictLaneAudit.strict_uncovered_files_total,
    strict_uncovered_files: strictLaneAudit.strict_uncovered_files,
    public_scope: {
        files: publicCoverage.total,
        with_ts_check: publicCoverage.withTsCheck,
        coverage_pct: publicCoverage.coveragePct,
        exports_total: publicJSDocReport.exports_total,
        functions_total: publicJSDocReport.functions_total,
        functions_missing_param_tags: publicJSDocReport.functions_missing_param_tags,
        functions_missing_options_typedef: publicJSDocReport.functions_missing_options_typedef,
        unsafe_generic_tags_total: publicJSDocReport.unsafe_generic_tags_total,
        public_any_tags_total: publicScopePublicAnyTagsTotal,
        public_unknown_tags_total: publicScopePublicUnknownTagsTotal,
    },
    public_api: {
        public_any_tags_total: publicAnyTagsTotal,
        public_unknown_tags_total: publicUnknownTagsTotal,
        unsafe_generic_tags_total: jsdocReport.unsafe_generic_tags_total,
        functions_missing_options_typedef: jsdocReport.functions_missing_options_typedef,
    },
    directives: {
        ts_expect_error_total: tsExpectErrorCount,
    },
    strict_lanes: strictLanes,
    strict_lane_audit: strictLaneAudit,
    passes,
};

if (String(values.format || 'console').toLowerCase() === 'json') {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log('='.repeat(80));
    console.log('TYPING HARDENING AUDIT');
    console.log('='.repeat(80));
    if (requestedScope === 'public') {
        console.log(
            `@ts-check public scope: ${publicCoverage.withTsCheck}/${publicCoverage.total} (${publicCoverage.coveragePct}%)`,
        );
        console.log(`public_scope_files: ${publicCoverage.total}`);
        console.log(`public_scope_exports_total: ${publicJSDocReport.exports_total}`);
        console.log(`public_scope_functions_missing_param_tags: ${publicJSDocReport.functions_missing_param_tags}`);
        console.log(
            `public_scope_functions_missing_options_typedef: ${publicJSDocReport.functions_missing_options_typedef}`,
        );
        console.log(`public_scope_unsafe_generic_tags_total: ${publicJSDocReport.unsafe_generic_tags_total}`);
        console.log(`public_scope_public_any_tags_total: ${publicScopePublicAnyTagsTotal}`);
        console.log(`public_scope_public_unknown_tags_total: ${publicScopePublicUnknownTagsTotal}`);
        console.log(`@ts-expect-error total: ${tsExpectErrorCount}`);
        console.log('');
    } else {
        console.log(`@ts-check src: ${srcCoverage.withTsCheck}/${srcCoverage.total} (${srcCoverage.coveragePct}%)`);
        console.log(
            `@ts-check scripts: ${scriptsCoverage.withTsCheck}/${scriptsCoverage.total} (${scriptsCoverage.coveragePct}%)`,
        );
        console.log(
            `@ts-check tests: ${testsCoverage.withTsCheck}/${testsCoverage.total} (${testsCoverage.coveragePct}%)`,
        );
        console.log(
            `@ts-check overall: ${overallCoverage.withTsCheck}/${overallCoverage.total} (${overallCoverage.coveragePct}%)`,
        );
        console.log(`public_any_tags_total: ${publicAnyTagsTotal}`);
        console.log(`public_unknown_tags_total: ${publicUnknownTagsTotal}`);
        console.log(`unsafe_generic_tags_total: ${jsdocReport.unsafe_generic_tags_total}`);
        console.log(`functions_missing_options_typedef: ${jsdocReport.functions_missing_options_typedef}`);
        console.log(`@ts-expect-error total: ${tsExpectErrorCount}`);
        console.log('');
    }
    for (const [config, lane] of Object.entries(strictLanes)) {
        console.log(`- ${config}: ${lane.files} file(s)`);
    }

    if (values['show-gaps']) {
        console.log('');
        console.log('='.repeat(80));
        console.log('GAPS — arquivos sem @ts-check');
        console.log('='.repeat(80));
        if (allMissingTsCheck.length === 0) {
            console.log('✅ Nenhum arquivo sem @ts-check.');
        } else {
            for (const f of allMissingTsCheck) {
                console.log(`  MISSING_TS_CHECK  ${f}`);
            }
        }
        console.log('');
        console.log('GAPS — arquivos sem cobertura strict');
        console.log('='.repeat(80));
        if (strictLaneAudit.strict_uncovered_files_total === 0) {
            console.log('✅ Todos os arquivos elegíveis cobertos por alguma lane strict.');
        } else {
            for (const f of strictLaneAudit.strict_uncovered_files) {
                console.log(`  UNCOVERED_STRICT  ${f}`);
            }
        }
    }
}

if (!passes) {
    process.exit(1);
}
