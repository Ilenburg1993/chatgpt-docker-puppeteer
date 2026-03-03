#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { analyzeJSDocCoverage, collectJsSourceFiles } from './jsdoc_coverage_engine.mjs';

const { values } = parseArgs({
    options: {
        format: { type: 'string', default: 'console' },
        scope: { type: 'string', default: 'full' },
    },
});

const AREA_THRESHOLDS = {
    src: 100,
    scripts: 95,
    tests: 90,
    overall: 90,
};

const PUBLIC_ROOTS = ['src/shared', 'src/inference_gateway', 'src/audit_agent', 'src/server/api', 'src/integration/lsp'];

const STRICT_CONFIGS = [
    'tsconfig.strict.public.json',
    'tsconfig.strict.core.json',
    'tsconfig.strict.server.json',
    'tsconfig.strict.infra.json',
    'tsconfig.strict.integration.json',
    'tsconfig.strict.audit.json',
    'tsconfig.strict.tools.json',
    'tsconfig.strict.tests.json',
];

/**
 * @param {string} file
 * @returns {boolean}
 */
function isLegacyExcluded(file) {
    const normalized = file.replace(/\\/g, '/');
    return normalized.includes('/legacy/') || normalized.startsWith('scripts/legacy/') || normalized.startsWith('tests/legacy/');
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
 * @returns {{ total: number, withTsCheck: number, coveragePct: number }}
 */
function summarizeTsCheck(files) {
    const total = files.length;
    const withTsCheck = files.filter(file => hasTsCheckDirective(file)).length;
    const coveragePct = total > 0 ? Number(((withTsCheck / total) * 100).toFixed(1)) : 100;
    return { total, withTsCheck, coveragePct };
}

/**
 * @param {string} configPath
 * @returns {{ files: number, fileNames: string[] }}
 */
function getStrictLaneFiles(configPath) {
    const absolutePath = path.resolve(configPath);
    const readResult = ts.readConfigFile(absolutePath, ts.sys.readFile);
    if (readResult.error) {
        throw new Error(ts.flattenDiagnosticMessageText(readResult.error.messageText, '\n'));
    }
    const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, path.dirname(absolutePath));
    return {
        files: parsed.fileNames.length,
        fileNames: parsed.fileNames.map(fileName => path.relative(process.cwd(), fileName).replace(/\\/g, '/')),
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

const sourceFiles = collectJsSourceFiles(['src']).filter(file => !isLegacyExcluded(file));
const scriptFiles = collectJsSourceFiles(['scripts']).filter(file => !isLegacyExcluded(file));
const testFiles = collectJsSourceFiles(['tests']).filter(file => !isLegacyExcluded(file));
const combinedFiles = [...new Set([...sourceFiles, ...scriptFiles, ...testFiles])];
const requestedScope = String(values.scope || 'full').trim().toLowerCase() === 'public' ? 'public' : 'full';
const publicScopeFiles = collectJsSourceFiles(PUBLIC_ROOTS).filter(file => !isLegacyExcluded(file));
const jsdocReport = analyzeJSDocCoverage({ files: combinedFiles, scope: 'full' });
const publicJSDocReport = analyzeJSDocCoverage({ files: publicScopeFiles, scope: 'full' });
const srcCoverage = summarizeTsCheck(sourceFiles);
const scriptsCoverage = summarizeTsCheck(scriptFiles);
const testsCoverage = summarizeTsCheck(testFiles);
const overallCoverage = summarizeTsCheck(combinedFiles);
const publicCoverage = summarizeTsCheck(publicScopeFiles);
const tsExpectErrorCount = countDirective(combinedFiles);

/** @type {Record<string, { files: number, fileNames: string[] }>} */
const strictLanes = {};
for (const config of STRICT_CONFIGS) {
    strictLanes[config] = getStrictLaneFiles(config);
}

const publicAnyTagsTotal = jsdocReport.files.reduce(
    (total, fileReport) =>
        total +
        fileReport.exported_symbols.reduce((fileTotal, symbol) => fileTotal + symbol.public_any_tags_count, 0),
    0
);

const publicUnknownTagsTotal = jsdocReport.files.reduce(
    (total, fileReport) =>
        total +
        fileReport.exported_symbols.reduce((fileTotal, symbol) => fileTotal + symbol.public_unknown_tags_count, 0),
    0
);

const publicScopePublicAnyTagsTotal = publicJSDocReport.files.reduce(
    (total, fileReport) =>
        total +
        fileReport.exported_symbols.reduce((fileTotal, symbol) => fileTotal + symbol.public_any_tags_count, 0),
    0
);

const publicScopePublicUnknownTagsTotal = publicJSDocReport.files.reduce(
    (total, fileReport) =>
        total +
        fileReport.exported_symbols.reduce((fileTotal, symbol) => fileTotal + symbol.public_unknown_tags_count, 0),
    0
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
            `@ts-check public scope: ${publicCoverage.withTsCheck}/${publicCoverage.total} (${publicCoverage.coveragePct}%)`
        );
        console.log(`public_scope_files: ${publicCoverage.total}`);
        console.log(`public_scope_exports_total: ${publicJSDocReport.exports_total}`);
        console.log(`public_scope_functions_missing_param_tags: ${publicJSDocReport.functions_missing_param_tags}`);
        console.log(
            `public_scope_functions_missing_options_typedef: ${publicJSDocReport.functions_missing_options_typedef}`
        );
        console.log(`public_scope_unsafe_generic_tags_total: ${publicJSDocReport.unsafe_generic_tags_total}`);
        console.log(`public_scope_public_any_tags_total: ${publicScopePublicAnyTagsTotal}`);
        console.log(`public_scope_public_unknown_tags_total: ${publicScopePublicUnknownTagsTotal}`);
        console.log(`@ts-expect-error total: ${tsExpectErrorCount}`);
        console.log('');
    } else {
        console.log(`@ts-check src: ${srcCoverage.withTsCheck}/${srcCoverage.total} (${srcCoverage.coveragePct}%)`);
        console.log(
            `@ts-check scripts: ${scriptsCoverage.withTsCheck}/${scriptsCoverage.total} (${scriptsCoverage.coveragePct}%)`
        );
        console.log(`@ts-check tests: ${testsCoverage.withTsCheck}/${testsCoverage.total} (${testsCoverage.coveragePct}%)`);
        console.log(
            `@ts-check overall: ${overallCoverage.withTsCheck}/${overallCoverage.total} (${overallCoverage.coveragePct}%)`
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
}

if (!passes) {
    process.exit(1);
}
