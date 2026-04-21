#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
 */
function runCommand(cmd, args) {
    const printable = `${cmd} ${args.join(' ')}`;
    console.log(`\n[test-runner] Running: ${printable}`);
    const result = spawnSync(cmd, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    return result.status ?? 1;
}

/**
 * @param {string[]} files
 * @param {number} chunkSize
 */
function chunkFiles(files, chunkSize = 120) {
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

console.log(
    `[test-runner] Discovered ${uniqueFiles.length} spec files (${nodeTestFiles.length} node:test, ${vitestFiles.length} vitest).`,
);

let exitCode = 0;

for (const chunk of chunkFiles(nodeTestFiles)) {
    if (chunk.length === 0) continue;
    const status = runCommand('node', ['--strip-types', '--test', ...chunk]);
    if (status !== 0) exitCode = status;
}

for (const chunk of chunkFiles(vitestFiles)) {
    if (chunk.length === 0) continue;
    const status = runCommand('npx', ['vitest', 'run', ...chunk]);
    if (status !== 0) exitCode = status;
}

if (exitCode !== 0) {
    console.error('[test-runner] Mixed test run finished with failures.');
    process.exit(exitCode);
}

console.log('\n[test-runner] Mixed test run finished successfully.');
