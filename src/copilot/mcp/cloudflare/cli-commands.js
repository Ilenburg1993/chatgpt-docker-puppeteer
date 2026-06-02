// @ts-check
/** Command registry for the Cloudflare MCP CLI. */
import process from 'node:process';
import { formatChatGptConnectorAuthentication } from '#copilot/mcp/connection';
import { readMcpAuthConfig } from '#copilot/mcp/control-plane';
import { auditCloudflareConfigPosture } from './config-audit.js';
import { auditCloudflarePlanCapabilities } from './plan-capabilities-audit.js';
import { createCloudflareEdgeBackup, listCloudflareEdgeBackups } from './edge-backup.js';
import { auditCloudflareEdgeRulesets } from './edge-audit.js';
import { applyCloudflareEdgePolicy } from './edge-policy-apply.js';
import { diffCloudflareEdgePolicy } from './edge-policy-diff.js';
import { buildCloudflareEdgePolicyPlan } from './edge-policy-plan.js';
import { buildCloudflareEdgeSnapshot } from './edge-snapshot.js';
import { auditCloudflareRemoteTunnel } from './remote-api.js';
import { applyCloudflareTunnelOriginPlan, buildCloudflareTunnelOriginPlan } from './tunnel-origin-plan.js';
import { buildCloudflareMcpPassthroughPlan, diffCloudflareMcpPassthroughPlan } from './mcp-passthrough-plan.js';
import { auditCloudflareSkipPosture } from './skip-audit.js';
import { buildManagedTunnelArgs, buildQuickTunnelArgs, readCloudflareTunnelConfig, validateConfiguredPublicUrl } from './config.js';
import { isQuickTunnelState, readConnectorSmokeState, readQuickTunnelState, summarizeConnectorSmokeState, summarizeQuickTunnelState } from './state.js';
import { assessCloudflaredCompatibility, readCloudflaredVersion, readPidFileStatus } from './cli-process.js';
import { probeHealth } from './cli-probe.js';
import { runCloudflareSmoke } from './cli-smoke.js';
import { buildCloudflareLogReport, buildCloudflareMetricsReport, readRuntimeOriginSummary, runCloudflared, runQuickTunnel, selectMcpOriginTransport, startManagedStack, stopManagedStack } from './cli-runtime.js';

export const CLOUDFLARE_CLI_VERSION = '1.0.0';

/**
 * @typedef {{
 *   argv: string[];
 *   args: string[];
 *   env: NodeJS.ProcessEnv;
 *   command: string;
 * }} CloudflareCliContext
 *
 * @typedef {(context: CloudflareCliContext) => void | Promise<void>} CloudflareCliCommandRunner
 *
 * @typedef {[name: string, description: string, run: CloudflareCliCommandRunner]} CloudflareCliCommandEntry
 */

/** @type {Record<string, string>} */
const COMMAND_ALIASES = { 'smoke-authenticated': 'oauth-smoke', 'smoke:authenticated': 'oauth-smoke', '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version' };

/** @type {CloudflareCliCommandEntry[]} */
const COMMANDS = [
    ['doctor', 'Audit local cloudflared, origin, configured URL and process prerequisites.', runDoctor],
    ['quick', 'Run a temporary TryCloudflare tunnel.', runQuick],
    ['status', 'Report configured connector, runtime and smoke state.', runStatus],
    ['smoke', 'Probe health, OAuth metadata and tools/list.', runSmoke],
    ['oauth-smoke', 'Run smoke with bearer token from COPILOT_MCP_SMOKE_BEARER_TOKEN.', runOAuthSmoke],
    ['remote-audit', 'Audit remote Cloudflare tunnel configuration.', () => writeJsonAndSetExit(auditCloudflareRemoteTunnel())],
    ['config-audit', 'Audit local Cloudflare MCP configuration posture.', () => writeJsonAndSetExit(auditCloudflareConfigPosture())],
    ['plan-capabilities-audit', 'Audit Cloudflare plan capabilities.', () => writeJsonAndSetExit(auditCloudflarePlanCapabilities())],
    ['skip-audit', 'Audit Cloudflare skip/bypass posture.', () => writeJsonAndSetExit(auditCloudflareSkipPosture())],
    ['mcp-passthrough-plan', 'Plan MCP passthrough rules.', () => writeJsonAndSetExit(buildCloudflareMcpPassthroughPlan())],
    ['mcp-passthrough-diff', 'Diff MCP passthrough rules.', () => writeJsonAndSetExit(diffCloudflareMcpPassthroughPlan())],
    ['edge-audit', 'Audit Cloudflare edge rulesets.', () => writeJsonAndSetExit(auditCloudflareEdgeRulesets())],
    ['edge-policy-diff', 'Diff canonical edge policy.', () => writeJsonAndSetExit(diffCloudflareEdgePolicy())],
    ['edge-policy-plan', 'Plan canonical edge policy.', () => writeJsonAndSetExit(buildCloudflareEdgePolicyPlan())],
    ['edge-policy-apply', 'Apply canonical edge policy with explicit flags.', runEdgePolicyApply],
    ['edge-snapshot', 'Build Cloudflare edge snapshot.', () => writeJsonAndSetExit(buildCloudflareEdgeSnapshot())],
    ['edge-backup-create', 'Create Cloudflare edge backup.', runEdgeBackupCreate],
    ['edge-backup-list', 'List Cloudflare edge backups.', () => writeJsonAndSetExit(listCloudflareEdgeBackups())],
    ['origin-plan', 'Plan tunnel origin configuration.', () => writeJsonAndSetExit(buildCloudflareTunnelOriginPlan())],
    ['origin-apply', 'Apply tunnel origin configuration.', runOriginApply],
    ['up', 'Start local MCP HTTP origin and named cloudflared tunnel.', runUp],
    ['down', 'Stop managed local MCP HTTP origin and cloudflared tunnel.', runDown],
    ['restart', 'Restart managed stack.', runRestart],
    ['run', 'Run cloudflared in foreground.', runRun],
    ['commands', 'Print command registry as JSON.', runCommands],
    ['help', 'Print help.', runHelp],
    ['version', 'Print version.', () => process.stdout.write(`${CLOUDFLARE_CLI_VERSION}\n`)],
];
const COMMAND_MAP = new Map(COMMANDS.map(([name, description, run]) => [name, { name, description, run }]));

/**
 * @param {string[]} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<void>}
 */
export async function runCloudflareCli(argv = process.argv, env = process.env) {
    const rawCommand = argv[2] ?? 'doctor';
    const commandName = COMMAND_ALIASES[rawCommand] ?? rawCommand;
    const command = COMMAND_MAP.get(commandName);
    if (!command) {
        await writeJsonAndSetExit({ ok: false, error: `Unknown Cloudflare MCP command: ${rawCommand}`, availableCommands: [...COMMAND_MAP.keys()].sort() });
        return;
    }
    await command.run({ argv: argv.slice(3), args: argv.slice(3), env, command: commandName });
}

/** @param {CloudflareCliContext} context */
async function runDoctor({ env }) {
    const config = readCloudflareTunnelConfig(env);
    const cloudflared = readCloudflaredVersion();
    const compatibility = assessCloudflaredCompatibility(cloudflared, config);
    const health = await probeHealth(config.healthUrl);
    const publicUrlValidation = validateConfiguredPublicUrl(config) ?? { ok: false, reason: 'missing-public-url' };
    const token = tokenPosture(config);
    await writeJsonAndSetExit({ ok: Boolean(cloudflared.ok && compatibility.ok && publicUrlValidation.ok && (config.mode !== 'named-permanent' || token.ok)), version: CLOUDFLARE_CLI_VERSION, config: publicConfig(config), cloudflared, compatibility, token, health, publicUrlValidation, hints: commandHints(config) });
}

/** @param {CloudflareCliContext} context */
async function runStatus({ env }) {
    const config = readCloudflareTunnelConfig(env);
    const quick = await readQuickTunnelState(config.stateFile);
    const smoke = await readConnectorSmokeState(config.smokeStateFile);
    const authentication = formatChatGptConnectorAuthentication(readMcpAuthConfig(env));
    const mcpHttp = await readPidFileStatus(config.mcpHttpPidFile);
    const cloudflared = await readPidFileStatus(config.managedTunnelPidFile);
    const runtime = await readRuntimeOriginSummary(config, env);
    await writeJsonAndSetExit({ ok: true, version: CLOUDFLARE_CLI_VERSION, config: publicConfig(config), authentication, chatgpt: chatgptStatus(quick, config, authentication), quickTunnel: summarizeQuickTunnelState(quick, Date.now(), config.staleAfterMs), connectorSmoke: summarizeConnectorSmokeState(smoke, config.publicMcpUrl ?? null), processes: { mcpHttp, cloudflared }, runtime, logs: buildCloudflareLogReport(), metrics: buildCloudflareMetricsReport(config) });
}

/** @param {CloudflareCliContext} context */
function runQuick({ env }) { runQuickTunnel(readCloudflareTunnelConfig(env), env); }
/** @param {CloudflareCliContext} context */
async function runSmoke({ env }) { await writeJsonAndSetExit(await runCloudflareSmoke({ config: readCloudflareTunnelConfig(env), authenticated: false, env })); }
/** @param {CloudflareCliContext} context */
async function runOAuthSmoke({ env }) { await writeJsonAndSetExit(await runCloudflareSmoke({ config: readCloudflareTunnelConfig(env), authenticated: true, env })); }
/** @param {CloudflareCliContext} context */
async function runUp({ env }) { await writeJsonAndSetExit(await startManagedStack({ config: readCloudflareTunnelConfig(env), env, restart: false })); }
/** @param {CloudflareCliContext} context */
async function runDown({ env }) { await writeJsonAndSetExit(await stopManagedStack(readCloudflareTunnelConfig(env))); }
/** @param {CloudflareCliContext} context */
async function runRestart({ env }) { await writeJsonAndSetExit(await startManagedStack({ config: readCloudflareTunnelConfig(env), env, restart: true })); }
/** @param {CloudflareCliContext} context */
function runRun({ env }) { const config = readCloudflareTunnelConfig(env); runCloudflared(buildManagedTunnelArgs(env['CLOUDFLARE_TUNNEL_TOKEN'], config.tunnelTokenFile, config), config.transportProtocol, env); }

/** @param {CloudflareCliContext} context */
async function runOriginApply({ env }) { await writeJsonAndSetExit(await applyCloudflareTunnelOriginPlan({ dryRun: env['COPILOT_MCP_CLOUDFLARE_ORIGIN_APPLY_DRY_RUN'] !== 'false', confirmApply: env['COPILOT_MCP_CLOUDFLARE_ORIGIN_APPLY_CONFIRM'] === 'true' })); }
/** @param {CloudflareCliContext} context */
async function runEdgePolicyApply({ argv }) { await writeJsonAndSetExit(await applyCloudflareEdgePolicy({ dryRun: !argv.includes('--apply'), confirmApply: argv.includes('--confirm-apply') })); }
/** @param {CloudflareCliContext} context */
async function runEdgeBackupCreate({ args }) { await writeJsonAndSetExit(await createCloudflareEdgeBackup({ ...(args[0] ? { label: args[0] } : {}) })); }

/** @returns {Promise<void>} */
function runCommands() { return writeJsonAndSetExit({ ok: true, version: CLOUDFLARE_CLI_VERSION, commands: COMMANDS.map(([name, description]) => ({ name, description })), aliases: COMMAND_ALIASES }); }
/** @returns {void} */
function runHelp() { process.stdout.write(`copilot-mcp-cloudflare ${CLOUDFLARE_CLI_VERSION}\n\nUsage: node src/copilot/mcp/cloudflare/cli.js <command> [args]\n\nCommands:\n${COMMANDS.map(([name, description]) => `  ${String(name).padEnd(28)} ${description}`).join('\n')}\n`); }

/**
 * @param {unknown | Promise<unknown>} report
 * @returns {Promise<void>}
 */
async function writeJsonAndSetExit(report) {
    const resolved = await report;
    process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
    if (resolved && typeof resolved === 'object' && /** @type {Record<string, unknown>} */ (resolved)['ok'] === false) process.exitCode = 1;
}

/** @param {import('./config.js').CloudflareTunnelConfig} config */
function publicConfig(config) {
    return { mode: config.mode, publicMcpUrl: config.publicMcpUrl ?? null, originUrl: config.originUrl, originTransport: selectMcpOriginTransport(config), tunnelName: config.tunnelName, publicHostname: config.publicHostname, transportProtocol: config.transportProtocol, metricsAddr: config.metricsAddr ?? null, pidFiles: { mcpHttp: config.mcpHttpPidFile, cloudflared: config.managedTunnelPidFile }, hasTunnelToken: config.hasTunnelToken, hasTunnelTokenFile: config.hasTunnelTokenFile };
}

/** @param {import('./config.js').CloudflareTunnelConfig} config */
function tokenPosture(config) {
    if (config.hasTunnelTokenFile) return { ok: true, source: 'file', warning: config.hasTunnelToken ? 'env-token-and-token-file-present-token-file-wins' : null };
    if (config.hasTunnelToken) return { ok: true, source: 'env', warning: null };
    return { ok: false, source: 'missing', warning: 'named tunnel requires CLOUDFLARE_TUNNEL_TOKEN or CLOUDFLARE_TUNNEL_TOKEN_FILE' };
}

/** @param {import('./config.js').CloudflareTunnelConfig} config */
function commandHints(config) {
    return { quick: `cloudflared ${buildQuickTunnelArgs(config).join(' ')}`, managed: `cloudflared ${buildManagedTunnelArgs('<redacted>', undefined, config).join(' ')}`, status: 'npm run copilot:mcp:cloudflare:status', smoke: 'npm run copilot:mcp:cloudflare:smoke' };
}

/**
 * @param {unknown} quick
 * @param {import('./config.js').CloudflareTunnelConfig} config
 * @param {unknown} authentication
 */
function chatgptStatus(quick, config, authentication) {
    if (isQuickTunnelState(quick)) return { name: quick.chatgpt.name, description: quick.chatgpt.description, mcpServerUrl: config.publicMcpUrl ?? quick.connectorUrl, authentication };
    return { name: 'Repo DevContainer MCP', description: 'Conecta o ChatGPT ao repositório por túnel Cloudflare permanente.', mcpServerUrl: config.publicMcpUrl ?? null, authentication };
}
