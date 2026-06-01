// @ts-check
/**
 * Local Cloudflare Tunnel CLI for the Copilot MCP endpoint.
 *
 * Version 1.0 refactor:
 * - keeps this file as a small executable entrypoint;
 * - moves command dispatch, process supervision and smoke probes into focused modules;
 * - preserves every command name used by package.json and existing MCP tools.
 *
 * @module copilot/mcp/cloudflare/cli
 */

import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runCloudflareCli } from './cli-commands.js';

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    runCloudflareCli(process.argv, process.env).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[copilot-mcp-cloudflare] ${message}\n`);
        process.exitCode = 1;
    });
}
