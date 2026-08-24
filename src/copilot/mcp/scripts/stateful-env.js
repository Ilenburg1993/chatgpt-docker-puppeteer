// @ts-check
/** Stable launcher for stateful MCP HTTP bootstrap/environment management. */

import { runStatefulHttpBootstrapCli } from '#copilot/mcp/public/transport/http/stateful/bootstrap';

process.exitCode = await runStatefulHttpBootstrapCli(process.argv.slice(2));
