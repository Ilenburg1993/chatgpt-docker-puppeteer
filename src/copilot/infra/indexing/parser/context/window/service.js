// @ts-check
/** Pure FileContext bounded projection. @module copilot/infra/indexing/parser/context/window/service */

import { utf8ByteLength } from '#copilot/infra/internal/platform/buffer';

/** @typedef {import('../../foundation/index.js').FileContext} FileContext */

/** @param {FileContext} context @param {{ maxItems?: number; maxBytes?: number; includeImports?: boolean; includeExports?: boolean; includeOutline?: boolean; includeTopComments?: boolean }} [options] */
export function windowFileContext(context, options = {}) {
    const maxItems =
        Number.isFinite(options.maxItems) && Number(options.maxItems) > 0
            ? Math.min(5_000, Math.floor(Number(options.maxItems)))
            : 500;
    const maxBytes =
        Number.isFinite(options.maxBytes) && Number(options.maxBytes) > 0
            ? Math.min(4 * 1024 * 1024, Math.floor(Number(options.maxBytes)))
            : 512 * 1024;
    let returnedContentBytes = 0;
    /** @template T @param {readonly T[]} items @param {boolean} included @returns {T[]} */
    const take = (items, included) => {
        if (!included) return [];
        /** @type {T[]} */ const selected = [];
        for (const item of items) {
            if (selected.length >= maxItems) break;
            const serialized = typeof item === 'string' ? item : JSON.stringify(item);
            const itemBytes = utf8ByteLength(serialized, 'parser context output item');
            if (returnedContentBytes + itemBytes > maxBytes) break;
            selected.push(item);
            returnedContentBytes += itemBytes;
        }
        return selected;
    };
    const included = {
        symbols: true,
        imports: options.includeImports !== false,
        exports: options.includeExports !== false,
        outline: options.includeOutline !== false,
        topComments: options.includeTopComments === true,
    };
    const totalCounts = {
        symbols: context.symbols.symbols.length,
        imports: context.symbols.imports.length,
        exports: context.symbols.exports.length,
        outline: context.outline.length,
        topComments: context.topComments.length,
    };
    const symbols = take(context.symbols.symbols, included.symbols);
    const imports = take(context.symbols.imports, included.imports);
    const exports = take(context.symbols.exports, included.exports);
    const outline = take(context.outline, included.outline);
    const topComments = take(context.topComments, included.topComments);
    const returnedCounts = {
        symbols: symbols.length,
        imports: imports.length,
        exports: exports.length,
        outline: outline.length,
        topComments: topComments.length,
    };
    return {
        symbols,
        imports,
        exports,
        outline,
        topComments,
        maxItems,
        maxBytes,
        returnedContentBytes,
        totalCounts,
        returnedCounts,
        truncated: /** @type {(keyof typeof totalCounts)[]} */ (Object.keys(totalCounts)).some(
            (key) => included[key] && totalCounts[key] > returnedCounts[key],
        ),
    };
}
