// @ts-check
/**
 * Static import-closure analysis for infra public entrypoints.
 *
 * The analyzer follows repository-local static ESM imports/reexports only. Dynamic imports are intentionally excluded:
 * they are lazy cost decisions and must not inflate cold static-import budgets. External packages are recorded by
 * package name but their node_modules implementation trees are not traversed.
 *
 * @module copilot/infra/governance/public-api-cost
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json');
const PACKAGE_IMPORTS = Object.freeze(JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')).imports ?? {});
const MODULE_CANDIDATES = Object.freeze(['.js', '.mjs', '.cjs', '.json']);
const STATIC_MODULE_SPECIFIER_PATTERN =
    /(?:^|\n)\s*(?:import\s+(?:[^'"\n;]*?\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)['"]([^'"]+)['"]/g;

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

/** @param {string} specifier @returns {string | null} */
function resolvePackageImport(specifier) {
    const exact = PACKAGE_IMPORTS[specifier];
    if (typeof exact === 'string') return resolveFileCandidate(resolve(REPO_ROOT, exact));
    for (const [pattern, target] of Object.entries(PACKAGE_IMPORTS)) {
        if (typeof target !== 'string' || !pattern.includes('*')) continue;
        const [prefix, suffix] = pattern.split('*');
        if (!specifier.startsWith(prefix ?? '') || !specifier.endsWith(suffix ?? '')) continue;
        const middle = specifier.slice((prefix ?? '').length, specifier.length - (suffix ?? '').length);
        return resolveFileCandidate(resolve(REPO_ROOT, target.replace('*', middle)));
    }
    return null;
}

/** @param {string} specifier @returns {string} */
function externalPackageName(specifier) {
    if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
    return specifier.split('/')[0] ?? specifier;
}

/**
 * @param {string} importer
 * @param {string} specifier
 * @returns {{ kind: 'local'; path: string } | { kind: 'external'; packageName: string } | { kind: 'builtin' } | null}
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

/** @param {string} source @returns {string[]} */
export function listStaticModuleSpecifiers(source) {
    return [...source.matchAll(STATIC_MODULE_SPECIFIER_PATTERN)]
        .map((match) => match[1])
        .filter((specifier) => typeof specifier === 'string');
}

/**
 * @param {string} entryTarget Package-import target or repository-relative file path.
 * @returns {{
 *     moduleCount: number;
 *     sourceBytes: number;
 *     files: string[];
 *     externalPackages: string[];
 *     unresolved: { importer: string; specifier: string }[];
 * }}
 */
export function buildStaticImportClosure(entryTarget) {
    const absoluteEntry = resolveFileCandidate(resolve(REPO_ROOT, entryTarget));
    if (!absoluteEntry) throw new Error(`Unable to resolve static-closure entrypoint: ${entryTarget}`);

    const pending = [absoluteEntry];
    const visited = new Set();
    const externalPackages = new Set();
    /** @type {{ importer: string; specifier: string }[]} */
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
                unresolved.push({ importer: relative(REPO_ROOT, file), specifier });
                continue;
            }
            if (resolution.kind === 'external') externalPackages.add(resolution.packageName);
            if (resolution.kind === 'local' && resolution.path.startsWith(REPO_ROOT)) pending.push(resolution.path);
        }
    }

    return {
        moduleCount: visited.size,
        sourceBytes,
        files: [...visited].map((file) => relative(REPO_ROOT, file).replaceAll('\\', '/')).sort(),
        externalPackages: [...externalPackages].sort(),
        unresolved: unresolved.sort((a, b) =>
            `${a.importer}:${a.specifier}`.localeCompare(`${b.importer}:${b.specifier}`),
        ),
    };
}

/**
 * Evaluate every public entrypoint against its versioned closure baseline and declared cost tier.
 *
 * @param {{ manifest?: readonly import('./public-api-manifest.js').PublicApiDescriptor[] }} [options]
 */
export async function buildInfraPublicApiCostReport(options = {}) {
    const { INFRA_PUBLIC_API_COST_BASELINE } = await import('./public-api-cost-baseline.js');
    const { INFRA_PUBLIC_API_COST_TIER_LIMITS, INFRA_PUBLIC_API_MANIFEST } = await import('./public-api-manifest.js');
    const manifest = options.manifest ?? INFRA_PUBLIC_API_MANIFEST;
    const baselineByAlias = new Map(INFRA_PUBLIC_API_COST_BASELINE.map((entry) => [entry.alias, entry]));
    /** @type {{ alias:string; passed:boolean; violations:string[]; moduleCount:number; sourceBytes:number; externalPackages:string[]; costTier:string }[]} */
    const entries = [];

    for (const descriptor of manifest) {
        const closure = buildStaticImportClosure(descriptor.target);
        const baseline = baselineByAlias.get(descriptor.alias);
        const tier = INFRA_PUBLIC_API_COST_TIER_LIMITS[descriptor.costTier];
        /** @type {string[]} */
        const violations = [];
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
        if (tier.maxModules !== null && closure.moduleCount > tier.maxModules)
            violations.push(`tier-module-limit:${closure.moduleCount}>${tier.maxModules}`);
        if (tier.maxSourceBytes !== null && closure.sourceBytes > tier.maxSourceBytes)
            violations.push(`tier-source-limit:${closure.sourceBytes}>${tier.maxSourceBytes}`);
        if (closure.unresolved.length > 0) violations.push(`unresolved-static-imports:${closure.unresolved.length}`);
        entries.push({
            alias: descriptor.alias,
            passed: violations.length === 0,
            violations,
            moduleCount: closure.moduleCount,
            sourceBytes: closure.sourceBytes,
            externalPackages: closure.externalPackages,
            costTier: descriptor.costTier,
        });
    }

    const manifestAliases = new Set(manifest.map((entry) => entry.alias));
    for (const baseline of INFRA_PUBLIC_API_COST_BASELINE) {
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
        entries: Object.freeze(entries),
        violations: Object.freeze(violations),
    });
}
