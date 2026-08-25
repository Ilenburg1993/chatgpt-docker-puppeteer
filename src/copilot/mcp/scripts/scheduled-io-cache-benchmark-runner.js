// @ts-check
/** Thin process launcher for the owned MCP IO-cache diagnostic benchmark. */

import { runScheduledIoCacheBenchmark } from '#copilot/mcp/public/diagnostics/io-cache';

const finalState = await runScheduledIoCacheBenchmark(process.argv.slice(2), process.env);
process.exitCode = finalState['status'] === 'completed' ? 0 : 1;
