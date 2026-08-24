#!/usr/bin/env node
// @ts-check
/** Thin launcher for dependency native-runtime smoke verification. */

import { runDependencyNativeSmoke } from '#copilot/mcp/public/maintenance/dependencies/native-smoke';

const result = await runDependencyNativeSmoke();
process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
if (!result.success) process.exitCode = 1;
