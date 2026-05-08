#!/usr/bin/env node
/**
 * CLI operacional para o índice L2 do Copilot.
 *
 * Mesma infraestrutura das tools `workspace_index_*` e do comando REPL `/index`; existe para builds manuais, automação
 * local e diagnóstico sem abrir o terminal permanente da LLM-B.
 */

import {
    buildIoIndexForDirectory,
    findIoIndexSymbol,
    getIoIndex,
    getIoIndexStats,
    searchIoIndex,
} from '../src/copilot/infra/index.js';

function parsePositiveInt(value) {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.floor(parsed);
}

function normalizeExtension(ext) {
    if (!ext) return ext;
    return ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}

function readInlineFlagValue(token, name) {
    const prefix = `${name}=`;
    return token.startsWith(prefix) ? token.slice(prefix.length) : null;
}

function parseBuildArgs(parts) {
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
        const token = parts[i];
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
            parsed.extensions.push(normalizeExtension(next));
            i += 1;
        } else if (extInline !== null) parsed.extensions.push(normalizeExtension(extInline));
        else if (token === '--concurrency' && next) {
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

function print(value, json) {
    if (json) {
        console.log(JSON.stringify(value, null, 2));
        return;
    }
    console.log(value);
}

async function main() {
    const rawArgs = process.argv.slice(2);
    const json = rawArgs.includes('--json');
    const args = rawArgs.filter((arg) => arg !== '--json');
    const [cmd = 'status', ...parts] = args;

    if (cmd === 'status' || cmd === 'stats') {
        const stats = getIoIndexStats();
        if (json) print(stats, true);
        else {
            print(
                `index: available=${stats.available} files=${stats.files ?? 0} fresh=${stats.freshFiles ?? 0} failed=${stats.failedFiles ?? 0} symbols=${stats.symbols ?? 0} imports=${stats.imports ?? 0} chunks=${stats.chunks ?? 0}`,
                false,
            );
        }
        return;
    }

    if (cmd === 'build' || cmd === 'rebuild' || cmd === 'update') {
        const parsed = parseBuildArgs(parts);
        const directory = parsed.rest.join(' ').trim() || 'src/copilot';
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
            print(
                `build: dir=${directory} scanned=${result.scannedEntries ?? 0} candidates=${result.candidateFiles ?? 0} indexed=${result.indexed ?? 0} unchanged=${result.unchanged ?? 0} skipped=${result.skipped ?? 0} pruned=${result.pruned ?? 0} failed=${result.failed ?? 0} duration=${result.durationMs ?? 0}ms`,
                false,
            );
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
        getIoIndex()?.clearAll();
        print('index: cleared', json);
        return;
    }

    throw new Error(
        'Uso: npm run copilot:index -- status|build|search|symbol|clear [--json] [--ext js] [--concurrency 8]',
    );
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
