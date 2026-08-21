// @ts-check
/** Staging inode, mode preservation and directory-sync support for atomic publish. */
import { emitMutationPhase } from '#copilot/infra/internal/filesystem/transaction';
import {
    assertSuccessfulSync,
    syncFileHandleBestEffort,
    syncParentDirectoryBestEffort,
} from '#copilot/infra/internal/platform/node/filesystem';
import * as fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
/** @typedef {import('./types.js').AtomicWriteOptions} AtomicWriteOptions */

/**
 * Resolve o modo do inode temporário sem transformar uma escrita de conteúdo em uma mutação implícita de permissões. Em
 * replacement, o modo POSIX existente é preservado quando o caller não forneceu um override explícito.
 *
 * @param {string} filePath
 * @param {Pick<AtomicWriteOptions, 'mode' | 'exclusive'>} options
 * @returns {Promise<{ mode: number | null; source: 'explicit' | 'preserved-existing' | 'default' }>}
 */
export async function resolveAtomicWriteMode(filePath, options) {
    if (options.mode !== undefined) return { mode: options.mode, source: 'explicit' };
    if (options.exclusive) return { mode: null, source: 'default' };
    try {
        const info = await fs.stat(filePath);
        return { mode: info.mode & 0o777, source: 'preserved-existing' };
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return { mode: null, source: 'default' };
        throw error;
    }
}

/**
 * Escreve um inode novo por um único `FileHandle`. O modo final é aplicado antes do fsync, evitando o padrão antigo
 * `writeFile({ flush:true }) -> chmod`, no qual a última mutação de metadata acontecia depois da barreira de
 * durability. Se qualquer etapa anterior ao retorno falhar, o inode recém-criado é removido best-effort.
 *
 * @param {string} targetPath
 * @param {Buffer} payload Owned/private buffer; callers must not mutate it while this promise is pending.
 * @param {{ mode: number | null; source: 'explicit' | 'preserved-existing' | 'default' }} resolvedMode
 * @param {boolean} fileFlushRequested
 * @param {AtomicWriteOptions} options
 */
export async function writeNewFileThroughHandle(targetPath, payload, resolvedMode, fileFlushRequested, options) {
    /** @type {import('node:fs/promises').FileHandle | null} */
    let handle = null;
    let created = false;
    /** @type {number} */
    let tempWriteMs;
    let modeApplyMs = 0;
    /** @type {Awaited<ReturnType<typeof syncFileHandleBestEffort>> | null} */
    let fileSync = null;
    try {
        const writeStartedAt = performance.now();
        handle = await fs.open(targetPath, 'wx', resolvedMode.mode === null ? undefined : resolvedMode.mode);
        created = true;
        await handle.writeFile(payload);
        tempWriteMs = Math.max(0, performance.now() - writeStartedAt);

        // chmod after open intentionally defeats umask for explicit modes and exactly preserves replacement modes.
        if (resolvedMode.mode !== null) {
            const modeStartedAt = performance.now();
            await emitMutationPhase(options, 'before-mode-apply', {
                filePath: targetPath,
                effectiveMode: resolvedMode.mode,
                modeSource: resolvedMode.source,
            });
            await handle.chmod(resolvedMode.mode);
            modeApplyMs = Math.max(0, performance.now() - modeStartedAt);
            await emitMutationPhase(options, 'after-mode-apply', {
                filePath: targetPath,
                effectiveMode: resolvedMode.mode,
                modeSource: resolvedMode.source,
            });
        }

        if (fileFlushRequested) {
            await emitMutationPhase(options, 'before-file-sync', { filePath: targetPath });
            fileSync = await syncFileHandleBestEffort(handle);
            await emitMutationPhase(options, 'after-file-sync', { filePath: targetPath, ...fileSync });
            assertSuccessfulSync(fileSync, {
                code: 'EFILESYNC',
                message: `Falha ao sincronizar inode temporário da escrita atômica: ${targetPath}`,
            });
        }
        return {
            tempWriteMs,
            modeApplyMs,
            fileSync,
            fileSyncMs: Number(fileSync?.durationMs ?? 0),
        };
    } catch (error) {
        if (handle) {
            await handle.close().catch(() => undefined);
            handle = null;
        }
        if (created) await fs.unlink(targetPath).catch(() => undefined);
        throw error;
    } finally {
        if (handle) await handle.close().catch(() => undefined);
    }
}

/**
 * A replacement-only precondition is checked at the latest portable point immediately before rename. POSIX/Node does
 * not expose a portable atomic "rename only if destination currently exists", so arbitrary external unlink/rename can
 * still race in the tiny interval between this check and publish. Intra-process callers remain protected by the outer
 * resource lock; expectedHash additionally performs a content CAS immediately before publish.
 *
 * @param {string} filePath
 */
export async function assertReplacementTargetExists(filePath) {
    try {
        await fs.stat(filePath);
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code !== 'ENOENT') throw error;
        const missing = new Error(`Arquivo não encontrado: ${filePath}`);
        /** @type {{ code?: string; cause?: unknown }} */ (missing).code = 'ENOENT';
        /** @type {{ code?: string; cause?: unknown }} */ (missing).cause = error;
        throw missing;
    }
}

/**
 * @param {AtomicWriteOptions} options
 * @param {string} filePath
 */
export async function syncWriteDirectory(options, filePath) {
    await emitMutationPhase(options, 'before-destination-directory-sync', { filePath, target: filePath });
    const result = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(filePath);
    await emitMutationPhase(options, 'after-destination-directory-sync', { filePath, target: filePath, ...result });
    assertSuccessfulSync(result, {
        code: 'EDIRECTORYSYNC',
        message: `Falha ao sincronizar diretório da escrita atômica: ${filePath}`,
    });
    return result;
}
