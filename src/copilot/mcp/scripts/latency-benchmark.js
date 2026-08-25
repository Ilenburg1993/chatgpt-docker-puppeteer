#!/usr/bin/env node
// @ts-check
/** Thin launcher for MCP endpoint latency benchmarking. */

import { createMcpProcessConfig } from '#copilot/mcp/public/composition/process-config';
import { runMcpLatencyBenchmark } from '#copilot/mcp/public/diagnostics/latency/benchmark';

const processConfig = createMcpProcessConfig(process.env);
const report = await runMcpLatencyBenchmark(processConfig.diagnostics.latency);
process.stdout.write(`${JSON.stringify(report, null, 2)}
`);
if (!report['ok']) process.exitCode = 1;
