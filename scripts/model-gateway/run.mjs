#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { MODEL_GATEWAY_SCRIPT_PATHS } from './index.mjs';

const [scriptId, ...scriptArgs] = process.argv.slice(2);

function printHelp() {
    const ids = Object.keys(MODEL_GATEWAY_SCRIPT_PATHS)
        .filter((id) => id !== 'runner')
        .sort();
    process.stdout.write(`Usage: node scripts/model-gateway/run.mjs <script-id> [args...]\n\n`);
    process.stdout.write(`Script ids:\n`);
    for (const id of ids) process.stdout.write(`  - ${id}\n`);
}

if (!scriptId || scriptId === '--help' || scriptId === '-h') {
    printHelp();
    process.exit(scriptId ? 0 : 2);
}

const scriptPath = MODEL_GATEWAY_SCRIPT_PATHS[scriptId];
if (!scriptPath) {
    process.stderr.write(`Unknown model-gateway script id: ${scriptId}\n\n`);
    printHelp();
    process.exit(2);
}

if (path.resolve(scriptPath) === path.resolve(MODEL_GATEWAY_SCRIPT_PATHS.runner)) {
    process.stderr.write('Refusing to recursively run the model-gateway runner.\n');
    process.exit(2);
}

const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    stdio: 'inherit',
    env: process.env,
});

if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
}

process.exit(result.status ?? 1);
