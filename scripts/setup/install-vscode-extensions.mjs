#!/usr/bin/env node
// @ts-check
import { execFileSync, spawnSync } from 'node:child_process';
import { getExtensionProfile } from '../../config/vscode/extensions.mjs';

const profile = process.argv.find((arg) => !arg.startsWith('-') && arg !== process.argv[0] && arg !== process.argv[1]) ?? 'core';
const dryRun = process.argv.includes('--dry-run');
const extensions = getExtensionProfile(profile);

/** @returns {Set<string>} */
function installedSet() {
    try {
        return new Set(
            execFileSync('code', ['--list-extensions'], { encoding: 'utf8' })
                .split(/\r?\n/)
                .map((value) => value.trim().toLowerCase())
                .filter(Boolean),
        );
    } catch (error) {
        throw new Error(`VS Code CLI indisponível: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
}

const installed = installedSet();
const missing = extensions.filter((extension) => !installed.has(extension.toLowerCase()));
console.log(`VS Code profile=${profile}: target=${extensions.length}, missing=${missing.length}, dryRun=${dryRun}`);
if (dryRun || missing.length === 0) {
    for (const extension of missing) console.log(`  + ${extension}`);
    process.exit(0);
}

let failures = 0;
for (const extension of missing) {
    process.stdout.write(`Installing ${extension} ... `);
    const result = spawnSync('code', ['--install-extension', extension, '--force'], { stdio: 'ignore' });
    if (result.status === 0) console.log('ok');
    else {
        failures += 1;
        console.log(`failed (${result.status ?? 'signal'})`);
    }
}
process.exit(failures ? 1 : 0);
