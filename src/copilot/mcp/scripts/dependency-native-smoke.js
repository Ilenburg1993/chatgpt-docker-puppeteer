#!/usr/bin/env node
// @ts-check
/** Thin launcher for dependency native-runtime smoke verification. */

import { runDependencyNativeSmoke } from '#copilot/mcp/public/maintenance/dependencies/native-smoke';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';

const result = await runDependencyNativeSmoke({
    workspaceRoot: process.cwd(),
    childEnvironment: buildMcpChildEnvironment({ parentEnv: process.env }).env,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
if (!result.success) process.exitCode = 1;
