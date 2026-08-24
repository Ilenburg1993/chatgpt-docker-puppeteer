#!/usr/bin/env node
// @ts-check

import { runMcpOAuthSmoke } from '#copilot/mcp/public/diagnostics/oauth-smoke';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';

const report = await runMcpOAuthSmoke({
    localToolNames: getCanonicalMcpTools().map((tool) => tool.name),
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report['ok']) process.exitCode = 1;
