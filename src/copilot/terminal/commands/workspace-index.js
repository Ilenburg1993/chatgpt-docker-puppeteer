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

import { channel } from 'node:diagnostics_channel';
import { relative } from 'node:path';
import { toError } from '../../core/error-handlers.js';
import {
    buildIoIndexForDirectory,
    findIoIndexSymbol,
    getIoIndex,
    getIoIndexStats,
    searchIoIndex,
} from '../../infra/index.js';
import {
    formatTerminalTimeLabel,
    terminalThemeHeadline,
    terminalThemeJoin,
    terminalThemeRow,
    terminalThemeText,
    terminalThemeWrappedRow,
} from '../state/ui/index.js';

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

const ioIndexChannel = channel('copilot.io.index');
const ioScanChannel = channel('copilot.io.scan');

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
 * @param {unknown} value
 * @returns {string}
 */
function boolLabel(value) {
    return value === true ? 'sim' : value === false ? 'não' : '-';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringLabel(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || '-';
}

/**
 * @param {unknown} value
 * @param {number} [limit=180] Default is `180`
 * @returns {string}
 */
function compactText(value, limit = 180) {
    const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

/**
 * FTS5 usa marcadores textuais nos snippets (`[match]`). Isso é bom para a saída estruturada/Markdown das tools, mas
 * no terminal humano parece caminho adulterado (`src/copilot/[terminal]`) e dificulta copiar o texto. A superfície
 * visual converte esses marcadores em destaque ANSI, mantendo o texto real sem colchetes artificiais.
 *
 * @param {unknown} value
 * @returns {string}
 */
function renderTerminalIndexSnippet(value) {
    return compactText(value).replace(/\[([^\]\n]{1,120})\]/gu, (_match, highlighted) =>
        terminalThemeText('index', String(highlighted ?? '')),
    );
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

/**
 * @param {IndexCommandContext} ctx
 * @param {string} rootPath
 * @returns {() => void}
 */
function subscribeIndexBuildProgress(ctx, rootPath) {
    const normalizedRoot = compactPath(rootPath);
    let lastPrintedAt = 0;
    let activeTraceId = /** @type {string | null} */ (null);

    /**
     * @param {string} label
     * @param {string} detail
     * @param {{ force?: boolean }} [options]
     */
    function printProgress(label, detail, options = {}) {
        const now = Date.now();
        if (!options.force && now - lastPrintedAt < 900) return;
        lastPrintedAt = now;
        ctx.println(terminalThemeRow(label, detail, { role: 'info' }));
    }

    /**
     * @param {unknown} message
     */
    function onIndex(message) {
        const event = objectOrNull(message);
        if (!event) return;
        const phase = String(event['phase'] ?? '');
        const eventRoot = compactPath(String(event['rootPath'] ?? rootPath));
        if (eventRoot !== normalizedRoot) return;
        const traceId = typeof event['traceId'] === 'string' ? event['traceId'] : null;
        if (phase === 'build.start') {
            activeTraceId = traceId;
            printProgress(
                'Progresso',
                terminalThemeJoin([
                    'varrendo arquivos',
                    `raiz ${normalizedRoot}`,
                    `limite ${numberLabel(event['effectiveMaxFiles'])}`,
                    `concorrência ${numberLabel(event['concurrency'])}`,
                ]),
                { force: true },
            );
            return;
        }
        if (activeTraceId && traceId && traceId !== activeTraceId) return;
        if (phase !== 'build.progress') return;
        const indexed = finiteNumberOrNull(event['indexed']) ?? 0;
        const total = finiteNumberOrNull(event['total']);
        const pct = finiteNumberOrNull(event['pct']);
        const current = typeof event['currentFile'] === 'string' ? compactPath(event['currentFile']) : null;
        printProgress(
            'Indexando',
            terminalThemeJoin([
                total ? `${indexed}/${total}` : `${indexed} arquivos`,
                pct !== null ? `${pct}%` : null,
                current,
            ]),
        );
    }

    /**
     * @param {unknown} message
     */
    function onScan(message) {
        const event = objectOrNull(message);
        if (!event) return;
        const phase = String(event['phase'] ?? '');
        const eventRoot = compactPath(String(event['rootPath'] ?? rootPath));
        if (eventRoot !== normalizedRoot) return;
        const scanned = finiteNumberOrNull(event['scannedEntries']);
        if (phase === 'progress') {
            const current = typeof event['currentPath'] === 'string' ? compactPath(event['currentPath']) : null;
            printProgress('Varrendo', terminalThemeJoin([scanned !== null ? `${scanned} entradas` : null, current]));
        } else if (phase === 'complete') {
            printProgress('Varredura', terminalThemeJoin([scanned !== null ? `${scanned} entradas` : null, 'selecionando candidatos']), {
                force: true,
            });
        }
    }

    ioIndexChannel.subscribe(onIndex);
    ioScanChannel.subscribe(onScan);
    return () => {
        ioIndexChannel.unsubscribe(onIndex);
        ioScanChannel.unsubscribe(onScan);
    };
}

/**
 * @param {unknown} kind
 * @returns {string}
 */
function symbolKindLabel(kind) {
    const normalized = typeof kind === 'string' ? kind : '';
    if (normalized === 'function') return 'função';
    if (normalized === 'class') return 'classe';
    if (normalized === 'variable') return 'variável';
    if (normalized === 'import') return 'import';
    return normalized || 'símbolo';
}

/**
 * @returns {string}
 */
function usageText() {
    return '/index status | build [dir] [--ext js] [--include p] [--exclude p] [--depth n] [--concurrency n] [--no-prune] | search <query> | symbol <name> | clear';
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
        ctx.println('');
        ctx.println(terminalThemeRow('Índice L2', `indisponível · ${stringLabel(stats['reason'])}`, { role: 'warn' }));
        ctx.println('');
        return;
    }
    const latest =
        typeof stats['latestIndexedAtMs'] === 'number' ? formatTerminalTimeLabel(stats['latestIndexedAtMs'], { mode: 'dual' }) : '-';
    ctx.println('');
    ctx.println(terminalThemeHeadline('index', 'Índice L2 local'));
    ctx.println(
        terminalThemeRow(
            'Disponível',
            terminalThemeJoin([
                boolLabel(stats['available']),
                `arquivos ${numberLabel(stats['files'])}`,
                `frescos ${numberLabel(stats['freshFiles'])}`,
                `falhas ${numberLabel(stats['failedFiles'])}`,
            ]),
        ),
    );
    ctx.println(
        terminalThemeRow(
            'Conteúdo',
            terminalThemeJoin([
                `símbolos ${numberLabel(stats['symbols'])}`,
                `imports ${numberLabel(stats['imports'])}`,
                `chunks ${numberLabel(stats['chunks'])}`,
                bytesLabel(stats['bytesIndexed']),
            ]),
        ),
    );
    ctx.println(
        terminalThemeRow(
            'Builds',
            terminalThemeJoin([
                numberLabel(stats['builds']),
                `indexados ${numberLabel(stats['indexed'])}`,
                `ignorados ${numberLabel(stats['skipped'])}`,
                `podados ${numberLabel(stats['pruned'])}`,
                `buscas ${numberLabel(stats['searches'])}`,
            ]),
        ),
    );
    ctx.println(terminalThemeRow('Última', terminalThemeJoin([latest, `frescor ${stringLabel(stats['freshness'])}`])));
    ctx.println('');
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

    ctx.println('');
    ctx.println(
        terminalThemeHeadline('index', '/index build', [
            directory,
            `gitignore ${parsed.respectGitignore ? 'on' : 'off'}`,
            `prune ${parsed.pruneMissing === false ? 'off' : 'auto'}`,
        ]),
    );
    const unsubscribeProgress = subscribeIndexBuildProgress(ctx, directory);
    let result;
    try {
        result = /** @type {Record<string, unknown>} */ (await buildIoIndexForDirectory(directory, options));
    } finally {
        unsubscribeProgress();
    }
    if (result['available'] === false) {
        ctx.println(terminalThemeRow('Índice L2', `falhou · ${stringLabel(result['reason'] ?? 'index-unavailable')}`, { role: 'error' }));
        ctx.println('');
        return;
    }
    ctx.println(
        terminalThemeRow(
            'Resultado',
            terminalThemeJoin([
                `varridos ${numberLabel(result['scannedEntries'])}`,
                `candidatos ${numberLabel(result['candidateFiles'])}`,
                `indexados ${numberLabel(result['indexed'])}`,
                `inalterados ${numberLabel(result['unchanged'])}`,
            ]),
        ),
    );
    ctx.println(
        terminalThemeRow(
            'Limpeza',
            terminalThemeJoin([
                `ignorados ${numberLabel(result['skipped'])}`,
                `podados ${numberLabel(result['pruned'])}`,
                `falhas ${numberLabel(result['failed'])}`,
            ]),
        ),
    );
    ctx.println(
        terminalThemeRow(
            'Workspace',
            terminalThemeJoin([compactPath(String(result['workspaceRoot'] ?? directory)), `duração ${numberLabel(result['durationMs'])}ms`]),
        ),
    );
    ctx.println('');
}

/**
 * @param {IndexCommandContext} ctx
 * @param {string[]} parts
 */
function runSearch(ctx, parts) {
    const query = parts.join(' ').trim();
    if (!query) {
        ctx.println(terminalThemeRow('Uso', '/index search <consulta>', { role: 'warn' }));
        return;
    }
    const results = searchIoIndex(query).slice(0, 20);
    ctx.println('');
    ctx.println(terminalThemeHeadline('index', '/index search', [`"${query}"`, `resultados ${results.length}`]));
    for (const item of results) {
        ctx.println(
            terminalThemeWrappedRow('Arquivo', `${item.relativePath} · ${renderTerminalIndexSnippet(item.snippet)}`, {
                role: 'fileRead',
                columns: 110,
            }),
        );
    }
    if (results.length === 0)
        ctx.println(terminalThemeRow('Resultado', 'sem resultados · rode /index build src/copilot se o índice estiver vazio'));
    ctx.println('');
}

/**
 * @param {IndexCommandContext} ctx
 * @param {string[]} parts
 */
function runSymbol(ctx, parts) {
    const symbol = parts.join(' ').trim();
    if (!symbol) {
        ctx.println(terminalThemeRow('Uso', '/index symbol <nome>', { role: 'warn' }));
        return;
    }
    const results = findIoIndexSymbol(symbol).slice(0, 30);
    ctx.println('');
    ctx.println(terminalThemeHeadline('index', '/index symbol', [symbol, `resultados ${results.length}`]));
    for (const item of results) {
        ctx.println(
            terminalThemeWrappedRow(
                'Símbolo',
                terminalThemeJoin([
                    `${item.relativePath}:${item.line || 0}`,
                    symbolKindLabel(item.symbolKind),
                    item.symbolName,
                    item.exported ? 'exportado' : null,
                ]),
                { role: 'index', columns: 110 },
            ),
        );
    }
    if (results.length === 0)
        ctx.println(terminalThemeRow('Resultado', 'sem símbolos · rode /index build src/copilot --ext js --ext ts'));
    ctx.println('');
}

/**
 * @param {IndexCommandContext} ctx
 */
function runClear(ctx) {
    getIoIndex()?.clearAll();
    ctx.println(terminalThemeRow('Índice L2', 'limpo', { role: 'success' }));
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
            ctx.println(terminalThemeRow('Uso', usageText(), { role: 'warn' }));
        }
    } catch (e) {
        ctx.println('');
        ctx.println(terminalThemeRow('Index', toError(e).message, { role: 'error' }));
        ctx.println('');
    }
}
