#!/usr/bin/env node
// @ts-check
/**
 * Gate estrutural do baseline TypeScript 7-only.
 *
 * Invariantes:
 *
 * - `typescript` é a única autoridade TypeScript first-party e resolve major >= 7 sem alias npm;
 * - nenhuma entrada de compiler/native package TypeScript abaixo de major 7 pode existir no lock/node_modules;
 * - aliases históricos `@typescript/native` e `@typescript/typescript6` permanecem ausentes;
 * - lint type-aware é propriedade de Oxlint + oxlint-tsgolint, não de typescript-eslint;
 * - código first-party pode importar `typescript`/`typescript/unstable/*`, mas não aliases TypeScript aposentados;
 * - o adaptador interno `scripts/analysis/typescript-compat.mjs` não pode reaparecer;
 * - Madge não pode reaparecer enquanto sua árvore puder reintroduzir uma geração TypeScript anterior.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const lockPath = path.join(ROOT, 'package-lock.json');
const packagePath = path.join(ROOT, 'package.json');
const npmrcPath = path.join(ROOT, '.npmrc');
const FIRST_PARTY_CODE_ROOTS = ['src', 'scripts', 'tests', 'tools', 'config'];
const FIRST_PARTY_CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);
const FIRST_PARTY_SCAN_SKIP_DIRECTORIES = new Set([
    '.ai',
    '.cache',
    '.git',
    'analysis',
    'artifacts',
    'coverage',
    'data',
    'dist',
    'logs',
    'node_modules',
]);
const RETIRED_TYPESCRIPT_SPECIFIER_PREFIXES = Object.freeze(['@typescript/native', '@typescript/typescript6']);
const RETIRED_TYPESCRIPT_PACKAGE_KEYS = Object.freeze([
    'node_modules/@typescript/native',
    'node_modules/@typescript/typescript6',
    'node_modules/typescript-eslint',
    'node_modules/@typescript-eslint/parser',
    'node_modules/@typescript-eslint/eslint-plugin',
]);

/** @param {string | undefined} version */
function majorOf(version) {
    const match = String(version ?? '').match(/^(\d+)/u);
    return match ? Number(match[1]) : Number.NaN;
}

/** @param {string | undefined} spec */
function majorOfSpec(spec) {
    const match = String(spec ?? '').match(/(?:^|[^0-9])(\d+)(?:\.|$)/u);
    return match ? Number(match[1]) : Number.NaN;
}

/** @param {unknown} value */
function asObject(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, any>} */ (value) : {};
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
function collectCodeFiles(directory) {
    if (!fs.existsSync(directory)) return [];
    /** @type {string[]} */
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!FIRST_PARTY_SCAN_SKIP_DIRECTORIES.has(entry.name)) files.push(...collectCodeFiles(absolutePath));
            continue;
        }
        if (entry.isFile() && FIRST_PARTY_CODE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolutePath);
    }
    return files;
}

/**
 * @param {string} sourceText
 * @returns {string[]}
 */
function extractLiteralModuleSpecifiers(sourceText) {
    const patterns = [
        /\bimport\s+(?:[^'"\n;]+?\s+from\s+)?['"]([^'"]+)['"]/gu,
        /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
        /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
        /\bexport\s+[^'"\n;]*?\s+from\s+['"]([^'"]+)['"]/gu,
    ];
    const specifiers = new Set();
    for (const pattern of patterns) {
        for (const match of sourceText.matchAll(pattern)) {
            if (match[1]) specifiers.add(match[1]);
        }
    }
    return [...specifiers];
}

/** @param {string} specifier */
function isRetiredTypeScriptSpecifier(specifier) {
    return (
        RETIRED_TYPESCRIPT_SPECIFIER_PREFIXES.some(
            (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
        ) || specifier.includes('typescript-compat.mjs')
    );
}

/** @returns {{ file: string; specifier: string }[]} */
function findRetiredFirstPartyTypeScriptImports() {
    const files = FIRST_PARTY_CODE_ROOTS.flatMap((relativeRoot) => collectCodeFiles(path.join(ROOT, relativeRoot)));
    for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
        if (entry.isFile() && FIRST_PARTY_CODE_EXTENSIONS.has(path.extname(entry.name))) files.push(path.join(ROOT, entry.name));
    }

    /** @type {{ file: string; specifier: string }[]} */
    const findings = [];
    for (const file of files) {
        const sourceText = fs.readFileSync(file, 'utf8');
        for (const specifier of extractLiteralModuleSpecifiers(sourceText)) {
            if (!isRetiredTypeScriptSpecifier(specifier)) continue;
            findings.push({ file: path.relative(ROOT, file).replaceAll(path.sep, '/'), specifier });
        }
    }
    return findings.sort(
        (left, right) => left.file.localeCompare(right.file) || left.specifier.localeCompare(right.specifier),
    );
}

/** @param {string} packageKey @param {Record<string, any>} metadata */
function isTypeScriptCompilerPackage(packageKey, metadata) {
    const name = String(metadata['name'] ?? '');
    return (
        packageKey === 'node_modules/typescript' ||
        /(?:^|\/)node_modules\/@typescript\/typescript(?:\d+|-[^/]+)$/u.test(packageKey) ||
        name === 'typescript' ||
        /^@typescript\/typescript(?:\d+|-[^/]+)$/u.test(name)
    );
}

const pkg = asObject(JSON.parse(fs.readFileSync(packagePath, 'utf8')));
const lock = asObject(JSON.parse(fs.readFileSync(lockPath, 'utf8')));
const packages = asObject(lock['packages']);
const rootLock = asObject(packages['']);
const packageDevDependencies = asObject(pkg['devDependencies']);
const rootDevDependencies = asObject(rootLock['devDependencies']);
/** @type {string[]} */
const errors = [];
const npmrcText = fs.existsSync(npmrcPath) ? fs.readFileSync(npmrcPath, 'utf8') : '';
if (/^\s*legacy-peer-deps\s*=\s*true\s*$/imu.test(npmrcText)) {
    errors.push('legacy-peer-deps=true is forbidden because it can mask a TS7-incompatible dependency graph.');
}

const canonicalSpec = String(packageDevDependencies['typescript'] ?? rootDevDependencies['typescript'] ?? '');
const canonicalSpecMajor = majorOfSpec(canonicalSpec);
if (!canonicalSpec || canonicalSpec.startsWith('npm:') || !Number.isFinite(canonicalSpecMajor) || canonicalSpecMajor < 7) {
    errors.push(`typescript must be a direct non-alias TS7+ dependency; found ${canonicalSpec || '(missing)'}`);
}
if (packageDevDependencies['@typescript/native'] || rootDevDependencies['@typescript/native']) {
    errors.push('Retired @typescript/native alias must not be declared in root dependencies.');
}
if (packageDevDependencies['typescript-eslint'] || rootDevDependencies['typescript-eslint']) {
    errors.push('typescript-eslint must remain retired; TS7 type-aware lint is owned by Oxlint/tsgolint.');
}

const oxlintSpec = String(packageDevDependencies['oxlint'] ?? rootDevDependencies['oxlint'] ?? '');
const tsgolintSpec = String(packageDevDependencies['oxlint-tsgolint'] ?? rootDevDependencies['oxlint-tsgolint'] ?? '');
if (!oxlintSpec) errors.push('oxlint must be installed as the structural/type-aware lint frontend.');
if (!tsgolintSpec || majorOfSpec(tsgolintSpec) < 7) {
    errors.push(`oxlint-tsgolint must resolve a TS7 generation; found ${tsgolintSpec || '(missing)'}`);
}

/** @type {{ path: string; name: string; version: string; major: number }[]} */
const typeScriptEntries = [];
for (const [packageKey, rawMetadata] of Object.entries(packages)) {
    const metadata = asObject(rawMetadata);
    if (!isTypeScriptCompilerPackage(packageKey, metadata)) continue;
    const name = String(metadata['name'] ?? (packageKey === 'node_modules/typescript' ? 'typescript' : '(implicit)'));
    const version = String(metadata['version'] ?? '');
    if (!version) continue;
    const major = majorOf(version);
    typeScriptEntries.push({ path: packageKey || '(root)', name, version, major });
    if (!Number.isFinite(major) || major < 7) {
        errors.push(`TypeScript < 7 is forbidden: ${packageKey} -> ${name}@${version}`);
    }
}

const canonicalEntry = asObject(packages['node_modules/typescript']);
const canonicalMajor = majorOf(canonicalEntry['version']);
if (!Number.isFinite(canonicalMajor) || canonicalMajor < 7) {
    errors.push(`node_modules/typescript must resolve TS7+; found ${canonicalEntry['version'] ?? '(missing)'}`);
}

for (const packageKey of RETIRED_TYPESCRIPT_PACKAGE_KEYS) {
    if (packages[packageKey]) errors.push(`Retired TypeScript lint/compat package is present in lock: ${packageKey}`);
}

for (const relativePath of [
    'node_modules/@typescript/native',
    'node_modules/@typescript/typescript6',
    'node_modules/.bin/tsc6',
]) {
    if (fs.existsSync(path.join(ROOT, relativePath))) errors.push(`Retired TypeScript runtime artifact is present: ${relativePath}`);
}

const installedTypeScriptPackage = path.join(ROOT, 'node_modules', 'typescript', 'package.json');
if (!fs.existsSync(installedTypeScriptPackage)) {
    errors.push('Installed canonical node_modules/typescript/package.json is missing.');
} else {
    const installed = asObject(JSON.parse(fs.readFileSync(installedTypeScriptPackage, 'utf8')));
    if (installed['name'] !== 'typescript' || majorOf(installed['version']) < 7) {
        errors.push(`Installed canonical compiler is invalid: ${installed['name'] ?? '?'}@${installed['version'] ?? '?'}`);
    }
}

const compatibilityAdapterPath = path.join(ROOT, 'scripts', 'analysis', 'typescript-compat.mjs');
if (fs.existsSync(compatibilityAdapterPath)) {
    errors.push('Retired scripts/analysis/typescript-compat.mjs must remain absent.');
}

const madgeEntries = Object.keys(packages).filter((packageKey) => /(?:^|\/)node_modules\/madge$/u.test(packageKey));
if (madgeEntries.length > 0 || packageDevDependencies['madge']) {
    errors.push('Madge is forbidden in the TS7-only baseline while it can reintroduce an older TypeScript graph.');
}

const retiredFirstPartyImports = findRetiredFirstPartyTypeScriptImports();
for (const finding of retiredFirstPartyImports) {
    errors.push(`Retired TypeScript specifier is forbidden: ${finding.file} -> ${finding.specifier}`);
}

const versions = typeScriptEntries
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => `${entry.path}: ${entry.name}@${entry.version}`);

if (errors.length > 0) {
    console.error('TypeScript baseline: FAIL');
    for (const error of errors) console.error(`- ${error}`);
    if (versions.length > 0) console.error(`Observed TypeScript compiler entries:\n- ${versions.join('\n- ')}`);
    process.exitCode = 1;
} else {
    console.log('TypeScript baseline: OK');
    console.log(`- canonical: typescript@${canonicalEntry['version']}`);
    console.log(`- compiler/native entries: ${typeScriptEntries.length}; all major >= 7`);
    console.log('- TS6/@typescript/native compatibility aliases: absent');
    console.log('- npm peer masking: disabled');
    console.log(`- type-aware lint: oxlint ${oxlintSpec} + oxlint-tsgolint ${tsgolintSpec}`);
    console.log(`- retired first-party TypeScript specifiers: ${retiredFirstPartyImports.length}`);
    console.log('- typescript-eslint parser/plugin: absent');
    console.log('- internal compatibility adapter: absent');
    console.log('- Madge: absent');
}
