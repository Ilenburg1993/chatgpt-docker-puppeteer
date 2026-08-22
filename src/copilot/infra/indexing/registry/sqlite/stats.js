// @ts-check
/**
 * Health/statistics projection for the persistent index registry.
 *
 * @module copilot/infra/indexing/registry/sqlite/stats
 */

/** @typedef {ReturnType<typeof import('./statements.js').createIoIndexStatements>} IoIndexStatements */

/**
 * @param {{
 *     statements: IoIndexStatements;
 *     stats: import('./types.js').IoIndexRuntimeStats;
 *     schemaVersion: number;
 *     freshnessPolicy: Readonly<Record<string, unknown>>;
 * }} context
 */
export function createIoIndexStatsReader({ statements, stats, schemaVersion, freshnessPolicy }) {
    const { stmtCountFiles, stmtCountSymbols, stmtCountImports, stmtCountChunks, stmtLatest } = statements;
    return function getStats() {
        const files =
            /** @type {{ total?:unknown; fresh?:unknown; stale?:unknown; failed?:unknown; bytes?:unknown }} */ (
                stmtCountFiles.get() ?? {}
            );
        const symbols = /** @type {{ total?:unknown }} */ (stmtCountSymbols.get() ?? {});
        const imports = /** @type {{ total?:unknown }} */ (stmtCountImports.get() ?? {});
        const chunks = /** @type {{ total?:unknown }} */ (stmtCountChunks.get() ?? {});
        const latest = /** @type {{ latest?:unknown }} */ (stmtLatest.get() ?? {});
        const totalFiles = Number(files.total ?? 0);
        const latestIndexedAtMs = Number(latest.latest ?? 0) || null;
        return {
            enabled: true,
            available: totalFiles > 0,
            schemaVersion,
            ...stats,
            files: totalFiles,
            freshFiles: Number(files.fresh ?? 0),
            staleFiles: Number(files.stale ?? 0),
            failedFiles: Number(files.failed ?? 0),
            bytesIndexed: Number(files.bytes ?? 0),
            symbols: Number(symbols.total ?? 0),
            imports: Number(imports.total ?? 0),
            chunks: Number(chunks.total ?? 0),
            latestIndexedAtMs,
            freshness: latestIndexedAtMs ? 'fresh-or-aging' : 'empty',
            freshnessPolicy,
        };
    };
}
