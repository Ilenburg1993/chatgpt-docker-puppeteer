// @ts-check
/** Composition root and command registry for the Cloudflare MCP CLI. */
import { readMcpAuthConfig } from '#copilot/mcp/public/auth';
import {
    buildManagedTunnelArgs,
    buildQuickTunnelArgs,
    readCloudflareTunnelConfig,
    validateConfiguredPublicUrl,
} from '#copilot/mcp/public/cloudflare/config';
import {
    applyCloudflareEdgePolicy,
    auditCloudflareEdgeRulesets,
    buildCloudflareEdgePolicyPlan,
    buildCloudflareEdgeSnapshot,
    createCloudflareEdgeBackup,
    diffCloudflareEdgePolicy,
    listCloudflareEdgeBackups,
} from '#copilot/mcp/public/cloudflare/edge';
import { createCloudflareEnvironmentAuthority } from '#copilot/mcp/public/cloudflare/environment-authority';
import {
    probeHealth,
    runCanonicalConnectorSmoke,
    runCloudflareSmoke,
} from '#copilot/mcp/public/cloudflare/observability';
import {
    auditCloudflareConfigPosture,
    auditCloudflarePlanCapabilities,
    auditCloudflareSkipPosture,
    buildCloudflareMcpPassthroughPlan,
    diffCloudflareMcpPassthroughPlan,
} from '#copilot/mcp/public/cloudflare/posture';
import {
    assessCloudflaredCompatibility,
    createCloudflareManagedProcessController,
    readCloudflaredVersion,
} from '#copilot/mcp/public/cloudflare/process';
import { auditCloudflareRemoteTunnel } from '#copilot/mcp/public/cloudflare/remote';
import {
    applyCloudflareTunnelOriginPlan,
    buildCloudflareTunnelOriginPlan,
    createCloudflareStateStore,
    isQuickTunnelState,
    summarizeConnectorSmokeState,
    summarizeQuickTunnelState,
} from '#copilot/mcp/public/cloudflare/tunnel';
import { formatChatGptConnectorAuthentication } from '#copilot/mcp/public/connection';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import process from 'node:process';
import {
    buildCloudflareLogReport,
    buildCloudflareMetricsReport,
    readRuntimeOriginSummary,
    runCloudflared,
    runQuickTunnel,
    selectMcpOriginTransport,
    startManagedStack,
    stopManagedStack,
} from './managed-stack.js';

export const CLOUDFLARE_CLI_VERSION = '1.0.0';

/**
 * @typedef {{
 *     argv: string[];
 *     args: string[];
 *     env: NodeJS.ProcessEnv;
 *     config: import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig;
 *     authority: import('#copilot/mcp/public/cloudflare/environment-authority').CloudflareEnvironmentAuthority;
 *     command: string;
 * }} CloudflareCliContext
 *
 *
 * @typedef {(context: CloudflareCliContext) => void | Promise<void>} CloudflareCliCommandRunner
 *
 * @typedef {[name: string, description: string, run: CloudflareCliCommandRunner]} CloudflareCliCommandEntry
 */

/** @type {Record<string, string>} */
const COMMAND_ALIASES = {
    'smoke-authenticated': 'oauth-smoke',
    'smoke:authenticated': 'oauth-smoke',
    '--help': 'help',
    '-h': 'help',
    '--version': 'version',
    '-v': 'version',
};

/** @type {CloudflareCliCommandEntry[]} */
const COMMANDS = [
    ['doctor', 'Audit local cloudflared, origin, configured URL and process prerequisites.', runDoctor],
    ['quick', 'Run a temporary TryCloudflare tunnel.', runQuick],
    ['status', 'Report configured connector, runtime and smoke state.', runStatus],
    ['smoke', 'Probe health, OAuth metadata and tools/list.', runSmoke],
    ['oauth-smoke', 'Run smoke with bearer token from COPILOT_MCP_SMOKE_BEARER_TOKEN.', runOAuthSmoke],
    [
        'remote-audit',
        'Audit remote Cloudflare tunnel configuration.',
        ({ authority }) => writeJsonAndSetExit(auditCloudflareRemoteTunnel({ authority })),
    ],
    [
        'config-audit',
        'Audit local Cloudflare MCP configuration posture.',
        ({ authority }) => writeJsonAndSetExit(auditCloudflareConfigPosture({ authority })),
    ],
    [
        'plan-capabilities-audit',
        'Audit Cloudflare plan capabilities.',
        ({ authority }) => writeJsonAndSetExit(auditCloudflarePlanCapabilities({ authority })),
    ],
    [
        'skip-audit',
        'Audit Cloudflare skip/bypass posture.',
        ({ authority }) => writeJsonAndSetExit(auditCloudflareSkipPosture({ authority })),
    ],
    [
        'mcp-passthrough-plan',
        'Plan MCP passthrough rules.',
        ({ authority }) => writeJsonAndSetExit(buildCloudflareMcpPassthroughPlan({ authority })),
    ],
    [
        'mcp-passthrough-diff',
        'Diff MCP passthrough rules.',
        ({ authority }) => writeJsonAndSetExit(diffCloudflareMcpPassthroughPlan({ authority })),
    ],
    [
        'edge-audit',
        'Audit Cloudflare edge rulesets.',
        ({ authority }) => writeJsonAndSetExit(auditCloudflareEdgeRulesets({ authority })),
    ],
    [
        'edge-policy-diff',
        'Diff canonical edge policy.',
        ({ authority }) => writeJsonAndSetExit(diffCloudflareEdgePolicy({ authority })),
    ],
    [
        'edge-policy-plan',
        'Plan canonical edge policy.',
        ({ authority }) => writeJsonAndSetExit(buildCloudflareEdgePolicyPlan({ authority })),
    ],
    ['edge-policy-apply', 'Apply canonical edge policy with explicit flags.', runEdgePolicyApply],
    [
        'edge-snapshot',
        'Build Cloudflare edge snapshot.',
        ({ authority }) => writeJsonAndSetExit(buildCloudflareEdgeSnapshot({ authority })),
    ],
    ['edge-backup-create', 'Create Cloudflare edge backup.', runEdgeBackupCreate],
    ['edge-backup-list', 'List Cloudflare edge backups.', () => writeJsonAndSetExit(listCloudflareEdgeBackups())],
    [
        'origin-plan',
        'Plan tunnel origin configuration.',
        ({ authority }) => writeJsonAndSetExit(buildCloudflareTunnelOriginPlan({ authority })),
    ],
    ['origin-apply', 'Apply tunnel origin configuration.', runOriginApply],
    ['up', 'Start local MCP HTTP origin and named cloudflared tunnel.', runUp],
    ['down', 'Stop managed local MCP HTTP origin and cloudflared tunnel.', runDown],
    ['restart', 'Restart managed stack.', runRestart],
    ['run', 'Run cloudflared in foreground.', runRun],
    ['commands', 'Print command registry as JSON.', runCommands],
    ['help', 'Print help.', runHelp],
    ['version', 'Print version.', () => process.stdout.write(`${CLOUDFLARE_CLI_VERSION}\n`)],
];
/** @type {Readonly<Record<string, { name: string; description: string; run: CloudflareCliCommandRunner }>>} */
const COMMAND_MAP = Object.freeze(
    Object.fromEntries(COMMANDS.map(([name, description, run]) => [name, Object.freeze({ name, description, run })])),
);

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<void>}
 */
export async function runCloudflareCli(argv, env) {
    if (!env) throw new TypeError('Cloudflare CLI requires explicit process env.');
    const config = readCloudflareTunnelConfig(env);
    const authority = createCloudflareEnvironmentAuthority(env);
    await authority.prepare();
    const rawCommand = argv[2] ?? 'doctor';
    const commandName = COMMAND_ALIASES[rawCommand] ?? rawCommand;
    const command = COMMAND_MAP[commandName];
    if (!command) {
        await writeJsonAndSetExit({
            ok: false,
            error: `Unknown Cloudflare MCP command: ${rawCommand}`,
            availableCommands: Object.keys(COMMAND_MAP).sort(),
        });
        return;
    }
    await command.run({ argv: argv.slice(3), args: argv.slice(3), env, config, authority, command: commandName });
}

/** @param {CloudflareCliContext} context */
async function runDoctor({ env, config }) {
    const cloudflared = readCloudflaredVersion(env);
    const compatibility = assessCloudflaredCompatibility(cloudflared, config);
    const health = await probeHealth(
        config.healthUrl,
        config.originUrl.startsWith('https://127.0.0.1') || config.originUrl.startsWith('https://localhost')
            ? { allowInsecureHttps: true, servername: config.originServerName ?? config.publicHostname }
            : {},
    );
    const publicUrlValidation = validateConfiguredPublicUrl(config) ?? { ok: false, reason: 'missing-public-url' };
    const token = tokenPosture(config);
    await writeJsonAndSetExit({
        ok: Boolean(
            cloudflared.ok &&
            compatibility.ok &&
            publicUrlValidation.ok &&
            (config.mode !== 'named-permanent' || token.ok),
        ),
        version: CLOUDFLARE_CLI_VERSION,
        config: publicConfig(config),
        cloudflared,
        compatibility,
        token,
        health,
        publicUrlValidation,
        hints: commandHints(config),
    });
}

/** @param {CloudflareCliContext} context */
async function runStatus({ env, config }) {
    const stateStore = createCloudflareStateStore(config);
    const [quick, smoke] = await Promise.all([stateStore.readQuickTunnelState(), stateStore.readConnectorSmokeState()]);
    const authentication = formatChatGptConnectorAuthentication(readMcpAuthConfig(env));
    const processes = createCloudflareManagedProcessController(config);
    const [mcpHttp, cloudflared, runtime] = await Promise.all([
        processes.mcpHttp.status(),
        processes.cloudflared.status(),
        readRuntimeOriginSummary(config, env),
    ]);
    await writeJsonAndSetExit({
        ok: true,
        version: CLOUDFLARE_CLI_VERSION,
        config: publicConfig(config),
        authentication,
        chatgpt: chatgptStatus(quick, config, authentication),
        quickTunnel: summarizeQuickTunnelState(quick, Date.now(), config.staleAfterMs),
        connectorSmoke: summarizeConnectorSmokeState(smoke, config.publicMcpUrl ?? null),
        processes: { mcpHttp, cloudflared },
        runtime,
        logs: buildCloudflareLogReport(config),
        metrics: buildCloudflareMetricsReport(config),
    });
}

/** @param {CloudflareCliContext} context */
async function runQuick({ env, config }) {
    const result = await runQuickTunnel(config, env, {
        onStdout: (chunk) => process.stdout.write(chunk),
        onConnectorUrl: (url) => process.stderr.write(`[copilot-mcp-cloudflare] quick tunnel URL: ${url}\n`),
    });
    applyForegroundProcessExit(result);
}
/** @param {CloudflareCliContext} context */
async function runSmoke({ config, authority }) {
    await writeJsonAndSetExit(
        await runCanonicalConnectorSmoke({
            config,
            authority,
            persistState: true,
            localToolNames: canonicalToolNames(),
        }),
    );
}
/** @param {CloudflareCliContext} context */
async function runOAuthSmoke({ env, config }) {
    await writeJsonAndSetExit(
        await runCloudflareSmoke({
            config,
            authenticated: true,
            env,
            localToolNames: canonicalToolNames(),
        }),
    );
}

/** @returns {string[]} */
function canonicalToolNames() {
    return getCanonicalMcpTools().map((tool) => tool.name);
}
/** @param {CloudflareCliContext} context */
async function runUp({ env, config }) {
    await writeJsonAndSetExit(await startManagedStack({ config, env, restart: false }));
}
/** @param {CloudflareCliContext} context */
async function runDown({ config }) {
    await writeJsonAndSetExit(await stopManagedStack(config));
}
/** @param {CloudflareCliContext} context */
async function runRestart({ env, config }) {
    await writeJsonAndSetExit(await startManagedStack({ config, env, restart: true }));
}
/** @param {CloudflareCliContext} context */
async function runRun({ env, config }) {
    const result = await runCloudflared(
        buildManagedTunnelArgs(env['CLOUDFLARE_TUNNEL_TOKEN'], config.tunnelTokenFile, config),
        config.transportProtocol,
        env,
    );
    applyForegroundProcessExit(result);
}

/** @param {CloudflareCliContext} context */
async function runOriginApply({ env, authority }) {
    await writeJsonAndSetExit(
        await applyCloudflareTunnelOriginPlan({
            authority,
            dryRun: env['COPILOT_MCP_CLOUDFLARE_ORIGIN_APPLY_DRY_RUN'] !== 'false',
            confirmApply: env['COPILOT_MCP_CLOUDFLARE_ORIGIN_APPLY_CONFIRM'] === 'true',
        }),
    );
}
/** @param {CloudflareCliContext} context */
async function runEdgePolicyApply({ argv, authority }) {
    await writeJsonAndSetExit(
        await applyCloudflareEdgePolicy({
            authority,
            dryRun: !argv.includes('--apply'),
            confirmApply: argv.includes('--confirm-apply'),
        }),
    );
}
/** @param {CloudflareCliContext} context */
async function runEdgeBackupCreate({ args, authority }) {
    await writeJsonAndSetExit(await createCloudflareEdgeBackup({ authority, ...(args[0] ? { label: args[0] } : {}) }));
}

/**
 * CLI-only projection from a truthful foreground process observation to Node exit status.
 *
 * @param {{ ok: boolean; exitCode: number | null; signal: NodeJS.Signals | null; error: string | null }} result
 */
function applyForegroundProcessExit(result) {
    if (result.ok) return;
    if (result.error) process.stderr.write(`[copilot-mcp-cloudflare] ${result.error}\n`);
    process.exitCode = typeof result.exitCode === 'number' && result.exitCode !== 0 ? result.exitCode : 1;
}

/** @returns {Promise<void>} */
function runCommands() {
    return writeJsonAndSetExit({
        ok: true,
        version: CLOUDFLARE_CLI_VERSION,
        commands: COMMANDS.map(([name, description]) => ({ name, description })),
        aliases: COMMAND_ALIASES,
    });
}
/** @returns {void} */
function runHelp() {
    process.stdout.write(
        `copilot-mcp-cloudflare ${CLOUDFLARE_CLI_VERSION}\n\nUsage: node src/copilot/mcp/composition/cloudflare-cli/cli.js <command> [args]\n\nCommands:\n${COMMANDS.map(([name, description]) => `  ${String(name).padEnd(28)} ${description}`).join('\n')}\n`,
    );
}

/**
 * @param {unknown | Promise<unknown>} report
 * @returns {Promise<void>}
 */
async function writeJsonAndSetExit(report) {
    const resolved = await report;
    process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
    if (resolved && typeof resolved === 'object' && /** @type {Record<string, unknown>} */ (resolved)['ok'] === false)
        process.exitCode = 1;
}

/** @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config */
function publicConfig(config) {
    return {
        mode: config.mode,
        publicMcpUrl: config.publicMcpUrl ?? null,
        originUrl: config.originUrl,
        originTransport: selectMcpOriginTransport(config),
        tunnelName: config.tunnelName,
        publicHostname: config.publicHostname,
        transportProtocol: config.transportProtocol,
        metricsAddr: config.metricsAddr ?? null,
        pidFiles: { mcpHttp: config.mcpHttpPidFile, cloudflared: config.managedTunnelPidFile },
        hasTunnelToken: config.hasTunnelToken,
        hasTunnelTokenFile: config.hasTunnelTokenFile,
    };
}

/** @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config */
function tokenPosture(config) {
    if (config.hasTunnelTokenFile)
        return {
            ok: true,
            source: 'file',
            warning: config.hasTunnelToken ? 'env-token-and-token-file-present-token-file-wins' : null,
        };
    if (config.hasTunnelToken) return { ok: true, source: 'env', warning: null };
    return {
        ok: false,
        source: 'missing',
        warning: 'named tunnel requires CLOUDFLARE_TUNNEL_TOKEN or CLOUDFLARE_TUNNEL_TOKEN_FILE',
    };
}

/** @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config */
function commandHints(config) {
    return {
        quick: `cloudflared ${buildQuickTunnelArgs(config).join(' ')}`,
        managed: `cloudflared ${buildManagedTunnelArgs('<redacted>', undefined, config).join(' ')}`,
        status: 'npm run copilot:mcp:cloudflare:status',
        smoke: 'npm run copilot:mcp:cloudflare:smoke',
    };
}

/**
 * @param {unknown} quick
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config
 * @param {unknown} authentication
 */
function chatgptStatus(quick, config, authentication) {
    if (isQuickTunnelState(quick))
        return {
            name: quick.chatgpt.name,
            description: quick.chatgpt.description,
            mcpServerUrl: config.publicMcpUrl ?? quick.connectorUrl,
            authentication,
        };
    return {
        name: 'Repo DevContainer MCP',
        description: 'Conecta o ChatGPT ao repositório por túnel Cloudflare permanente.',
        mcpServerUrl: config.publicMcpUrl ?? null,
        authentication,
    };
}
