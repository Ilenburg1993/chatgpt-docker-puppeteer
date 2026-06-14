// @ts-check
/** @module copilot/mcp/scripts/stateful-env */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileAtomicTrusted } from '#copilot/infra/public/trusted-io';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '../../../..');

export const DEFAULT_STATEFUL_ENV_FILE = 'src/copilot/.ai/mcp/stateful-session.env';
export const DEFAULT_SESSION_TTL_MS = '600000';
export const DEFAULT_MAX_SESSIONS = '256';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const secretKey = 'COPILOT_MCP_HTTP_SESSION_ID_HASH_SECRET';
const RUN_TARGETS = new Set([
    'copilot:mcp:quic:up',
    'copilot:mcp:quic:restart',
    'copilot:mcp:quic:status',
    'copilot:mcp:h2:up',
    'copilot:mcp:h2:restart',
    'copilot:mcp:h2:status',
    'copilot:mcp:cloudflare:smoke',
    'copilot:mcp:cloudflare:oauth-smoke',
]);

/** @typedef {{ envFile: string; created: boolean; secretPreview: string; mode: number | null; warnings: string[] }} EnsureResult */

/**
 * @param {string} [relativePath]
 * @returns {Promise<EnsureResult>}
 */
export async function ensureStatefulEnvFile(relativePath = process.env['COPILOT_MCP_STATEFUL_ENV_FILE'] || DEFAULT_STATEFUL_ENV_FILE) {
    const envFile = resolve(repoRoot, relativePath);
    mkdirSync(dirname(envFile), { recursive: true, mode: 0o700 });
    const warnings = [];
    let created = false;

    if (!existsSync(envFile)) {
        const secret = normalizeSecret(process.env[secretKey]) || generateSessionSecret();
        await writeFileAtomicTrusted(envFile, buildEnvFileContent(secret), {
            caller: 'mcp.scripts.stateful-env',
            mode: 0o600,
        });
        chmodSync(envFile, 0o600);
        created = true;
    }

    const fileStat = statSync(envFile);
    const mode = fileStat.mode & 0o777;
    if ((mode & 0o077) !== 0) {
        chmodSync(envFile, 0o600);
        warnings.push('env-file-permissions-tightened-to-0600');
    }

    const envText = readFileSync(envFile, 'utf8');
    const env = parseEnvFile(envText);
    const secret = normalizeSecret(env[secretKey]);
    if (!secret) throw new Error(`${secretKey} is missing or too short in ${relativePath}`);
    const upgradedText = upgradeStatefulEnvFileContent(envText, env);
    if (upgradedText !== envText) {
        await writeFileAtomicTrusted(envFile, upgradedText, {
            caller: 'mcp.scripts.stateful-env',
            mode: 0o600,
        });
        chmodSync(envFile, 0o600);
        warnings.push('env-file-upgraded');
    }

    return {
        envFile: relativePath,
        created,
        secretPreview: previewSecret(secret),
        mode: statSync(envFile).mode & 0o777,
        warnings,
    };
}

/**
 * @param {string} scriptName
 * @returns {Promise<number>}
 */
export async function runWithStatefulEnv(scriptName) {
    if (!RUN_TARGETS.has(scriptName)) throw new Error(`Unsupported stateful run target: ${scriptName}`);
    const ensured = await ensureStatefulEnvFile();
    const env = buildStatefulProcessEnv(ensured.envFile);
    console.error(`[mcp-stateful-env] env=${ensured.envFile} secret=${ensured.secretPreview} target=${scriptName}`);
    return spawnNpmRun(scriptName, env);
}

/**
 * @param {string} relativePath
 * @returns {NodeJS.ProcessEnv}
 */
export function buildStatefulProcessEnv(relativePath = process.env['COPILOT_MCP_STATEFUL_ENV_FILE'] || DEFAULT_STATEFUL_ENV_FILE) {
    const envFile = resolve(repoRoot, relativePath);
    const fileEnv = parseEnvFile(readFileSync(envFile, 'utf8'));
    const secret = normalizeSecret(fileEnv[secretKey]);
    if (!secret) throw new Error(`${secretKey} is missing or too short in ${relativePath}`);
    return {
        ...process.env,
        ...fileEnv,
        COPILOT_MCP_HTTP_STATEFUL_SESSIONS: 'true',
        COPILOT_MCP_HTTP_STATELESS_COMPAT: 'false',
        COPILOT_MCP_HTTP_ENFORCE_POST_SESSION_CONTRACT: 'true',
        COPILOT_MCP_HTTP_SESSION_TTL_MS: process.env['COPILOT_MCP_HTTP_SESSION_TTL_MS'] || fileEnv['COPILOT_MCP_HTTP_SESSION_TTL_MS'] || DEFAULT_SESSION_TTL_MS,
        COPILOT_MCP_HTTP_MAX_SESSIONS: process.env['COPILOT_MCP_HTTP_MAX_SESSIONS'] || fileEnv['COPILOT_MCP_HTTP_MAX_SESSIONS'] || DEFAULT_MAX_SESSIONS,
        [secretKey]: secret,
    };
}

/**
 * @param {string} scriptName
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>}
 */
function spawnNpmRun(scriptName, env) {
    return new Promise((resolvePromise) => {
        const child = spawn(npmCommand, ['run', scriptName], { cwd: repoRoot, env, stdio: 'inherit' });
        child.on('exit', (code, signal) => {
            if (signal) {
                console.error(`[mcp-stateful-env] child terminated by ${signal}`);
                resolvePromise(1);
                return;
            }
            resolvePromise(Number(code ?? 1));
        });
        child.on('error', (error) => {
            console.error(`[mcp-stateful-env] failed to start child: ${error.message}`);
            resolvePromise(1);
        });
    });
}

/** @returns {string} */
function generateSessionSecret() {
    return randomBytes(32).toString('base64url');
}

/**
 * @param {string} secret
 * @returns {string}
 */
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

/**
 * @param {string} text
 * @param {Record<string, string>} env
 * @returns {string}
 */
function upgradeStatefulEnvFileContent(text, env) {
    const currentMaxSessions = Number(env['COPILOT_MCP_HTTP_MAX_SESSIONS'] ?? 0);
    if (currentMaxSessions >= Number(DEFAULT_MAX_SESSIONS)) return text;
    if (/^COPILOT_MCP_HTTP_MAX_SESSIONS=/mu.test(text)) {
        return text.replace(/^COPILOT_MCP_HTTP_MAX_SESSIONS=.*$/mu, `COPILOT_MCP_HTTP_MAX_SESSIONS=${DEFAULT_MAX_SESSIONS}`);
    }
    return `${text.trimEnd()}\nCOPILOT_MCP_HTTP_MAX_SESSIONS=${DEFAULT_MAX_SESSIONS}\n`;
}

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
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

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function normalizeSecret(value) {
    const normalized = String(value ?? '').trim();
    return normalized.length >= 32 ? normalized : '';
}

/**
 * @param {string} value
 * @returns {string}
 */
function quoteEnvValue(value) {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function unquoteEnvValue(value) {
    if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("'\\''", "'");
    if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replaceAll('\\"', '"');
    return value;
}

/**
 * @param {string} value
 * @returns {string}
 */
function previewSecret(value) {
    return `${value.slice(0, 4)}…${value.slice(-4)}:${value.length}`;
}

function printUsage() {
    console.log(`Usage:
  node src/copilot/mcp/scripts/stateful-env.js ensure
  node src/copilot/mcp/scripts/stateful-env.js status
  node src/copilot/mcp/scripts/stateful-env.js print-source
  node src/copilot/mcp/scripts/stateful-env.js run <allowlisted-npm-script>`);
}

async function main() {
    const [command, target] = process.argv.slice(2);
    if (!command || command === 'help' || command === '--help') {
        printUsage();
        return 0;
    }
    if (command === 'ensure' || command === 'status') {
        const result = await ensureStatefulEnvFile();
        console.log(JSON.stringify({ success: true, ...result }, null, 2));
        return 0;
    }
    if (command === 'print-source') {
        const result = await ensureStatefulEnvFile();
        console.log(`set -a; . ${result.envFile}; set +a`);
        return 0;
    }
    if (command === 'run') {
        if (!target) throw new Error('Missing allowlisted npm script target.');
        return runWithStatefulEnv(target);
    }
    throw new Error(`Unsupported command: ${String(command)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main()
        .then((exitCode) => {
            process.exitCode = exitCode;
        })
        .catch((error) => {
            console.error(`[mcp-stateful-env] ${error instanceof Error ? error.message : String(error)}`);
            process.exitCode = 1;
        });
}
