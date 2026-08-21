// @ts-check
/**
 * Comando de escopos inteligentes do terminal LLM-B.
 *
 * `/scope` expõe no REPL a mesma camada canônica usada pelas tools `workspace_scope_*`: declara escopos de trabalho,
 * pré-aquece cache, indexa símbolos, consulta contexto e refresca arquivos alterados sem criar um fluxo paralelo.
 *
 * @module copilot/terminal/commands/scope
 */

import { getApplicationWorkspaceInfra } from '#copilot/boot';
import { relative } from 'node:path';
import { toError } from '../../core/error-handlers.js';
import { terminalThemeHeadline, terminalThemeRow } from '../state/index.js';

const TERMINAL_SCOPE_WORKSPACE = getApplicationWorkspaceInfra(process.cwd());
const TERMINAL_SCOPE_CONTEXT = TERMINAL_SCOPE_WORKSPACE.indexing.context;
const { closeScope, declareScope, findSymbol, getScopeContext, getScopeStats, listScopes, refreshScope } =
    TERMINAL_SCOPE_CONTEXT;

/**
 * @typedef {{ println: (text: string) => void; hubSessionId?: string | null }} ScopeCommandContext
 */

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

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
 * @param {boolean} value
 * @returns {string}
 */
function yesNo(value) {
    return value ? 'sim' : 'não';
}

/**
 * @param {unknown} kind
 * @returns {string}
 */
function renderScopeSymbolKind(kind) {
    const value = String(kind ?? '').trim();
    if (value === 'function') return 'função';
    if (value === 'class') return 'classe';
    if (value === 'method') return 'método';
    if (value === 'const') return 'constante';
    if (value === 'let') return 'variável';
    if (value === 'export') return 'exportação';
    return value.replace(/[._-]+/gu, ' ') || 'símbolo';
}

/**
 * @param {string} item
 * @returns {string}
 */
function renderScopeExportLabel(item) {
    const match = /^(?<file>.+)::(?<name>[^()]+)\((?<kind>[^()]+)\)$/u.exec(item.trim());
    if (!match?.groups) return item.replace(/::/gu, ' · ').replace(/[()]/gu, '');
    const file = compactPath(match.groups['file'] ?? '');
    const name = (match.groups['name'] ?? '').trim();
    const kind = renderScopeSymbolKind(match.groups['kind']);
    return [name, kind, file].filter(Boolean).join(' · ');
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
        await TERMINAL_SCOPE_WORKSPACE.readIo.statPath(value);
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
 * @param {import('#copilot/infra/public/composition/workspace/indexing').ScopeStats | null} stats
 * @returns {void}
 */
function printScopeStats(ctx, stats) {
    if (!stats) {
        ctx.println(terminalThemeRow('Escopo', 'não encontrado', { role: 'warn' }));
        return;
    }
    const statusLabel = {
        ready: 'pronto',
        warming: 'aquecendo',
        stale: 'desatualizado',
        degraded: 'degradado',
    }[stats.status];
    ctx.println(
        terminalThemeRow(
            'Escopo',
            `${stats.sessionId} · ${statusLabel} · arquivos ${stats.pathCount} · cache L1 ${stats.preloaded} · analisados ${stats.parsed} · invalidados ${stats.invalidated} · falhas ${stats.failed} · ${Math.round(stats.warmDurationMs)}ms`,
        ),
    );
    if (stats.lastError) {
        ctx.println(
            terminalThemeRow('Atenção', `${stats.lastError.summary} · ${stats.lastError.code}`, { role: 'warn' }),
        );
    }
}

/**
 * @param {ScopeCommandContext} ctx
 * @param {string[]} parts
 * @returns {Promise<void>}
 */
async function runDeclare(ctx, parts) {
    const args = parseScopeArgs(parts);
    const target = await resolveDeclareTarget(ctx, args);
    /** @type {import('#copilot/infra/public/composition/workspace/indexing').ScopeDeclareOptions} */
    const scopeOptions = {
        sessionId: target.sessionId,
        recursive: args.recursive,
        parseSymbols: args.parseSymbols,
    };
    if (target.paths.length > 0) {
        scopeOptions.paths = await Promise.all(
            target.paths.map((filePath) => TERMINAL_SCOPE_WORKSPACE.authority.resolvePath(filePath, 'read')),
        );
    }
    if (target.directory !== undefined) {
        scopeOptions.directory = await TERMINAL_SCOPE_WORKSPACE.authority.resolvePath(target.directory, 'scan');
    }
    if (args.extensions.length > 0) scopeOptions.extensions = args.extensions;
    if (args.include.length > 0) scopeOptions.include = args.include;
    if (args.exclude.length > 0) scopeOptions.exclude = args.exclude;
    if (args.maxFiles !== undefined) scopeOptions.maxFiles = args.maxFiles;
    if (args.concurrency !== undefined) scopeOptions.concurrency = args.concurrency;

    const handle = declareScope(scopeOptions);

    const source =
        target.paths.length > 0
            ? `${target.paths.length} paths explícitos`
            : `diretório ${compactPath(String(target.directory ?? '.'))}`;
    ctx.println('');
    ctx.println(terminalThemeHeadline('assistant', 'Escopo declarado'));
    ctx.println(terminalThemeRow('Escopo', handle.sessionId));
    ctx.println(terminalThemeRow('Fonte', source));
    ctx.println(
        terminalThemeRow(
            'Opções',
            `símbolos ${yesNo(args.parseSymbols)} · recursivo ${yesNo(args.recursive)} · limite ${numberLabel(args.maxFiles)} informativo · concorrência ${numberLabel(args.concurrency)} informativo`,
        ),
    );

    if (args.awaitReady) {
        const stats = await handle.awaitReady();
        printScopeStats(ctx, stats);
    } else {
        ctx.println(
            terminalThemeRow(
                'Próximo',
                'aquecimento em segundo plano; use /scope context ou /scope list para acompanhar',
            ),
        );
    }
    ctx.println('');
}

/**
 * @param {ScopeCommandContext} ctx
 */
function runList(ctx) {
    const ids = listScopes();
    if (ids.length === 0) {
        ctx.println(terminalThemeRow('Escopos', 'nenhum escopo ativo', { role: 'warn' }));
        return;
    }
    ctx.println('');
    ctx.println(terminalThemeHeadline('assistant', 'Escopos ativos'));
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
        ctx.println(terminalThemeRow('Escopo', `não encontrado: ${sessionId}`, { role: 'warn' }));
        return;
    }
    const statusLabel = {
        ready: 'pronto',
        warming: 'aquecendo',
        stale: 'desatualizado',
        degraded: 'degradado',
    }[scope.status];
    ctx.println('');
    ctx.println(terminalThemeHeadline('assistant', 'Contexto de escopo'));
    ctx.println(terminalThemeRow('Escopo', `${scope.sessionId} · ${statusLabel}`));
    ctx.println(
        terminalThemeRow(
            'Arquivos',
            `${scope.files} · símbolos ${scope.symbols} · exportações ${scope.topExports.length}`,
        ),
    );
    for (const item of scope.topExports.slice(0, 30))
        ctx.println(terminalThemeRow('Exportação', renderScopeExportLabel(item)));
    if (scope.topExports.length > 30)
        ctx.println(
            terminalThemeRow(
                'Mais',
                countLabel(scope.topExports.length - 30, 'exportação adicional', 'exportações adicionais'),
            ),
        );
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
        ctx.println(terminalThemeRow('Uso', '/scope find <sessionId> <symbol> [--exact]', { role: 'warn' }));
        return;
    }
    const results = findSymbol(sessionId, symbol, { exactMatch: args.exactMatch });
    ctx.println('');
    ctx.println(terminalThemeHeadline('assistant', 'Busca de símbolo no escopo'));
    ctx.println(terminalThemeRow('Consulta', `${sessionId} · "${symbol}" · resultados ${results.length}`));
    for (const result of results.slice(0, 80)) {
        ctx.println(
            terminalThemeRow(
                renderScopeSymbolKind(result.symbol.kind),
                `${result.symbol.name} · ${compactPath(result.filePath)}:${result.symbol.line}`,
            ),
        );
    }
    if (results.length > 80)
        ctx.println(
            terminalThemeRow('Mais', countLabel(results.length - 80, 'resultado adicional', 'resultados adicionais')),
        );
    ctx.println('');
}

/**
 * @param {ScopeCommandContext} ctx
 * @param {string[]} parts
 */
async function runRefresh(ctx, parts) {
    const args = parseScopeArgs(parts);
    const sessionId = args.sessionId ?? args.rest.shift() ?? ctx.hubSessionId ?? 'terminal-live';
    const modifiedPaths =
        args.rest.length > 0
            ? await Promise.all(
                  args.rest.map((filePath) => TERMINAL_SCOPE_WORKSPACE.authority.resolvePath(filePath, 'read')),
              )
            : undefined;
    const result = await refreshScope(sessionId, modifiedPaths);
    ctx.println('');
    ctx.println(
        terminalThemeRow(
            'Escopo',
            `${sessionId} · atualizados ${result.refreshed} · removidos ${result.removed} · falhas ${result.failed}`,
        ),
    );
    ctx.println('');
}

/**
 * @param {ScopeCommandContext} ctx
 * @param {string[]} parts
 */
function runClose(ctx, parts) {
    const sessionId = parts[0] ?? ctx.hubSessionId ?? 'terminal-live';
    const stats = closeScope(sessionId);
    if (!stats) {
        ctx.println(terminalThemeRow('Escopo', `não encontrado: ${sessionId}`, { role: 'warn' }));
        return;
    }
    ctx.println(
        terminalThemeRow('Escopo fechado', `${sessionId} · arquivos ${stats.pathCount} · analisados ${stats.parsed}`, {
            role: 'success',
        }),
    );
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
                terminalThemeRow(
                    'Uso',
                    '/scope list | declare [sessionId] [dir] [--await] [--include p] [--exclude p] [--ext js] [--max-files n] [--concurrency n] | context [sessionId] | find <sessionId> <symbol> [--exact] | refresh [sessionId] [paths...] | close [sessionId]',
                    { role: 'warn' },
                ),
            );
        }
    } catch (e) {
        ctx.println('');
        ctx.println(terminalThemeRow('Escopo', toError(e).message, { role: 'error' }));
        ctx.println('');
    }
}
