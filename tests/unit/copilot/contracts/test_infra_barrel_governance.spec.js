// @ts-check

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildInfraModuleScorecard, INFRA_MODULE_LAYOUT } from '#copilot/infra/internal/governance';

const REPO_ROOT = process.cwd();
const INFRA_ROOT = resolve(REPO_ROOT, 'src/copilot/infra');
const PACKAGE_JSON = resolve(REPO_ROOT, 'package.json');

/** @param {string} directory @returns {string[]} */
function listJavaScriptFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = join(directory, entry.name);
        if (entry.isDirectory()) return listJavaScriptFiles(entryPath);
        return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
    });
}

/** @param {string} importer @param {string} specifier */
function resolveRelativeModule(importer, specifier) {
    const candidate = resolve(importer, '..', specifier);
    for (const target of [candidate, `${candidate}.js`, join(candidate, 'index.js')]) {
        if (existsSync(target) && statSync(target).isFile()) return target;
    }
    return null;
}

/** @param {string} directory @param {string} candidate */
function isInsideDirectory(directory, candidate) {
    const pathFromDirectory = relative(directory, candidate);
    return (
        pathFromDirectory === '' ||
        (pathFromDirectory !== '..' && !pathFromDirectory.startsWith(`..${sep}`) && !isAbsolute(pathFromDirectory))
    );
}

/** @param {string} file */
function findBarrelOwner(file) {
    let directory = dirname(file);
    while (directory.startsWith(INFRA_ROOT)) {
        if (existsSync(join(directory, 'index.js'))) return relative(INFRA_ROOT, directory) || '.';
        if (directory === INFRA_ROOT) break;
        directory = dirname(directory);
    }
    return null;
}

/** @param {Map<string, Set<string>>} graph */
function findDependencyCycles(graph) {
    const visiting = new Set();
    const visited = new Set();
    /** @type {string[]} */
    const stack = [];
    /** @type {string[]} */
    const cycles = [];

    /** @param {string} node */
    function visit(node) {
        if (visited.has(node)) return;
        if (visiting.has(node)) {
            const start = stack.indexOf(node);
            const cycle = [...stack.slice(start), node];
            cycles.push(cycle.join(' -> '));
            return;
        }
        visiting.add(node);
        stack.push(node);
        for (const target of graph.get(node) ?? []) visit(target);
        stack.pop();
        visiting.delete(node);
        visited.add(node);
    }

    for (const node of graph.keys()) visit(node);
    return [...new Set(cycles)].sort();
}

describe('infra barrel governance', () => {
    it('module-map cobre todas as entradas raiz de infra', () => {
        const actual = readdirSync(INFRA_ROOT, { withFileTypes: true })
            .filter((entry) => entry.name === 'README.md' || entry.name.endsWith('.js') || entry.isDirectory())
            .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
            .sort();
        const mapped = INFRA_MODULE_LAYOUT.map((entry) => entry.path).sort();

        expect(mapped).toEqual(actual);
    });

    it('public/ é a única membrana externa e preserva capabilities internas como owners primários', () => {
        const publicRoots = INFRA_MODULE_LAYOUT.filter((entry) => entry.public).map((entry) => entry.path);
        const primaryCapabilities = INFRA_MODULE_LAYOUT.filter(
            (entry) => entry.tier === 'primary' && entry.role !== 'public-api',
        ).map((entry) => entry.path);

        expect(publicRoots).toEqual(['public/']);
        expect(primaryCapabilities).toEqual(
            expect.arrayContaining([
                'governance/',
                'platform/',
                'concurrency/',
                'filesystem/',
                'persistence/',
                'cache/',
                'code-analysis/',
                'indexing/',
                'operations/',
                'observability/',
                'policy/',
                'testing/',
            ]),
        );
        expect(readdirSync(INFRA_ROOT)).toContain('public');
        expect(existsSync(join(INFRA_ROOT, 'public', 'index.js'))).toBe(false);
    });

    it('cada diretório sob public/ possui barrel e public/ não recria um mega-barrel raiz', () => {
        const publicRoot = join(INFRA_ROOT, 'public');
        const missing = [];
        /** @param {string} directory */
        function visit(directory) {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const child = join(directory, entry.name);
                if (!existsSync(join(child, 'index.js'))) missing.push(relative(publicRoot, child));
                visit(child);
            }
        }
        visit(publicRoot);
        expect(missing).toEqual([]);
        expect(existsSync(join(publicRoot, 'index.js'))).toBe(false);
    });

    it('package imports separa namespaces public/internal sem aliases legados ou wildcard', async () => {
        const packageJson = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'));
        const infraAliases = Object.entries(packageJson.imports ?? {}).filter(([key]) =>
            key.startsWith('#copilot/infra/'),
        );
        const publicAliases = infraAliases.filter(([key]) => key.startsWith('#copilot/infra/public/'));
        const internalAliases = infraAliases.filter(([key]) => key.startsWith('#copilot/infra/internal/'));
        const legacyAliases = infraAliases.filter(
            ([key]) => !key.startsWith('#copilot/infra/public/') && !key.startsWith('#copilot/infra/internal/'),
        );

        expect(legacyAliases).toEqual([]);
        expect(infraAliases.map(([key]) => key)).not.toContain('#copilot/infra/*');
        expect(publicAliases.length).toBeGreaterThan(0);
        expect(internalAliases.length).toBeGreaterThan(0);
        expect(
            publicAliases.every(
                ([, target]) =>
                    typeof target === 'string' &&
                    target.startsWith('./src/copilot/infra/public/') &&
                    target.endsWith('/index.js'),
            ),
        ).toBe(true);
        expect(
            internalAliases.every(
                ([, target]) =>
                    typeof target === 'string' &&
                    target.startsWith('./src/copilot/infra/') &&
                    !target.startsWith('./src/copilot/infra/public/') &&
                    target.endsWith('/index.js'),
            ),
        ).toBe(true);
        expect(publicAliases.map(([key]) => key)).toEqual(
            expect.arrayContaining([
                '#copilot/infra/public/platform',
                '#copilot/infra/public/concurrency/locks',
                '#copilot/infra/public/filesystem/read',
                '#copilot/infra/public/filesystem/write',
                '#copilot/infra/public/filesystem/workspace',
                '#copilot/infra/public/filesystem/trusted',
                '#copilot/infra/public/database',
                '#copilot/infra/public/cache',
                '#copilot/infra/public/code-analysis',
                '#copilot/infra/public/indexing',
                '#copilot/infra/public/operations',
                '#copilot/infra/public/observability',
                '#copilot/infra/public/telemetry',
                '#copilot/infra/public/policy',
                '#copilot/infra/public/testing',
            ]),
        );
    });

    it('código externo a infra só consome a membrana public e não atravessa por caminho relativo', async () => {
        const copilotRoot = resolve(REPO_ROOT, 'src/copilot');
        const violations = [];
        const moduleSpecifierPattern = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
        for (const file of listJavaScriptFiles(copilotRoot)) {
            if (isInsideDirectory(INFRA_ROOT, file)) continue;
            const source = await readFile(file, 'utf8');
            for (const match of source.matchAll(moduleSpecifierPattern)) {
                const specifier = match[1];
                if (!specifier) continue;
                if (specifier.startsWith('#copilot/infra/') && !specifier.startsWith('#copilot/infra/public/')) {
                    violations.push(`${relative(copilotRoot, file)} -> ${specifier}`);
                    continue;
                }
                if (!specifier.startsWith('.')) continue;
                const target = resolveRelativeModule(file, specifier);
                if (target && isInsideDirectory(INFRA_ROOT, target)) {
                    violations.push(`${relative(copilotRoot, file)} -> ${relative(INFRA_ROOT, target)}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('scripts e testes não-white-box também consomem infra somente por public', async () => {
        const roots = [resolve(REPO_ROOT, 'scripts'), resolve(REPO_ROOT, 'tests/unit/copilot')];
        const infraTestsRoot = resolve(REPO_ROOT, 'tests/unit/copilot/infra');
        const governanceTest = resolve(REPO_ROOT, 'tests/unit/copilot/contracts/test_infra_barrel_governance.spec.js');
        const violations = [];
        const moduleSpecifierPattern = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
        for (const root of roots) {
            for (const file of listJavaScriptFiles(root)) {
                if (isInsideDirectory(infraTestsRoot, file) || file === governanceTest) continue;
                const source = await readFile(file, 'utf8');
                for (const match of source.matchAll(moduleSpecifierPattern)) {
                    const specifier = match[1];
                    if (!specifier) continue;
                    if (specifier.startsWith('#copilot/infra/') && !specifier.startsWith('#copilot/infra/public/')) {
                        violations.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
                        continue;
                    }
                    if (!specifier.startsWith('.')) continue;
                    const target = resolveRelativeModule(file, specifier);
                    if (target && isInsideDirectory(INFRA_ROOT, target)) {
                        violations.push(`${relative(REPO_ROOT, file)} -> ${relative(INFRA_ROOT, target)}`);
                    }
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('internals nunca dependem de public e public projeta somente barrels internos/filhos', async () => {
        const publicRoot = join(INFRA_ROOT, 'public');
        const internalViolations = [];
        const publicViolations = [];
        const moduleSpecifierPattern = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
        for (const file of listJavaScriptFiles(INFRA_ROOT)) {
            const source = await readFile(file, 'utf8');
            const isPublic = isInsideDirectory(publicRoot, file);
            for (const match of source.matchAll(moduleSpecifierPattern)) {
                const specifier = match[1];
                if (!specifier) continue;
                if (!isPublic && specifier.startsWith('#copilot/infra/public/')) {
                    internalViolations.push(`${relative(INFRA_ROOT, file)} -> ${specifier}`);
                    continue;
                }
                if (!isPublic) continue;
                if (specifier.startsWith('#copilot/infra/internal/')) {
                    publicViolations.push(`${relative(INFRA_ROOT, file)} -> ${specifier}`);
                    continue;
                }
                if (!specifier.startsWith('.')) {
                    publicViolations.push(`${relative(INFRA_ROOT, file)} -> ${specifier}`);
                    continue;
                }
                const target = resolveRelativeModule(file, specifier);
                if (!target || !target.endsWith('/index.js')) {
                    publicViolations.push(`${relative(INFRA_ROOT, file)} -> ${specifier}`);
                }
            }
        }
        expect(internalViolations).toEqual([]);
        expect(publicViolations).toEqual([]);
    });

    it('entrypoints public operacionais não expõem controles exclusivos de teste', async () => {
        const packageJson = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'));
        const violations = [];
        for (const [alias, target] of Object.entries(packageJson.imports ?? {})) {
            if (!alias.startsWith('#copilot/infra/public/') || alias === '#copilot/infra/public/testing') continue;
            if (typeof target !== 'string' || !target.startsWith('./src/copilot/infra/public/')) continue;
            const publicSource = await readFile(resolve(REPO_ROOT, target), 'utf8');
            const specifier = [...publicSource.matchAll(/(?:from\s*)['"]([^'"]+)['"]/g)][0]?.[1];
            if (!specifier) continue;
            const internalTarget = resolveRelativeModule(resolve(REPO_ROOT, target), specifier);
            if (!internalTarget) continue;
            const internalSource = await readFile(internalTarget, 'utf8');
            if (/\b(?:reset|clear)[A-Za-z0-9_]*(?:ForTest|ForTests|ForTesting)\b/.test(internalSource)) {
                violations.push(alias);
            }
        }
        expect(violations).toEqual([]);
    });

    it('travessias entre diretórios usam barrel, mesma pasta ou subpasta privada', async () => {
        const violations = [];
        const privilegedTargets = [];
        const moduleSpecifierPattern = /(?:from\s*|import\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g;

        for (const file of listJavaScriptFiles(INFRA_ROOT)) {
            const source = await readFile(file, 'utf8');
            const importerDirectory = dirname(file);
            for (const match of source.matchAll(moduleSpecifierPattern)) {
                const specifier = match[1];
                if (!specifier) continue;
                const target = resolveRelativeModule(file, specifier);
                if (!target) continue;
                if (importerDirectory === dirname(target)) continue;
                // A parent owner may depend directly on a private child/subcapability.
                if (isInsideDirectory(importerDirectory, target)) continue;
                if (target.endsWith('/index.js')) continue;

                const relativeImporter = file.slice(INFRA_ROOT.length + 1);
                const relativeTarget = target.slice(INFRA_ROOT.length + 1);
                if (relativeImporter === 'testing/index.js' && target.endsWith('/test-control.js')) {
                    privilegedTargets.push(relativeTarget);
                    continue;
                }
                violations.push(`${relativeImporter} -> ${relativeTarget}`);
            }
        }

        expect(violations).toEqual([]);
        expect(privilegedTargets.length).toBeGreaterThan(0);
        expect(privilegedTargets.every((target) => target.endsWith('/test-control.js'))).toBe(true);
    });

    it('contratos JSDoc de infra não usam any opaco', async () => {
        const violations = [];
        const opaqueAnyPattern =
            /@(?:type|param|returns?|typedef|property)\b[^\n]*\bany\b|\b(?:Array|Promise|ReadonlyArray)<any>\b|=>\s*any\b/g;
        for (const file of listJavaScriptFiles(INFRA_ROOT)) {
            const source = await readFile(file, 'utf8');
            const matches = [...source.matchAll(opaqueAnyPattern)];
            if (matches.length > 0) {
                violations.push(`${relative(INFRA_ROOT, file)}:${matches.map((match) => match[0]).join(' | ')}`);
            }
        }
        expect(violations).toEqual([]);
    });

    it('identidade @module acompanha o owner físico atual', async () => {
        const violations = [];
        for (const file of listJavaScriptFiles(INFRA_ROOT)) {
            const source = await readFile(file, 'utf8');
            const match = source.match(/@module\s+(copilot\/infra\/[^\s*]+)/);
            if (!match) continue;
            const relativeFile = relative(INFRA_ROOT, file).replaceAll('\\', '/');
            const expected = relativeFile.endsWith('/index.js')
                ? `copilot/infra/${relativeFile.slice(0, -'/index.js'.length)}`
                : `copilot/infra/${relativeFile.replace(/\.js$/u, '')}`;
            if (match[1] !== expected) violations.push(`${relativeFile}: ${match[1]} != ${expected}`);
        }
        expect(violations).toEqual([]);
    });

    it('todo index.js de infra é barrel puro, sem implementação ou import runtime', async () => {
        const violations = [];
        for (const file of listJavaScriptFiles(INFRA_ROOT).filter((entry) => entry.endsWith('/index.js'))) {
            const source = await readFile(file, 'utf8');
            const hasRuntimeImport = /^\s*import\s/m.test(source);
            const hasImplementation = /^\s*(?:export\s+)?(?:(?:async\s+)?function|class|(?:const|let|var)\s)\b/m.test(
                source,
            );
            if (hasRuntimeImport || hasImplementation) {
                violations.push(relative(INFRA_ROOT, file));
            }
        }
        expect(violations).toEqual([]);
    });

    it('grafo entre capabilities com index.js permanece acíclico', async () => {
        const packageJson = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'));
        const aliasTargets = new Map(
            Object.entries(packageJson.imports ?? {})
                .filter(([alias, target]) => alias.startsWith('#copilot/infra/') && typeof target === 'string')
                .map(([alias, target]) => [alias, resolve(REPO_ROOT, /** @type {string} */ (target))]),
        );
        const graph = new Map();
        const moduleSpecifierPattern = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

        for (const file of listJavaScriptFiles(INFRA_ROOT)) {
            const sourceOwner = findBarrelOwner(file);
            if (!sourceOwner) continue;
            if (!graph.has(sourceOwner)) graph.set(sourceOwner, new Set());
            const source = await readFile(file, 'utf8');
            for (const match of source.matchAll(moduleSpecifierPattern)) {
                const specifier = match[1];
                if (!specifier) continue;
                const target = specifier.startsWith('.')
                    ? resolveRelativeModule(file, specifier)
                    : (aliasTargets.get(specifier) ?? null);
                if (!target || !target.startsWith(INFRA_ROOT)) continue;
                const targetOwner = findBarrelOwner(target);
                if (targetOwner && targetOwner !== sourceOwner) graph.get(sourceOwner)?.add(targetOwner);
            }
        }

        expect(findDependencyCycles(graph)).toEqual([]);
    });

    it('grafo completo de arquivos permanece acíclico, inclusive dependências JSDoc', async () => {
        const packageJson = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'));
        const aliasTargets = new Map(
            Object.entries(packageJson.imports ?? {})
                .filter(([alias, target]) => alias.startsWith('#copilot/infra/') && typeof target === 'string')
                .map(([alias, target]) => [alias, resolve(REPO_ROOT, /** @type {string} */ (target))]),
        );
        const files = listJavaScriptFiles(INFRA_ROOT);
        const fileSet = new Set(files);
        /** @type {Map<string, Set<string>>} */
        const graph = new Map(files.map((file) => [relative(INFRA_ROOT, file), new Set()]));
        const moduleSpecifierPattern = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

        for (const file of files) {
            const source = await readFile(file, 'utf8');
            const sourceNode = relative(INFRA_ROOT, file);
            for (const match of source.matchAll(moduleSpecifierPattern)) {
                const specifier = match[1];
                if (!specifier) continue;
                const target = specifier.startsWith('.')
                    ? resolveRelativeModule(file, specifier)
                    : (aliasTargets.get(specifier) ?? null);
                if (!target || !fileSet.has(target)) continue;
                graph.get(sourceNode)?.add(relative(INFRA_ROOT, target));
            }
        }

        expect(findDependencyCycles(graph)).toEqual([]);
    });

    it('observability não reexporta operações pertencentes ao parser', async () => {
        const source = await readFile(join(INFRA_ROOT, 'observability/index.js'), 'utf8');

        expect(source).not.toContain('#copilot/infra/public/indexing/parser');
        expect(source).not.toContain('parseAndCacheSymbols');
        expect(source).not.toContain('invalidateParserCache');
    });

    it('scorecard expõe hotspots de IO para orientar novas ondas', () => {
        const scorecard = buildInfraModuleScorecard();

        expect(scorecard.total).toBe(INFRA_MODULE_LAYOUT.length);
        expect(scorecard.hotspots).toEqual(expect.arrayContaining(['filesystem/', 'indexing/']));
        expect(scorecard.byRole['public-api']).toBe(1);
        expect(scorecard.publicEntries).toEqual(['public/']);
        expect(scorecard.drift.available).toBe(true);
        expect(scorecard.drift.missingInLayout).toEqual([]);
        expect(scorecard.drift.staleInLayout).toEqual([]);
    });

    it('persistence/json é o owner canônico do JSON store', async () => {
        const source = await readFile(join(INFRA_ROOT, 'persistence/json/index.js'), 'utf8');

        expect(source).not.toContain('io-engine.js');
        expect(source).toContain('./store.js');
    });

    it('code-analysis/ permanece puro sem ownership de runtime IO/cache/session/indexing', async () => {
        const analysisFiles = readdirSync(join(INFRA_ROOT, 'code-analysis')).filter((name) => name.endsWith('.js'));
        const violations = [];
        for (const file of analysisFiles) {
            const source = await readFile(join(INFRA_ROOT, 'code-analysis', file), 'utf8');
            if (
                /from ['"](?:#copilot\/infra\/(?:cache|filesystem|indexing)|\.\.\/(?:io|cache|filesystem|indexing))/.test(
                    source,
                )
            ) {
                violations.push(file);
            }
        }

        expect(violations).toEqual([]);
    });
});
