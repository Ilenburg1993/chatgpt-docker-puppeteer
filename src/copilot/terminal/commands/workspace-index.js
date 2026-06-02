// @ts-check
/**
 * Comando `/index` do terminal LLM-B.
 *
 * Expõe a mesma superfície canônica das tools `workspace_index_*` para operação humana: status, build incremental,
 * busca FTS e navegação simbólica. O objetivo é não criar fluxo paralelo ao SDK/tools, apenas uma UX terminal para a
 * infraestrutura L2 já usada pela LLM-B.
 *
 * @module copilot/terminal/commands/workspace-index
 */

import { relative } from 'node:path';
import { toError } from '../../core/error-handlers.js';
import {
    buildIoIndexForDirectory,
    findIoIndexSymbol,
    getIoIndex,
    getIoIndexStats,
    searchIoIndex,
} from '../../infra/index.js';
import { formatTerminalIsoTimestamp } from '../state/ui/index.js';

/**
 * @typedef {{ println: (text: string) => void }} IndexCommandContext
 *
 * @typedef {{
 *     recursive: boolean;
 *     respectGitignore: boolean;
 *     pruneMissing: boolean | undefined;
 *     include: string[];
 *     exclude: string[];
 *     extensions: string[];
 *     concurrency: number | undefined;
 *     depth: number | undefined;
 *     rest: string[];
 * }} ParsedIndexArgs
 */

/**
 * @param {string} target
 * @returns {string}
 */
function compactPath(target) {
    const rel = relative(process.cwd(), target);
    if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return rel || '.';
    return target;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function numberLabel(value) {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function bytesLabel(value) {
    const bytes = Number(value ?? 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

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
 * @param {string} ext
 * @returns {string}
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
 * @returns {ParsedIndexArgs}
 */
function parseIndexArgs(parts) {
    /** @type {ParsedIndexArgs} */
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
        if (!token) continue;

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

/**
 * @param {IndexCommandContext} ctx
 */
function printStats(ctx) {
    const stats = /** @type {Record<string, unknown>} */ (getIoIndexStats());
    if (stats['enabled'] === false) {
        ctx.println(`\x1b[33m  Índice L2 indisponível:\x1b[0m ${String(stats['reason'] ?? 'unavailable')}`);
        return;
    }
    const latest =
        typeof stats['latestIndexedAtMs'] === 'number' ? formatTerminalIsoTimestamp(stats['latestIndexedAtMs']) : '-';
    ctx.println('\n  \x1b[36mÍndice L2 local\x1b[0m');
    ctx.println(
        `  disponibilidade ${String(stats['available'])} · arquivos ${numberLabel(stats['files'])} · frescos ${numberLabel(stats['freshFiles'])} · falhas ${numberLabel(stats['failedFiles'])}`,
    );
    ctx.println(
        `  símbolos ${numberLabel(stats['symbols'])} · imports ${numberLabel(stats['imports'])} · chunks ${numberLabel(stats['chunks'])} · bytes ${bytesLabel(stats['bytesIndexed'])}`,
    );
    ctx.println(
        `  builds ${numberLabel(stats['builds'])} · indexados ${numberLabel(stats['indexed'])} · ignorados ${numberLabel(stats['skipped'])} · podados ${numberLabel(stats['pruned'])} · buscas ${numberLabel(stats['searches'])}`,
    );
    ctx.println(`  última indexação ${latest} · frescor ${String(stats['freshness'] ?? '-')}\n`);
}

/**
 * @param {IndexCommandContext} ctx
 * @param {string[]} parts
 */
async function runBuild(ctx, parts) {
    const parsed = parseIndexArgs(parts);
    const directory = parsed.rest.join(' ').trim() || 'src/copilot';
    /** @type {Parameters<typeof buildIoIndexForDirectory>[1]} */
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

    ctx.println(
        `\n  \x1b[36m/index build\x1b[0m ${directory} \x1b[90m(gitignore=${parsed.respectGitignore ? 'on' : 'off'}, prune=${parsed.pruneMissing === false ? 'off' : 'auto'})\x1b[0m`,
    );
    const result = /** @type {Record<string, unknown>} */ (await buildIoIndexForDirectory(directory, options));
    if (result['available'] === false) {
        ctx.println(`  \x1b[31mfalhou:\x1b[0m ${String(result['reason'] ?? 'index-unavailable')}`);
        return;
    }
    ctx.println(
        `  scanned=${numberLabel(result['scannedEntries'])} · candidates=${numberLabel(result['candidateFiles'])} · indexed=${numberLabel(result['indexed'])} · unchanged=${numberLabel(result['unchanged'])} · skipped=${numberLabel(result['skipped'])} · pruned=${numberLabel(result['pruned'])} · failed=${numberLabel(result['failed'])}`,
    );
    ctx.println(
        `  workspaceRoot=${compactPath(String(result['workspaceRoot'] ?? directory))} · duration=${numberLabel(result['durationMs'])}ms\n`,
    );
}

/**
 * @param {IndexCommandContext} ctx
 * @param {string[]} parts
 */
function runSearch(ctx, parts) {
    const query = parts.join(' ').trim();
    if (!query) {
        ctx.println('\x1b[33m  Uso: /index search <consulta>\x1b[0m');
        return;
    }
    const results = searchIoIndex(query).slice(0, 20);
    ctx.println(`\n  \x1b[36m/index search\x1b[0m "${query}" · resultados ${results.length}`);
    for (const item of results) {
        ctx.println(`  \x1b[90m- ${item.relativePath}\x1b[0m ${String(item.snippet ?? '').replace(/\s+/gu, ' ')}`);
    }
    if (results.length === 0)
        ctx.println('  \x1b[90mSem resultados. Rode /index build src/copilot se o índice estiver vazio.\x1b[0m');
    ctx.println('');
}

/**
 * @param {IndexCommandContext} ctx
 * @param {string[]} parts
 */
function runSymbol(ctx, parts) {
    const symbol = parts.join(' ').trim();
    if (!symbol) {
        ctx.println('\x1b[33m  Uso: /index symbol <nome>\x1b[0m');
        return;
    }
    const results = findIoIndexSymbol(symbol).slice(0, 30);
    ctx.println(`\n  \x1b[36m/index symbol\x1b[0m ${symbol} · resultados ${results.length}`);
    for (const item of results) {
        ctx.println(
            `  \x1b[90m- ${item.relativePath}:${item.line || 0}\x1b[0m ${item.symbolKind} ${item.symbolName}${item.exported ? ' export' : ''}`,
        );
    }
    if (results.length === 0)
        ctx.println('  \x1b[90mSem símbolos. Rode /index build src/copilot --ext js --ext ts.\x1b[0m');
    ctx.println('');
}

/**
 * @param {IndexCommandContext} ctx
 */
function runClear(ctx) {
    getIoIndex()?.clearAll();
    ctx.println('\x1b[32m  Índice L2 limpo.\x1b[0m');
}

/**
 * @param {IndexCommandContext} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdIndex(ctx, arg = '') {
    const [sub = 'status', ...parts] = arg.trim().split(/\s+/u).filter(Boolean);
    try {
        if (sub === 'status' || sub === 'stats') printStats(ctx);
        else if (sub === 'build' || sub === 'rebuild' || sub === 'update') await runBuild(ctx, parts);
        else if (sub === 'search' || sub === 'find') runSearch(ctx, parts);
        else if (sub === 'symbol' || sub === 'symbols') runSymbol(ctx, parts);
        else if (sub === 'clear') runClear(ctx);
        else {
            ctx.println(
                '\x1b[33m  Uso: /index status | build [dir] [--ext js] [--include p] [--exclude p] [--depth n] [--concurrency n] [--no-prune] | search <query> | symbol <name> | clear\x1b[0m',
            );
        }
    } catch (e) {
        ctx.println(`\n  \x1b[31m✗ Index: ${toError(e).message}\x1b[0m\n`);
    }
}
