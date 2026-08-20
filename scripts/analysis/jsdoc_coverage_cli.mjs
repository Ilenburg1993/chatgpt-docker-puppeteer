#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { JSDOC_COVERAGE_SCHEMA_VERSION, analyzeJSDocCoverage, collectJsSourceFiles } from './jsdoc_coverage_engine.mjs';

const DEFAULT_SCHEMA_PATH = path.resolve('schemas/typing/jsdoc-coverage-report.schema.json');

const { values } = parseArgs({
    options: {
        scope: { type: 'string', default: 'full' },
        files: { type: 'string', default: '' },
        roots: { type: 'string', default: 'src,scripts,tests' },
        format: { type: 'string', default: 'console' },
        quiet: { type: 'boolean', default: false },
        'output-json': { type: 'string', default: 'jsdoc-coverage-report.json' },
        'validate-schema': { type: 'boolean', default: false },
        'schema-version': { type: 'string', default: JSDOC_COVERAGE_SCHEMA_VERSION },
        gaps: { type: 'boolean', default: false },
        'fail-on-any-gap': { type: 'boolean', default: false },
    },
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isString(value) {
    return typeof value === 'string';
}

/**
 * @param {unknown} report
 * @param {string} expectedSchemaVersion
 * @returns {string[]}
 */
function validateReportShape(report, expectedSchemaVersion) {
    /** @type {string[]} */
    const issues = [];
    if (!isRecord(report)) {
        issues.push('Report must be an object.');
        return issues;
    }

    const requiredNumericFields = [
        'files_scanned',
        'files_with_exports',
        'exports_total',
        'exports_with_jsdoc',
        'coverage_pct',
        'functions_total',
        'functions_with_returns_tag',
        'functions_missing_returns_tag',
        'function_returns_coverage_pct',
        'functions_with_complete_param_tags',
        'functions_missing_param_tags',
        'functions_with_options_typedef',
        'functions_missing_options_typedef',
        'unsafe_generic_tags_total',
        'public_symbols_using_import_types',
        'public_symbols_using_template_tags',
    ];

    if (report['schema_version'] !== expectedSchemaVersion) {
        issues.push(`schema_version must be ${expectedSchemaVersion}.`);
    }
    if (report['scope'] !== 'full' && report['scope'] !== 'changed') {
        issues.push('scope must be "full" or "changed".');
    }
    for (const field of requiredNumericFields) {
        if (!isNumber(report[field])) {
            issues.push(`${field} must be a finite number.`);
        }
    }

    if (!Array.isArray(report['files'])) {
        issues.push('files must be an array.');
    }
    if (!isRecord(report['by_path_prefix'])) {
        issues.push('by_path_prefix must be an object.');
    }

    for (const fileReport of Array.isArray(report['files']) ? report['files'] : []) {
        if (!isRecord(fileReport)) {
            issues.push('Each file report must be an object.');
            continue;
        }
        if (!isString(fileReport['file'])) {
            issues.push('Each file report requires a string file path.');
        }
        if (!Array.isArray(fileReport['exported_symbols'])) {
            issues.push(`File report ${String(fileReport['file'] || '<unknown>')} must expose exported_symbols.`);
        }
    }

    return issues;
}

/**
 * @param {string} expectedSchemaVersion
 * @returns {string[]}
 */
function validateSchemaFile(expectedSchemaVersion) {
    /** @type {string[]} */
    const issues = [];
    if (!fs.existsSync(DEFAULT_SCHEMA_PATH)) {
        issues.push(`Schema file not found: ${DEFAULT_SCHEMA_PATH}`);
        return issues;
    }

    const schema = /** @type {unknown} */ (JSON.parse(fs.readFileSync(DEFAULT_SCHEMA_PATH, 'utf8')));
    if (!isRecord(schema)) {
        issues.push('Schema file must parse as an object.');
        return issues;
    }
    if (!isString(schema['$schema']) || !schema['$schema'].includes('json-schema.org')) {
        issues.push('Schema file must declare a Draft 2020-12 $schema URL.');
    }
    if (!isRecord(schema['properties'])) {
        issues.push('Schema file must expose properties.');
        return issues;
    }
    const properties = schema['properties'];
    const schemaVersionProperty = isRecord(properties['schema_version']) ? properties['schema_version'] : null;
    if (!schemaVersionProperty || schemaVersionProperty['const'] !== expectedSchemaVersion) {
        issues.push(`Schema file must pin schema_version const to ${expectedSchemaVersion}.`);
    }
    return issues;
}

const scope = String(values.scope || 'full').toLowerCase() === 'changed' ? 'changed' : 'full';
const format = String(values.format || 'console').toLowerCase();
const filesArg = String(values.files || '').trim();
const roots = String(values.roots || 'src,scripts,tests')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const expectedSchemaVersion =
    String(values['schema-version'] || JSDOC_COVERAGE_SCHEMA_VERSION).trim() || JSDOC_COVERAGE_SCHEMA_VERSION;
const quiet = Boolean(values.quiet);

const files = filesArg
    ? filesArg
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
    : collectJsSourceFiles(roots);
const report = analyzeJSDocCoverage({ files, scope });

if (String(values['output-json'] || '').trim()) {
    fs.writeFileSync(String(values['output-json']), JSON.stringify(report, null, 2), 'utf8');
}

if (values['validate-schema']) {
    const issues = [
        ...validateSchemaFile(expectedSchemaVersion),
        ...validateReportShape(report, expectedSchemaVersion),
    ];
    if (issues.length > 0) {
        for (const issue of issues) {
            console.error(`[jsdoc-schema] ${issue}`);
        }
        process.exit(1);
    }
}

if (quiet) {
    // Intentionally suppress normal report output for script-only validation flows.
} else if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log('='.repeat(80));
    console.log(`JSDOC COVERAGE REPORT (schema ${report.schema_version})`);
    console.log('='.repeat(80));
    console.log(`scope: ${report.scope}`);
    console.log(`files_scanned: ${report.files_scanned}`);
    console.log(`files_with_exports: ${report.files_with_exports}`);
    console.log(`exports_total: ${report.exports_total}`);
    console.log(`exports_with_jsdoc: ${report.exports_with_jsdoc}`);
    console.log(`coverage_pct: ${report.coverage_pct}%`);
    console.log(`functions_total: ${report.functions_total}`);
    console.log(`functions_with_returns_tag: ${report.functions_with_returns_tag}`);
    console.log(`functions_missing_returns_tag: ${report.functions_missing_returns_tag}`);
    console.log(`function_returns_coverage_pct: ${report.function_returns_coverage_pct}%`);
    console.log(`functions_with_complete_param_tags: ${report.functions_with_complete_param_tags}`);
    console.log(`functions_missing_param_tags: ${report.functions_missing_param_tags}`);
    console.log(`functions_with_options_typedef: ${report.functions_with_options_typedef}`);
    console.log(`functions_missing_options_typedef: ${report.functions_missing_options_typedef}`);
    console.log(`unsafe_generic_tags_total: ${report.unsafe_generic_tags_total}`);
    console.log(`public_symbols_using_import_types: ${report.public_symbols_using_import_types}`);
    console.log(`public_symbols_using_template_tags: ${report.public_symbols_using_template_tags}`);
    console.log('');

    const worstFiles = [...report.files]
        .sort(
            (left, right) =>
                right.functions_missing_returns_tag - left.functions_missing_returns_tag ||
                right.functions_missing_param_tags - left.functions_missing_param_tags ||
                right.functions_missing_options_typedef - left.functions_missing_options_typedef ||
                right.unsafe_generic_tags_total - left.unsafe_generic_tags_total ||
                left.file.localeCompare(right.file),
        )
        .slice(0, 25);

    for (const item of worstFiles) {
        if (
            item.functions_missing_returns_tag === 0 &&
            item.functions_missing_param_tags === 0 &&
            item.functions_missing_options_typedef === 0 &&
            item.unsafe_generic_tags_total === 0 &&
            item.coverage_pct >= 100
        ) {
            continue;
        }
        console.log(
            `- ${item.file}: exports ${item.coverage_pct}% (${item.exports_with_jsdoc}/${item.exports_total}), returns ${item.function_returns_coverage_pct}% (${item.functions_with_returns_tag}/${item.functions_total}), params ${item.functions_with_complete_param_tags}/${item.functions_total}, options typedef missing ${item.functions_missing_options_typedef}, unsafe tags ${item.unsafe_generic_tags_total}`,
        );
    }
}

if (values.gaps) {
    console.log('');
    console.log('='.repeat(80));
    console.log('GAPS — símbolos bloqueadores por arquivo');
    console.log('='.repeat(80));
    let gapCount = 0;
    for (const fileReport of report.files) {
        /** @type {string[]} */
        const fileGaps = [];
        for (const symbol of fileReport.exported_symbols) {
            if (symbol.missing_tags.length > 0) {
                fileGaps.push(
                    `  ${symbol.export_name}:${symbol.line ?? '?'}  missing=[${symbol.missing_tags.join(',')}]`,
                );
                gapCount++;
            }
        }
        if (fileGaps.length > 0) {
            console.log(`\n${fileReport.file}:`);
            for (const gap of fileGaps) {
                console.log(gap);
            }
        }
    }
    if (gapCount === 0) {
        console.log('✅ Nenhum gap de JSDoc encontrado.');
    } else {
        console.log(`\nTotal de gaps: ${gapCount}`);
    }
}

if (values['fail-on-any-gap']) {
    const hasGap =
        report.functions_missing_param_tags > 0 ||
        report.functions_missing_options_typedef > 0 ||
        report.unsafe_generic_tags_total > 0 ||
        report.public_any_tags_total > 0;
    if (hasGap) {
        process.exit(1);
    }
}
