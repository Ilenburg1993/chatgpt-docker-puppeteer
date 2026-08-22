#!/usr/bin/env node
// @ts-check
/**
 * Negative architecture invariant: the generic Copilot trusted-filesystem surface must not exist.
 *
 * Configured external state belongs to ConfiguredFsGrant-backed owners; caller-selected repository paths belong to
 * WorkspacePathAuthority; non-filesystem operating-system resources require narrow domain primitives. Reintroducing a
 * generic outside-workspace filesystem escape hatch is therefore an architecture regression, not an allowlist event.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSourceFilesSync } from '../lib/source-tree.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_ROOT = path.join(ROOT, 'src', 'copilot');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];
const FORBIDDEN_ALIASES = Object.freeze([
    '#copilot/infra/internal/filesystem/trusted',
    '#copilot/infra/public/filesystem/trusted',
]);
const FORBIDDEN_IMPLEMENTATION_PATHS = Object.freeze([
    'src/copilot/infra/filesystem/trusted',
    'src/copilot/infra/public/filesystem/trusted',
]);

/**
 * @param {string} directory
 * @returns {string[]}
 */
function listSourceFiles(directory) {
    return listSourceFilesSync(directory, { extensions: SOURCE_EXTENSIONS });
}

/**
 * @returns {Promise<{
 *     ok: boolean;
 *     issues: string[];
 *     scannedFiles: number;
 *     forbiddenImportReferences: number;
 *     forbiddenAliases: number;
 *     forbiddenImplementationPaths: number;
 * }>}
 */
export async function checkCopilotNoTrustedIo() {
    const packageJson = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'));
    const imports =
        packageJson && typeof packageJson === 'object' && packageJson.imports && typeof packageJson.imports === 'object'
            ? /** @type {Record<string, unknown>} */ (packageJson.imports)
            : {};
    /** @type {string[]} */
    const issues = [];

    const aliasHits = FORBIDDEN_ALIASES.filter((alias) => Object.prototype.hasOwnProperty.call(imports, alias));
    for (const alias of aliasHits) issues.push(`forbidden-trusted-io-alias:${alias}`);

    const implementationHits = FORBIDDEN_IMPLEMENTATION_PATHS.filter((relativePath) =>
        existsSync(path.join(ROOT, relativePath)),
    );
    for (const relativePath of implementationHits) {
        issues.push(`forbidden-trusted-io-implementation:${relativePath}`);
    }

    const sourceFiles = listSourceFiles(SOURCE_ROOT);
    let forbiddenImportReferences = 0;
    for (const absolute of sourceFiles) {
        const source = await readFile(absolute, 'utf8');
        for (const alias of FORBIDDEN_ALIASES) {
            if (!source.includes(alias)) continue;
            forbiddenImportReferences += 1;
            issues.push(`forbidden-trusted-io-reference:${path.relative(ROOT, absolute)}:${alias}`);
        }
    }

    return {
        ok: issues.length === 0,
        issues,
        scannedFiles: sourceFiles.length,
        forbiddenImportReferences,
        forbiddenAliases: aliasHits.length,
        forbiddenImplementationPaths: implementationHits.length,
    };
}

async function main() {
    const report = await checkCopilotNoTrustedIo();
    if (!report.ok) {
        console.error('Copilot no-trusted IO invariant: FAILED');
        for (const issue of report.issues) console.error(`- ${issue}`);
        process.exitCode = 1;
        return;
    }
    console.log('Copilot no-trusted IO invariant: OK');
    console.log(`- scanned source files: ${report.scannedFiles}`);
    console.log(`- forbidden import references: ${report.forbiddenImportReferences}`);
    console.log(`- forbidden aliases: ${report.forbiddenAliases}`);
    console.log(`- forbidden implementation paths: ${report.forbiddenImplementationPaths}`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    await main();
}
