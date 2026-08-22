#!/usr/bin/env node
// @ts-check
/**
 * Canonical CI gate for `#copilot/**` package-import governance.
 *
 * Guarantees:
 * - every active usage in executable workspace roots resolves through an exact package import;
 * - wildcard `#copilot/**` mappings do not exist;
 * - `#copilot/testing/**` is test-only and every testing alias has a live test consumer;
 * - exact leaf aliases cannot survive unused unless an explicit architecture manifest owns them;
 * - SDK public aliases are a bijection with SDK_ALIAS_LAYOUT;
 * - every declared `#copilot/**` target exists physically.
 *
 * @module scripts/ci/check-copilot-package-imports
 */

import { INFRA_PUBLIC_API_MANIFEST } from '#copilot/infra/public/diagnostic/governance';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { SDK_ALIAS_LAYOUT } from '../../src/copilot/sdk/module-map.js';
import { buildCopilotExactImportReport, readPackageImports } from '../lib/copilot-package-imports.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXECUTABLE_ROOTS = Object.freeze(['src', 'tests', 'scripts', 'tools']);

/** @param {string} repoRoot @param {string} relativePath */
function absolutePath(repoRoot, relativePath) {
    return path.join(repoRoot, relativePath);
}

/** @param {readonly string[]} values */
function sortedUnique(values) {
    return [...new Set(values)].sort();
}

/**
 * @param {{repoRoot?:string}} [options]
 */
export function buildCopilotPackageImportGovernanceReport(options = {}) {
    const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
    const packagePath = path.join(repoRoot, 'package.json');
    const roots = EXECUTABLE_ROOTS.map((root) => absolutePath(repoRoot, root));
    const exactReport = buildCopilotExactImportReport({
        roots,
        packagePath,
        relativeTo: repoRoot,
    });
    const packageJson = /** @type {{exports?:Record<string, unknown>}} */ (
        JSON.parse(readFileSync(packagePath, 'utf8'))
    );
    const packageImports = readPackageImports(packagePath);
    const packageExports = packageJson.exports ?? {};
    const copilotAliases = Object.keys(packageImports)
        .filter((alias) => alias.startsWith('#copilot/'))
        .sort();

    const brokenAliases = copilotAliases
        .filter((alias) => {
            const target = packageImports[alias];
            if (!target) return true;
            const normalized = target.replace(/^\.\//u, '');
            return !existsSync(path.join(repoRoot, normalized));
        })
        .map((alias) => `${alias} -> ${String(packageImports[alias])}`);

    const productionUsages = exactReport.usages.filter((usage) => !usage.file.startsWith('tests/'));
    const forbiddenTestingUsages = productionUsages.filter((usage) => usage.specifier.startsWith('#copilot/testing/'));

    const testingAliases = copilotAliases.filter((alias) => alias.startsWith('#copilot/testing/'));
    const testUsageAliases = new Set(
        exactReport.usages
            .filter((usage) => usage.file.startsWith('tests/'))
            .map((usage) => usage.specifier)
            .filter((specifier) => specifier.startsWith('#copilot/testing/')),
    );
    const unusedTestingAliases = testingAliases.filter((alias) => !testUsageAliases.has(alias));

    const usedAliases = new Set(exactReport.usages.map((usage) => usage.specifier));
    const manifestAliases = new Set([
        ...INFRA_PUBLIC_API_MANIFEST.map((entry) => entry.alias),
        ...SDK_ALIAS_LAYOUT.map((entry) => entry.alias),
    ]);
    const staleAliases = copilotAliases
        .filter((alias) => !alias.includes('*') && !usedAliases.has(alias) && !manifestAliases.has(alias))
        .map((alias) => `${alias} -> ${String(packageImports[alias])}`);

    const packageSdkAliases = copilotAliases.filter(
        (alias) => alias === '#copilot/sdk' || alias.startsWith('#copilot/sdk/'),
    );
    const declaredSdkAliases = SDK_ALIAS_LAYOUT.map((entry) => entry.alias).sort();
    const packageSdkSet = new Set(packageSdkAliases);
    const declaredSdkSet = new Set(declaredSdkAliases);
    const missingSdkAliases = declaredSdkAliases.filter((alias) => !packageSdkSet.has(alias));
    const undeclaredSdkAliases = packageSdkAliases.filter((alias) => !declaredSdkSet.has(alias));

    /** @param {string} alias */
    const sdkExportPath = (alias) => `./${alias.slice(1)}`;
    const declaredSdkExports = declaredSdkAliases.map(sdkExportPath).sort();
    const packageSdkExports = Object.keys(packageExports)
        .filter((entry) => entry === './copilot/sdk' || entry.startsWith('./copilot/sdk/'))
        .sort();
    const declaredSdkExportSet = new Set(declaredSdkExports);
    const packageSdkExportSet = new Set(packageSdkExports);
    const missingSdkExports = declaredSdkExports.filter((entry) => !packageSdkExportSet.has(entry));
    const undeclaredSdkExports = packageSdkExports.filter((entry) => !declaredSdkExportSet.has(entry));
    const sdkExportTargetMismatches = declaredSdkAliases.flatMap((alias) => {
        const exportPath = sdkExportPath(alias);
        const exportEntry = packageExports[exportPath];
        const actualTarget =
            typeof exportEntry === 'string'
                ? exportEntry
                : exportEntry && typeof exportEntry === 'object' && 'default' in exportEntry
                  ? /** @type {{default?:unknown}} */ (exportEntry).default
                  : undefined;
        const expectedTarget = packageImports[alias];
        return actualTarget === expectedTarget
            ? []
            : [`${exportPath}: ${String(actualTarget)} != ${String(expectedTarget)}`];
    });

    const violations = Object.freeze({
        brokenAliases: Object.freeze(sortedUnique(brokenAliases)),
        wildcardAliases: exactReport.wildcardAliases,
        nonExactUsages: exactReport.nonExactUsages,
        parseErrors: exactReport.parseErrors,
        forbiddenTestingUsages: Object.freeze(forbiddenTestingUsages),
        unusedTestingAliases: Object.freeze(unusedTestingAliases),
        staleAliases: Object.freeze(sortedUnique(staleAliases)),
        missingSdkAliases: Object.freeze(missingSdkAliases),
        undeclaredSdkAliases: Object.freeze(undeclaredSdkAliases),
        missingSdkExports: Object.freeze(missingSdkExports),
        undeclaredSdkExports: Object.freeze(undeclaredSdkExports),
        sdkExportTargetMismatches: Object.freeze(sdkExportTargetMismatches),
    });
    const success = Object.values(violations).every((entries) => entries.length === 0);

    return Object.freeze({
        success,
        repoRoot,
        scannedFiles: exactReport.scannedFiles,
        parsedFiles: exactReport.parsedFiles,
        usageCount: exactReport.usages.length,
        uniqueSpecifiers: exactReport.uniqueSpecifiers.length,
        copilotAliasCount: copilotAliases.length,
        testingAliasCount: testingAliases.length,
        sdkAliasCount: packageSdkAliases.length,
        sdkExportCount: packageSdkExports.length,
        violations,
    });
}

/** @param {ReturnType<typeof buildCopilotPackageImportGovernanceReport>} report */
function compactReport(report) {
    return {
        success: report.success,
        scannedFiles: report.scannedFiles,
        parsedFiles: report.parsedFiles,
        usageCount: report.usageCount,
        uniqueSpecifiers: report.uniqueSpecifiers,
        copilotAliasCount: report.copilotAliasCount,
        testingAliasCount: report.testingAliasCount,
        sdkAliasCount: report.sdkAliasCount,
        sdkExportCount: report.sdkExportCount,
        violations: report.violations,
    };
}

async function main() {
    const report = buildCopilotPackageImportGovernanceReport();
    process.stdout.write(`${JSON.stringify(compactReport(report), null, 2)}\n`);
    if (!report.success) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
