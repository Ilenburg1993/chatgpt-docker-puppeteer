#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** @param {string} dir */
function walkSpecFiles(dir) {
    /** @type {string[]} */
    const results = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
            results.push(...walkSpecFiles(full));
        } else if (entry.endsWith('.spec.js')) {
            results.push(full);
        }
    }
    return results;
}

/** @param {string} filePath */
function isVitestFile(filePath) {
    const src = readFileSync(filePath, 'utf-8');
    return /from\s+['"]vitest['"]/.test(src);
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [envOverrides]
 */
function runCommand(cmd, args, envOverrides = {}) {
    const printable = `${cmd} ${args.join(' ')}`;
    console.log(`\n[test-runner] Running: ${printable}`);

    const compileCacheDir =
        process.env['NODE_COMPILE_CACHE'] ||
        (process.env['XDG_CACHE_HOME']
            ? join(process.env['XDG_CACHE_HOME'], 'node-compile')
            : join(homedir(), '.cache', 'node-compile'));
    const result = spawnSync(cmd, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: {
            ...process.env,
            NODE_COMPILE_CACHE: compileCacheDir,
            ...envOverrides,
        },
    });

    return result.status ?? 1;
}

/**
 * Lê inteiro positivo de ambiente sem permitir que um valor inválido desative os limites do runner.
 *
 * @param {string} name
 * @param {number} fallback
 */
function positiveEnvInteger(name, fallback) {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @param {string[]} files
 * @param {number} chunkSize
 */
function chunkFiles(files, chunkSize) {
    /** @type {string[][]} */
    const chunks = [];
    for (let index = 0; index < files.length; index += chunkSize) {
        chunks.push(files.slice(index, index + chunkSize));
    }
    return chunks;
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
    console.error('[test-runner] Usage: node scripts/ci/run-mixed-tests.mjs <dir-or-file> [<dir-or-file> ...]');
    process.exit(1);
}

/** @type {string[]} */
const allFiles = [];
for (const input of roots) {
    const full = resolve(input);
    const st = statSync(full);
    if (st.isDirectory()) {
        allFiles.push(...walkSpecFiles(full));
    } else if (full.endsWith('.spec.js')) {
        allFiles.push(full);
    }
}

const uniqueFiles = [...new Set(allFiles)].sort();
const vitestFiles = uniqueFiles.filter((filePath) => isVitestFile(filePath));
const nodeTestFiles = uniqueFiles.filter((filePath) => !isVitestFile(filePath));
const copilotVitestFiles = vitestFiles.filter((filePath) => /[/\\]copilot[/\\]/.test(filePath));
const genericVitestFiles = vitestFiles.filter((filePath) => !/[/\\]copilot[/\\]/.test(filePath));

console.log(
    `[test-runner] Discovered ${uniqueFiles.length} spec files (${nodeTestFiles.length} node:test, ${vitestFiles.length} vitest).`,
);

const nodeTestConcurrency = positiveEnvInteger('TEST_NODE_CONCURRENCY', 4);
const nodeTestShardSize = positiveEnvInteger('TEST_NODE_SHARD_SIZE', 40);
const vitestShardSize = positiveEnvInteger('TEST_VITEST_SHARD_SIZE', 80);
const vitestMaxWorkers = String(positiveEnvInteger('TEST_VITEST_MAX_WORKERS', 4));

console.log(
    `[test-runner] Limits: nodeConcurrency=${nodeTestConcurrency}, nodeShardSize=${nodeTestShardSize}, ` +
        `vitestShardSize=${vitestShardSize}, vitestMaxWorkers=${vitestMaxWorkers}.`,
);

let exitCode = 0;

for (const chunk of chunkFiles(nodeTestFiles, nodeTestShardSize)) {
    if (chunk.length === 0) continue;
    const status = runCommand('node', [
        '--strip-types',
        '--test',
        `--test-concurrency=${nodeTestConcurrency}`,
        ...chunk,
    ]);
    if (status !== 0) exitCode = status;
}

for (const chunk of chunkFiles(genericVitestFiles, vitestShardSize)) {
    if (chunk.length === 0) continue;
    const status = runCommand(
        'npx',
        ['vitest', 'run', '--config', 'vitest.config.js', `--maxWorkers=${vitestMaxWorkers}`, ...chunk],
    );
    if (status !== 0) exitCode = status;
}

for (const chunk of chunkFiles(copilotVitestFiles, vitestShardSize)) {
    if (chunk.length === 0) continue;
    const status = runCommand(
        'node',
        ['scripts/ci/run-vitest-copilot.mjs', `--maxWorkers=${vitestMaxWorkers}`, ...chunk],
    );
    if (status !== 0) exitCode = status;
}

if (exitCode !== 0) {
    console.error('[test-runner] Mixed test run finished with failures.');
    process.exit(exitCode);
}

console.log('\n[test-runner] Mixed test run finished successfully.');
