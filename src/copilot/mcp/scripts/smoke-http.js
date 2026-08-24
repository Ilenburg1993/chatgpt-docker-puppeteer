#!/usr/bin/env node
// @ts-check
/** Thin launcher for local MCP HTTP smoke diagnostics. */

import { runMcpHttpSmoke } from '#copilot/mcp/public/diagnostics/http-smoke';

const report = await runMcpHttpSmoke();
process.stdout.write(`${JSON.stringify(report, null, 2)}
`);
if (!report['ok']) process.exitCode = 1;
