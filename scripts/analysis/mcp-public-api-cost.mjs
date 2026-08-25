#!/usr/bin/env node
// @ts-check
/** Static public-surface cost governance for MCP. */

import { buildPublicSurfaceCostReport, buildStaticImportClosure } from '#copilot/infra/public/diagnostic/governance';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildTransitiveImportPurityReport } from './lib/import-purity.mjs';
import {
    loadMcpPublicApiCostConfiguration,
    MCP_PUBLIC_API_COST_BASELINE_PATH,
    MCP_PUBLIC_API_COST_SCHEMA_VERSION,
    packageMcpPublicAliases,
    REPO_ROOT,
    validateMcpPublicApiManifestBijection,
} from './lib/mcp-public-api-cost-config.mjs';

const DEFAULT_HEADROOM_MULTIPLIER = 1.5;

/** @param {number} value @param {number} multiplier */
function withHeadroom(value, multiplier) {
    return Math.ceil(value * multiplier);
}

/** @param {readonly {alias:string;target:string;costTier:string;coldImport:boolean}[]} manifest @param {number} multiplier */
function buildBaseline(manifest, multiplier) {
    return manifest.map((descriptor) => {
        const closure = buildStaticImportClosure(descriptor.target);
        if (closure.unresolved.length > 0) {
            throw new Error(
                `Cannot baseline unresolved static imports for ${descriptor.alias}: ${closure.unresolved.length}`,
            );
        }
        return Object.freeze({
            alias: descriptor.alias,
            moduleCount: closure.moduleCount,
            maxModuleCount: withHeadroom(closure.moduleCount, multiplier),
            sourceBytes: closure.sourceBytes,
            maxSourceBytes: withHeadroom(closure.sourceBytes, multiplier),
            externalPackages: Object.freeze([...closure.externalPackages]),
        });
    });
}

async function main() {
    const writeBaseline = process.argv.includes('--write-baseline');
    const details = process.argv.includes('--details');
    const configuration = await loadMcpPublicApiCostConfiguration();
    const packageAliases = packageMcpPublicAliases(configuration.packageJson);
    const manifestViolations = validateMcpPublicApiManifestBijection(packageAliases, configuration.manifest);

    if (writeBaseline) {
        if (manifestViolations.length > 0) {
            throw new Error(`Cannot rebaseline with manifest drift: ${manifestViolations.join(', ')}`);
        }
        const multiplier = Number(configuration.baselineObject.headroomMultiplier ?? DEFAULT_HEADROOM_MULTIPLIER);
        if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error('Invalid baseline headroomMultiplier.');
        const output = {
            schemaVersion: MCP_PUBLIC_API_COST_SCHEMA_VERSION,
            kind: 'copilot-mcp-public-api-cost-baseline',
            headroomMultiplier: multiplier,
            generatedFrom: 'measured-static-import-closure',
            entries: buildBaseline(configuration.manifest, multiplier),
        };
        await writeFile(MCP_PUBLIC_API_COST_BASELINE_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
        process.stdout.write(
            `Updated ${path.relative(REPO_ROOT, MCP_PUBLIC_API_COST_BASELINE_PATH)} (${output.entries.length} aliases)\n`,
        );
        return;
    }

    const closureCache = new Map();
    const buildClosure = (target) => {
        const cached = closureCache.get(target);
        if (cached) return cached;
        const closure = buildStaticImportClosure(target);
        closureCache.set(target, closure);
        return closure;
    };
    const cost = buildPublicSurfaceCostReport({
        manifest: configuration.manifest,
        baseline: configuration.baseline,
        tierLimits: configuration.tierLimits,
        buildClosure,
    });
    const importPurity = buildTransitiveImportPurityReport({
        manifest: configuration.manifest,
        buildClosure,
    });
    const costTierCounts = Object.fromEntries(
        [...new Set(configuration.manifest.map((entry) => entry.costTier))]
            .sort()
            .map((tier) => [tier, configuration.manifest.filter((entry) => entry.costTier === tier).length]),
    );
    const success = manifestViolations.length === 0 && cost.success && importPurity.success;
    const summary = {
        success,
        aliasCount: configuration.manifest.length,
        packageAliasCount: packageAliases.length,
        coldImportAliasCount: configuration.manifest.filter((entry) => entry.coldImport).length,
        closureFileCount: importPurity.closureFileCount,
        costTierCounts,
        manifestViolationCount: manifestViolations.length,
        costViolationCount: cost.violations.length,
        importPurityViolationCount: importPurity.findingCount,
        manifestViolations,
        costViolations: cost.violations.map((entry) => ({ alias: entry.alias, violations: entry.violations })),
        importPurityViolations: importPurity.findings.slice(0, details ? undefined : 25),
        ...(details ? { entries: cost.entries } : {}),
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!success) process.exitCode = 1;
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
