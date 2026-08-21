// @ts-check
/**
 * Transactional writer for the persistent index registry.
 *
 * Owns row replacement, pruning, parser projection and explicit invalidation. It receives prepared statements and
 * policies from the store composition root; it does not own directory scanning or query semantics.
 *
 * @module copilot/infra/indexing/registry/sqlite/writer
 */

import { toError } from '#copilot/core';
import { BABEL_PARSER_POLICY_VERSION } from '#copilot/infra/internal/code-analysis';
import { parseFileSymbols } from '#copilot/infra/internal/indexing/parser/parse';
import { sha256 } from '#copilot/infra/internal/platform';
import { publishIoLifecycleEvent } from '#copilot/infra/internal/telemetry';
import { basename, extname } from 'node:path';
import { classifyContentKind, countLines, iterateLineChunks, SYMBOL_EXTENSIONS } from './content.js';
import { buildIndexPathTreeRange, normalizeIndexPath, normalizeRelativePath } from './path/index.js';

/** @typedef {ReturnType<typeof import('./statements.js').createIoIndexStatements>} IoIndexStatements */

/**
 * @param {{
 *     db: { transaction?: Function };
 *     statements: IoIndexStatements;
 *     stats: import('./types.js').IoIndexRuntimeStats;
 *     now: () => number;
 *     buildIndexMetadataJson: (filePath: string, metadata: Record<string, unknown> | undefined, fingerprint: Record<string, unknown>) => string;
 *     assertCurrentFileSnapshot: (filePath: string, snapshot: { sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number }, context: { action: string; attempt: number }) => Promise<void>;
 *     parserWorkerRuntime?: ReturnType<typeof import('../../parser/worker/index.js').createParserWorkerRuntime>;
 * }} context
 */
export function createIoIndexWriter({
    db,
    statements,
    stats,
    now,
    buildIndexMetadataJson,
    assertCurrentFileSnapshot,
    parserWorkerRuntime,
}) {
    const {
        stmtDeleteFile,
        stmtDeleteFts,
        stmtDeleteSymbols,
        stmtDeleteImports,
        stmtDeleteChunks,
        stmtUpsertFile,
        stmtInsertFts,
        stmtInsertSymbol,
        stmtInsertImport,
        stmtInsertChunk,
        stmtListIndexedUnderPathFiltered,
    } = statements;

    /** @param {string} filePath */
    function clearFileRows(filePath) {
        const range = buildIndexPathTreeRange(filePath);
        const params = [range.exact, range.descendantStart, range.descendantEnd];
        stmtDeleteFts.run(...params);
        stmtDeleteChunks.run(...params);
        stmtDeleteSymbols.run(...params);
        stmtDeleteImports.run(...params);
        stmtDeleteFile.run(...params);
    }

    /** @param {string} rootPath @param {Set<string>} currentFilePaths @param {readonly string[]} extensions */
    function pruneMissingRows(rootPath, currentFilePaths, extensions) {
        const normalizedRoot = normalizeIndexPath(rootPath);
        const normalizedExtensions = extensions.map((extension) => String(extension).toLowerCase());
        const extensionJson = JSON.stringify(normalizedExtensions);
        const range = buildIndexPathTreeRange(normalizedRoot);
        const rows = /** @type {{ filePath: string; extension: string }[]} */ (
            stmtListIndexedUnderPathFiltered.all(
                range.exact,
                range.descendantStart,
                range.descendantEnd,
                extensionJson,
                extensionJson,
            )
        );
        let pruned = 0;
        const prune = () => {
            for (const row of rows) {
                if (currentFilePaths.has(row.filePath)) continue;
                clearFileRows(row.filePath);
                pruned += 1;
            }
        };
        if (typeof db.transaction === 'function') db.transaction(prune)();
        else prune();
        return pruned;
    }

    /**
     * @param {{ filePath: string; workspaceRoot: string; content: string; sizeBytes: number; mtimeMs: number; ctimeMs?: number | null; dev?: number | null; ino?: number | null; metadata?: Record<string, unknown> }} input
     * @param {{ confirmCurrent?: boolean; attempt?: number; signal?: AbortSignal; parsedSymbols?: import('#copilot/infra/internal/indexing/parser').FileSymbols }} [internal]
     */
    async function indexTextFile(input, internal = {}) {
        internal.signal?.throwIfAborted();
        const filePath = normalizeIndexPath(input.filePath);
        const workspaceRoot = normalizeIndexPath(input.workspaceRoot);
        const relativePath = normalizeRelativePath(workspaceRoot, filePath);
        const extension = extname(filePath).toLowerCase();
        const contentHash = sha256(input.content);
        const indexedAtMs = now();

        let symbols = /** @type {import('#copilot/infra/internal/indexing/parser').FileSymbols | null} */ (
            internal.parsedSymbols ?? null
        );
        if (
            SYMBOL_EXTENSIONS.has(extension) &&
            symbols &&
            symbols.parserPolicyVersion !== BABEL_PARSER_POLICY_VERSION
        ) {
            stats.parsedSymbolPolicyRejects += 1;
            symbols = null;
        }
        let parseError = symbols?.parseError ?? /** @type {string | null} */ (null);
        if (SYMBOL_EXTENSIONS.has(extension) && !symbols) {
            try {
                symbols = await parseFileSymbols(filePath, input.content, {
                    ...(internal.signal ? { signal: internal.signal } : {}),
                    ...(parserWorkerRuntime ? { workerRuntime: parserWorkerRuntime } : {}),
                });
                parseError = symbols.parseError;
            } catch (error) {
                internal.signal?.throwIfAborted();
                parseError = toError(error).message;
            }
        }

        internal.signal?.throwIfAborted();
        if (internal.confirmCurrent !== false && input.ctimeMs != null && input.dev != null && input.ino != null) {
            await assertCurrentFileSnapshot(
                filePath,
                {
                    sizeBytes: input.sizeBytes,
                    mtimeMs: input.mtimeMs,
                    ctimeMs: input.ctimeMs,
                    dev: input.dev,
                    ino: input.ino,
                },
                { action: 'index', attempt: internal.attempt ?? 1 },
            );
        }

        internal.signal?.throwIfAborted();
        const commit = () => {
            clearFileRows(filePath);
            const fileSymbols = symbols?.symbols ?? [];
            const fileImports = symbols?.imports ?? [];
            stmtUpsertFile.run({
                filePath,
                workspaceRoot,
                relativePath,
                fileName: basename(filePath),
                extension,
                contentKind: classifyContentKind(filePath),
                sizeBytes: input.sizeBytes,
                mtimeMs: input.mtimeMs,
                ctimeMs: input.ctimeMs ?? null,
                dev: input.dev ?? null,
                ino: input.ino ?? null,
                contentHash,
                lineCount: countLines(input.content),
                symbolCount: fileSymbols.length,
                importCount: fileImports.length,
                status: parseError ? 'failed' : 'fresh',
                parseError,
                indexedAtMs,
                refreshedAtMs: indexedAtMs,
                metadataJson: buildIndexMetadataJson(filePath, input.metadata, {
                    mtimeMs: input.mtimeMs,
                    ctimeMs: input.ctimeMs ?? null,
                    dev: input.dev ?? null,
                    ino: input.ino ?? null,
                    sizeBytes: input.sizeBytes,
                    contentHash,
                }),
            });
            for (const chunk of iterateLineChunks(input.content)) {
                const inserted = stmtInsertChunk.run(
                    filePath,
                    chunk.index,
                    chunk.startLine,
                    chunk.endLine,
                    chunk.content,
                    chunk.hash,
                    indexedAtMs,
                );
                stmtInsertFts.run(Number(inserted.lastInsertRowid), relativePath, chunk.content);
            }
            for (const symbol of fileSymbols) {
                stmtInsertSymbol.run(
                    filePath,
                    symbol.name,
                    symbol.kind,
                    symbol.exported ? 1 : 0,
                    symbol.line,
                    symbol.docComment ?? null,
                );
            }
            for (const importEntry of fileImports) {
                stmtInsertImport.run(
                    filePath,
                    importEntry.source,
                    JSON.stringify(importEntry.specifiers ?? []),
                    importEntry.isDynamic ? 1 : 0,
                    importEntry.line,
                );
            }
        };
        if (typeof db.transaction === 'function') db.transaction(commit)();
        else commit();

        stats.indexed += 1;
        publishIoLifecycleEvent('index', 'file.indexed', {
            filePath,
            workspaceRoot,
            relativePath,
            symbolCount: symbols?.symbols.length ?? 0,
            importCount: symbols?.imports.length ?? 0,
            parseError,
        });
        return {
            filePath,
            relativePath,
            contentHash,
            symbolCount: symbols?.symbols.length ?? 0,
            importCount: symbols?.imports.length ?? 0,
            parseError,
        };
    }

    /** @param {string} filePath */
    function invalidatePath(filePath) {
        try {
            clearFileRows(normalizeIndexPath(filePath));
            stats.invalidations += 1;
            return true;
        } catch {
            stats.errors += 1;
            return false;
        }
    }

    return Object.freeze({ clearFileRows, indexTextFile, invalidatePath, pruneMissingRows });
}
