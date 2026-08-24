// @ts-check
/**
 * Read-only dependency maintenance launcher for the composed MCP workspace runtime.
 *
 * This script accepts only the read-only `outdated` action. It exists so an already-projected run_copilot_validator
 * tool can bridge to dependency inspection until the host refreshes/reviews the MCP action snapshot. Mutating upgrades
 * deliberately remain exclusive to mcp_dependency_upgrade, whose schema requires confirmUpgrade=true, or to the
 * explicitly open-world terminal tools.
 */

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { inspectRootDependencyUpdates } from '#copilot/mcp/public/maintenance';

const action = String(process.argv[2] ?? '').trim();

if (action !== 'outdated') {
    process.stderr.write('Usage: dependency-maintenance-runner.js outdated\n');
    process.exitCode = 2;
} else {
    const processHost = createComposedMcpProcessHost({
        hostId: 'mcp-dependency-maintenance-runner',
        backgroundServices: false,
    });
    try {
        await processHost.prepare();
        const result = await inspectRootDependencyUpdates({ workspace: processHost.workspace });
        process.stdout.write(`${JSON.stringify({ action, ...result }, null, 2)}\n`);
        if (result.success !== true) process.exitCode = 1;
    } finally {
        await processHost.dispose();
    }
}
