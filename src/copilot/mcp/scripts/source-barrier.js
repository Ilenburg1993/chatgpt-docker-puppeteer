#!/usr/bin/env node
// @ts-check
/** Capture, verify or execute a command under an explicit repository source barrier. */

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { buildMcpRuntimeSourcePromotionEnvironment } from '#copilot/mcp/public/runtime/source-generation';
import {
    captureRepositorySourceBarrier,
    parseRepositorySourceBarrierJson,
    verifyRepositorySourceBarrier,
} from '#copilot/mcp/public/workspace/repository/integrity';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const FINGERPRINT_RE = /^[a-f0-9]{64}$/u;

function usage() {
    return [
        'Usage:',
        '  node src/copilot/mcp/scripts/source-barrier.js capture --manifest <file> <source-file>...',
        '  node src/copilot/mcp/scripts/source-barrier.js verify  --manifest <file> --expected-fingerprint <sha256>',
        '  node src/copilot/mcp/scripts/source-barrier.js run     --manifest <file> --expected-fingerprint <sha256> -- <executable> [args...]',
        '',
        'The manifest is hash-bound to exact file bytes. verify/run exit non-zero on ERR_SOURCE_DRIFT.',
        'run uses direct argv spawning (shell=false) and verifies the same manifest immediately before and after the child.',
    ].join('\n');
}

/** @param {string[]} argv */
function parseArgs(argv) {
    const command = argv[0];
    if (command !== 'capture' && command !== 'verify' && command !== 'run') throw new Error(usage());
    let manifest = '';
    let expectedFingerprint = '';
    /** @type {string[]} */
    const files = [];
    /** @type {string[]} */
    let commandArgs = [];
    for (let index = 1; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--manifest') {
            manifest = String(argv[index + 1] ?? '');
            index += 1;
            continue;
        }
        if (token === '--expected-fingerprint') {
            expectedFingerprint = String(argv[index + 1] ?? '')
                .trim()
                .toLowerCase();
            index += 1;
            continue;
        }
        if (token === '--') {
            if (command === 'run') commandArgs = argv.slice(index + 1);
            else files.push(...argv.slice(index + 1));
            break;
        }
        if (token?.startsWith('--')) throw new Error(`Unknown source-barrier option: ${token}\n${usage()}`);
        if (token) files.push(token);
    }
    if (!manifest) throw new Error(`--manifest is required.\n${usage()}`);
    if (command === 'capture' && files.length < 1) throw new Error(`capture requires source files.\n${usage()}`);
    if (command !== 'capture' && files.length > 0)
        throw new Error(`${command} reads source paths from the manifest.\n${usage()}`);
    if (command !== 'capture' && !FINGERPRINT_RE.test(expectedFingerprint)) {
        throw new Error(`${command} requires --expected-fingerprint <sha256>.\n${usage()}`);
    }
    if (command === 'run' && commandArgs.length < 1)
        throw new Error(`run requires -- <executable> [args...].\n${usage()}`);
    return {
        command,
        manifest: path.resolve(manifest),
        expectedFingerprint: expectedFingerprint || null,
        files,
        commandArgs,
    };
}

/** @param {string} target @param {string} content */
async function writeAtomicText(target, content) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
    const handle = await fs.open(temp, 'wx', 0o600);
    try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        await fs.rename(temp, target);
        const dir = await fs.open(path.dirname(target), 'r');
        try {
            await dir.sync();
        } finally {
            await dir.close();
        }
    } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => {});
        throw error;
    }
}

/** @param {unknown} error */
function projectError(error) {
    const candidate = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (error);
    return {
        success: false,
        code: candidate.code ?? 'ERR_SOURCE_BARRIER_CLI',
        error: candidate.message,
        details: candidate.details ?? null,
    };
}

/** @param {string} manifestPath @param {string} expectedFingerprint */
async function readExpectedBarrier(manifestPath, expectedFingerprint) {
    const barrier = parseRepositorySourceBarrierJson(await fs.readFile(manifestPath, 'utf8'));
    if (barrier.fingerprint !== expectedFingerprint) {
        const error = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (
            new Error(
                `Source-barrier manifest fingerprint mismatch: expected ${expectedFingerprint}, got ${barrier.fingerprint}.`,
            )
        );
        error.code = 'ERR_SOURCE_BARRIER_FINGERPRINT_MISMATCH';
        error.details = {
            manifestPath,
            expectedFingerprint,
            manifestFingerprint: barrier.fingerprint,
            promotionAllowed: false,
        };
        throw error;
    }
    return barrier;
}

/**
 * @param {ReturnType<typeof createComposedMcpProcessHost>} host
 * @param {string} manifestPath
 * @param {string} expectedFingerprint
 */
async function verifyExpectedBarrier(host, manifestPath, expectedFingerprint) {
    const barrier = await readExpectedBarrier(manifestPath, expectedFingerprint);
    const result = await verifyRepositorySourceBarrier(host.workspace, barrier, {
        ...(host.toolCapabilities.audit ? { audit: host.toolCapabilities.audit } : {}),
    });
    return { barrier, result };
}

/**
 * Derive promotion transport from the immutable process-config snapshot rather than re-reading ambient environment.
 *
 * @param {import('#copilot/mcp/public/runtime/source-generation').McpRuntimeSourceGeneration} generation
 */
function promotionEnvironmentForGeneration(generation) {
    if (generation.sourceBinding !== 'controlled-promotion') return Object.freeze({});
    if (
        !generation.promotionRequestId ||
        !generation.sourceBarrierFingerprint ||
        !generation.sourceBarrierManifestPath
    ) {
        throw new Error('Controlled MCP source generation is missing its immutable promotion binding.');
    }
    return buildMcpRuntimeSourcePromotionEnvironment({
        requestId: generation.promotionRequestId,
        sourceBarrierFingerprint: generation.sourceBarrierFingerprint,
        sourceBarrierManifestPath: generation.sourceBarrierManifestPath,
    });
}

/** @param {string[]} commandArgs @param {string} workspaceRoot @param {Readonly<Record<string, string>>} promotionEnvironment */
async function runDirectCommand(commandArgs, workspaceRoot, promotionEnvironment) {
    const executable = /** @type {string} */ (commandArgs[0]);
    const args = commandArgs.slice(1);
    const childEnvironment = buildMcpChildEnvironment({ overrides: promotionEnvironment });
    return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(executable, args, {
            cwd: workspaceRoot,
            env: childEnvironment.env,
            shell: false,
            stdio: 'inherit',
        });
        child.once('error', rejectPromise);
        child.once('close', (code, signal) => {
            resolvePromise({ exitCode: Number(code ?? (signal ? 1 : 0)), signal: signal ?? null });
        });
    });
}

async function main() {
    const input = parseArgs(process.argv.slice(2));
    const host = createComposedMcpProcessHost({
        hostId: `source-barrier-cli-${process.pid}`,
        backgroundServices: false,
    });
    if (input.command === 'capture') {
        const barrier = await captureRepositorySourceBarrier(host.workspace, input.files);
        await writeAtomicText(input.manifest, `${JSON.stringify(barrier, null, 2)}\n`);
        process.stdout.write(
            `${JSON.stringify({ success: true, command: 'capture', manifest: input.manifest, fingerprint: barrier.fingerprint, entryCount: barrier.entryCount })}\n`,
        );
        return;
    }

    const expectedFingerprint = /** @type {string} */ (input.expectedFingerprint);
    const before = await verifyExpectedBarrier(host, input.manifest, expectedFingerprint);
    if (input.command === 'verify') {
        process.stdout.write(
            `${JSON.stringify({
                success: true,
                command: 'verify',
                manifest: input.manifest,
                fingerprint: before.result.fingerprint,
                currentFingerprint: before.result.currentFingerprint,
                entryCount: before.result.entryCount,
            })}\n`,
        );
        return;
    }

    const child = await runDirectCommand(
        input.commandArgs,
        host.workspace.workspaceRoot,
        promotionEnvironmentForGeneration(host.processConfig.runtime.sourceGeneration),
    );
    const after = await verifyExpectedBarrier(host, input.manifest, expectedFingerprint);
    process.stdout.write(
        `${JSON.stringify({
            success: child.exitCode === 0,
            command: 'run',
            manifest: input.manifest,
            fingerprint: after.result.fingerprint,
            currentFingerprint: after.result.currentFingerprint,
            entryCount: after.result.entryCount,
            child,
        })}\n`,
    );
    if (child.exitCode !== 0) process.exitCode = child.exitCode;
}

main().catch((error) => {
    process.stderr.write(`${JSON.stringify(projectError(error))}\n`);
    process.exitCode = 2;
});
