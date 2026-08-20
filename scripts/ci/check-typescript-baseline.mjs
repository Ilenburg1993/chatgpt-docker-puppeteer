#!/usr/bin/env node
// @ts-check
/**
 * Gate estrutural do baseline TypeScript.
 *
 * Invariantes:
 *
 * - compilador canônico `@typescript/native` em major >= 7;
 * - alias de compatibilidade `typescript -> @typescript/typescript6` limitado a major 6;
 * - nenhuma instalação/lock entry do pacote TypeScript em major < 6;
 * - TS6 existe somente como compatibilidade de peers upstream: código first-party não pode importá-lo;
 * - o adaptador interno `scripts/analysis/typescript-compat.mjs` não pode reaparecer;
 * - Madge não pode reaparecer enquanto sua árvore exigir TS5.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const lockPath = path.join(ROOT, 'package-lock.json');
const packagePath = path.join(ROOT, 'package.json');
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

/** @param {string | undefined} version */
function majorOf(version) {
    const match = String(version ?? '').match(/^(\d+)/u);
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
 * Extrai apenas specifiers literais de import/export/require. O gate não procura a palavra "typescript" em comentários,
 * documentação ou comandos: ele rejeita dependência executável first-party do compatibility package.
 *
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
function isForbiddenFirstPartyTypeScriptSpecifier(specifier) {
    return (
        specifier === 'typescript' ||
        specifier.startsWith('typescript/') ||
        specifier === '@typescript/typescript6' ||
        specifier.startsWith('@typescript/typescript6/') ||
        specifier.includes('typescript-compat.mjs')
    );
}

/** @returns {{ file: string; specifier: string }[]} */
function findForbiddenFirstPartyTypeScriptImports() {
    const files = FIRST_PARTY_CODE_ROOTS.flatMap((relativeRoot) => collectCodeFiles(path.join(ROOT, relativeRoot)));
    for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
        if (entry.isFile() && FIRST_PARTY_CODE_EXTENSIONS.has(path.extname(entry.name)))
            files.push(path.join(ROOT, entry.name));
    }

    /** @type {{ file: string; specifier: string }[]} */
    const findings = [];
    for (const file of files) {
        const sourceText = fs.readFileSync(file, 'utf8');
        for (const specifier of extractLiteralModuleSpecifiers(sourceText)) {
            if (!isForbiddenFirstPartyTypeScriptSpecifier(specifier)) continue;
            findings.push({ file: path.relative(ROOT, file).replaceAll(path.sep, '/'), specifier });
        }
    }
    return findings.sort(
        (left, right) => left.file.localeCompare(right.file) || left.specifier.localeCompare(right.specifier),
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
/** @type {string[]} */
const notes = [];

const nativeSpec = String(
    packageDevDependencies['@typescript/native'] ?? rootDevDependencies['@typescript/native'] ?? '',
);
const compatSpec = String(packageDevDependencies['typescript'] ?? rootDevDependencies['typescript'] ?? '');
if (!/^npm:typescript@/u.test(nativeSpec))
    errors.push(`@typescript/native must alias the canonical TypeScript package; found ${nativeSpec || '(missing)'}`);
if (!/^npm:@typescript\/typescript6@/u.test(compatSpec))
    errors.push(`typescript must be the explicit TS6 compatibility alias; found ${compatSpec || '(missing)'}`);

/** @type {{ path: string; name: string; version: string; major: number }[]} */
const typeScriptEntries = [];
for (const [packageKey, rawMetadata] of Object.entries(packages)) {
    const metadata = asObject(rawMetadata);
    const name = String(metadata['name'] ?? '');
    const version = String(metadata['version'] ?? '');
    const looksLikeTypeScript =
        name === 'typescript' || name === '@typescript/typescript6' || packageKey === 'node_modules/typescript';
    if (!looksLikeTypeScript || !version) continue;
    const major = majorOf(version);
    typeScriptEntries.push({ path: packageKey || '(root)', name: name || '(implicit typescript)', version, major });
    if (!Number.isFinite(major) || major < 6)
        errors.push(`TypeScript < 6 is forbidden: ${packageKey} -> ${name}@${version}`);
}

const nativeEntry = asObject(packages['node_modules/@typescript/native']);
const nativeMajor = majorOf(nativeEntry['version']);
if (nativeEntry['name'] !== 'typescript' || !Number.isFinite(nativeMajor) || nativeMajor < 7) {
    errors.push(
        `canonical @typescript/native must resolve TypeScript >=7; found ${nativeEntry['name'] ?? '?'}@${nativeEntry['version'] ?? '?'}`,
    );
}

const compatEntry = asObject(packages['node_modules/typescript']);
const compatMajor = majorOf(compatEntry['version']);
if (compatEntry['name'] !== '@typescript/typescript6' || compatMajor !== 6) {
    errors.push(
        `root compatibility alias must resolve @typescript/typescript6 major 6; found ${compatEntry['name'] ?? '?'}@${compatEntry['version'] ?? '?'}`,
    );
}

const madgeEntries = Object.keys(packages).filter((packageKey) => /(?:^|\/)node_modules\/madge$/u.test(packageKey));
if (madgeEntries.length > 0 || packageDevDependencies['madge'])
    errors.push('Madge is forbidden in the TS7 baseline while it requires TypeScript 5.x.');

const compatibilityAdapterPath = path.join(ROOT, 'scripts', 'analysis', 'typescript-compat.mjs');
if (fs.existsSync(compatibilityAdapterPath)) {
    errors.push(
        'First-party TS6 compatibility adapter is forbidden: scripts/analysis/typescript-compat.mjs must remain retired.',
    );
}

const forbiddenFirstPartyImports = findForbiddenFirstPartyTypeScriptImports();
for (const finding of forbiddenFirstPartyImports) {
    errors.push(`First-party TS6 import is forbidden: ${finding.file} -> ${finding.specifier}`);
}

const eslintMetadata = asObject(packages['node_modules/typescript-eslint']);
const eslintPeerRange = String(asObject(eslintMetadata['peerDependencies'])['typescript'] ?? 'unknown');
const upperBoundMatch = eslintPeerRange.match(/<\s*(\d+(?:\.\d+){0,2})/u);
const eslintUpperMajor = upperBoundMatch ? majorOf(upperBoundMatch[1]) : Number.POSITIVE_INFINITY;
if (eslintUpperMajor < 7)
    notes.push(`TS6 compatibility remains justified by typescript-eslint peer range: ${eslintPeerRange}`);
else
    notes.push(
        `typescript-eslint no longer advertises an upper bound below TS7 (${eslintPeerRange}); reevaluate removal of the TS6 alias.`,
    );

const versions = typeScriptEntries
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => `${entry.path}: ${entry.name}@${entry.version}`);

if (errors.length > 0) {
    console.error('TypeScript baseline: FAIL');
    for (const error of errors) console.error(`- ${error}`);
    if (versions.length > 0) console.error(`Observed TypeScript entries:\n- ${versions.join('\n- ')}`);
    process.exitCode = 1;
} else {
    console.log('TypeScript baseline: OK');
    console.log(`- canonical: TypeScript ${nativeEntry['version']} via @typescript/native`);
    console.log(`- compatibility: ${compatEntry['name']}@${compatEntry['version']}`);
    console.log('- forbidden majors: none below 6');
    console.log(`- first-party TS6 imports: ${forbiddenFirstPartyImports.length}`);
    console.log('- internal TS6 compatibility adapter: absent');
    console.log('- Madge: absent');
    for (const note of notes) console.log(`- ${note}`);
}
