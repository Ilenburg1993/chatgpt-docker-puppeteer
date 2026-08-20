#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { MODEL_GATEWAY_SCRIPT_MANIFEST, MODEL_GATEWAY_SCRIPT_PATHS } from './index.mjs';

const [scriptId, ...scriptArgs] = process.argv.slice(2);

function printHelp() {
    const commands = MODEL_GATEWAY_SCRIPT_MANIFEST.filter((entry) => entry.role === 'command').sort((left, right) =>
        left.id.localeCompare(right.id),
    );
    process.stdout.write(`Usage: node scripts/model-gateway/run.mjs <script-id> [args...]\n`);
    process.stdout.write(`       node scripts/model-gateway/run.mjs --list-json\n\n`);
    process.stdout.write(`Script ids:\n`);
    for (const entry of commands) process.stdout.write(`  - ${entry.id} :: ${entry.runnerCommand}\n`);
}

function printJsonManifest() {
    process.stdout.write(
        `${JSON.stringify(
            {
                schema: 'model-gateway-script-runner-manifest',
                scripts: MODEL_GATEWAY_SCRIPT_MANIFEST,
            },
            null,
            2,
        )}\n`,
    );
}

if (scriptId === '--list-json' || scriptId === 'list-json') {
    printJsonManifest();
    process.exit(0);
}

if (!scriptId || scriptId === '--help' || scriptId === '-h') {
    printHelp();
    process.exit(scriptId ? 0 : 2);
}

const scriptPath = MODEL_GATEWAY_SCRIPT_MANIFEST.find((entry) => entry.id === scriptId)?.scriptPath;
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
