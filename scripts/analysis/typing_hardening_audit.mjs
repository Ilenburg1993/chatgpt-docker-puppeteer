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
    },
});

const AREA_THRESHOLDS = {
    src: 100,
    scripts: 95,
    tests: 90,
    overall: 90,
};

const STRICT_CONFIGS = [
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
const jsdocReport = analyzeJSDocCoverage({ files: combinedFiles, scope: 'full' });
const srcCoverage = summarizeTsCheck(sourceFiles);
const scriptsCoverage = summarizeTsCheck(scriptFiles);
const testsCoverage = summarizeTsCheck(testFiles);
const overallCoverage = summarizeTsCheck(combinedFiles);
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

const passes =
    srcCoverage.coveragePct >= AREA_THRESHOLDS.src &&
    scriptsCoverage.coveragePct >= AREA_THRESHOLDS.scripts &&
    testsCoverage.coveragePct >= AREA_THRESHOLDS.tests &&
    overallCoverage.coveragePct >= AREA_THRESHOLDS.overall &&
    tsExpectErrorCount === 0;

const report = {
    thresholds: AREA_THRESHOLDS,
    ts_check: {
        src: srcCoverage,
        scripts: scriptsCoverage,
        tests: testsCoverage,
        overall: overallCoverage,
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
    for (const [config, lane] of Object.entries(strictLanes)) {
        console.log(`- ${config}: ${lane.files} file(s)`);
    }
}

if (!passes) {
    process.exit(1);
}
