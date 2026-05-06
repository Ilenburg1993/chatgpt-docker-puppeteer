// @ts-check
/**
 * Scanner canônico de diretórios para I/O local.
 *
 * Mantém listagem e scan em uma única superfície observável, sem indexação persistente. O índice L2/FTS deve consumir
 * esta engine depois, em vez de reimplementar traversal próprio.
 *
 * @module copilot/infra/io-scanner
 */

import { lstat, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { buildIoMeta, createIoTraceId } from '../core/io-contracts.js';
import { nowIoMs, publishIoOperation } from './io-observability.js';

/**
 * @typedef {object} IoScanEntry
 * @property {string} name
 * @property {'file' | 'directory' | 'symlink' | 'other'} type
 * @property {string} path
 * @property {string} absolutePath
 * @property {number} [size]
 * @property {IoScanEntry[]} [children]
 */

/**
 * @param {string} name
 * @param {string | undefined} filter
 * @returns {boolean}
 */
function matchesFilter(name, filter) {
    if (!filter) return true;
    if (filter.startsWith('*.')) return name.endsWith(filter.slice(1));
    return name === filter;
}

/**
 * @param {import('node:fs').Stats} stats
 * @returns {'file' | 'directory' | 'symlink' | 'other'}
 */
function classifyStats(stats) {
    if (stats.isFile()) return 'file';
    if (stats.isDirectory()) return 'directory';
    if (stats.isSymbolicLink()) return 'symlink';
    return 'other';
}

/**
 * Escaneia diretório com metadata canônica e limite de profundidade.
 *
 * @param {string} rootPath
 * @param {{
 *     workspaceRoot?: string;
 *     recursive?: boolean;
 *     depth?: number;
 *     showHidden?: boolean;
 *     filter?: string;
 *     traceId?: string;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     entries: IoScanEntry[];
 *     scannedEntries: number;
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function scanDirectory(rootPath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const recursive = Boolean(options.recursive);
    const maxDepth = Math.max(1, options.depth ?? 3);
    const showHidden = Boolean(options.showHidden);
    let scannedEntries = 0;

    /**
     * @param {string} dir
     * @param {number} currentDepth
     * @returns {Promise<IoScanEntry[]>}
     */
    async function scan(dir, currentDepth) {
        const names = await readdir(dir);
        names.sort((a, b) => a.localeCompare(b));
        /** @type {IoScanEntry[]} */
        const entries = [];

        for (const name of names) {
            if (!showHidden && name.startsWith('.')) continue;
            const absolutePath = join(dir, name);
            let stats;
            try {
                stats = await lstat(absolutePath);
            } catch {
                continue;
            }
            const type = classifyStats(stats);
            const isDirectory = type === 'directory';
            const includeEntry = matchesFilter(name, options.filter) || isDirectory;
            if (!includeEntry) continue;

            const entry = /** @type {IoScanEntry} */ ({
                name,
                type,
                path: options.workspaceRoot ? relative(options.workspaceRoot, absolutePath) : absolutePath,
                absolutePath,
            });
            if (type === 'file') entry.size = stats.size;
            scannedEntries += 1;
            if (isDirectory && recursive && currentDepth < maxDepth) {
                entry.children = await scan(absolutePath, currentDepth + 1);
            }
            entries.push(entry);
        }
        return entries;
    }

    try {
        const rootStats = await lstat(rootPath);
        if (!rootStats.isDirectory()) {
            throw new Error('Não é um diretório.');
        }
        const entries = await scan(rootPath, 1);
        const io = buildIoMeta({
            operation: 'scan',
            target: rootPath,
            targetKind: 'directory',
            engine: 'io-scanner.fs.readdir',
            durationMs: Math.max(0, Math.round(nowIoMs() - startedAt)),
            traceId,
            advisoryLimits: {
                recursive,
                depth: maxDepth,
                showHidden,
                scannedEntries,
                limitMode: 'informative',
            },
        });
        publishIoOperation(io, { success: true });
        return { path: rootPath, entries, scannedEntries, io };
    } catch (error) {
        const io = buildIoMeta({
            operation: 'scan',
            target: rootPath,
            targetKind: 'directory',
            engine: 'io-scanner.fs.readdir',
            durationMs: Math.max(0, Math.round(nowIoMs() - startedAt)),
            traceId,
        });
        publishIoOperation(io, { success: false, error });
        throw error;
    }
}

export { basename as getIoScanBasename };
