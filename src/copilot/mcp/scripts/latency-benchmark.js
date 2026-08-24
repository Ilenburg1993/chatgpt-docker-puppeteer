#!/usr/bin/env node
// @ts-check
/** Thin launcher for MCP endpoint latency benchmarking. */

import { runMcpLatencyBenchmark } from '#copilot/mcp/public/diagnostics/latency/benchmark';

const report = await runMcpLatencyBenchmark();
process.stdout.write(`${JSON.stringify(report, null, 2)}
`);
if (!report['ok']) process.exitCode = 1;
