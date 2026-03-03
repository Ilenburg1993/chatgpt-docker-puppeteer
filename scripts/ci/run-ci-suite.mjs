#!/usr/bin/env node
// @ts-check
import { spawnSync } from 'node:child_process';

const commands = [
    ['node', ['scripts/ci/check-node-version.mjs']],
    ['npm', ['run', 'lint']],
    ['npm', ['run', 'format:check']],
    ['npm', ['run', 'test:unit']],
];

for (const [cmd, args] of commands) {
    const printable = `${cmd} ${args.join(' ')}`;
    console.log(`\n[ci] Running: ${printable}`);

    const result = spawnSync(cmd, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });

    if (result.status !== 0) {
        console.error(`[ci] Command failed: ${printable}`);
        process.exit(result.status ?? 1);
    }
}

console.log('\n[ci] Full CI suite finished successfully.');
