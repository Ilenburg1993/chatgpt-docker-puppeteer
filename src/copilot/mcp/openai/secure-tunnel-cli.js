// @ts-check
/** CLI for local Secure MCP Tunnel readiness audit. */

import { auditOpenAiSecureMcpTunnelReadiness } from './secure-tunnel-readiness.js';

const result = auditOpenAiSecureMcpTunnelReadiness({ env: process.env });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
