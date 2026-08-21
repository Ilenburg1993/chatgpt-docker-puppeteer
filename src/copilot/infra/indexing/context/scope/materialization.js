// @ts-check
/** Symbol materialization stage for a selected scope working set. */
import { parseAndCacheSymbols } from '#copilot/infra/internal/indexing/parser/cache';
import { isSymbolParseTarget, recordScopeFailure, setScopeSymbols } from './state.js';

/** @typedef {import('./types.js')._InternalScope} _InternalScope */

/**
 * @param {_InternalScope} scope
 * @param {readonly string[]} resolvedPaths
 * @param {ReadonlyMap<string, import('#copilot/infra/internal/filesystem/read').TextFileSnapshot>} warmSnapshots
 * @param {{ parseSymbols: boolean; silent: boolean; signal: AbortSignal; parserCacheRuntime?: ReturnType<typeof import('../../parser/cache/runtime/index.js').createParserCacheRuntime> }} options
 */
export async function materializeScopeSymbols(scope, resolvedPaths, warmSnapshots, options) {
    if (!options.parseSymbols || resolvedPaths.length === 0) return;
    const parseTargets = resolvedPaths.filter(isSymbolParseTarget);
    let idx = 0;
    const parseWorker = async () => {
        while (idx < parseTargets.length) {
            if (options.signal.aborted) return;
            const filePath = parseTargets[idx++];
            if (!filePath) continue;
            try {
                const snapshot = warmSnapshots.get(filePath);
                const symbols = await parseAndCacheSymbols(filePath, {
                    ...(snapshot ? { snapshot } : {}),
                    signal: options.signal,
                    ...(options.parserCacheRuntime ? { parserCacheRuntime: options.parserCacheRuntime } : {}),
                });
                setScopeSymbols(scope, filePath, symbols);
            } catch (error) {
                if (!options.silent) throw error;
                scope.failed += 1;
                recordScopeFailure(scope, error, 'parse', 'análise de símbolos falhou durante aquecimento');
            }
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(scope.refreshConcurrency, parseTargets.length || 1) }, () => parseWorker()),
    );
}
