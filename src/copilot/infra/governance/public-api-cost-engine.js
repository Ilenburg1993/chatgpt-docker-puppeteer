// @ts-check
/**
 * Domain-neutral static import-closure and public-surface cost governance engine.
 *
 * This module owns mechanics only: repository-local static ESM traversal, package-import resolution and
 * baseline/tier comparison. Semantic manifests, tiers and baselines remain owned by each governed domain.
 * Dynamic import() is intentionally excluded because it is a lazy/runtime cost decision.
 *
 * @module copilot/infra/governance/public-api-cost-engine
 */

import { parse } from '@babel/parser';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MODULE_CANDIDATES = Object.freeze(['.js', '.mjs', '.cjs', '.json']);

/**
 * @typedef {{ alias:string; target:string; costTier:string }} PublicSurfaceCostDescriptor
 * @typedef {{ alias:string; moduleCount:number; maxModuleCount:number; sourceBytes:number; maxSourceBytes:number; externalPackages:readonly string[] }} PublicSurfaceCostBaselineEntry
 * @typedef {{ maxModules:number|null; maxSourceBytes:number|null }} PublicSurfaceCostTierLimit
 */

/** @param {string} candidate @returns {string | null} */
function resolveFileCandidate(candidate) {
    const candidates = [candidate];
    if (!extname(candidate)) {
        for (const extension of MODULE_CANDIDATES) candidates.push(`${candidate}${extension}`);
        for (const extension of MODULE_CANDIDATES) candidates.push(join(candidate, `index${extension}`));
    }
    for (const target of candidates) {
        if (existsSync(target) && statSync(target).isFile()) return target;
    }
    return null;
}

/** @param {string} specifier @returns {string} */
function externalPackageName(specifier) {
    if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
    return specifier.split('/')[0] ?? specifier;
}

/**
 * Parse real static ESM edges. Multiline imports/reexports are supported; dynamic import() is excluded.
 * @param {string} source
 * @returns {{specifier:string;kind:'import'|'reexport'}[]}
 */
export function listStaticModuleEdges(source) {
    const ast = parse(source, {
        sourceType: 'unambiguous',
        allowAwaitOutsideFunction: true,
        errorRecovery: false,
    });
    /** @type {{specifier:string;kind:'import'|'reexport'}[]} */
    const edges = [];
    for (const statement of ast.program.body) {
        if (statement.type === 'ImportDeclaration') {
            if (statement.source.value) edges.push({ specifier: String(statement.source.value), kind: 'import' });
            continue;
        }
        if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportAllDeclaration') {
            if (statement.source?.value) edges.push({ specifier: String(statement.source.value), kind: 'reexport' });
        }
    }
    return edges;
}

/**
 * @param {string} source
 * @returns {string[]}
 */
export function listStaticModuleSpecifiers(source) {
    return listStaticModuleEdges(source).map((edge) => edge.specifier);
}

/**
 * Build an analyzer bound to one repository/package-import generation.
 * @param {{ repoRoot?:string; packageImports?:Readonly<Record<string, unknown>> }} [options]
 */
export function createStaticImportClosureAnalyzer(options = {}) {
    const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
    const packageImports = Object.freeze(
        options.packageImports ?? JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).imports ?? {},
    );

    /** @param {string} specifier @returns {string | null} */
    function resolvePackageImport(specifier) {
        const exact = packageImports[specifier];
        if (typeof exact === 'string') return resolveFileCandidate(resolve(repoRoot, exact));
        for (const [pattern, target] of Object.entries(packageImports)) {
            if (typeof target !== 'string' || !pattern.includes('*')) continue;
            const [prefix, suffix] = pattern.split('*');
            if (!specifier.startsWith(prefix ?? '') || !specifier.endsWith(suffix ?? '')) continue;
            const middle = specifier.slice((prefix ?? '').length, specifier.length - (suffix ?? '').length);
            return resolveFileCandidate(resolve(repoRoot, target.replace('*', middle)));
        }
        return null;
    }

    /**
     * @param {string} importer
     * @param {string} specifier
     * @returns {{ kind:'local'; path:string } | { kind:'external'; packageName:string } | { kind:'builtin' } | null}
     */
    function resolveStaticSpecifier(importer, specifier) {
        if (specifier.startsWith('node:')) return { kind: 'builtin' };
        if (specifier.startsWith('.')) {
            const target = resolveFileCandidate(resolve(dirname(importer), specifier));
            return target ? { kind: 'local', path: target } : null;
        }
        if (specifier.startsWith('#')) {
            const target = resolvePackageImport(specifier);
            return target ? { kind: 'local', path: target } : null;
        }
        return { kind: 'external', packageName: externalPackageName(specifier) };
    }

    /** @param {string} entryTarget */
    function build(entryTarget) {
        const absoluteEntry = resolveFileCandidate(resolve(repoRoot, entryTarget));
        if (!absoluteEntry) throw new Error(`Unable to resolve static-closure entrypoint: ${entryTarget}`);

        const pending = [absoluteEntry];
        const visited = new Set();
        const externalPackages = new Set();
        /** @type {{ importer:string; specifier:string }[]} */
        const unresolved = [];
        let sourceBytes = 0;

        while (pending.length > 0) {
            const file = pending.pop();
            if (!file || visited.has(file)) continue;
            visited.add(file);
            const source = readFileSync(file, 'utf8');
            sourceBytes += Buffer.byteLength(source, 'utf8');
            for (const specifier of listStaticModuleSpecifiers(source)) {
                const resolution = resolveStaticSpecifier(file, specifier);
                if (!resolution) {
                    unresolved.push({ importer: relative(repoRoot, file).replaceAll('\\', '/'), specifier });
                    continue;
                }
                if (resolution.kind === 'external') externalPackages.add(resolution.packageName);
                if (resolution.kind === 'local' && resolution.path.startsWith(repoRoot)) pending.push(resolution.path);
            }
        }

        return Object.freeze({
            moduleCount: visited.size,
            sourceBytes,
            files: Object.freeze([...visited].map((file) => relative(repoRoot, file).replaceAll('\\', '/')).sort()),
            externalPackages: Object.freeze([...externalPackages].sort()),
            unresolved: Object.freeze(
                unresolved.sort((a, b) => `${a.importer}:${a.specifier}`.localeCompare(`${b.importer}:${b.specifier}`)),
            ),
        });
    }

    return Object.freeze({ repoRoot, build, resolveStaticSpecifier });
}

const DEFAULT_ANALYZER = createStaticImportClosureAnalyzer();

/** @param {string} entryTarget */
export function buildStaticImportClosure(entryTarget) {
    return DEFAULT_ANALYZER.build(entryTarget);
}

/**
 * Evaluate a domain-owned public-surface manifest against its domain-owned baseline and tier limits.
 * @param {{
 *   manifest:readonly PublicSurfaceCostDescriptor[];
 *   baseline:readonly PublicSurfaceCostBaselineEntry[];
 *   tierLimits:Readonly<Record<string, PublicSurfaceCostTierLimit>>;
 *   buildClosure?:(target:string)=>ReturnType<typeof buildStaticImportClosure>;
 * }} options
 */
export function buildPublicSurfaceCostReport(options) {
    const buildClosure = options.buildClosure ?? buildStaticImportClosure;
    const baselineByAlias = new Map(options.baseline.map((entry) => [entry.alias, entry]));
    /** @type {{ alias:string; passed:boolean; violations:string[]; moduleCount:number; sourceBytes:number; externalPackages:string[]; costTier:string }[]} */
    const entries = [];

    for (const descriptor of options.manifest) {
        const closure = buildClosure(descriptor.target);
        const baseline = baselineByAlias.get(descriptor.alias);
        const tier = options.tierLimits[descriptor.costTier];
        /** @type {string[]} */
        const violations = [];
        if (!tier) violations.push(`unknown-cost-tier:${descriptor.costTier}`);
        if (!baseline) {
            violations.push('missing-versioned-baseline');
        } else {
            if (closure.moduleCount > baseline.maxModuleCount)
                violations.push(`module-count:${closure.moduleCount}>${baseline.maxModuleCount}`);
            if (closure.sourceBytes > baseline.maxSourceBytes)
                violations.push(`source-bytes:${closure.sourceBytes}>${baseline.maxSourceBytes}`);
            const allowedPackages = new Set(baseline.externalPackages);
            for (const dependency of closure.externalPackages) {
                if (!allowedPackages.has(dependency)) violations.push(`new-external-package:${dependency}`);
            }
        }
        if (tier?.maxModules !== null && tier && closure.moduleCount > tier.maxModules)
            violations.push(`tier-module-limit:${closure.moduleCount}>${tier.maxModules}`);
        if (tier?.maxSourceBytes !== null && tier && closure.sourceBytes > tier.maxSourceBytes)
            violations.push(`tier-source-limit:${closure.sourceBytes}>${tier.maxSourceBytes}`);
        if (closure.unresolved.length > 0) violations.push(`unresolved-static-imports:${closure.unresolved.length}`);
        entries.push({
            alias: descriptor.alias,
            passed: violations.length === 0,
            violations,
            moduleCount: closure.moduleCount,
            sourceBytes: closure.sourceBytes,
            externalPackages: [...closure.externalPackages],
            costTier: descriptor.costTier,
        });
    }

    const manifestAliases = new Set(options.manifest.map((entry) => entry.alias));
    for (const baseline of options.baseline) {
        if (!manifestAliases.has(baseline.alias)) {
            entries.push({
                alias: baseline.alias,
                passed: false,
                violations: ['stale-baseline-entry'],
                moduleCount: baseline.moduleCount,
                sourceBytes: baseline.sourceBytes,
                externalPackages: [...baseline.externalPackages],
                costTier: 'unknown',
            });
        }
    }

    const violations = entries.filter((entry) => !entry.passed);
    return Object.freeze({
        success: violations.length === 0,
        entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
        violations: Object.freeze(violations),
    });
}
