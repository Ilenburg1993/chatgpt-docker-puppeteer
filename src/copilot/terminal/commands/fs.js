// @ts-check
/**
 * Comando canônico de FS local para o terminal LLM-B.
 *
 * Diferente de `/workspace`, que opera no workspace virtual da sessão SDK, `/fs` usa as file-tools locais
 * `src/copilot/tools/file/*` e portanto materializa leituras/escritas no filesystem real do workspace.
 *
 * @module copilot/terminal/commands/fs
 */

import { fileReadTools, fileWriteTools } from '#copilot/tools';
import { toError } from '../../core/error-handlers.js';
import { buildActivityAwareGuidance, buildFailureRecoveryLines } from '../auto-briefing.js';
import { readTerminalIoActivityProjection } from '../io-activity-events.js';

/**
 * @typedef {{ println: (text: string) => void }} CommandContext
 */

/**
 * @param {{ handler?: Function }} tool
 * @returns {Function}
 */
function getToolHandler(tool) {
    if (typeof tool.handler === 'function') return tool.handler;
    throw new TypeError('[terminal/fs] tool sem handler executável.');
}

/**
 * @param {import('#copilot/sdk/types').Tool[]} tools
 * @param {string} name
 * @returns {import('#copilot/sdk/types').Tool}
 */
function findTool(tools, name) {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new TypeError(`[terminal/fs] tool canônica ausente: ${name}`);
    return tool;
}

const listDirectoryTool = findTool(fileReadTools, 'list_directory');
const readFileContentTool = findTool(fileReadTools, 'read_file_content');
const searchInFilesTool = findTool(fileReadTools, 'search_in_files');
const createFileTool = findTool(fileWriteTools, 'create_file');
const writeFileContentTool = findTool(fileWriteTools, 'write_file_content');

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
 * @param {{ handler?: Function }} tool
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
    return `  \x1b[90mio=${operation ?? '-'} · engine=${engine ?? '-'}\x1b[0m`;
}

/**
 * @param {CommandContext} ctx
 * @param {Record<string, unknown>} result
 */
function printFailure({ println }, result) {
    println(`\n  \x1b[31m✗ FS local: ${String(result['error'] ?? 'operação falhou')}\x1b[0m`);
    const guidance = buildFsDynamicGuidance();
    if (guidance.nextCommand) {
        println(`  \x1b[33m→ ${guidance.nextCommand}\x1b[0m`);
    }
    for (const line of buildFailureRecoveryLines(guidance)) {
        println(`  \x1b[90m${line}\x1b[0m`);
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
    ctx.println(`\n  \x1b[36mFS local (${entries.length})\x1b[0m  \x1b[90m${String(result['path'] ?? path)}\x1b[0m`);
    for (const entry of entries.slice(0, 120)) {
        const item = entry && typeof entry === 'object' ? /** @type {Record<string, unknown>} */ (entry) : {};
        ctx.println(
            `  \x1b[33m${String(item['type'] ?? '?')}\x1b[0m  ${String(item['name'] ?? item['path'] ?? entry)}`,
        );
    }
    if (entries.length > 120) ctx.println(`  \x1b[90m… ${entries.length - 120} entradas omitidas\x1b[0m`);
    const io = ioSummary(result);
    if (io) ctx.println(io);
    ctx.println('');
}

/**
 * @param {CommandContext} ctx
 * @param {string[]} parts
 */
async function runRead(ctx, parts) {
    const path = parts.join(' ').trim();
    if (!path) {
        ctx.println('\x1b[33m  Uso: /fs read <path>\x1b[0m');
        return;
    }
    const result = await invokeFileTool(readFileContentTool, { path, encoding: 'utf8' });
    if (!isSuccess(result)) {
        printFailure(ctx, result);
        return;
    }
    ctx.println(`\n  \x1b[36m${String(result['path'] ?? path)}\x1b[0m  \x1b[90m(FS local)\x1b[0m`);
    ctx.println(pretty(String(result['content'] ?? ''), 8000));
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
        ctx.println('\x1b[33m  Uso: /fs search <pattern> [path]\x1b[0m');
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
    ctx.println(`\n  \x1b[36mFS search\x1b[0m  \x1b[90m${String(result['searchPath'] ?? path)}\x1b[0m`);
    ctx.println(pretty(String(result['output'] ?? ''), 8000));
    ctx.println(`  \x1b[90mmatches=${String(result['matchCount'] ?? 0)}\x1b[0m`);
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
        ctx.println(`\x1b[33m  Uso: /fs ${overwrite ? 'write' : 'create'} <path> <content>\x1b[0m`);
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
    ctx.println(`\n  \x1b[32m✓ FS local ${overwrite ? 'escrito' : 'criado'}:\x1b[0m \x1b[33m${path}\x1b[0m`);
    ctx.println(`  \x1b[90mbytes=${String(result['bytesWritten'] ?? 0)}\x1b[0m`);
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
        else if (sub === 'search' || sub === 'grep') await runSearch(ctx, parts);
        else if (sub === 'create') await runWrite(ctx, parts, false);
        else if (sub === 'write') await runWrite(ctx, parts, true);
        else {
            ctx.println(
                '\x1b[33m  Uso: /fs list [path] [--recursive] [--hidden] | read <path> | search <pattern> [path] | create <path> <content> | write <path> <content>\x1b[0m',
            );
        }
    } catch (e) {
        ctx.println(`\n  \x1b[31m✗ FS local: ${toError(e).message}\x1b[0m`);
        const guidance = buildFsDynamicGuidance();
        if (guidance.nextCommand) {
            ctx.println(`  \x1b[33m→ ${guidance.nextCommand}\x1b[0m`);
        }
        for (const line of buildFailureRecoveryLines(guidance)) {
            ctx.println(`  \x1b[90m${line}\x1b[0m`);
        }
        ctx.println('');
    }
}
