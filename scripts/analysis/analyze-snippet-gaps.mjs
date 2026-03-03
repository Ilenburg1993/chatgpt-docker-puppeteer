#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const PREFIX_PATTERN = /^[a-z]+(?:\.[a-z0-9-]+)+$/;
const DEFAULT_SNIPPET_FILE = '.vscode/chatgpt-docker-puppeteer.code-snippets';
const DEFAULT_EXPECTED_FAMILIES = [
    'nerv',
    'task',
    'driver',
    'browser',
    'db',
    'log',
    'audit',
    'metric',
    'config',
    'health',
    'test',
    'process',
    'pkg',
    'vscode',
    'sh',
];
const FAMILY_MINIMUMS = {
    nerv: 6,
    task: 5,
    driver: 4,
    browser: 4,
    db: 2,
    log: 2,
    test: 4,
};
const RECOMMENDED_PREFIXES = [
    'nerv.imports',
    'nerv.event',
    'nerv.command',
    'nerv.emit',
    'nerv.on-event',
    'nerv.on-actor',
    'task.create.v5',
    'task.parse',
    'task.save',
    'task.load',
    'task.status',
    'driver.factory.start',
    'driver.pool.acquire',
    'browser.pool.init',
    'browser.page.allocate',
    'browser.wait',
    'db.sqlite.core',
    'db.sqlite.prepare',
    'log.import',
    'log.info',
    'audit.entry',
    'metric.emit',
    'config.get',
    'health.controller',
    'test.node.file',
    'test.mock.io',
    'process.pm2.app',
    'process.pm2.snapshot',
    'pkg.script.test',
    'vscode.launch.node',
    'sh.test.unit',
];
const DISALLOWED_PATTERNS = [
    { label: 'require()', regex: /\brequire\(/ },
    { label: 'relative-parent-import', regex: /\.\.\// },
    { label: 'legacy-nerv-waitForResponse', regex: /waitForResponse\(/ },
];

/**
 * @typedef {{
 *   file: string,
 *   prefix: string | string[],
 *   scope: string,
 *   body: string | string[],
 *   description: string
 * }} SnippetDefinition
 */

const { values } = parseArgs({
    options: {
        file: { type: 'string', default: DEFAULT_SNIPPET_FILE },
        format: { type: 'string', default: 'console' },
        strict: { type: 'boolean', default: false },
        families: { type: 'string', default: DEFAULT_EXPECTED_FAMILIES.join(',') },
    },
});

const snippetFile = path.resolve(process.cwd(), String(values.file || DEFAULT_SNIPPET_FILE));
const format = String(values.format || 'console').toLowerCase();
const strict = Boolean(values.strict);
const expectedFamilies = String(values.families || DEFAULT_EXPECTED_FAMILIES.join(','))
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const report = analyzeSnippetCatalog({
    snippetFile,
    expectedFamilies,
});

if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
} else {
    printConsoleReport(report);
}

if (strict && (report.issues.length > 0 || report.gaps.length > 0)) {
    process.exitCode = 1;
}

/**
 * @param {{ snippetFile: string, expectedFamilies: string[] }} options
 */
function analyzeSnippetCatalog({ snippetFile, expectedFamilies }) {
    /** @type {Record<string, SnippetDefinition>} */
    const catalog = JSON.parse(fs.readFileSync(snippetFile, 'utf8'));
    const entries = Object.entries(catalog);
    const prefixes = [];
    const issues = [];

    for (const [name, snippet] of entries) {
        const missing = ['prefix', 'scope', 'body', 'description'].filter(key => !(key in snippet));
        if (missing.length > 0) {
            issues.push({
                type: 'missing_fields',
                snippet: name,
                details: `Campos ausentes: ${missing.join(', ')}`,
            });
            continue;
        }

        const snippetPrefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
        for (const prefix of snippetPrefixes) {
            prefixes.push({ prefix, snippet: name });
            if (!PREFIX_PATTERN.test(prefix)) {
                issues.push({
                    type: 'invalid_prefix',
                    snippet: name,
                    details: prefix,
                });
            }
        }

        const bodyText = Array.isArray(snippet.body) ? snippet.body.join('\n') : String(snippet.body);
        for (const rule of DISALLOWED_PATTERNS) {
            if (rule.regex.test(bodyText)) {
                issues.push({
                    type: 'disallowed_pattern',
                    snippet: name,
                    details: rule.label,
                });
            }
        }
    }

    const duplicatePrefixes = collectDuplicatePrefixes(prefixes);
    for (const duplicate of duplicatePrefixes) {
        issues.push({
            type: 'duplicate_prefix',
            snippet: duplicate.prefix,
            details: duplicate.snippets.join(', '),
        });
    }

    const scopes = [...new Set(entries.map(([, snippet]) => snippet.scope))].sort();
    const familyCounts = prefixes.reduce((acc, entry) => {
        const family = String(entry.prefix).split('.')[0];
        acc[family] = (acc[family] || 0) + 1;
        return acc;
    }, /** @type {Record<string, number>} */ ({}));

    const gaps = [];

    for (const family of expectedFamilies) {
        if (!familyCounts[family]) {
            gaps.push({
                type: 'missing_family',
                details: family,
            });
        }
    }

    for (const [family, minimum] of Object.entries(FAMILY_MINIMUMS)) {
        const actual = familyCounts[family] || 0;
        if (actual > 0 && actual < minimum) {
            gaps.push({
                type: 'thin_family',
                details: `${family}: ${actual}/${minimum}`,
            });
        }
    }

    const prefixSet = new Set(prefixes.map(entry => entry.prefix));
    for (const expectedPrefix of RECOMMENDED_PREFIXES) {
        if (!prefixSet.has(expectedPrefix)) {
            gaps.push({
                type: 'missing_recommended_prefix',
                details: expectedPrefix,
            });
        }
    }

    const requiredScopes = ['javascript,typescript', 'json,jsonc', 'shellscript'];
    for (const scope of requiredScopes) {
        if (!scopes.includes(scope)) {
            gaps.push({
                type: 'missing_scope',
                details: scope,
            });
        }
    }

    const repoHints = collectRepoHints();
    for (const hint of repoHints) {
        if (!prefixSet.has(hint.expectedPrefix)) {
            gaps.push({
                type: 'repo_hint_gap',
                details: `${hint.expectedPrefix} (${hint.reason})`,
            });
        }
    }

    return {
        file: path.relative(process.cwd(), snippetFile),
        snippet_count: entries.length,
        prefix_count: prefixes.length,
        scopes,
        families: Object.keys(familyCounts)
            .sort()
            .map(family => ({ family, count: familyCounts[family] })),
        issues,
        gaps,
    };
}

/**
 * @param {{ prefix: string, snippet: string }[]} prefixes
 */
function collectDuplicatePrefixes(prefixes) {
    const map = new Map();
    for (const entry of prefixes) {
        const arr = map.get(entry.prefix) || [];
        arr.push(entry.snippet);
        map.set(entry.prefix, arr);
    }

    return [...map.entries()]
        .filter(([, snippets]) => snippets.length > 1)
        .map(([prefix, snippets]) => ({ prefix, snippets }));
}

function collectRepoHints() {
    const hints = [];
    const cwd = process.cwd();

    if (fs.existsSync(path.join(cwd, 'src/core/logger.js'))) {
        hints.push({
            expectedPrefix: 'log.import',
            reason: 'logger canônico presente em src/core/logger.js',
        });
        hints.push({
            expectedPrefix: 'metric.emit',
            reason: 'API metric() exportada pelo logger',
        });
    }

    if (fs.existsSync(path.join(cwd, 'src/infra/browser_pool/pool_manager.js'))) {
        hints.push({
            expectedPrefix: 'browser.wait',
            reason: 'browser pool presente e uso de página Puppeteer é recorrente',
        });
    }

    if (fs.existsSync(path.join(cwd, '.vscode/launch.json'))) {
        hints.push({
            expectedPrefix: 'vscode.launch.node',
            reason: 'workspace já expõe launchers pwa-node',
        });
    }

    if (fs.existsSync(path.join(cwd, 'package.json'))) {
        hints.push({
            expectedPrefix: 'pkg.script.test',
            reason: 'package.json define scripts de teste',
        });
    }

    return hints;
}

/**
 * @param {ReturnType<typeof analyzeSnippetCatalog>} report
 */
function printConsoleReport(report) {
    console.log('='.repeat(80));
    console.log('SNIPPET GAP REPORT');
    console.log('='.repeat(80));
    console.log(`file: ${report.file}`);
    console.log(`snippet_count: ${report.snippet_count}`);
    console.log(`prefix_count: ${report.prefix_count}`);
    console.log(`scopes: ${report.scopes.join(', ')}`);
    console.log('');
    console.log('families:');
    for (const item of report.families) {
        console.log(`- ${item.family}: ${item.count}`);
    }

    console.log('');
    console.log(`issues: ${report.issues.length}`);
    if (report.issues.length === 0) {
        console.log('- none');
    } else {
        for (const issue of report.issues) {
            console.log(`- [${issue.type}] ${issue.snippet}: ${issue.details}`);
        }
    }

    console.log('');
    console.log(`gaps: ${report.gaps.length}`);
    if (report.gaps.length === 0) {
        console.log('- none');
    } else {
        for (const gap of report.gaps) {
            console.log(`- [${gap.type}] ${gap.details}`);
        }
    }
}
