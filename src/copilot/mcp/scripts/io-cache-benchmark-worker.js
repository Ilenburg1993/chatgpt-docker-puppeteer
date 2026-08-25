#!/usr/bin/env node
// @ts-check
/** Thin process launcher for one isolated MCP IO-cache benchmark worker. */

import { runIoCacheBenchmarkWorker } from '#copilot/mcp/public/diagnostics/io-cache';

try {
    await runIoCacheBenchmarkWorker(process.argv.slice(2), process.env);
} catch (error) {
    process.stdout.write(
        `${JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) })}
`,
    );
    process.exitCode = 1;
}
