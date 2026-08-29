// @ts-check
/** Pure FileContext bounded projection. @module copilot/infra/indexing/parser/context/window/service */

import { utf8ByteLength } from '#copilot/infra/internal/platform/buffer';

/** @typedef {import('../../foundation/index.js').FileContext} FileContext */
/** @typedef {'symbols'|'imports'|'exports'|'outline'|'topComments'} FileContextCollection */

const CURSOR_VERSION = 1;
const COLLECTIONS = /** @type {const} */ (['symbols', 'imports', 'exports', 'outline', 'topComments']);

/**
 * @param {FileContext} context
 * @param {{ maxItems?: number; maxBytes?: number; includeImports?: boolean; includeExports?: boolean; includeOutline?: boolean; includeTopComments?: boolean; cursor?: string; cursorRevision?: string }} [options]
 */
export function windowFileContext(context, options = {}) {
    const maxItems =
        Number.isFinite(options.maxItems) && Number(options.maxItems) > 0
            ? Math.min(5_000, Math.floor(Number(options.maxItems)))
            : 500;
    const maxBytes =
        Number.isFinite(options.maxBytes) && Number(options.maxBytes) > 0
            ? Math.min(4 * 1024 * 1024, Math.floor(Number(options.maxBytes)))
            : 512 * 1024;
    const included = {
        symbols: true,
        imports: options.includeImports !== false,
        exports: options.includeExports !== false,
        outline: options.includeOutline !== false,
        topComments: options.includeTopComments === true,
    };
    const profile = buildCursorProfile(included);
    const totalCounts = {
        symbols: context.symbols.symbols.length,
        imports: context.symbols.imports.length,
        exports: context.symbols.exports.length,
        outline: context.outline.length,
        topComments: context.topComments.length,
    };
    const startOffsets = decodeWindowCursor(options.cursor, {
        revision: options.cursorRevision ?? null,
        profile,
        totalCounts,
    });
    const nextOffsets = { ...startOffsets };
    let returnedContentBytes = 0;
    let returnedItemCount = 0;
    let itemLimitReached = false;
    let contentByteBudgetReached = false;

    /**
     * @template T
     * @param {FileContextCollection} collection
     * @param {readonly T[]} items
     * @param {boolean} collectionIncluded
     * @returns {T[]}
     */
    const take = (collection, items, collectionIncluded) => {
        if (!collectionIncluded) return [];
        /** @type {T[]} */
        const selected = [];
        const start = startOffsets[collection];
        for (let index = start; index < items.length; index += 1) {
            if (selected.length >= maxItems) {
                itemLimitReached = true;
                break;
            }
            const item = /** @type {T} */ (items[index]);
            const serialized = typeof item === 'string' ? item : JSON.stringify(item);
            const itemBytes = utf8ByteLength(serialized, 'parser context output item');
            if (returnedContentBytes + itemBytes > maxBytes) {
                if (returnedItemCount === 0) {
                    throw Object.assign(
                        new Error(
                            `File-context item ${collection}[${String(index)}] requires ${String(itemBytes)} bytes but maxBytes is ${String(maxBytes)}.`,
                        ),
                        {
                            code: 'ERR_FILE_CONTEXT_WINDOW_ITEM_TOO_LARGE',
                            collection,
                            index,
                            requiredBytes: itemBytes,
                            maxBytes,
                        },
                    );
                }
                contentByteBudgetReached = true;
                break;
            }
            selected.push(item);
            nextOffsets[collection] = index + 1;
            returnedContentBytes += itemBytes;
            returnedItemCount += 1;
        }
        if (nextOffsets[collection] < items.length && selected.length >= maxItems) itemLimitReached = true;
        return selected;
    };

    const symbols = take('symbols', context.symbols.symbols, included.symbols);
    const imports = take('imports', context.symbols.imports, included.imports);
    const exports = take('exports', context.symbols.exports, included.exports);
    const outline = take('outline', context.outline, included.outline);
    const topComments = take('topComments', context.topComments, included.topComments);
    const returnedCounts = {
        symbols: symbols.length,
        imports: imports.length,
        exports: exports.length,
        outline: outline.length,
        topComments: topComments.length,
    };
    const hasMore = COLLECTIONS.some(
        (collection) => included[collection] && nextOffsets[collection] < totalCounts[collection],
    );
    const nextCursor = hasMore
        ? encodeWindowCursor({
              revision: options.cursorRevision ?? null,
              profile,
              offsets: nextOffsets,
          })
        : null;
    const truncationReason = hasMore
        ? itemLimitReached && contentByteBudgetReached
            ? 'item-and-content-limits'
            : contentByteBudgetReached
              ? 'content-byte-budget'
              : 'item-limit'
        : null;

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
        cursor: options.cursor ?? null,
        nextCursor,
        hasMore,
        truncated: hasMore,
        truncationReason,
        cursorKind: 'file-context-collections-v1',
    };
}

/** @param {{symbols:boolean;imports:boolean;exports:boolean;outline:boolean;topComments:boolean}} included */
function buildCursorProfile(included) {
    return COLLECTIONS.map((collection) => (included[collection] ? '1' : '0')).join('');
}

/**
 * @param {string | undefined} cursor
 * @param {{revision:string|null;profile:string;totalCounts:Record<FileContextCollection,number>}} expected
 * @returns {Record<FileContextCollection,number>}
 */
function decodeWindowCursor(cursor, expected) {
    if (!cursor) return zeroOffsets();
    let parsed;
    try {
        parsed = JSON.parse(cursor);
    } catch {
        throw cursorError('File-context cursor is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw cursorError('File-context cursor must be an object.');
    }
    const row = /** @type {Record<string, unknown>} */ (parsed);
    if (row['v'] !== CURSOR_VERSION) throw cursorError('File-context cursor version is unsupported.');
    if (row['p'] !== expected.profile) throw cursorError('File-context cursor projection profile does not match this request.');
    if ((row['r'] ?? null) !== expected.revision) throw cursorError('File-context cursor revision does not match current file content.');
    const offsets = row['o'];
    if (!Array.isArray(offsets) || offsets.length !== COLLECTIONS.length) {
        throw cursorError('File-context cursor offsets are malformed.');
    }
    /** @type {Record<FileContextCollection,number>} */
    const normalized = zeroOffsets();
    for (let index = 0; index < COLLECTIONS.length; index += 1) {
        const collection = /** @type {FileContextCollection} */ (COLLECTIONS[index]);
        const value = Number(offsets[index]);
        if (!Number.isSafeInteger(value) || value < 0 || value > expected.totalCounts[collection]) {
            throw cursorError(`File-context cursor offset is invalid for ${collection}.`);
        }
        normalized[collection] = value;
    }
    return normalized;
}

/** @param {{revision:string|null;profile:string;offsets:Record<FileContextCollection,number>}} value */
function encodeWindowCursor(value) {
    return JSON.stringify({
        v: CURSOR_VERSION,
        r: value.revision,
        p: value.profile,
        o: COLLECTIONS.map((collection) => value.offsets[collection]),
    });
}

/** @returns {Record<FileContextCollection,number>} */
function zeroOffsets() {
    return { symbols: 0, imports: 0, exports: 0, outline: 0, topComments: 0 };
}

/** @param {string} message */
function cursorError(message) {
    return Object.assign(new Error(message), { code: 'ERR_FILE_CONTEXT_WINDOW_CURSOR' });
}
