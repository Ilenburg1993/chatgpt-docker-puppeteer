#!/usr/bin/env node
// @ts-check

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkgJsonPath = path.join(root, 'package.json');

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
    const args = { packageName: '@github/copilot-sdk' };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i] ?? '';
        if ((arg === '--package' || arg === '-p') && argv[i + 1]) {
            args.packageName = String(argv[i + 1]);
            i += 1;
        } else if (arg.startsWith('--package=')) {
            args.packageName = arg.slice('--package='.length) || args.packageName;
        }
    }
    return args;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
function sh(command, args) {
    return execFileSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

/**
 * @param {string} packageName
 * @returns {string}
 */
function resolveRange(packageName) {
    if (!fs.existsSync(pkgJsonPath)) {
        throw new Error(`package.json não encontrado em ${pkgJsonPath}`);
    }
    /** @type {{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }} */
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    return pkg.dependencies?.[packageName] ?? pkg.devDependencies?.[packageName] ?? '';
}

const { packageName } = parseArgs(process.argv.slice(2));
const wantedRange = resolveRange(packageName);

if (!wantedRange) {
    console.error(`[npm-check] pacote ${packageName} não encontrado em dependencies/devDependencies.`);
    process.exit(2);
}

const preferOnlineArgs = ['--prefer-online', '--cache', '/tmp/npm-cache-fresh'];

try {
    const registry = sh('npm', ['config', 'get', 'registry']);
    const tagsRaw = sh('npm', ['view', packageName, 'dist-tags', '--json', ...preferOnlineArgs]);
    const latest = sh('npm', ['view', packageName, 'version', ...preferOnlineArgs]);
    const resolvedRange = sh('npm', ['view', `${packageName}@${wantedRange}`, 'version', ...preferOnlineArgs]);

    /** @type {unknown} */
    let parsedTags = tagsRaw;
    try {
        parsedTags = JSON.parse(tagsRaw);
    } catch {
        // mantém raw
    }

    console.log(`[npm-check] registry=${registry}`);
    console.log(`[npm-check] package=${packageName}`);
    console.log(`[npm-check] dependency-range=${wantedRange}`);
    console.log(`[npm-check] latest=${latest}`);
    console.log(`[npm-check] range-resolves-to=${resolvedRange}`);
    console.log(`[npm-check] dist-tags=${typeof parsedTags === 'string' ? parsedTags : JSON.stringify(parsedTags)}`);
    console.log('[npm-check] OK: metadados online e resolução do range confirmados.');
} catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[npm-check] Falha ao validar metadados online do npm.');
    console.error(`[npm-check] ${msg}`);
    console.error(
        '[npm-check] Dica: execute `npm run deps:refresh:online` para forçar metadata fresh e lockfile coerente.',
    );
    process.exit(1);
}
