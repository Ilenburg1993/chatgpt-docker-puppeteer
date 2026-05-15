// @ts-check
/**
 * Comando de escopos inteligentes do terminal LLM-B.
 *
 * `/scope` expõe no REPL a mesma camada canônica usada pelas tools `workspace_scope_*`: declara escopos de trabalho,
 * pré-aquece cache, indexa símbolos, consulta contexto e refresca arquivos alterados sem criar um fluxo paralelo.
 *
 * @module copilot/terminal/commands/scope
 */

import {
    closeScope,
    declareScope,
    findSymbol,
    getScopeContext,
    getScopeStats,
    listScopes,
    refreshScope,
} from '#copilot/infra/public/session';
import { stat } from 'node:fs/promises';
import { relative } from 'node:path';
import { toError } from '../../core/error-handlers.js';

/**
 * @typedef {{ println: (text: string) => void; hubSessionId?: string | null }} ScopeCommandContext
 */

/**
 * @typedef {{
 *     awaitReady: boolean;
 *     exactMatch: boolean;
 *     parseSymbols: boolean;
 *     recursive: boolean;
 *     include: string[];
 *     exclude: string[];
 *     extensions: string[];
 *     paths: string[];
 *     maxFiles: number | undefined;
 *     concurrency: number | undefined;
 *     sessionId: string | null;
 *     rest: string[];
 * }} ParsedScopeArgs
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
 * @param {number | undefined} value
 * @returns {string}
 */
function numberLabel(value) {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-';
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
    return ext.startsWith('.') ? ext : `.${ext}`;
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
 * @returns {ParsedScopeArgs}
 */
function parseScopeArgs(parts) {
    /** @type {ParsedScopeArgs} */
    const parsed = {
        awaitReady: false,
        exactMatch: false,
        parseSymbols: true,
        recursive: true,
        include: [],
        exclude: [],
        extensions: [],
        paths: [],
        maxFiles: undefined,
        concurrency: undefined,
        sessionId: null,
        rest: [],
    };

    for (let i = 0; i < parts.length; i++) {
        const token = parts[i];
        const next = parts[i + 1];
        if (!token) continue;

        const includeInline = readInlineFlagValue(token, '--include');
        const excludeInline = readInlineFlagValue(token, '--exclude');
        const extInline = readInlineFlagValue(token, '--ext');
        const pathInline = readInlineFlagValue(token, '--path') ?? readInlineFlagValue(token, '--file');
        const maxFilesInline = readInlineFlagValue(token, '--max-files');
        const concurrencyInline = readInlineFlagValue(token, '--concurrency');
        const sessionInline = readInlineFlagValue(token, '--session');

        if (token === '--await' || token === '--wait') parsed.awaitReady = true;
        else if (token === '--exact') parsed.exactMatch = true;
        else if (token === '--no-symbols') parsed.parseSymbols = false;
        else if (token === '--flat' || token === '--non-recursive') parsed.recursive = false;
        else if (token === '--recursive') parsed.recursive = true;
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
        else if ((token === '--path' || token === '--file') && next) {
            parsed.paths.push(next);
            i += 1;
        } else if (pathInline !== null) parsed.paths.push(pathInline);
        else if (token === '--max-files' && next) {
            parsed.maxFiles = parsePositiveInt(next);
            i += 1;
        } else if (maxFilesInline !== null) parsed.maxFiles = parsePositiveInt(maxFilesInline);
        else if (token === '--concurrency' && next) {
            parsed.concurrency = parsePositiveInt(next);
            i += 1;
        } else if (concurrencyInline !== null) parsed.concurrency = parsePositiveInt(concurrencyInline);
        else if ((token === '--session' || token === '-s') && next) {
            parsed.sessionId = next;
            i += 1;
        } else if (sessionInline !== null) parsed.sessionId = sessionInline;
        else parsed.rest.push(token);
    }

    return parsed;
}

/**
 * @param {string} value
 * @returns {Promise<boolean>}
 */
async function looksLikeExistingPath(value) {
    if (!value) return false;
    try {
        await stat(value);
        return true;
    } catch {
        return value.includes('/') || value.includes('\\') || value.startsWith('.') || value.startsWith('~');
    }
}

/**
 * @param {ScopeCommandContext} ctx
 * @param {ParsedScopeArgs} args
 * @returns {Promise<{ sessionId: string; directory: string | undefined; paths: string[] }>}
 */
async function resolveDeclareTarget(ctx, args) {
    if (args.sessionId) {
        return {
            sessionId: args.sessionId,
            directory: args.paths.length === 0 ? args.rest.join(' ').trim() || '.' : undefined,
            paths: args.paths,
        };
    }

    if (args.rest.length >= 2) {
        return { sessionId: String(args.rest[0]), directory: args.rest.slice(1).join(' '), paths: args.paths };
    }

    if (args.rest.length === 1) {
        const only = String(args.rest[0]);
        if (await looksLikeExistingPath(only)) {
            return { sessionId: ctx.hubSessionId ?? 'terminal-live', directory: only, paths: args.paths };
        }
        return { sessionId: only, directory: args.paths.length === 0 ? '.' : undefined, paths: args.paths };
    }

    return {
        sessionId: ctx.hubSessionId ?? 'terminal-live',
        directory: args.paths.length === 0 ? '.' : undefined,
        paths: args.paths,
    };
}

/**
 * @param {ScopeCommandContext} ctx
 * @param {import('../../infra/io-session-scope.js').ScopeStats | null} stats
 * @returns {void}
 */
function printScopeStats(ctx, stats) {
    if (!stats) {
        ctx.println('\x1b[33m  Escopo não encontrado.\x1b[0m');
        return;
    }
    const ready = stats.ready ? '\x1b[32mready\x1b[0m' : '\x1b[33mwarming\x1b[0m';
    ctx.println(
        `  \x1b[36m${stats.sessionId}\x1b[0m · ${ready} · files=${stats.pathCount} · l1=${stats.preloaded} · parsed=${stats.parsed} · invalidated=${stats.invalidated} · failed=${stats.failed} · ${Math.round(stats.warmDurationMs)}ms`,
    );
}

/**
 * @param {ScopeCommandContext} ctx
 * @param {string[]} parts
 * @returns {Promise<void>}
 */
async function runDeclare(ctx, parts) {
    const args = parseScopeArgs(parts);
    const target = await resolveDeclareTarget(ctx, args);
    /** @type {import('../../infra/io-session-scope.js').ScopeDeclareOptions} */
    const scopeOptions = {
        sessionId: target.sessionId,
        recursive: args.recursive,
        parseSymbols: args.parseSymbols,
    };
    if (target.paths.length > 0) scopeOptions.paths = target.paths;
    if (target.directory !== undefined) scopeOptions.directory = target.directory;
    if (args.extensions.length > 0) scopeOptions.extensions = args.extensions;
    if (args.include.length > 0) scopeOptions.include = args.include;
    if (args.exclude.length > 0) scopeOptions.exclude = args.exclude;
    if (args.maxFiles !== undefined) scopeOptions.maxFiles = args.maxFiles;
    if (args.concurrency !== undefined) scopeOptions.concurrency = args.concurrency;

    const handle = declareScope(scopeOptions);

    const source =
        target.paths.length > 0
            ? `${target.paths.length} paths explícitos`
            : `dir=${compactPath(String(target.directory ?? '.'))}`;
    ctx.println(`\n  \x1b[36m/scope declare\x1b[0m ${handle.sessionId} · ${source}`);
    ctx.println(
        `  \x1b[90mparseSymbols=${args.parseSymbols} · recursive=${args.recursive} · maxFiles=${numberLabel(args.maxFiles)} informativo · concurrency=${numberLabel(args.concurrency)} informativo\x1b[0m`,
    );

    if (args.awaitReady) {
        const stats = await handle.awaitReady();
        printScopeStats(ctx, stats);
    } else {
        ctx.println('  \x1b[90mwarm-up em background; use /scope context ou /scope list para acompanhar.\x1b[0m');
    }
    ctx.println('');
}

/**
 * @param {ScopeCommandContext} ctx
 */
function runList(ctx) {
    const ids = listScopes();
    if (ids.length === 0) {
        ctx.println('\x1b[33m  Nenhum escopo ativo.\x1b[0m');
        return;
    }
    ctx.println('\n  \x1b[36mEscopos ativos\x1b[0m');
    for (const id of ids) printScopeStats(ctx, getScopeStats(id));
    ctx.println('');
}

/**
 * @param {ScopeCommandContext} ctx
 * @param {string[]} parts
 */
function runContext(ctx, parts) {
    const sessionId = parts[0] ?? ctx.hubSessionId ?? 'terminal-live';
    const scope = getScopeContext(sessionId);
    if (!scope) {
        ctx.println(`\x1b[33m  Escopo não encontrado: ${sessionId}\x1b[0m`);
        return;
    }
    const ready = scope.ready ? '\x1b[32mready\x1b[0m' : '\x1b[33mwarming\x1b[0m';
    ctx.println(`\n  \x1b[36mContexto de escopo\x1b[0m ${scope.sessionId} · ${ready}`);
    ctx.println(`  files=${scope.files} · symbols=${scope.symbols} · exports=${scope.topExports.length}`);
    for (const item of scope.topExports.slice(0, 30)) ctx.println(`  \x1b[90m- ${item}\x1b[0m`);
    if (scope.topExports.length > 30)
        ctx.println(`  \x1b[90m… ${scope.topExports.length - 30} exports adicionais\x1b[0m`);
    ctx.println('');
}

/**
 * @param {ScopeCommandContext} ctx
 * @param {string[]} parts
 */
function runFind(ctx, parts) {
    const args = parseScopeArgs(parts);
    const sessionId = args.sessionId ?? args.rest.shift() ?? ctx.hubSessionId ?? 'terminal-live';
    const symbol = args.rest.join(' ').trim();
    if (!symbol) {
        ctx.println('\x1b[33m  Uso: /scope find <sessionId> <symbol> [--exact]\x1b[0m');
        return;
    }
    const results = findSymbol(sessionId, symbol, { exactMatch: args.exactMatch });
    ctx.println(`\n  \x1b[36mScope symbol search\x1b[0m ${sessionId} · "${symbol}" · matches=${results.length}`);
    for (const result of results.slice(0, 80)) {
        ctx.println(
            `  \x1b[33m${result.symbol.kind}\x1b[0m ${result.symbol.name} · ${compactPath(result.filePath)}:${result.symbol.line}`,
        );
    }
    if (results.length > 80) ctx.println(`  \x1b[90m… ${results.length - 80} resultados adicionais\x1b[0m`);
    ctx.println('');
}

/**
 * @param {ScopeCommandContext} ctx
 * @param {string[]} parts
 */
async function runRefresh(ctx, parts) {
    const args = parseScopeArgs(parts);
    const sessionId = args.sessionId ?? args.rest.shift() ?? ctx.hubSessionId ?? 'terminal-live';
    const modifiedPaths = args.rest.length > 0 ? args.rest : undefined;
    const result = await refreshScope(sessionId, modifiedPaths);
    ctx.println(
        `\n  \x1b[36m/scope refresh\x1b[0m ${sessionId} · refreshed=${result.refreshed} · failed=${result.failed}\n`,
    );
}

/**
 * @param {ScopeCommandContext} ctx
 * @param {string[]} parts
 */
function runClose(ctx, parts) {
    const sessionId = parts[0] ?? ctx.hubSessionId ?? 'terminal-live';
    const stats = closeScope(sessionId);
    if (!stats) {
        ctx.println(`\x1b[33m  Escopo não encontrado: ${sessionId}\x1b[0m`);
        return;
    }
    ctx.println(`\x1b[32m  Escopo fechado:\x1b[0m ${sessionId} · files=${stats.pathCount} · parsed=${stats.parsed}`);
}

/**
 * @param {ScopeCommandContext} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdScope(ctx, arg = '') {
    const [sub = 'list', ...parts] = arg.trim().split(/\s+/u).filter(Boolean);
    try {
        if (sub === 'list' || sub === 'ls') runList(ctx);
        else if (sub === 'declare' || sub === 'open') await runDeclare(ctx, parts);
        else if (sub === 'context' || sub === 'ctx') runContext(ctx, parts);
        else if (sub === 'find' || sub === 'symbol') runFind(ctx, parts);
        else if (sub === 'refresh') await runRefresh(ctx, parts);
        else if (sub === 'close' || sub === 'end') runClose(ctx, parts);
        else {
            ctx.println(
                '\x1b[33m  Uso: /scope list | declare [sessionId] [dir] [--await] [--include p] [--exclude p] [--ext js] [--max-files n] [--concurrency n] | context [sessionId] | find <sessionId> <symbol> [--exact] | refresh [sessionId] [paths...] | close [sessionId]\x1b[0m',
            );
        }
    } catch (e) {
        ctx.println(`\n  \x1b[31m✗ Scope: ${toError(e).message}\x1b[0m\n`);
    }
}
