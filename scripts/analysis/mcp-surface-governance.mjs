// @ts-check
/** Cheap one-pass consumer/owner gate for exact MCP public/testing package-import surfaces. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMcpSurfaceGovernanceReport } from './lib/mcp-surface-governance.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const ownerManifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'config/architecture/copilot-mcp-owners.json'), 'utf8'),
);
const report = buildMcpSurfaceGovernanceReport({ repoRoot: REPO_ROOT, packageJson, ownerManifest });
const output = {
    success: report.success,
    filesScanned: report.filesScanned,
    publicAliasCount: report.publicAliasCount,
    testingAliasCount: report.testingAliasCount,
    violationCount: report.violationCount,
    violations: report.violations,
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!report.success) process.exitCode = 1;
