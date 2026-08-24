// @ts-check
/** Stable launcher for the controlled Cloudflare transport benchmark. */

import { runCloudflareTransportBenchmarkCli } from '#copilot/mcp/public/cloudflare/transport-benchmark';

process.exitCode = await runCloudflareTransportBenchmarkCli(process.argv.slice(2));
