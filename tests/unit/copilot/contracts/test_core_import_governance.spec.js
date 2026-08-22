// @ts-check

import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSourceFilesSync } from '../../../../scripts/lib/source-tree.mjs';

const REPO_ROOT = process.cwd();
const PACKAGE_JSON = resolve(REPO_ROOT, 'package.json');
const MANIFEST_PATH = resolve(REPO_ROOT, 'config/architecture/copilot-core-import-boundaries.json');
const CORE_IO_POLICY_PATH = resolve(REPO_ROOT, 'src/copilot/core/io-policy.js');
const SCAN_ROOTS = ['src', 'tests', 'scripts', 'config'].map((entry) => resolve(REPO_ROOT, entry));
const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];
const CORE_PREFIX = '#copilot/core/';

/** @param {string} directory @returns {string[]} */
function listSourceFiles(directory) {
    if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
    return listSourceFilesSync(directory, { extensions: SOURCE_EXTENSIONS });
}

/** @param {string} source */
function collectCoreSubpathSpecifiers(source) {
    const patterns = [
        /(?:^|\n)\s*(?:import|export)\b[\s\S]{0,2048}?\bfrom\s*['"](#copilot\/core\/[^'"]+)['"]/gu,
        /(?:^|\n)\s*import\s*['"](#copilot\/core\/[^'"]+)['"]/gu,
        /\bimport\s*\(\s*['"](#copilot\/core\/[^'"]+)['"]\s*\)/gu,
        /\brequire\s*\(\s*['"](#copilot\/core\/[^'"]+)['"]\s*\)/gu,
        /\bvi\.(?:mock|importActual)\s*\(\s*['"](#copilot\/core\/[^'"]+)['"]/gu,
    ];
    const specifiers = new Set();
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const specifier = match[1];
            if (specifier) specifiers.add(specifier);
        }
    }
    return specifiers;
}

async function readArchitectureState() {
    const [packageSource, manifestSource] = await Promise.all([
        readFile(PACKAGE_JSON, 'utf8'),
        readFile(MANIFEST_PATH, 'utf8'),
    ]);
    const packageJson = JSON.parse(packageSource);
    const manifest = JSON.parse(manifestSource);
    return { packageJson, manifest };
}

async function collectConsumedCoreSubpaths() {
    const consumed = new Set();
    const files = SCAN_ROOTS.flatMap((root) => listSourceFiles(root));
    for (const file of files) {
        const source = await readFile(file, 'utf8');
        for (const specifier of collectCoreSubpathSpecifiers(source)) consumed.add(specifier);
    }
    return [...consumed].sort();
}

describe('Core semantic import governance', () => {
    it('package.json expõe somente root canônico + aliases exatos do manifesto', async () => {
        const { packageJson, manifest } = await readArchitectureState();
        expect(manifest.schemaVersion).toBe(1);
        expect(manifest.policy).toBe('copilot-core-exact-semantic-import-boundaries');
        expect(manifest.rootAlias).toBe('#copilot/core');
        expect(manifest.rootTarget).toBe('./src/copilot/core/index.js');

        const aliases = /** @type {Array<{alias:string;target:string;semantic:string}>} */ (manifest.aliases);
        expect(aliases.length).toBeGreaterThan(0);
        expect(new Set(aliases.map((entry) => entry.alias)).size).toBe(aliases.length);
        expect(aliases.every((entry) => entry.alias.startsWith(CORE_PREFIX) && !entry.alias.includes('*'))).toBe(true);
        expect(aliases.every((entry) => typeof entry.semantic === 'string' && entry.semantic.length > 0)).toBe(true);

        const packageCoreEntries = Object.entries(packageJson.imports ?? {})
            .filter(([alias]) => alias === manifest.rootAlias || alias.startsWith(CORE_PREFIX))
            .sort(([left], [right]) => left.localeCompare(right));
        const expectedEntries = [
            [manifest.rootAlias, manifest.rootTarget],
            ...aliases.map((entry) => [entry.alias, entry.target]),
        ].sort(([left], [right]) => String(left).localeCompare(String(right)));

        expect(packageJson.imports?.['#copilot/core/*']).toBeUndefined();
        expect(packageCoreEntries).toEqual(expectedEntries);
        for (const [, target] of expectedEntries) {
            expect(typeof target).toBe('string');
            const absoluteTarget = resolve(REPO_ROOT, String(target));
            expect(existsSync(absoluteTarget), `missing Core alias target: ${target}`).toBe(true);
            expect(statSync(absoluteTarget).isFile(), `Core alias target is not a file: ${target}`).toBe(true);
        }
    });

    it('consumo real de Core coincide exatamente com a allowlist e não revive /index', async () => {
        const { manifest } = await readArchitectureState();
        const allowed = /** @type {Array<{alias:string}>} */ (manifest.aliases).map((entry) => entry.alias).sort();
        const consumed = await collectConsumedCoreSubpaths();

        expect(consumed).not.toContain('#copilot/core/index');
        expect(consumed).toEqual(allowed);
    });

    it('core/io-policy permanece puro e não readquire filesystem path authority', async () => {
        const source = await readFile(CORE_IO_POLICY_PATH, 'utf8');
        const forbidden = [
            'node:fs',
            'node:path',
            'process.cwd',
            'process.env',
            'realpath(',
            'evaluateIoPathPolicy',
            'evaluateIoPathPolicyAsync',
            'activateIoPathPolicyCacheConfig',
            'getIoPathPolicyCacheStats',
            'invalidateIoPathPolicyCache',
            'readIoPathPolicyCacheConfig',
            'resetIoPathPolicyCacheForTest',
            'DEFAULT_BLOCKED_PATH_SEGMENTS',
            'DEFAULT_BLOCKED_READ_PATH_PATTERNS',
            'DEFAULT_BLOCKED_WRITE_PATH_PATTERNS',
        ];
        expect(forbidden.filter((token) => source.includes(token))).toEqual([]);
        expect(source).toContain('evaluateIoUrlPolicy');
        expect(source).toContain('resolveIoAdvisoryLimits');
        expect(source).toContain('sanitizeIoTextOutput');
    });
});
