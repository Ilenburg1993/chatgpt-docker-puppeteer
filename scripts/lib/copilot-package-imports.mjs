// @ts-check
/**
 * Canonical package-import governance primitives for `#copilot/**`.
 *
 * This module deliberately parses real JavaScript/TypeScript syntax instead of grepping source text. It covers runtime
 * imports/re-exports, dynamic imports, common module-mocking APIs and JSDoc `import()` types while ignoring arbitrary
 * strings/regex fixtures. Exact `package.json#imports` entries are the authority; wildcard mappings are treated as an
 * architectural bypass rather than as a convenience fallback.
 *
 * @module scripts/lib/copilot-package-imports
 */

import { resolveBabelParserOptions } from '#copilot/infra/public/diagnostic/code-analysis';
import { parse } from '@babel/parser';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { listSourceFilesSync } from './source-tree.mjs';

const DEFAULT_ROOTS = Object.freeze(['src', 'tests', 'scripts', 'tools']);
const SOURCE_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);
const MOCK_CALL_PROPERTIES = new Set([
    'mock',
    'doMock',
    'unmock',
    'importActual',
    'importMock',
    'requireActual',
    'unstable_mockModule',
    'resolve',
]);

/** @typedef {'runtime'|'dynamic'|'mock'|'jsdoc'} CopilotImportUsageKind */
/** @typedef {{file:string;specifier:string;kind:CopilotImportUsageKind}} CopilotImportUsage */

/**
 * @param {string} packagePath
 * @returns {Record<string,string>}
 */
export function readPackageImports(packagePath = 'package.json') {
    const parsed = /** @type {{imports?:Record<string,unknown>}} */ (JSON.parse(readFileSync(packagePath, 'utf8')));
    /** @type {Record<string,string>} */
    const result = {};
    for (const [alias, target] of Object.entries(parsed.imports ?? {})) {
        if (typeof target === 'string') result[alias] = target;
    }
    return result;
}

/** @param {Record<string,string>} packageImports */
export function listCopilotWildcardAliases(packageImports) {
    return Object.keys(packageImports)
        .filter((alias) => alias.startsWith('#copilot/') && alias.includes('*'))
        .sort();
}

/** @param {Record<string,string>} packageImports */
export function listCopilotExactAliases(packageImports) {
    return Object.keys(packageImports)
        .filter((alias) => alias.startsWith('#copilot/') && !alias.includes('*'))
        .sort();
}

/** @param {string} filePath */
function sourceLanguage(filePath) {
    return ['.ts', '.mts', '.cts'].includes(extname(filePath).toLowerCase()) ? 'ts' : 'js';
}

/**
 * @param {CopilotImportUsage[]} usages
 * @param {string} file
 * @param {unknown} specifier
 * @param {CopilotImportUsageKind} kind
 */
function addUsage(usages, file, specifier, kind) {
    if (typeof specifier !== 'string' || !specifier.startsWith('#copilot/')) return;
    usages.push(Object.freeze({ file, specifier, kind }));
}

/**
 * @param {unknown} node
 * @param {string} file
 * @param {CopilotImportUsage[]} usages
 */
function walkImportAst(node, file, usages) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const entry of node) walkImportAst(entry, file, usages);
        return;
    }

    const value = /** @type {Record<string,any>} */ (node);
    if (
        ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(String(value['type'])) &&
        value['source']?.type === 'StringLiteral'
    ) {
        addUsage(usages, file, value['source'].value, 'runtime');
    }
    if (value['type'] === 'ImportExpression' && value['source']?.type === 'StringLiteral') {
        addUsage(usages, file, value['source'].value, 'dynamic');
    }
    if (value['type'] === 'CallExpression') {
        if (value['callee']?.type === 'Import' && value['arguments']?.[0]?.type === 'StringLiteral') {
            addUsage(usages, file, value['arguments'][0].value, 'dynamic');
        }
        const callee = value['callee'];
        const property =
            callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier'
                ? callee.property.name
                : null;
        if (property && MOCK_CALL_PROPERTIES.has(property) && value['arguments']?.[0]?.type === 'StringLiteral') {
            addUsage(usages, file, value['arguments'][0].value, 'mock');
        }
    }

    for (const [key, child] of Object.entries(value)) {
        if (
            [
                'loc',
                'start',
                'end',
                'extra',
                'leadingComments',
                'trailingComments',
                'innerComments',
                'comments',
            ].includes(key)
        ) {
            continue;
        }
        if (child && typeof child === 'object') walkImportAst(child, file, usages);
    }
}

/**
 * Parse all semantically active `#copilot/**` specifiers from one source file.
 *
 * @param {string} source
 * @param {string} filePath
 * @returns {CopilotImportUsage[]}
 */
export function collectCopilotImportUsagesFromSource(source, filePath = 'inline.js') {
    if (!source.includes('#copilot/')) return [];
    const ast = parse(
        source,
        resolveBabelParserOptions(filePath, sourceLanguage(filePath), {
            profile: 'documentation',
        }),
    );
    /** @type {CopilotImportUsage[]} */
    const usages = [];
    walkImportAst(ast, filePath, usages);
    for (const comment of ast.comments ?? []) {
        if (comment.type !== 'CommentBlock' || !comment.value.startsWith('*')) continue;
        for (const match of comment.value.matchAll(/\bimport\s*\(\s*['"](#copilot\/[^'"]+)['"]\s*\)/gu)) {
            addUsage(usages, filePath, match[1], 'jsdoc');
        }
    }
    return usages;
}

/**
 * @param {{roots?:readonly string[];relativeTo?:string}} [options]
 * @returns {{usages:readonly CopilotImportUsage[];scannedFiles:number;parsedFiles:number;parseErrors:readonly {file:string;message:string}[]}}
 */
export function collectCopilotImportUsages(options = {}) {
    const roots = options.roots ?? DEFAULT_ROOTS;
    const relativeTo = options.relativeTo ?? process.cwd();
    /** @type {CopilotImportUsage[]} */
    const usages = [];
    /** @type {{file:string;message:string}[]} */
    const parseErrors = [];
    let scannedFiles = 0;
    let parsedFiles = 0;

    for (const root of roots) {
        for (const file of listSourceFilesSync(root, { extensions: SOURCE_EXTENSIONS })) {
            scannedFiles += 1;
            const source = readFileSync(file, 'utf8');
            if (!source.includes('#copilot/')) continue;
            parsedFiles += 1;
            const displayFile = relative(relativeTo, file).replaceAll('\\', '/');
            try {
                usages.push(...collectCopilotImportUsagesFromSource(source, displayFile));
            } catch (error) {
                parseErrors.push({
                    file: displayFile,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    return Object.freeze({
        usages: Object.freeze(usages),
        scannedFiles,
        parsedFiles,
        parseErrors: Object.freeze(parseErrors),
    });
}

/**
 * @param {{roots?:readonly string[];packagePath?:string;relativeTo?:string;forbiddenPrefixes?:readonly string[]}} [options]
 */
export function buildCopilotExactImportReport(options = {}) {
    const packageImports = readPackageImports(options.packagePath ?? 'package.json');
    const exactAliases = listCopilotExactAliases(packageImports);
    const exactSet = new Set(exactAliases);
    const wildcardAliases = listCopilotWildcardAliases(packageImports);
    const collected = collectCopilotImportUsages({
        ...(options.roots ? { roots: options.roots } : {}),
        ...(options.relativeTo ? { relativeTo: options.relativeTo } : {}),
    });
    const uniqueSpecifiers = [...new Set(collected.usages.map((usage) => usage.specifier))].sort();
    const nonExactSpecifiers = uniqueSpecifiers.filter((specifier) => !exactSet.has(specifier));
    const nonExactSet = new Set(nonExactSpecifiers);
    const nonExactUsages = collected.usages.filter((usage) => nonExactSet.has(usage.specifier));
    const forbiddenPrefixes = options.forbiddenPrefixes ?? [];
    const forbiddenUsages = collected.usages.filter((usage) =>
        forbiddenPrefixes.some((prefix) => usage.specifier.startsWith(prefix)),
    );

    return Object.freeze({
        packageImports: Object.freeze({ ...packageImports }),
        exactAliases: Object.freeze(exactAliases),
        wildcardAliases: Object.freeze(wildcardAliases),
        usages: collected.usages,
        uniqueSpecifiers: Object.freeze(uniqueSpecifiers),
        nonExactSpecifiers: Object.freeze(nonExactSpecifiers),
        nonExactUsages: Object.freeze(nonExactUsages),
        forbiddenUsages: Object.freeze(forbiddenUsages),
        forbiddenPrefixes: Object.freeze([...forbiddenPrefixes]),
        scannedFiles: collected.scannedFiles,
        parsedFiles: collected.parsedFiles,
        parseErrors: collected.parseErrors,
        success:
            collected.parseErrors.length === 0 &&
            wildcardAliases.length === 0 &&
            nonExactSpecifiers.length === 0 &&
            forbiddenUsages.length === 0,
    });
}

/**
 * Build top-level Copilot boundary coverage. A module is covered by a deliberate root barrel or by at least one exact
 * package-map entrypoint targeting that module. This explicitly supports manifest/micro-entrypoint architectures such
 * as `infra/` without requiring a mega-barrel.
 *
 * @param {{copilotRoot?:string;packagePath?:string}} [options]
 */
export function buildCopilotBoundaryReport(options = {}) {
    const copilotRoot = options.copilotRoot ?? 'src/copilot';
    const packageImports = readPackageImports(options.packagePath ?? 'package.json');
    const excluded = new Set(['.ai', '.github', 'docs', 'logs', 'node_modules']);
    const modules = readdirSync(copilotRoot)
        .filter((entry) => !excluded.has(entry) && statSync(join(copilotRoot, entry)).isDirectory())
        .sort();
    const exactTargets = Object.entries(packageImports)
        .filter(
            ([alias]) =>
                alias.startsWith('#copilot/') && !alias.startsWith('#copilot/testing/') && !alias.includes('*'),
        )
        .map(([, target]) => target.replaceAll('\\', '/'));
    const normalizedRoot = copilotRoot.replaceAll('\\', '/').replace(/^\.\//u, '');
    const details = Object.fromEntries(
        modules.map((module) => {
            const rootBarrel = existsSync(join(copilotRoot, module, 'index.js'));
            const targetPrefix = `./${normalizedRoot}/${module}/`;
            const exactEntrypoints = exactTargets.filter((target) => target.startsWith(targetPrefix)).length;
            return [
                module,
                Object.freeze({
                    rootBarrel,
                    exactEntrypoints,
                    covered: rootBarrel || exactEntrypoints > 0,
                }),
            ];
        }),
    );
    const uncovered = modules.filter((module) => !details[module]?.covered);
    const covered = modules.length - uncovered.length;
    return Object.freeze({
        total: modules.length,
        covered,
        ratio: modules.length > 0 ? Math.round((covered / modules.length) * 1000) / 10 : 100,
        uncovered: Object.freeze(uncovered),
        details: Object.freeze(details),
    });
}
