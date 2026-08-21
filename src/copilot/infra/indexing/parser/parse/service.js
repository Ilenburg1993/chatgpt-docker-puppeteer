// @ts-check
/**
 * Core parser execution for JS/TS/JSON/Markdown.
 *
 * This module owns parsing only. Worker lifecycle, caches, context projection and health live in sibling modules and
 * are composed by `index.js`.
 *
 * @module copilot/infra/indexing/parser/parse/service
 */

import {
    BABEL_PARSER_POLICY_VERSION,
    extractBabelFileSymbols,
    extractJsonSchema,
    extractMarkdownOutlineWithLines,
    formatBabelParserError,
    resolveBabelParserOptions,
} from '#copilot/infra/internal/code-analysis';
import { countPhysicalTextLines, truncateUtf8String, utf8ByteLength } from '#copilot/infra/internal/platform';
import * as nodePath from 'node:path';
import { performance } from 'node:perf_hooks';
import {
    classifyParserExtension,
    MAX_PARSE_BYTES,
    MAX_PARSE_DURATION_MS,
    MAX_PARSE_LINE_GUARD,
    PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES,
    PARSER_WORKER_ENABLED,
    parserRuntimeStats,
} from '../foundation/index.js';
import { getParserWorkerRuntimeErrorCode, parseSymbolsInWorker } from '../worker/index.js';

/** @typedef {import('../foundation/index.js').FileSymbols} FileSymbols */

/** @type {typeof import('@babel/parser').parse | null | 'unavailable'} */
let babelParse = null;

/** @returns {Promise<typeof import('@babel/parser').parse | null>} */
async function getBabelParse() {
    if (babelParse !== null) return babelParse === 'unavailable' ? null : babelParse;
    try {
        const module = await import('@babel/parser');
        babelParse = module.parse ?? null;
        if (!babelParse) babelParse = 'unavailable';
    } catch {
        babelParse = 'unavailable';
    }
    return babelParse === 'unavailable' ? null : babelParse;
}

/** @param {string} code @param {import('@babel/parser').ParserOptions} parserOptions */
function tryBabelParse(code, parserOptions) {
    const parser = babelParse;
    if (!parser || parser === 'unavailable') return { ast: null, parseError: 'babel parser unavailable' };
    try {
        return { ast: parser(code, parserOptions), parseError: null };
    } catch (error) {
        return { ast: null, parseError: formatBabelParserError(error) };
    }
}

/**
 * Parseia um arquivo JS/TS e extrai símbolos, imports e exports.
 *
 * @param {string} filePath
 * @param {string} content
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<FileSymbols>}
 */
export async function parseFileSymbols(filePath, content, options = {}) {
    options.signal?.throwIfAborted();
    const ext = nodePath.extname(filePath).toLowerCase();
    const lang = classifyParserExtension(ext);
    const parserOptions =
        lang === 'js' || lang === 'ts' ? resolveBabelParserOptions(filePath, lang, { profile: 'symbols' }) : null;
    const bytes = utf8ByteLength(content, 'parser content');
    const truncated = bytes > MAX_PARSE_BYTES;
    const source = truncated ? truncateUtf8String(content, MAX_PARSE_BYTES).text : content;
    const parsedBytes = truncated ? utf8ByteLength(source, 'parser truncated content') : bytes;
    const lines = countPhysicalTextLines(content);

    /** @type {FileSymbols} */
    const base = {
        filePath,
        ext,
        parserPolicyVersion: BABEL_PARSER_POLICY_VERSION,
        symbols: [],
        imports: [],
        exports: [],
        parseError: null,
        truncated,
        lines,
        bytes,
        parsedBytes,
        parseDurationMs: 0,
    };

    if (lang === 'js' || lang === 'ts') {
        if (!parserOptions) throw new Error(`Babel parser options unavailable for ${lang}: ${filePath}`);
        if (lines > MAX_PARSE_LINE_GUARD) {
            parserRuntimeStats.skippedByLineGuard += 1;
            base.parseError = `parser skipped: line guard exceeded (${lines} > ${MAX_PARSE_LINE_GUARD})`;
            return base;
        }

        if (PARSER_WORKER_ENABLED) {
            try {
                const workerResult = await parseSymbolsInWorker(
                    {
                        source,
                        parserOptions,
                        maxParseDurationMs: MAX_PARSE_DURATION_MS,
                    },
                    options.signal,
                );
                options.signal?.throwIfAborted();
                base.parseDurationMs = Number(workerResult.parseDurationMs ?? 0);
                parserRuntimeStats.lastParseDurationMs = base.parseDurationMs;
                if (
                    typeof workerResult.parseError === 'string' &&
                    workerResult.parseError.includes('budget exceeded')
                ) {
                    parserRuntimeStats.budgetExceeded += 1;
                }
                base.parseError = workerResult.parseError;
                base.symbols = workerResult.symbols;
                base.imports = workerResult.imports;
                base.exports = workerResult.exports;
                return base;
            } catch (error) {
                options.signal?.throwIfAborted();
                const errorCode = getParserWorkerRuntimeErrorCode(error);
                if (
                    errorCode === 'ERR_IO_PARSER_WORKER_QUEUE_FULL' ||
                    errorCode === 'ERR_IO_PARSER_WORKER_QUEUE_TIMEOUT' ||
                    errorCode === 'ERR_IO_PARSER_WORKER_TIMEOUT'
                ) {
                    if (parsedBytes > PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES) {
                        base.parseError = error instanceof Error ? error.message : 'parser worker overloaded';
                        return base;
                    }
                }
                parserRuntimeStats.workerFallbacks += 1;
            }
        }

        await getBabelParse();
        options.signal?.throwIfAborted();
        const parseStart = performance.now();
        const parsed = tryBabelParse(source, parserOptions);
        options.signal?.throwIfAborted();
        const parseDurationMs = Math.max(0, Math.round(performance.now() - parseStart));
        base.parseDurationMs = parseDurationMs;
        parserRuntimeStats.lastParseDurationMs = parseDurationMs;
        if (!parsed.ast) {
            base.parseError = parsed.parseError ?? 'babel parse returned null';
            return base;
        }
        if (parseDurationMs > MAX_PARSE_DURATION_MS) {
            parserRuntimeStats.budgetExceeded += 1;
            base.parseError = `parser budget exceeded (${parseDurationMs}ms > ${MAX_PARSE_DURATION_MS}ms)`;
        }
        if (parsed.ast.errors?.length) {
            const astError = parsed.ast.errors.map((error) => formatBabelParserError(error)).join('; ');
            base.parseError = base.parseError ? `${base.parseError}; ${astError}` : astError;
        }
        const extracted = extractBabelFileSymbols(parsed.ast);
        base.symbols = extracted.symbols;
        base.imports = extracted.imports;
        base.exports = extracted.exports;
        return base;
    }

    if (lang === 'json') return { ...base, ...extractJsonSchema(source) };
    if (lang === 'markdown') {
        const outline = extractMarkdownOutlineWithLines(source);
        base.symbols = outline.map(({ heading, line }) => ({
            kind: /** @type {'variable'} */ ('variable'),
            name: heading,
            exported: false,
            line,
            docComment: null,
        }));
    }
    return base;
}
