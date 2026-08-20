#!/usr/bin/env node
// @ts-check

import { getCanonicalMcpTools } from '../registry.js';
import { runMcpOAuthSmoke } from './oauth-smoke.js';

const report = await runMcpOAuthSmoke({
    localToolNames: getCanonicalMcpTools().map((tool) => tool.name),
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report['ok']) process.exitCode = 1;
