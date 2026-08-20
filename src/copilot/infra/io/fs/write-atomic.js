// @ts-check
/**
 * Escrita atômica baixa, sem locks, cache ou observabilidade.
 *
 * @module copilot/infra/io/fs/write-atomic
 */

import * as fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { assertExpectedSha256Digest } from '../../policy/preconditions.js';
import { toOwnedBuffer } from '../../shared/buffer.js';
import { preflightIoCapacity } from './capacity-preflight.js';
import {
    assertSuccessfulSync,
    normalizeIoDurability,
    shouldFlushFile,
    shouldSyncDirectory,
    syncFileHandleBestEffort,
    syncParentDirectoryBestEffort,
} from './durability.js';
import { emitMutationPhase } from './mutation-phase.js';
import { markMutationAppliedError } from './mutation-state.js';
import { readBinaryMutationSnapshot } from './snapshot.js';
import { prepareSiblingTempPath } from './temp-path.js';

/**
 * @typedef {{
 *     mode?: number;
 *     exclusive?: boolean;
 *     requireExists?: boolean;
 *     expectedHash?: string;
 *     durability?: import('./durability.js').IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 *     capacityPreflight?: typeof preflightIoCapacity;
 * }} AtomicWriteOptions
 *
 *
 * @typedef {{
 *     durability: import('./durability.js').IoDurabilityMode;
 *     tempPath: string | null;
 *     effectiveMode: number | null;
 *     modeSource: 'explicit' | 'preserved-existing' | 'default';
 *     fileFlushRequested: boolean;
 *     fileSync: Awaited<ReturnType<typeof syncFileHandleBestEffort>> | null;
 *     directorySync: Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> | null;
 *     capacityPreflight: Awaited<ReturnType<typeof preflightIoCapacity>>;
 *     phaseTimings: {
 *         tempPathMs: number;
 *         capacityPreflightMs: number;
 *         tempWriteMs: number;
 *         modeApplyMs: number;
 *         fileSyncMs: number;
 *         prePublishCheckMs: number;
 *         publishMs: number;
 *         directorySyncMs: number;
 *         totalMs: number;
 *     };
 * }} AtomicWriteResult
 */

/**
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {BufferEncoding} [encoding]
 * @returns {Buffer}
 */
export function toWriteBuffer(content, encoding = 'utf8') {
    return toOwnedBuffer(content, encoding);
}

/**
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {BufferEncoding} encoding
 * @returns {{ payload: Buffer; bytes: number }}
 */
export function normalizeWritePayload(filePath, content, encoding) {
    void filePath;
    const buf = toWriteBuffer(content, encoding);
    return {
        payload: buf,
        bytes: buf.byteLength,
    };
}

/**
 * Resolve o modo do inode temporário sem transformar uma escrita de conteúdo em uma mutação implícita de permissões. Em
 * replacement, o modo POSIX existente é preservado quando o caller não forneceu um override explícito.
 *
 * @param {string} filePath
 * @param {Pick<AtomicWriteOptions, 'mode' | 'exclusive'>} options
 * @returns {Promise<{ mode: number | null; source: 'explicit' | 'preserved-existing' | 'default' }>}
 */
async function resolveAtomicWriteMode(filePath, options) {
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
async function writeNewFileThroughHandle(targetPath, payload, resolvedMode, fileFlushRequested, options) {
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
async function assertReplacementTargetExists(filePath) {
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
 * Safe low-level entrypoint. Binary inputs are copied once so caller mutation cannot alter an in-flight staged write.
 * Callers that already own a private immutable Buffer can use `writeAtomicOwnedBufferUnlocked` to avoid a second copy.
 *
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} payload
 * @param {AtomicWriteOptions} [options]
 * @returns {Promise<AtomicWriteResult>}
 */
export async function writeAtomicFileUnlocked(filePath, payload, options = {}) {
    return writeAtomicOwnedBufferUnlocked(filePath, toOwnedBuffer(payload), options);
}

/**
 * Escrita atômica sem lock para Buffer já-owned. O caller deve segurar o lock correto quando necessário e não pode
 * expor/mutar `writePayload` até a conclusão. Esta variante existe para evitar a cópia duplicada do wrapper canônico,
 * que já materializa um Buffer privado antes de adquirir o lock.
 *
 * @param {string} filePath
 * @param {Buffer} writePayload
 * @param {AtomicWriteOptions} [options]
 * @returns {Promise<AtomicWriteResult>}
 */
export async function writeAtomicOwnedBufferUnlocked(filePath, writePayload, options = {}) {
    if (!Buffer.isBuffer(writePayload)) {
        throw new TypeError('writeAtomicOwnedBufferUnlocked requer Buffer privado/owned.');
    }
    const totalStartedAt = performance.now();
    const tempPathStartedAt = performance.now();
    const tmpPath = await prepareSiblingTempPath(filePath, 'write');
    const durability = normalizeIoDurability(options.durability);
    const fileFlushRequested = shouldFlushFile(durability);
    const phaseTimings = {
        tempPathMs: Math.max(0, performance.now() - tempPathStartedAt),
        capacityPreflightMs: 0,
        tempWriteMs: 0,
        modeApplyMs: 0,
        fileSyncMs: 0,
        prePublishCheckMs: 0,
        publishMs: 0,
        directorySyncMs: 0,
        totalMs: 0,
    };
    const capacityStartedAt = performance.now();
    const capacityPreflight = await (options.capacityPreflight ?? preflightIoCapacity)(
        filePath,
        writePayload.byteLength,
    );
    phaseTimings.capacityPreflightMs = Math.max(0, performance.now() - capacityStartedAt);
    const resolvedMode = await resolveAtomicWriteMode(filePath, options);
    /** @type {Awaited<ReturnType<typeof syncFileHandleBestEffort>> | null} */
    let fileSync = null;
    /** @type {Awaited<ReturnType<typeof syncParentDirectoryBestEffort>> | null} */
    let directorySync = null;
    let tmpCreated = false;
    let published = false;
    const finish = () => {
        phaseTimings.fileSyncMs = Number(fileSync?.durationMs ?? phaseTimings.fileSyncMs);
        phaseTimings.directorySyncMs = Number(directorySync?.durationMs ?? phaseTimings.directorySyncMs);
        phaseTimings.totalMs = Math.max(0, performance.now() - totalStartedAt);
        return { ...phaseTimings };
    };
    try {
        if (options.exclusive && typeof fs.link !== 'function') {
            const staged = await writeNewFileThroughHandle(
                filePath,
                writePayload,
                resolvedMode,
                fileFlushRequested,
                options,
            );
            published = true;
            phaseTimings.tempWriteMs = staged.tempWriteMs;
            phaseTimings.modeApplyMs = staged.modeApplyMs;
            fileSync = staged.fileSync;
            phaseTimings.fileSyncMs = staged.fileSyncMs;
            if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
            return {
                durability,
                tempPath: null,
                effectiveMode: resolvedMode.mode,
                modeSource: resolvedMode.source,
                fileFlushRequested,
                fileSync,
                directorySync,
                capacityPreflight,
                phaseTimings: finish(),
            };
        }

        const staged = await writeNewFileThroughHandle(
            tmpPath,
            writePayload,
            resolvedMode,
            fileFlushRequested,
            options,
        );
        phaseTimings.tempWriteMs = staged.tempWriteMs;
        phaseTimings.modeApplyMs = staged.modeApplyMs;
        fileSync = staged.fileSync;
        phaseTimings.fileSyncMs = staged.fileSyncMs;
        tmpCreated = true;
        await emitMutationPhase(options, 'temp-written', {
            filePath,
            tmpPath,
            bytes: writePayload.byteLength,
            effectiveMode: resolvedMode.mode,
            modeSource: resolvedMode.source,
            fileSync,
        });

        if (options.exclusive) {
            const publishStartedAt = performance.now();
            await emitMutationPhase(options, 'before-publish', { filePath, tmpPath, exclusive: true });
            await fs.link(tmpPath, filePath);
            published = true;
            await emitMutationPhase(options, 'after-publish', { filePath, tmpPath, exclusive: true });
            await fs.unlink(tmpPath);
            phaseTimings.publishMs = Math.max(0, performance.now() - publishStartedAt);
            tmpCreated = false;
            if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
            return {
                durability,
                tempPath: tmpPath,
                effectiveMode: resolvedMode.mode,
                modeSource: resolvedMode.source,
                fileFlushRequested,
                fileSync,
                directorySync,
                capacityPreflight,
                phaseTimings: finish(),
            };
        }

        await emitMutationPhase(options, 'before-publish', { filePath, tmpPath, exclusive: false });
        if (options.expectedHash || options.requireExists) {
            const prePublishCheckStartedAt = performance.now();
            if (options.expectedHash) {
                const current = await readBinaryMutationSnapshot(filePath, { snapshotMaxBytes: 0 });
                assertExpectedSha256Digest(current.contentHash, options.expectedHash);
            } else {
                await assertReplacementTargetExists(filePath);
            }
            phaseTimings.prePublishCheckMs = Math.max(0, performance.now() - prePublishCheckStartedAt);
        }
        const publishStartedAt = performance.now();
        await fs.rename(tmpPath, filePath);
        published = true;
        phaseTimings.publishMs = Math.max(0, performance.now() - publishStartedAt);
        tmpCreated = false;
        await emitMutationPhase(options, 'after-publish', { filePath, tmpPath, exclusive: false });
        if (shouldSyncDirectory(durability)) directorySync = await syncWriteDirectory(options, filePath);
        return {
            durability,
            tempPath: tmpPath,
            effectiveMode: resolvedMode.mode,
            modeSource: resolvedMode.source,
            fileFlushRequested,
            fileSync,
            directorySync,
            capacityPreflight,
            phaseTimings: finish(),
        };
    } catch (error) {
        if (tmpCreated) await fs.unlink(tmpPath).catch(() => undefined);
        if (published) {
            throw markMutationAppliedError(error, { phase: 'post-publish', paths: [filePath] });
        }
        throw error;
    }
}

/**
 * @param {AtomicWriteOptions} options
 * @param {string} filePath
 */
async function syncWriteDirectory(options, filePath) {
    await emitMutationPhase(options, 'before-destination-directory-sync', { filePath, target: filePath });
    const result = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(filePath);
    await emitMutationPhase(options, 'after-destination-directory-sync', { filePath, target: filePath, ...result });
    assertSuccessfulSync(result, {
        code: 'EDIRECTORYSYNC',
        message: `Falha ao sincronizar diretório da escrita atômica: ${filePath}`,
    });
    return result;
}
