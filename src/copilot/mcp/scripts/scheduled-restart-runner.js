// @ts-check
/**
 * Detached allowlisted MCP restart runner.
 *
 * This helper is intentionally narrow: it accepts only a generated request id, a bounded delay and one of the three
 * canonical Cloudflare transport profiles. It never evaluates shell text or accepts arbitrary commands/paths.
 *
 * @module copilot/mcp/scripts/scheduled-restart-runner
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '../../../..');
const STATE_FILE = resolve(repoRoot, 'src/copilot/.ai/mcp/mcp-reload-state.json');
const RELOAD_STATE_FS = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'mcp.scripts.scheduled-restart-runner',
        exactPaths: [STATE_FILE],
        operations: ['write'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);
const RUNNER_PROFILE_TARGETS = Object.freeze({
    quic: 'copilot:mcp:quic:restart',
    h2: 'copilot:mcp:h2:restart',
    auto: 'copilot:mcp:auto:restart',
});
const REQUEST_ID_RE = /^mcp-reload-[a-z0-9-]{8,80}$/u;

/** @param {number} ms */
function sleep(ms) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** @param {Record<string, unknown>} state */
async function writeState(state) {
    await RELOAD_STATE_FS.writeFileAtomic(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

/** @param {string} profile */
function targetForProfile(profile) {
    const target = RUNNER_PROFILE_TARGETS[/** @type {keyof typeof RUNNER_PROFILE_TARGETS} */ (profile)];
    if (!target) throw new Error(`Unsupported restart profile: ${profile}`);
    return target;
}

/** @param {string[]} argv */
function parseArgs(argv) {
    /** @param {string} name */
    const read = (name) => {
        const index = argv.indexOf(name);
        return index >= 0 ? (argv[index + 1] ?? '') : '';
    };
    const requestId = read('--request-id');
    const profile = read('--profile');
    const delayMs = Number(read('--delay-ms'));
    if (!REQUEST_ID_RE.test(requestId)) throw new Error('Invalid generated request id.');
    if (!Object.hasOwn(RUNNER_PROFILE_TARGETS, profile)) throw new Error('Invalid restart profile.');
    if (!Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 60_000) throw new Error('Invalid restart delay.');
    return { requestId, profile, delayMs, target: targetForProfile(profile) };
}

/** @param {string} target */
function runRestart(target) {
    return new Promise((resolvePromise) => {
        const child = spawn(process.execPath, ['src/copilot/mcp/scripts/stateful-env.js', 'run', target], {
            cwd: repoRoot,
            env: process.env,
            stdio: 'ignore',
        });
        child.once('error', (error) => resolvePromise({ exitCode: 1, error: error.message }));
        child.once('exit', (code, signal) =>
            resolvePromise({
                exitCode: Number(code ?? (signal ? 1 : 0)),
                error: signal ? `restart child terminated by ${signal}` : null,
            }),
        );
    });
}

async function main() {
    const input = parseArgs(process.argv.slice(2));
    const scheduledAt = Date.now();
    await writeState({
        schemaVersion: 1,
        status: 'scheduled',
        scheduledAt,
        requestId: input.requestId,
        profile: input.profile,
        delayMs: input.delayMs,
        target: input.target,
        runnerPid: process.pid,
    });
    await sleep(input.delayMs);
    const startedAt = Date.now();
    await writeState({
        schemaVersion: 1,
        status: 'running',
        scheduledAt,
        startedAt,
        requestId: input.requestId,
        profile: input.profile,
        delayMs: input.delayMs,
        target: input.target,
        runnerPid: process.pid,
    });
    const result = await runRestart(input.target);
    await writeState({
        schemaVersion: 1,
        status: result.exitCode === 0 ? 'completed' : 'failed',
        scheduledAt,
        startedAt,
        completedAt: Date.now(),
        requestId: input.requestId,
        profile: input.profile,
        delayMs: input.delayMs,
        target: input.target,
        runnerPid: process.pid,
        exitCode: result.exitCode,
        error: result.error,
    });
    process.exitCode = result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch(async (error) => {
        try {
            await writeState({
                schemaVersion: 1,
                status: 'failed',
                completedAt: Date.now(),
                error: error instanceof Error ? error.message : String(error),
            });
        } catch {
            // Best effort: there is no safe recovery path if the fixed state file itself cannot be written.
        }
        process.exitCode = 1;
    });
}
