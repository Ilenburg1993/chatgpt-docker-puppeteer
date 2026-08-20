// @ts-check
/**
 * Fixed compatibility runner for dependency maintenance while a ChatGPT host is using a frozen tool snapshot.
 *
 * This script accepts only the read-only `outdated` action. It exists so an already-projected
 * run_copilot_validator tool can bridge to dependency inspection until the host refreshes/reviews the MCP action
 * snapshot. Mutating upgrades deliberately remain exclusive to mcp_dependency_upgrade, whose schema requires
 * confirmUpgrade=true, or to the explicitly open-world terminal tools.
 */

import { inspectRootDependencyUpdates } from '../control-plane/dependency-maintenance.js';

const action = String(process.argv[2] ?? '').trim();

if (action !== 'outdated') {
    process.stderr.write('Usage: dependency-maintenance-runner.js outdated\n');
    process.exitCode = 2;
} else {
    const result = await inspectRootDependencyUpdates();
    process.stdout.write(`${JSON.stringify({ action, ...result }, null, 2)}\n`);
    if (result.success !== true) process.exitCode = 1;
}
