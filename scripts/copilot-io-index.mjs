#!/usr/bin/env node
// @ts-check
/**
 * CLI operacional para o índice L2 do Copilot.
 *
 * Mesma infraestrutura das tools `workspace_index_*` e do comando REPL `/index`; existe para builds manuais, automação
 * local e diagnóstico sem abrir o terminal permanente da LLM-B.
 */

import { createApplicationInfraHost } from '#copilot/boot';

/**
 * @typedef {object} BuildCliArgs
 * @property {boolean} recursive
 * @property {boolean} respectGitignore
 * @property {boolean | undefined} pruneMissing
 * @property {string[]} include
 * @property {string[]} exclude
 * @property {string[]} extensions
 * @property {number | undefined} concurrency
 * @property {number | undefined} depth
 * @property {string[]} rest
 */

/**
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
function parsePositiveInt(value) {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.floor(parsed);
}

/**
 * @param {string | undefined} ext
 * @returns {string | undefined}
 */
function normalizeExtension(ext) {
    if (!ext) return ext;
    return ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}

/**
 * @param {string} token
 * @param {string} name
 * @returns {string | null}
 */
function readInlineFlagValue(token, name) {
    const prefix = `${name}=`;
    return token.startsWith(prefix) ? token.slice(prefix.length) : null;
}

/**
 * @param {string[]} parts
 * @returns {BuildCliArgs}
 */
function parseBuildArgs(parts) {
    /** @type {BuildCliArgs} */
    const parsed = {
        recursive: true,
        respectGitignore: true,
        pruneMissing: undefined,
        include: [],
        exclude: [],
        extensions: [],
        concurrency: undefined,
        depth: undefined,
        rest: [],
    };

    for (let i = 0; i < parts.length; i++) {
        const token = parts[i] ?? '';
        const next = parts[i + 1];
        const includeInline = readInlineFlagValue(token, '--include');
        const excludeInline = readInlineFlagValue(token, '--exclude');
        const extInline = readInlineFlagValue(token, '--ext');
        const concurrencyInline = readInlineFlagValue(token, '--concurrency');
        const depthInline = readInlineFlagValue(token, '--depth');

        if (token === '--flat' || token === '--non-recursive') parsed.recursive = false;
        else if (token === '--recursive') parsed.recursive = true;
        else if (token === '--no-gitignore') parsed.respectGitignore = false;
        else if (token === '--gitignore') parsed.respectGitignore = true;
        else if (token === '--no-prune') parsed.pruneMissing = false;
        else if (token === '--prune') parsed.pruneMissing = true;
        else if ((token === '--include' || token === '-I') && next) {
            parsed.include.push(next);
            i += 1;
        } else if (includeInline !== null) parsed.include.push(includeInline);
        else if ((token === '--exclude' || token === '-X') && next) {
            parsed.exclude.push(next);
            i += 1;
        } else if (excludeInline !== null) parsed.exclude.push(excludeInline);
        else if ((token === '--ext' || token === '-e') && next) {
            const normalizedExt = normalizeExtension(next);
            if (normalizedExt) {
                parsed.extensions.push(normalizedExt);
            }
            i += 1;
        } else if (extInline !== null) {
            const normalizedExt = normalizeExtension(extInline);
            if (normalizedExt) {
                parsed.extensions.push(normalizedExt);
            }
        } else if (token === '--concurrency' && next) {
            parsed.concurrency = parsePositiveInt(next);
            i += 1;
        } else if (concurrencyInline !== null) parsed.concurrency = parsePositiveInt(concurrencyInline);
        else if (token === '--depth' && next) {
            parsed.depth = parsePositiveInt(next);
            i += 1;
        } else if (depthInline !== null) parsed.depth = parsePositiveInt(depthInline);
        else parsed.rest.push(token);
    }

    return parsed;
}

/**
 * @param {unknown} value
 * @param {boolean} json
 * @returns {void}
 */
function print(value, json) {
    if (json) {
        console.log(JSON.stringify(value, null, 2));
        return;
    }
    console.log(value);
}

/** @param {ReturnType<typeof createApplicationInfraHost>['runtime']['indexRegistry']} indexRegistry */
async function main(indexRegistry) {
    const buildIoIndexForDirectory = indexRegistry.buildDirectory;
    const clearIoIndex = indexRegistry.clear;
    const findIoIndexSymbol = indexRegistry.findSymbol;
    const searchIoIndex = indexRegistry.search;
    const readIoIndexStatus = indexRegistry.status;
    const rawArgs = process.argv.slice(2);
    const json = rawArgs.includes('--json');
    const args = rawArgs.filter((arg) => arg !== '--json');
    const [cmd = 'status', ...parts] = args;

    if (cmd === 'status' || cmd === 'stats') {
        const stats = readIoIndexStatus();
        if (json) print(stats, true);
        else {
            print(
                `index: available=${stats.available} files=${stats.files} fresh=${stats.freshFiles} failed=${stats.failedFiles} symbols=${stats.symbols} imports=${stats.imports} chunks=${stats.chunks}`,
                false,
            );
        }
        return;
    }

    if (cmd === 'build' || cmd === 'rebuild' || cmd === 'update') {
        const parsed = parseBuildArgs(parts);
        const directory = parsed.rest.join(' ').trim() || 'src/copilot';
        /** @type {NonNullable<Parameters<typeof buildIoIndexForDirectory>[1]>} */
        const options = {
            recursive: parsed.recursive,
            respectGitignore: parsed.respectGitignore,
        };
        if (parsed.depth !== undefined) options.depth = parsed.depth;
        if (parsed.concurrency !== undefined) options.concurrency = parsed.concurrency;
        if (parsed.include.length > 0) options.include = parsed.include;
        if (parsed.exclude.length > 0) options.exclude = parsed.exclude;
        if (parsed.extensions.length > 0) options.extensions = parsed.extensions;
        if (parsed.pruneMissing !== undefined) options.pruneMissing = parsed.pruneMissing;

        const result = await buildIoIndexForDirectory(directory, options);
        if (json) print(result, true);
        else {
            if ('scannedEntries' in result) {
                print(
                    `build: dir=${directory} scanned=${result.scannedEntries} candidates=${result.candidateFiles} indexed=${result.indexed} unchanged=${result.unchanged} skipped=${result.skipped} pruned=${result.pruned} failed=${result.failed} duration=${result.durationMs}ms`,
                    false,
                );
            } else {
                print(
                    `build: dir=${directory} indexed=${result.indexed} skipped=${result.skipped} failed=${result.failed} duration=${result.durationMs}ms reason=${result.reason}`,
                    false,
                );
            }
        }
        return;
    }

    if (cmd === 'search') {
        const query = parts.join(' ').trim();
        if (!query) throw new Error('Uso: npm run copilot:index -- search <consulta>');
        print({ query, results: searchIoIndex(query) }, json);
        return;
    }

    if (cmd === 'symbol' || cmd === 'symbols') {
        const symbol = parts.join(' ').trim();
        if (!symbol) throw new Error('Uso: npm run copilot:index -- symbol <nome>');
        print({ symbol, results: findIoIndexSymbol(symbol) }, json);
        return;
    }

    if (cmd === 'clear') {
        clearIoIndex();
        print('index: cleared', json);
        return;
    }

    throw new Error(
        'Uso: npm run copilot:index -- status|build|search|symbol|clear [--json] [--ext js] [--concurrency 8]',
    );
}

async function run() {
    const host = createApplicationInfraHost({
        hostId: 'copilot-index-cli',
        runtimeId: 'copilot-index-cli:runtime',
        defaultWorkspaceRoot: process.cwd(),
        registerProcessShutdown: false,
        env: process.env,
    });
    try {
        await host.bootstrapSqliteProvider();
        await main(host.runtime.indexRegistry);
    } finally {
        await host.dispose();
    }
}

run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
