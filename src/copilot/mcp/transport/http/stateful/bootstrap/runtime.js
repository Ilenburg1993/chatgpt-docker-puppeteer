// @ts-check
/**
 * Bootstrap authority for stateful MCP Streamable HTTP sessions.
 *
 * This child owner owns the persisted session-id hash secret, stateful session bootstrap policy and the fixed npm
 * targets that may run with that authority. scripts/stateful-env.js is only its stable executable launcher.
 *
 * @module copilot/mcp/transport/http/stateful/bootstrap/runtime
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { createAttachedChildProcessSupervisor } from '#copilot/mcp/public/process/supervision';
import { projectMcpRuntimeSourcePromotionEnvironment } from '#copilot/mcp/public/runtime/source-generation';
import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const STATEFUL_ENV_ROOT = resolve(MCP_WORKSPACE_ROOT, 'src/copilot/.ai/mcp');

export const DEFAULT_STATEFUL_ENV_FILE = 'src/copilot/.ai/mcp/stateful-session.env';
export const DEFAULT_SESSION_TTL_MS = '600000';
export const DEFAULT_MAX_SESSIONS = '256';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const secretKey = 'COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET';
const RUN_TARGETS = Object.freeze([
    'copilot:mcp:quic:up',
    'copilot:mcp:quic:restart',
    'copilot:mcp:quic:status',
    'copilot:mcp:h2:up',
    'copilot:mcp:h2:restart',
    'copilot:mcp:h2:status',
    'copilot:mcp:auto:restart',
    'copilot:mcp:cloudflare:smoke',
    'copilot:mcp:cloudflare:oauth-smoke',
]);

/** @typedef {{ envFile: string; created: boolean; secretPreview: string; mode: number | null; warnings: string[] }} EnsureResult */

/**
 * @param {string | undefined} requestedPath
 * @param {NodeJS.ProcessEnv} parentEnv
 */
function createStatefulEnvStore(requestedPath, parentEnv) {
    const configuredPath = String(
        requestedPath ?? parentEnv['COPILOT_MCP_STATEFUL_ENV_FILE'] ?? DEFAULT_STATEFUL_ENV_FILE,
    ).trim();
    if (!configuredPath || configuredPath.includes('\0') || /[\r\n]/u.test(configuredPath)) {
        throw new Error('Stateful MCP env path must be a non-empty single-line repo-relative path.');
    }
    if (isAbsolute(configuredPath)) {
        throw new Error('Stateful MCP env path must be repo-relative; absolute paths are not allowed.');
    }
    const absolutePath = resolve(MCP_WORKSPACE_ROOT, configuredPath);
    const relativeToRoot = relative(STATEFUL_ENV_ROOT, absolutePath);
    if (
        relativeToRoot === '..' ||
        relativeToRoot.startsWith(`..${sep}`) ||
        isAbsolute(relativeToRoot) ||
        relativeToRoot === ''
    ) {
        throw new Error('Stateful MCP env path must resolve to a file inside src/copilot/.ai/mcp/.');
    }
    const parentDir = dirname(absolutePath);
    const normalizedRepoRelativePath = relative(MCP_WORKSPACE_ROOT, absolutePath).split(sep).join('/');
    const parentIo = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'mcp.transport.http.stateful.bootstrap.parent',
            exactPaths: [parentDir],
            operations: ['mkdir'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory'],
        }),
    );
    const fileIo = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'mcp.transport.http.stateful.bootstrap.file',
            exactPaths: [absolutePath],
            operations: ['chmod', 'read', 'stat', 'write'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory'],
        }),
    );
    return Object.freeze({
        envFile: normalizedRepoRelativePath,
        absolutePath,
        parentDir,
        parentIo,
        fileIo,
    });
}

/** @param {unknown} error */
function isMissingPathError(error) {
    const code = error && typeof error === 'object' ? /** @type {{ code?: unknown }} */ (error).code : undefined;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * @param {string | undefined} relativePath
 * @param {{ parentEnv: NodeJS.ProcessEnv }} options
 * @returns {Promise<EnsureResult>}
 */
export async function ensureStatefulEnvFile(relativePath, options) {
    const parentEnv = requireBootstrapParentEnv(options.parentEnv);
    const store = createStatefulEnvStore(relativePath, parentEnv);
    await store.parentIo.mkdirPath(store.parentDir, { recursive: true, mode: 0o700 });
    const warnings = [];
    let created = false;
    let fileStat;
    try {
        fileStat = (await store.fileIo.lstatPath(store.absolutePath)).stats;
    } catch (error) {
        if (!isMissingPathError(error)) throw error;
        const secret = normalizeSecret(parentEnv[secretKey]) || generateSessionSecret();
        await store.fileIo.writeFileAtomic(store.absolutePath, buildEnvFileContent(secret), { mode: 0o600 });
        created = true;
        fileStat = (await store.fileIo.lstatPath(store.absolutePath)).stats;
    }
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
        throw new Error(`Stateful MCP env path is not a regular file: ${store.envFile}`);
    }

    const mode = fileStat.mode & 0o777;
    if ((mode & 0o077) !== 0) {
        await store.fileIo.chmodFile(store.absolutePath, 0o600);
        warnings.push('env-file-permissions-tightened-to-0600');
    }

    const envText = (await store.fileIo.readTextFresh(store.absolutePath)).content;
    const env = parseEnvFile(envText);
    const secret = normalizeSecret(env[secretKey]);
    if (!secret) throw new Error(`${secretKey} is missing or too short in ${store.envFile}`);
    const upgradedText = upgradeStatefulEnvFileContent(envText, env);
    if (upgradedText !== envText) {
        await store.fileIo.writeFileAtomic(store.absolutePath, upgradedText, { mode: 0o600 });
        warnings.push('env-file-upgraded');
    }

    const finalMode = (await store.fileIo.lstatPath(store.absolutePath)).stats.mode & 0o777 || null;
    return {
        envFile: store.envFile,
        created,
        secretPreview: previewSecret(secret),
        mode: finalMode,
        warnings,
    };
}

/**
 * Build the exact child environment for a stateful transport target. The persisted env file cannot inject arbitrary
 * process variables: only the session hash secret, TTL and max-session policy are projected.
 *
 * @param {string | undefined} relativePath
 * @param {{ parentEnv: NodeJS.ProcessEnv }} options
 * @returns {Promise<NodeJS.ProcessEnv>}
 */
export async function buildStatefulProcessEnv(relativePath, options) {
    const parentEnv = requireBootstrapParentEnv(options.parentEnv);
    const store = createStatefulEnvStore(relativePath, parentEnv);
    const fileEnv = parseEnvFile((await store.fileIo.readTextFresh(store.absolutePath)).content);
    const secret = normalizeSecret(fileEnv[secretKey]);
    if (!secret) throw new Error(`${secretKey} is missing or too short in ${store.envFile}`);
    const sessionTtlMs =
        parentEnv['COPILOT_MCP_HTTP_SESSION_TTL_MS'] ||
        fileEnv['COPILOT_MCP_HTTP_SESSION_TTL_MS'] ||
        DEFAULT_SESSION_TTL_MS;
    const maxSessions =
        parentEnv['COPILOT_MCP_HTTP_MAX_SESSIONS'] || fileEnv['COPILOT_MCP_HTTP_MAX_SESSIONS'] || DEFAULT_MAX_SESSIONS;
    return buildMcpChildEnvironment({
        parentEnv,
        overrides: {
            ...projectMcpRuntimeSourcePromotionEnvironment(parentEnv),
            COPILOT_MCP_STATEFUL_ENV_FILE: store.envFile,
            COPILOT_MCP_HTTP_STATEFUL_SESSIONS: 'true',
            COPILOT_MCP_HTTP_STATELESS_COMPAT: 'false',
            COPILOT_MCP_HTTP_ENFORCE_POST_SESSION_CONTRACT: 'true',
            COPILOT_MCP_HTTP_SESSION_TTL_MS: sessionTtlMs,
            COPILOT_MCP_HTTP_MAX_SESSIONS: maxSessions,
            [secretKey]: secret,
        },
    }).env;
}

/**
 * @param {string} scriptName
 * @param {{ parentEnv?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<number>}
 */
export async function runWithStatefulEnv(scriptName, options = {}) {
    if (!RUN_TARGETS.includes(scriptName)) throw new Error(`Unsupported stateful run target: ${scriptName}`);
    const parentEnv = resolveBootstrapParentEnv(options.parentEnv);
    const ensured = await ensureStatefulEnvFile(undefined, { parentEnv });
    const env = await buildStatefulProcessEnv(ensured.envFile, { parentEnv });
    console.error(`[mcp-stateful-env] env=${ensured.envFile} secret=${ensured.secretPreview} target=${scriptName}`);
    return spawnNpmRun(scriptName, env);
}

/**
 * npm remains in the bootstrap process group. This is deliberate: the controlled reload owner creates the bootstrap
 * process group and can therefore terminate bootstrap + npm + descendants atomically. The local supervisor is used to
 * make completion truthful by observing `close`, not to establish a competing nested group.
 *
 * @param {string} scriptName
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>}
 */
async function spawnNpmRun(scriptName, env) {
    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
        child = spawn(npmCommand, ['run', scriptName], {
            cwd: MCP_WORKSPACE_ROOT,
            env,
            stdio: 'inherit',
            detached: false,
        });
    } catch (error) {
        console.error(
            `[mcp-stateful-env] failed to start child: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
    }
    const supervisor = createAttachedChildProcessSupervisor(child, { processGroup: false });
    /** @type {string | null} */
    let spawnError = null;
    child.once('error', (error) => {
        spawnError = error.message;
    });
    const closed = await supervisor.closed;
    if (spawnError) {
        console.error(`[mcp-stateful-env] failed to start child: ${spawnError}`);
        return 1;
    }
    if (closed.signal) {
        console.error(`[mcp-stateful-env] child terminated by ${closed.signal}`);
        return 1;
    }
    return Number(closed.exitCode ?? 1);
}

/** @returns {string} */
function generateSessionSecret() {
    return randomBytes(32).toString('base64url');
}

/** @param {string} secret @returns {string} */
function buildEnvFileContent(secret) {
    return [
        '# Generated by npm run mcp:stateful:secret:ensure. Do not commit this file.',
        '# This value is used only to hash MCP session IDs in persisted metadata.',
        `${secretKey}=${quoteEnvValue(secret)}`,
        `COPILOT_MCP_HTTP_SESSION_TTL_MS=${DEFAULT_SESSION_TTL_MS}`,
        `COPILOT_MCP_HTTP_MAX_SESSIONS=${DEFAULT_MAX_SESSIONS}`,
        '',
    ].join('\n');
}

/** @param {string} text @param {Record<string, string>} env @returns {string} */
function upgradeStatefulEnvFileContent(text, env) {
    const currentMaxSessions = Number(env['COPILOT_MCP_HTTP_MAX_SESSIONS'] ?? 0);
    if (currentMaxSessions >= Number(DEFAULT_MAX_SESSIONS)) return text;
    if (/^COPILOT_MCP_HTTP_MAX_SESSIONS=/mu.test(text)) {
        return text.replace(
            /^COPILOT_MCP_HTTP_MAX_SESSIONS=.*$/mu,
            `COPILOT_MCP_HTTP_MAX_SESSIONS=${DEFAULT_MAX_SESSIONS}`,
        );
    }
    return `${text.trimEnd()}\nCOPILOT_MCP_HTTP_MAX_SESSIONS=${DEFAULT_MAX_SESSIONS}\n`;
}

/** @param {string} text @returns {Record<string, string>} */
function parseEnvFile(text) {
    /** @type {Record<string, string>} */
    const env = {};
    for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const index = line.indexOf('=');
        if (index <= 0) continue;
        const key = line.slice(0, index).trim();
        const value = unquoteEnvValue(line.slice(index + 1).trim());
        if (/^[A-Z0-9_]+$/u.test(key)) env[key] = value;
    }
    return env;
}

/** @param {string | undefined} value @returns {string} */
function normalizeSecret(value) {
    const normalized = String(value ?? '').trim();
    return normalized.length >= 32 ? normalized : '';
}

/** @param {string} value @returns {string} */
function quoteEnvValue(value) {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

/** @param {string} value @returns {string} */
function unquoteEnvValue(value) {
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("'\\''", "'");
    if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replaceAll('\\"', '"');
    return value;
}

/** @param {string} value @returns {string} */
function previewSecret(value) {
    return `${value.slice(0, 4)}…${value.slice(-4)}:${String(value.length)}`;
}

function printUsage() {
    console.log(`Usage:
  node src/copilot/mcp/scripts/stateful-env.js ensure
  node src/copilot/mcp/scripts/stateful-env.js status
  node src/copilot/mcp/scripts/stateful-env.js print-source
  node src/copilot/mcp/scripts/stateful-env.js run <allowlisted-npm-script>`);
}

/** @param {NodeJS.ProcessEnv | undefined} parentEnv @returns {NodeJS.ProcessEnv} */
function resolveBootstrapParentEnv(parentEnv) {
    return parentEnv ?? process.env;
}

/** @param {NodeJS.ProcessEnv | undefined} parentEnv @returns {NodeJS.ProcessEnv} */
function requireBootstrapParentEnv(parentEnv) {
    if (!parentEnv) {
        throw new TypeError('Stateful MCP bootstrap internals require an explicit parent environment projection.');
    }
    return parentEnv;
}

/**
 * @param {string[]} argv
 * @param {{ parentEnv?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<number>}
 */
export async function runStatefulHttpBootstrapCli(argv, options = {}) {
    try {
        const [command, target] = argv;
        if (!command || command === 'help' || command === '--help') {
            printUsage();
            return 0;
        }
        const parentEnv = resolveBootstrapParentEnv(options.parentEnv);
        if (command === 'ensure' || command === 'status') {
            const result = await ensureStatefulEnvFile(undefined, { parentEnv });
            console.log(JSON.stringify({ success: true, ...result }, null, 2));
            return 0;
        }
        if (command === 'print-source') {
            const result = await ensureStatefulEnvFile(undefined, { parentEnv });
            console.log(`set -a; . ${result.envFile}; set +a`);
            return 0;
        }
        if (command === 'run') {
            if (!target) throw new Error('Missing allowlisted npm script target.');
            return await runWithStatefulEnv(target, { parentEnv });
        }
        throw new Error(`Unsupported command: ${String(command)}`);
    } catch (error) {
        console.error(`[mcp-stateful-env] ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}
