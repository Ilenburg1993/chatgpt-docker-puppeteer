// @ts-check
/** Test-only membrane for Cloudflare CLI composition internals. */

export {
    observeForegroundCloudflared,
    resolveManagedPublicHealthUrl,
    waitForManagedHealthReady,
} from '../managed-stack.js';
export {
    MCP_SERVER_CHILD_ENVIRONMENT_POLICY_VERSION,
    buildMcpServerChildEnvironment,
} from '../server-child-environment.js';
