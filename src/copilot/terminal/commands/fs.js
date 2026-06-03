// @ts-check
/**
 * Comando canônico de FS local para o terminal LLM-B.
 *
 * Diferente de `/workspace`, que opera no workspace virtual da sessão SDK, `/fs` usa as file-tools locais
 * `src/copilot/tools/file/*` e portanto materializa leituras/escritas no filesystem real do workspace.
 *
 * @module copilot/terminal/commands/fs
 */

import { toError } from '../../core/error-handlers.js';
import {
    renderTerminalFilePreview,
    renderTerminalMarkdownPreview,
    renderTerminalStructuredPreview,
} from '../capabilities/index.js';
import { readTerminalIoActivityProjection } from '../events/index.js';
import { requireTerminalFileTool } from '../frontend/gateways/index.js';
import { buildActivityAwareGuidance, buildFailureRecoveryLines } from '../frontend/operational-guidance/index.js';
import { terminalThemeRow } from '../state/ui/index.js';

/**
 * @typedef {{ println: (text: string) => void }} CommandContext
 */

/**
 * @param {import('../frontend/gateways/tools.js').TerminalTool} tool
 * @returns {Function}
 */
function getToolHandler(tool) {
    if (typeof tool.handler === 'function') return tool.handler;
    throw new TypeError('[terminal/fs] tool sem handler executável.');
}

const listDirectoryTool = requireTerminalFileTool('read', 'list_directory');
const readFileContentTool = requireTerminalFileTool('read', 'read_file_content');
const searchInFilesTool = requireTerminalFileTool('search', 'search_in_files');
const createFileTool = requireTerminalFileTool('write', 'create_file');
const writeFileContentTool = requireTerminalFileTool('write', 'write_file_content');

/**
 * Constrói guidance dinâmico de falha para o FS local, orientado pela última operação de I/O.
 *
 * @returns {ReturnType<typeof buildActivityAwareGuidance>}
 */
function buildFsDynamicGuidance() {
    const [lastEntry = null] = readTerminalIoActivityProjection(1);
    return buildActivityAwareGuidance({
        mode: 'local-fs-primary',
        lastIoEntry: lastEntry
            ? {
                  operation: lastEntry.operation,
                  target: lastEntry.target,
                  success: lastEntry.success,
                  engine: lastEntry.engine,
              }
            : null,
    });
}

/**
 * @param {import('../frontend/gateways/tools.js').TerminalTool} tool
 * @param {Record<string, unknown>} args
 * @returns {Promise<Record<string, unknown>>}
 */
async function invokeFileTool(tool, args) {
    const result = await getToolHandler(tool)(args);
    return /** @type {Record<string, unknown>} */ (result);
}

/**
 * @param {unknown} value
 * @param {number} [max=4000] Default is `4000`
 * @returns {string}
 */
function pretty(value, max = 4000) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} chars restantes)` : text;
}

/**
 * @param {Record<string, unknown>} result
 * @returns {boolean}
 */
function isSuccess(result) {
    return result['success'] === true;
}

/**
 * @param {Record<string, unknown>} result
 * @returns {string}
 */
function ioSummary(result) {
    const io =
        result['io'] && typeof result['io'] === 'object' ? /** @type {Record<string, unknown>} */ (result['io']) : {};
    const engine = typeof io['engine'] === 'string' ? io['engine'] : null;
    const operation = typeof io['operation'] === 'string' ? io['operation'] : null;
    if (!engine && !operation) return '';
    return terminalThemeRow(`I/O ${operation ?? '-'}`, `motor ${engine ?? '-'}`, { role: 'muted' });
}

/**
 * @param {CommandContext} ctx
 * @param {Record<string, unknown>} result
 */
function printFailure({ println }, result) {
    println('');
    println(terminalThemeRow('FS local', String(result['error'] ?? 'operação falhou'), { role: 'error' }));
    const guidance = buildFsDynamicGuidance();
    if (guidance.nextCommand) {
        println(terminalThemeRow('Próximo', guidance.nextCommand, { role: 'warn' }));
    }
    for (const line of buildFailureRecoveryLines(guidance)) {
        println(terminalThemeRow('Guia', line, { role: 'muted' }));
    }
    println('');
}

/**
 * @param {string[]} parts
 * @returns {{ showHidden: boolean; recursive: boolean; depth: number; rest: string[] }}
 */
function parseListFlags(parts) {
    let showHidden = false;
    let recursive = false;
    let depth = 3;
    /** @type {string[]} */
    const rest = [];
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '--hidden' || part === '-a') {
            showHidden = true;
        } else if (part === '--recursive' || part === '-r') {
            recursive = true;
        } else if (part === '--depth') {
            const next = parts[i + 1];
            if (next && /^\d+$/u.test(next)) {
                depth = Number(next);
                i += 1;
            }
        } else if (part) {
            rest.push(part);
        }
    }
    return { showHidden, recursive, depth, rest };
}

/**
 * @param {string[]} parts
 * @param {boolean} [previewDefault=false]
 * @returns {{ preview: boolean; forceJs: boolean; markdown: boolean; structured: 'json' | 'yaml' | null; query: string; lineLimit: number; rest: string[] }}
 */
function parseReadFlags(parts, previewDefault = false) {
    let preview = previewDefault;
    let forceJs = false;
    let markdown = false;
    /** @type {'json' | 'yaml' | null} */
    let structured = null;
    let query = '.';
    let lineLimit = 220;
    /** @type {string[]} */
    const rest = [];
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '--preview') {
            preview = true;
        } else if (part === '--plain' || part === '--no-external') {
            forceJs = true;
            preview = true;
        } else if (part === '--markdown' || part === '--md') {
            markdown = true;
            preview = true;
        } else if (part === '--json') {
            structured = 'json';
            preview = true;
        } else if (part === '--yaml' || part === '--yml') {
            structured = 'yaml';
            preview = true;
        } else if (part === '--query' || part === '--filter') {
            const next = parts[i + 1];
            if (next) {
                query = next;
                i += 1;
            }
        } else if (part === '--lines') {
            const next = parts[i + 1];
            if (next && /^\d+$/u.test(next)) {
                lineLimit = Number(next);
                i += 1;
            }
        } else if (part) {
            rest.push(part);
        }
    }
    if (structured) markdown = false;
    return { preview, forceJs, markdown, structured, query, lineLimit, rest };
}

/**
 * @param {CommandContext} ctx
 * @param {string[]} parts
 */
async function runList(ctx, parts) {
    const flags = parseListFlags(parts);
    const path = flags.rest.join(' ').trim() || '.';
    const result = await invokeFileTool(listDirectoryTool, {
        path,
        recursive: flags.recursive,
        depth: flags.depth,
        showHidden: flags.showHidden,
    });
    if (!isSuccess(result)) {
        printFailure(ctx, result);
        return;
    }
    const entries = Array.isArray(result['entries']) ? result['entries'] : [];
    ctx.println('');
    ctx.println(terminalThemeRow('FS local', `${entries.length} entrada(s) · ${String(result['path'] ?? path)}`));
    for (const entry of entries.slice(0, 120)) {
        const item = entry && typeof entry === 'object' ? /** @type {Record<string, unknown>} */ (entry) : {};
        ctx.println(
            terminalThemeRow(
                'Item',
                `${String(item['type'] ?? '?')} · ${String(item['name'] ?? item['path'] ?? entry)}`,
            ),
        );
    }
    if (entries.length > 120)
        ctx.println(terminalThemeRow('Mais', `${entries.length - 120} entradas omitidas`, { role: 'muted' }));
    const io = ioSummary(result);
    if (io) ctx.println(io);
    ctx.println('');
}

/**
 * @param {CommandContext} ctx
 * @param {string[]} parts
 */
async function runRead(ctx, parts, previewDefault = false) {
    const flags = parseReadFlags(parts, previewDefault);
    const path = flags.rest.join(' ').trim();
    if (!path) {
        ctx.println(terminalThemeRow('Uso', '/fs read <path> [--preview] [--markdown|--json|--yaml] [--query filtro] [--lines n]', { role: 'warn' }));
        return;
    }
    const result = await invokeFileTool(readFileContentTool, { path, encoding: 'utf8', quietLog: true });
    if (!isSuccess(result)) {
        printFailure(ctx, result);
        return;
    }
    const content = String(result['content'] ?? '');
    ctx.println('');
    ctx.println(terminalThemeRow('Arquivo', `${String(result['path'] ?? path)} · (FS local)`));
    if (flags.preview) {
        const rendered = flags.structured
            ? renderTerminalStructuredPreview(content, {
                  format: flags.structured,
                  query: flags.query,
                  forceJs: flags.forceJs,
              })
            : flags.markdown
              ? renderTerminalMarkdownPreview(content, { forceJs: flags.forceJs, width: 100 })
              : renderTerminalFilePreview(String(result['path'] ?? path), content, {
                    lineLimit: flags.lineLimit,
                    forceJs: flags.forceJs,
                });
        ctx.println(
            terminalThemeRow(
                'Preview',
                `${rendered.renderer}${'queryApplied' in rendered && rendered.queryApplied ? ` · filtro ${flags.query}` : ''}${rendered.fallbackReason ? ` · fallback: ${rendered.fallbackReason}` : ''}${rendered.truncated ? ' · truncado' : ''}`,
                {
                    role:
                        rendered.renderer === 'bat' ||
                        rendered.renderer === 'glow' ||
                        rendered.renderer === 'jq' ||
                        rendered.renderer === 'yq'
                            ? 'success'
                            : 'muted',
                },
            ),
        );
        ctx.println(rendered.output);
    } else {
        ctx.println(pretty(content, 8000));
    }
    const io = ioSummary(result);
    if (io) ctx.println(io);
    ctx.println('');
}

/**
 * @param {CommandContext} ctx
 * @param {string[]} parts
 */
async function runSearch(ctx, parts) {
    const pattern = parts.shift();
    const path = parts.join(' ').trim() || '.';
    if (!pattern) {
        ctx.println(terminalThemeRow('Uso', '/fs search <pattern> [path]', { role: 'warn' }));
        return;
    }
    const result = await invokeFileTool(searchInFilesTool, {
        pattern,
        path,
        isRegex: false,
        caseSensitive: false,
        contextLines: 1,
    });
    if (!isSuccess(result)) {
        printFailure(ctx, result);
        return;
    }
    ctx.println('');
    ctx.println(terminalThemeRow('FS search', String(result['searchPath'] ?? path)));
    ctx.println(pretty(String(result['output'] ?? ''), 8000));
    ctx.println(terminalThemeRow('resultados', String(result['matchCount'] ?? 0), { role: 'muted' }));
    const io = ioSummary(result);
    if (io) ctx.println(io);
    ctx.println('');
}

/**
 * @param {CommandContext} ctx
 * @param {string[]} parts
 * @param {boolean} overwrite
 */
async function runWrite(ctx, parts, overwrite) {
    const path = parts.shift();
    const content = parts.join(' ');
    if (!path) {
        ctx.println(
            terminalThemeRow('Uso', `/fs ${overwrite ? 'write' : 'create'} <path> <content>`, { role: 'warn' }),
        );
        return;
    }
    const tool = overwrite ? writeFileContentTool : createFileTool;
    const result = await invokeFileTool(
        tool,
        overwrite ? { path, content, encoding: 'utf8' } : { path, content, createParentDirs: true, overwrite: false },
    );
    if (!isSuccess(result)) {
        printFailure(ctx, result);
        return;
    }
    ctx.println('');
    ctx.println(terminalThemeRow(`FS local ${overwrite ? 'escrito' : 'criado'}`, path, { role: 'success' }));
    ctx.println(terminalThemeRow('Bytes', String(result['bytesWritten'] ?? 0), { role: 'muted' }));
    const io = ioSummary(result);
    if (io) ctx.println(io);
    ctx.println('');
}

/**
 * Executa file-tools locais canônicas a partir do REPL.
 *
 * @param {CommandContext} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdFs(ctx, arg = '') {
    const [sub = 'list', ...parts] = arg.trim().split(/\s+/u).filter(Boolean);
    try {
        if (sub === 'list' || sub === 'ls' || sub === 'scan') await runList(ctx, parts);
        else if (sub === 'read' || sub === 'cat') await runRead(ctx, parts);
        else if (sub === 'preview') await runRead(ctx, parts, true);
        else if (sub === 'search' || sub === 'grep') await runSearch(ctx, parts);
        else if (sub === 'create') await runWrite(ctx, parts, false);
        else if (sub === 'write') await runWrite(ctx, parts, true);
        else {
            ctx.println(
                terminalThemeRow(
                    'Uso',
                    '/fs list [path] [--recursive] [--hidden] | read <path> [--preview] [--markdown|--json|--yaml] | preview <path> | search <pattern> [path] | create <path> <content> | write <path> <content>',
                    { role: 'warn' },
                ),
            );
        }
    } catch (e) {
        ctx.println('');
        ctx.println(terminalThemeRow('FS local', toError(e).message, { role: 'error' }));
        const guidance = buildFsDynamicGuidance();
        if (guidance.nextCommand) {
            ctx.println(terminalThemeRow('Próximo', guidance.nextCommand, { role: 'warn' }));
        }
        for (const line of buildFailureRecoveryLines(guidance)) {
            ctx.println(terminalThemeRow('Guia', line, { role: 'muted' }));
        }
        ctx.println('');
    }
}
