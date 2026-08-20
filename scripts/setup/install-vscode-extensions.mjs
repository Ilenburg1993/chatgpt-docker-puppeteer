#!/usr/bin/env node
// @ts-check
import { spawnSync } from 'node:child_process';
import { planExtensionReconciliation } from '../../config/vscode/extensions.mjs';
import { availableExtensions, readBuiltInExtensions, readInstalledExtensions } from './vscode-extension-runtime.mjs';

const args = process.argv.slice(2);
const profile = args.find((arg) => !arg.startsWith('-')) ?? 'core';
const dryRun = args.includes('--dry-run');
const prune = args.includes('--prune');

const initialInstalled = readInstalledExtensions();
const initialBuiltIn = readBuiltInExtensions();
const initial = planExtensionReconciliation(initialInstalled, {
    profile,
    prune,
    availableExtensions: availableExtensions(initialInstalled, initialBuiltIn),
});
console.log(
    `VS Code profile=${profile}: target=${initial.target.length}, builtIn=${initialBuiltIn.length}, missing=${initial.install.length}, remove=${initial.remove.length}, prune=${prune}, dryRun=${dryRun}`,
);
for (const extension of initial.install) console.log(`  + ${extension}`);
for (const extension of initial.remove) console.log(`  - ${extension}`);
if (dryRun || (initial.install.length === 0 && initial.remove.length === 0)) {
    process.exit(0);
}

let failures = 0;
for (const extension of initial.install) {
    process.stdout.write(`Installing ${extension} ... `);
    const result = spawnSync('code', ['--install-extension', extension, '--force'], { stdio: 'ignore' });
    if (result.status === 0) console.log('ok');
    else {
        failures += 1;
        console.log(`failed (${result.status ?? 'signal'})`);
    }
}
for (const extension of initial.remove) {
    process.stdout.write(`Removing ${extension} from remote Extension Host ... `);
    const result = spawnSync('code', ['--uninstall-extension', extension], { stdio: 'ignore' });
    if (result.status === 0) console.log('ok');
    else {
        failures += 1;
        console.log(`failed (${result.status ?? 'signal'})`);
    }
}

const finalInstalled = readInstalledExtensions();
const finalBuiltIn = readBuiltInExtensions();
const remaining = planExtensionReconciliation(finalInstalled, {
    profile,
    prune,
    availableExtensions: availableExtensions(finalInstalled, finalBuiltIn),
});
if (remaining.install.length || remaining.remove.length) {
    failures += remaining.install.length + remaining.remove.length;
    console.error(
        `VS Code reconciliation incomplete: missing=${remaining.install.join(',') || '-'} remove=${remaining.remove.join(',') || '-'}`,
    );
}
process.exit(failures === 0 ? 0 : 1);
