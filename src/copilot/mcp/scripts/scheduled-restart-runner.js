// @ts-check
/** Stable launcher for a controlled MCP reload request. */

import { runControlledMcpReloadCli } from '#copilot/mcp/public/runtime/reload';

process.exitCode = await runControlledMcpReloadCli(process.argv.slice(2), process.env);
