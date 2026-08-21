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
        const files = stmtCountFiles.get() ?? {};
        const symbols = stmtCountSymbols.get() ?? {};
        const imports = stmtCountImports.get() ?? {};
        const chunks = stmtCountChunks.get() ?? {};
        const latest = stmtLatest.get() ?? {};
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
