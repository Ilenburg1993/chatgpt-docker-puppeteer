// @ts-check
/** Compact CLI for derived MCP owner ontology and direct dependency graph. */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMcpOwnerGovernanceProjection } from './lib/mcp-owner-governance.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OWNER_MANIFEST_PATH = 'config/architecture/copilot-mcp-owners.json';
const readJson = (relativePath) => JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));

function readInputs() {
    return {
        repoRoot: REPO_ROOT,
        packageJson: readJson('package.json'),
        ownerManifest: readJson(OWNER_MANIFEST_PATH),
        configAuthorityManifest: readJson('config/architecture/copilot-mcp-config-authorities.json'),
        stateScopeManifest: readJson('config/architecture/copilot-mcp-state-scopes.json'),
        dynamicGraphManifest: readJson('config/architecture/copilot-mcp-dynamic-graph.json'),
        publicApiManifest: readJson('config/architecture/copilot-mcp-public-api-manifest.json'),
    };
}

/** @param {ReturnType<typeof readInputs>} inputs @param {ReturnType<typeof buildMcpOwnerGovernanceProjection>} report */
function writeDerivedOwnerManifest(inputs, report) {
    if (report.violations.length > 0) {
        throw new Error(`Cannot write owner manifest with governance violations: ${report.violations.join(', ')}`);
    }
    if (report.stronglyConnectedComponents.length > 0) {
        throw new Error(
            `Cannot write owner manifest with cyclic owner dependencies: ${report.stronglyConnectedComponents
                .map((component) => component.join(' -> '))
                .join('; ')}`,
        );
    }
    const manifest = inputs.ownerManifest;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Array.isArray(manifest.owners)) {
        throw new Error('MCP owner manifest must be an object with an owners array.');
    }
    const projectionByOwnerId = new Map(report.rows.map((row) => [row.ownerId, row]));
    manifest.schemaVersion = 2;
    manifest.policy = {
        derivedFields: ['audiences', 'authorityClasses', 'policyHooks', 'allowedDependencies'],
        audiences: 'derived from exact #copilot/mcp/public/* and #copilot/testing/mcp/* package surfaces',
        authorities: 'derived from config/state/process manifests and public-surface audience',
        dependencies: 'exact direct static ESM import/re-export owner graph; cycles are rejected',
        dynamicEdges: 'governed separately by copilot-mcp-dynamic-graph.json',
    };
    manifest.owners = manifest.owners.map((owner) => {
        if (!owner || typeof owner !== 'object' || Array.isArray(owner) || typeof owner.ownerId !== 'string') {
            throw new Error('Every MCP owner manifest row must be an object with ownerId.');
        }
        const projection = projectionByOwnerId.get(owner.ownerId);
        if (!projection) throw new Error(`Missing derived owner projection for ${owner.ownerId}.`);
        return {
            ...owner,
            audiences: projection.audiences,
            authorityClasses: projection.authorityClasses,
            policyHooks: projection.policyHooks,
            allowedDependencies: projection.allowedDependencies,
        };
    });
    writeFileSync(path.join(REPO_ROOT, OWNER_MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
}

let inputs = readInputs();
let report = buildMcpOwnerGovernanceProjection(inputs);
if (process.argv.includes('--write-manifest')) {
    writeDerivedOwnerManifest(inputs, report);
    inputs = readInputs();
    report = buildMcpOwnerGovernanceProjection(inputs);
}
const mismatches = report.rows
    .filter((row) => row.declarationMismatch.length > 0)
    .map((row) => ({ ownerId: row.ownerId, fields: row.declarationMismatch }));
process.stdout.write(
    `${JSON.stringify(
        {
            success: report.success,
            parsedFiles: report.parsedFiles,
            localModuleEdges: report.localModuleEdges,
            ownerCount: report.ownerCount,
            directOwnerDependencyCount: report.directOwnerDependencyCount,
            stronglyConnectedComponents: report.stronglyConnectedComponents,
            declarationMismatchCount: report.declarationMismatchCount,
            violations: report.violations,
            mismatches,
            dependencyEvidence: process.argv.includes('--details') ? report.dependencyEvidence : undefined,
            rows: process.argv.includes('--details') ? report.rows : undefined,
            manifestWritten: process.argv.includes('--write-manifest') || undefined,
        },
        null,
        2,
    )}\n`,
);
if (process.argv.includes('--check') && !report.success) process.exitCode = 1;
