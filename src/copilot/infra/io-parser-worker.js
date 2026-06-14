// @ts-check
/**
 * Worker de parsing JS/TS para reduzir bloqueio do event loop principal.
 *
 * @module copilot/infra/io-parser-worker
 */

import { parse as babelParse } from '@babel/parser';
import { performance } from 'node:perf_hooks';
import { parentPort } from 'node:worker_threads';
import { extractBabelFileSymbols } from './parse/babel-symbols.js';
import { formatBabelParserError } from './parse/babel-policy.js';

const errorCtor = /** @type {{ isError?: (value: unknown) => boolean }} */ (Error);
const isError =
    typeof errorCtor.isError === 'function'
        ? /** @type {(value: unknown) => boolean} */ (errorCtor.isError.bind(Error))
        : /** @type {(value: unknown) => boolean} */ ((value) => value instanceof Error);

/**
 * @param {{ source: string; parserOptions: Record<string, unknown>; maxParseDurationMs: number }} payload
 * @returns {{
 *     symbols: any[];
 *     imports: any[];
 *     exports: string[];
 *     parseError: string | null;
 *     parseDurationMs: number;
 * }}
 */
function parseSymbols(payload) {
    const parseStart = performance.now();
    let ast;
    let thrownError = null;

    try {
        ast = babelParse(payload.source, /** @type {any} */ (payload.parserOptions));
    } catch (error) {
        ast = null;
        thrownError = formatBabelParserError(error);
    }

    const parseDurationMs = Math.max(0, Math.round(performance.now() - parseStart));

    if (!ast) {
        return {
            symbols: [],
            imports: [],
            exports: [],
            parseError: thrownError ?? 'babel parse returned null',
            parseDurationMs,
        };
    }

    const extracted = extractBabelFileSymbols(ast);
    const budgetError =
        parseDurationMs > payload.maxParseDurationMs
            ? `parser budget exceeded (${parseDurationMs}ms > ${payload.maxParseDurationMs}ms)`
            : null;
    const astError =
        Array.isArray(ast.errors) && ast.errors.length > 0
            ? ast.errors.map((/** @type {any} */ error) => formatBabelParserError(error)).join('; ')
            : null;
    const parseError = budgetError && astError ? `${budgetError}; ${astError}` : (budgetError ?? astError);

    return {
        symbols: extracted.symbols,
        imports: extracted.imports,
        exports: extracted.exports,
        parseError,
        parseDurationMs,
    };
}

const port = parentPort;

if (!port) {
    throw new Error('io-parser-worker requires parentPort');
}

port.on('message', (message) => {
    const id = Number(message?.id ?? 0);
    const payload = /** @type {{ source: string; parserOptions: Record<string, unknown>; maxParseDurationMs: number }} */ (
        message?.payload
    );

    try {
        const result = parseSymbols(payload);
        port.postMessage({ id, ok: true, result });
    } catch (error) {
        const msg = isError(error) ? /** @type {Error} */ (error).message : String(error ?? 'unknown-worker-error');
        port.postMessage({ id, ok: false, error: msg });
    }
});
