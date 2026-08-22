// @ts-check
/**
 * Lightweight physical IO backend for configured control-plane filesystem grants.
 *
 * This module intentionally avoids workspace mutation, cache, invalidation and global telemetry graphs. It preserves
 * the physical guarantees configured state actually needs: consistent fresh snapshots, bounded range reads, atomic
 * same-directory publish, mode preservation, explicit durability, stable-order local locking and optional canonical
 * multiprocess file locking through the configured lock service.
 *
 * @module copilot/infra/filesystem/configured/physical
 */

import { buildIoMeta, createIoTraceId } from '#copilot/core/io-contracts';
import { withConfiguredResourceLocks } from '#copilot/infra/internal/concurrency/locks/configured';
import {
    assertSuccessfulSync,
    normalizeIoDurability,
    shouldFlushFile,
    shouldSyncDirectory,
    syncFileHandleBestEffort,
    syncParentDirectoryBestEffort,
} from '#copilot/infra/internal/platform/node/filesystem';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, watch } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_SNAPSHOT_RETRIES = 2;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/** @typedef {'file-and-directory'|'file'|'none'} ConfiguredPhysicalDurability */
/** @typedef {{traceId?:string;signal?:AbortSignal;includeHash?:boolean;advisoryLimits?:Record<string,unknown>;maxRetries?:number}} ConfiguredPhysicalReadOptions */
/** @typedef {{traceId?:string;advisoryLimits?:Record<string,unknown>}} ConfiguredPhysicalMetadataOptions */
/** @typedef {{mode?:number;durability?:ConfiguredPhysicalDurability;failIfExists?:boolean}} ConfiguredPhysicalMutationOptions */

/** @param {unknown} error */
function errorCode(error) {
    return String(/** @type {{code?:unknown}} */ (error)?.code ?? '');
}

/** @param {unknown} error @param {string} phase @param {string[]} paths */
function markConfiguredMutationApplied(error, phase, paths) {
    const applied =
        /** @type {Error & {code?:string;mutationApplied?:boolean;mutationPhase?:string;mutationPaths?:string[];cause?:unknown}} */ (
            error instanceof Error ? error : new Error(String(error))
        );
    applied.mutationApplied = true;
    applied.mutationPhase = phase;
    applied.mutationPaths = [...paths];
    return applied;
}

/** @param {import('node:fs').Stats} left @param {import('node:fs').Stats} right */
function samePhysicalSnapshot(left, right) {
    return (
        left.size === right.size &&
        left.mtimeMs === right.mtimeMs &&
        left.ctimeMs === right.ctimeMs &&
        Number(left.dev) === Number(right.dev) &&
        Number(left.ino) === Number(right.ino)
    );
}

/** @param {string} filePath @param {number} attempts */
function createStaleSnapshotError(filePath, attempts) {
    const error = /** @type {Error & {code?:string;attempts?:number}} */ (
        new Error(`Arquivo mudou durante snapshot consistente: ${filePath}`)
    );
    error.code = 'ESTALESNAPSHOT';
    error.attempts = attempts;
    return error;
}

/** @param {unknown} value */
function normalizeSnapshotRetries(value) {
    return Number.isInteger(value) && Number(value) >= 0 ? Math.min(10, Number(value)) : DEFAULT_SNAPSHOT_RETRIES;
}

/** @param {string} target @param {Parameters<typeof buildIoMeta>[0]['operation']} operation @param {Partial<Parameters<typeof buildIoMeta>[0]>} details */
function configuredIoMeta(target, operation, details = {}) {
    return buildIoMeta({ operation, target, ...details });
}

/**
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 */
function configuredWriteBuffer(content) {
    if (typeof content === 'string') return Buffer.from(content, 'utf8');
    if (Buffer.isBuffer(content)) return Buffer.from(content);
    if (ArrayBuffer.isView(content)) {
        const view = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
        return Buffer.from(view);
    }
    if (content instanceof ArrayBuffer) return Buffer.from(content);
    if (typeof SharedArrayBuffer !== 'undefined' && content instanceof SharedArrayBuffer) return Buffer.from(content);
    throw new TypeError('Configured atomic write content must be string or binary data.');
}

/** @param {string} filePath */
async function preservedMode(filePath) {
    try {
        return (await fs.stat(filePath)).mode & 0o777;
    } catch (error) {
        if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return null;
        throw error;
    }
}

/** @param {ConfiguredPhysicalDurability|undefined} requested */
function durabilityMode(requested) {
    return normalizeIoDurability(requested);
}

/** @param {string} target @param {ConfiguredPhysicalDurability} durability */
async function syncConfiguredParent(target, durability) {
    if (!shouldSyncDirectory(durability)) return null;
    const result = await syncParentDirectoryBestEffort(target);
    assertSuccessfulSync(result, {
        code: 'EDIRECTORYSYNC',
        message: `Falha ao sincronizar diretório configurado: ${target}`,
    });
    return result;
}

/**
 * Create a directory path one component at a time so every newly published namespace entry can be durably synced.
 * Existing symlink components are rejected independently of the higher-level grant check, narrowing TOCTOU exposure.
 *
 * @param {string} dirPath
 * @param {{mode?:number;durability:ConfiguredPhysicalDurability}} options
 */
async function ensureConfiguredDirectoryPath(dirPath, options) {
    const absolute = path.resolve(dirPath);
    const parsed = path.parse(absolute);
    const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
    let current = parsed.root;
    /** @type {string | undefined} */
    let firstCreated;
    /** @type {Array<Awaited<ReturnType<typeof syncParentDirectoryBestEffort>>>} */
    const directorySyncs = [];
    for (const part of parts) {
        current = path.join(current, part);
        try {
            const stats = await fs.lstat(current);
            if (stats.isSymbolicLink()) {
                const error = /** @type {Error & {code?:string}} */ (
                    new Error(`Configured directory path rejects symlink component: ${current}`)
                );
                error.code = 'ERR_CONFIGURED_FS_SYMLINK';
                throw error;
            }
            if (!stats.isDirectory()) {
                const error = /** @type {Error & {code?:string}} */ (
                    new Error(`Configured directory component is not a directory: ${current}`)
                );
                error.code = 'ENOTDIR';
                throw error;
            }
            continue;
        } catch (error) {
            if (errorCode(error) !== 'ENOENT') throw error;
        }
        try {
            await fs.mkdir(current, options.mode === undefined ? undefined : { mode: options.mode });
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') throw error;
            const raced = await fs.lstat(current);
            if (raced.isSymbolicLink()) {
                const symlinkError = /** @type {Error & {code?:string}} */ (
                    new Error(`Configured directory path rejects raced symlink component: ${current}`)
                );
                symlinkError.code = 'ERR_CONFIGURED_FS_SYMLINK';
                throw symlinkError;
            }
            if (!raced.isDirectory()) throw error;
            continue;
        }
        firstCreated ??= current;
        const sync = await syncConfiguredParent(current, options.durability);
        if (sync) directorySyncs.push(sync);
    }
    return { created: firstCreated !== undefined, firstCreated, directorySyncs };
}

/**
 * @param {string} filePath
 * @param {ConfiguredPhysicalReadOptions} [options]
 */
export async function readConfiguredBytesFresh(filePath, options = {}) {
    const maxRetries = normalizeSnapshotRetries(options.maxRetries);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = performance.now();
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        options.signal?.throwIfAborted();
        const handle = await fs.open(filePath, 'r');
        try {
            const before = await handle.stat();
            const content = await handle.readFile(options.signal ? { signal: options.signal } : undefined);
            const after = await handle.stat();
            const pathAfter = await fs.stat(filePath);
            if (!samePhysicalSnapshot(before, after) || !samePhysicalSnapshot(after, pathAfter)) {
                if (attempt <= maxRetries) continue;
                throw createStaleSnapshotError(filePath, attempt);
            }
            const contentHash =
                options.includeHash === true ? createHash('sha256').update(content).digest('hex') : undefined;
            return {
                path: filePath,
                content,
                bytesRead: content.byteLength,
                sizeBytes: after.size,
                mtimeMs: after.mtimeMs,
                ctimeMs: after.ctimeMs,
                dev: Number(after.dev),
                ino: Number(after.ino),
                mode: Number(after.mode),
                isFile: after.isFile(),
                attempts: attempt,
                consistent: /** @type {const} */ (true),
                ...(contentHash === undefined ? {} : { contentHash }),
                cacheFingerprintStrategy: /** @type {const} */ ('fresh-snapshot'),
                io: configuredIoMeta(filePath, 'read', {
                    targetKind: 'file',
                    bytesRead: content.byteLength,
                    durationMs: Math.max(0, performance.now() - startedAt),
                    engine: 'io-engine.fs.readFile.bytes-fresh',
                    riskClass: 'low',
                    traceId,
                    cache: 'none',
                    advisoryLimits: { ...(options.advisoryLimits ?? {}), freshness: 'physical-snapshot' },
                }),
            };
        } finally {
            await handle.close().catch(() => undefined);
        }
    }
    throw createStaleSnapshotError(filePath, maxRetries + 1);
}

/**
 * @param {string} filePath
 * @param {ConfiguredPhysicalReadOptions} [options]
 */
export async function readConfiguredTextFresh(filePath, options = {}) {
    const result = await readConfiguredBytesFresh(filePath, options);
    try {
        return { ...result, content: UTF8_DECODER.decode(result.content) };
    } catch (error) {
        const invalid = new TypeError(`Arquivo contém bytes inválidos para UTF-8: ${filePath}`);
        /** @type {{code?:string;cause?:unknown}} */ (invalid).code = 'EINVALIDUTF8';
        /** @type {{code?:string;cause?:unknown}} */ (invalid).cause = error;
        throw invalid;
    }
}

/**
 * @param {string} filePath
 * @param {{start?:number;maxBytes:number;fromEnd?:boolean;rejectSymlink?:boolean;traceId?:string;advisoryLimits?:Record<string,unknown>;signal?:AbortSignal;maxRetries?:number}} options
 */
export async function readConfiguredBytesRangeFresh(filePath, options) {
    const maxBytes = Number(options?.maxBytes);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
        throw new RangeError('Configured range read requires maxBytes >= 0.');
    const requestedStart = Number(options?.start ?? 0);
    if (!Number.isSafeInteger(requestedStart) || requestedStart < 0) {
        throw new RangeError('Configured range read start must be a non-negative safe integer.');
    }
    const maxRetries = normalizeSnapshotRetries(options.maxRetries);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = performance.now();
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        options.signal?.throwIfAborted();
        const lexicalBefore = options.rejectSymlink ? await fs.lstat(filePath) : null;
        if (lexicalBefore && (lexicalBefore.isSymbolicLink() || !lexicalBefore.isFile())) {
            const error = /** @type {Error & {code?:string}} */ (
                new Error(`Bounded range read requires a regular non-symlink file: ${filePath}`)
            );
            error.code = lexicalBefore.isSymbolicLink() ? 'ELOOP' : 'EISDIR';
            throw error;
        }
        const handle = await fs.open(filePath, 'r');
        try {
            const before = await handle.stat();
            const startByte =
                options.fromEnd === true ? Math.max(0, before.size - maxBytes) : Math.min(before.size, requestedStart);
            const requestedLength = Math.min(maxBytes, Math.max(0, before.size - startByte));
            const content = Buffer.allocUnsafe(requestedLength);
            let totalRead = 0;
            while (totalRead < requestedLength) {
                options.signal?.throwIfAborted();
                const read = await handle.read(content, totalRead, requestedLength - totalRead, startByte + totalRead);
                if (read.bytesRead <= 0) break;
                totalRead += read.bytesRead;
            }
            const boundedContent = totalRead === content.byteLength ? content : content.subarray(0, totalRead);
            const after = await handle.stat();
            const pathAfter = await fs.stat(filePath);
            const lexicalAfter = options.rejectSymlink ? await fs.lstat(filePath) : null;
            const lexicalStable =
                lexicalBefore === null ||
                (lexicalAfter !== null &&
                    !lexicalAfter.isSymbolicLink() &&
                    lexicalAfter.isFile() &&
                    samePhysicalSnapshot(lexicalBefore, lexicalAfter) &&
                    samePhysicalSnapshot(lexicalAfter, pathAfter));
            if (!samePhysicalSnapshot(before, after) || !samePhysicalSnapshot(after, pathAfter) || !lexicalStable) {
                if (attempt <= maxRetries) continue;
                throw createStaleSnapshotError(filePath, attempt);
            }
            const endByteExclusive = startByte + totalRead;
            return {
                path: filePath,
                content: boundedContent,
                bytesRead: totalRead,
                startByte,
                endByteExclusive,
                sizeBytes: after.size,
                mtimeMs: after.mtimeMs,
                ctimeMs: after.ctimeMs,
                dev: Number(after.dev),
                ino: Number(after.ino),
                mode: Number(after.mode),
                isFile: after.isFile(),
                truncatedBefore: startByte > 0,
                truncatedAfter: endByteExclusive < after.size,
                attempts: attempt,
                consistent: /** @type {const} */ (true),
                io: configuredIoMeta(filePath, 'read', {
                    targetKind: 'file',
                    bytesRead: totalRead,
                    durationMs: Math.max(0, performance.now() - startedAt),
                    engine:
                        options.fromEnd === true
                            ? 'io-engine.fs.read.range-tail-fresh'
                            : 'io-engine.fs.read.range-fresh',
                    riskClass: 'low',
                    traceId,
                    cache: 'none',
                    advisoryLimits: {
                        ...(options.advisoryLimits ?? {}),
                        freshness: 'physical-range-snapshot',
                        startByte,
                        maxBytes,
                        fromEnd: options.fromEnd === true,
                        rejectSymlink: options.rejectSymlink === true,
                    },
                }),
            };
        } finally {
            await handle.close().catch(() => undefined);
        }
    }
    throw createStaleSnapshotError(filePath, maxRetries + 1);
}

/** @param {string} dirPath @param {ConfiguredPhysicalMetadataOptions} [options] */
export async function listConfiguredDirectoryNamesFresh(dirPath, options = {}) {
    const startedAt = performance.now();
    const entries = await fs.readdir(dirPath, { encoding: 'utf8' });
    return {
        path: dirPath,
        entries,
        io: configuredIoMeta(dirPath, 'scan', {
            targetKind: 'directory',
            durationMs: Math.max(0, performance.now() - startedAt),
            engine: 'io-engine.fs.readdir.names-fresh',
            riskClass: 'low',
            traceId: options.traceId ?? createIoTraceId(),
            cache: 'none',
            advisoryLimits: {
                ...(options.advisoryLimits ?? {}),
                freshness: 'physical-directory-listing',
                entryCount: entries.length,
            },
        }),
    };
}

/** @param {string} filePath @param {boolean} followSymlinks @param {ConfiguredPhysicalMetadataOptions} [options] */
async function configuredStat(filePath, followSymlinks, options = {}) {
    const startedAt = performance.now();
    const stats = await (followSymlinks ? fs.stat(filePath) : fs.lstat(filePath));
    return {
        path: filePath,
        stats,
        io: configuredIoMeta(filePath, 'stat', {
            targetKind: stats.isDirectory() ? 'directory' : 'file',
            durationMs: Math.max(0, performance.now() - startedAt),
            engine: followSymlinks ? 'io-engine.fs.stat' : 'io-engine.fs.lstat',
            riskClass: 'low',
            traceId: options.traceId ?? createIoTraceId(),
            cache: 'none',
            ...(options.advisoryLimits === undefined ? {} : { advisoryLimits: options.advisoryLimits }),
        }),
    };
}

/** @param {string} filePath @param {ConfiguredPhysicalMetadataOptions} [options] */
export function lstatConfiguredPath(filePath, options = {}) {
    return configuredStat(filePath, false, options);
}

/** @param {string} filePath @param {ConfiguredPhysicalMetadataOptions} [options] */
export function statConfiguredPath(filePath, options = {}) {
    return configuredStat(filePath, true, options);
}

/**
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {ConfiguredPhysicalMutationOptions} [options]
 * @param {() => Promise<void>} [revalidate]
 */
export async function writeConfiguredFileAtomic(filePath, content, options = {}, revalidate = undefined) {
    const payload = configuredWriteBuffer(content);
    const durability = durabilityMode(options.durability);
    await withConfiguredResourceLocks(
        [filePath],
        async () => {
            const parent = path.dirname(filePath);
            await ensureConfiguredDirectoryPath(parent, { durability });
            await revalidate?.();
            const mode = options.mode === undefined ? await preservedMode(filePath) : options.mode;
            const tmpPath = path.join(parent, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
            /** @type {import('node:fs/promises').FileHandle | null} */
            let handle = null;
            let published = false;
            try {
                handle = await fs.open(tmpPath, 'wx', mode === null ? undefined : mode);
                await handle.writeFile(payload);
                if (mode !== null) await handle.chmod(mode);
                if (shouldFlushFile(durability)) {
                    const fileSync = await syncFileHandleBestEffort(handle);
                    assertSuccessfulSync(fileSync, {
                        code: 'EFILESYNC',
                        message: `Falha ao sincronizar inode temporário configurado: ${tmpPath}`,
                    });
                }
                await handle.close();
                handle = null;
                if (options.failIfExists) {
                    await fs.link(tmpPath, filePath);
                    published = true;
                    await fs.unlink(tmpPath);
                } else {
                    await fs.rename(tmpPath, filePath);
                    published = true;
                }
                await syncConfiguredParent(filePath, durability);
            } catch (error) {
                await handle?.close().catch(() => undefined);
                if (!published || options.failIfExists) await fs.unlink(tmpPath).catch(() => undefined);
                throw published
                    ? markConfiguredMutationApplied(error, 'destination-directory-sync', [filePath])
                    : error;
            }
        },
        { operation: 'configured-write', riskClass: 'medium' },
    );
}

/**
 * @param {string} dirPath
 * @param {{recursive?:boolean;mode?:number;durability?:ConfiguredPhysicalDurability}} [options]
 * @param {() => Promise<void>} [revalidate]
 */
export async function mkdirConfiguredPath(dirPath, options = {}, revalidate = undefined) {
    const durability = durabilityMode(options.durability);
    return withConfiguredResourceLocks(
        [dirPath],
        async () => {
            /** @type {boolean} */
            let created;
            /** @type {string | undefined} */
            let createdPath;
            /** @type {Array<Awaited<ReturnType<typeof syncParentDirectoryBestEffort>>>} */
            let directorySyncs = [];
            if (options.recursive) {
                const result = await ensureConfiguredDirectoryPath(dirPath, {
                    ...(options.mode === undefined ? {} : { mode: options.mode }),
                    durability,
                });
                created = result.created;
                createdPath = result.firstCreated;
                directorySyncs = result.directorySyncs;
            } else {
                await fs.mkdir(dirPath, options.mode === undefined ? undefined : { mode: options.mode });
                created = true;
                createdPath = dirPath;
                const sync = await syncConfiguredParent(dirPath, durability);
                if (sync) directorySyncs = [sync];
            }
            await revalidate?.();
            return {
                path: dirPath,
                created,
                createdPath,
                durability: { durability, directorySyncs },
                io: configuredIoMeta(dirPath, 'mkdir', {
                    targetKind: 'directory',
                    engine: 'io-engine.fs.mkdir.configured',
                    riskClass: 'medium',
                    cache: 'none',
                }),
            };
        },
        { operation: 'configured-mkdir', riskClass: 'medium' },
    );
}

/** @param {string} filePath @param {{ignoreMissing?:boolean;durability?:ConfiguredPhysicalDurability}} [options] */
export async function deleteConfiguredFile(filePath, options = {}) {
    const durability = durabilityMode(options.durability);
    return withConfiguredResourceLocks(
        [filePath],
        async () => {
            try {
                await fs.unlink(filePath);
            } catch (error) {
                if (options.ignoreMissing === true && (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR'))
                    return null;
                throw error;
            }
            let directorySync;
            try {
                directorySync = await syncConfiguredParent(filePath, durability);
            } catch (error) {
                throw markConfiguredMutationApplied(error, 'parent-directory-sync', [filePath]);
            }
            return { durability, directorySync };
        },
        { operation: 'configured-delete', riskClass: 'medium' },
    );
}

/**
 * @param {string} source
 * @param {string} destination
 * @param {{overwrite?:boolean;durability?:ConfiguredPhysicalDurability}} [options]
 * @param {() => Promise<void>} [revalidate]
 */
export async function moveConfiguredFile(source, destination, options = {}, revalidate = undefined) {
    const durability = durabilityMode(options.durability);
    return withConfiguredResourceLocks(
        [source, destination],
        async () => {
            await ensureConfiguredDirectoryPath(path.dirname(destination), { durability });
            await revalidate?.();
            let destinationPublished = false;
            let sourceRemoved = false;
            let crossDevice = false;
            try {
                if (options.overwrite) {
                    await fs.rename(source, destination);
                    destinationPublished = true;
                    sourceRemoved = true;
                    await syncConfiguredParent(destination, durability);
                    if (path.dirname(source) !== path.dirname(destination))
                        await syncConfiguredParent(source, durability);
                    return { crossDevice, duplicatedAfterCrossDeviceMove: false, sourceUnlinkErrorCode: null };
                }
                await fs.link(source, destination);
                destinationPublished = true;
                await syncConfiguredParent(destination, durability);
                await fs.unlink(source);
                sourceRemoved = true;
                await syncConfiguredParent(source, durability);
                return { crossDevice, duplicatedAfterCrossDeviceMove: false, sourceUnlinkErrorCode: null };
            } catch (error) {
                if (errorCode(error) !== 'EXDEV' || destinationPublished) {
                    throw destinationPublished
                        ? markConfiguredMutationApplied(
                              error,
                              sourceRemoved ? 'source-removed' : 'destination-published',
                              [source, destination],
                          )
                        : error;
                }
            }

            crossDevice = true;
            const tmpDestination = path.join(
                path.dirname(destination),
                `.${path.basename(destination)}.${process.pid}.${randomUUID()}.move`,
            );
            try {
                await fs.copyFile(source, tmpDestination, fsConstants.COPYFILE_EXCL);
                if (shouldFlushFile(durability)) {
                    const syncHandle = await fs.open(tmpDestination, 'r');
                    try {
                        const fileSync = await syncFileHandleBestEffort(syncHandle);
                        assertSuccessfulSync(fileSync, {
                            code: 'EFILESYNC',
                            message: `Falha ao sincronizar move configurado: ${tmpDestination}`,
                        });
                    } finally {
                        await syncHandle.close().catch(() => undefined);
                    }
                }
                if (options.overwrite) await fs.rename(tmpDestination, destination);
                else {
                    await fs.link(tmpDestination, destination);
                    await fs.unlink(tmpDestination);
                }
                destinationPublished = true;
                await syncConfiguredParent(destination, durability);
                await fs.unlink(source);
                sourceRemoved = true;
                await syncConfiguredParent(source, durability);
                return { crossDevice, duplicatedAfterCrossDeviceMove: false, sourceUnlinkErrorCode: null };
            } catch (copyError) {
                await fs.unlink(tmpDestination).catch(() => undefined);
                throw destinationPublished
                    ? markConfiguredMutationApplied(
                          copyError,
                          sourceRemoved ? 'source-removed' : 'destination-published',
                          [source, destination],
                      )
                    : copyError;
            }
        },
        { operation: 'configured-move', riskClass: 'high' },
    );
}

/**
 * Append one bounded payload while the configured resource lock remains held through write + durability.
 * This is intentionally distinct from openConfiguredDetachedAppendSink(), whose handle escapes for child-process use.
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {{mode?:number;durability?:ConfiguredPhysicalDurability}} [options]
 * @param {() => Promise<void>} [revalidate]
 */
export async function appendConfiguredText(filePath, content, options = {}, revalidate = undefined) {
    const durability = durabilityMode(options.durability);
    const buffer = configuredWriteBuffer(content);
    return withConfiguredResourceLocks(
        [filePath],
        async () => {
            await ensureConfiguredDirectoryPath(path.dirname(filePath), { durability });
            await revalidate?.();
            /** @type {import('node:fs/promises').FileHandle | null} */
            let handle = null;
            let created = false;
            let mutationApplied = false;
            try {
                try {
                    handle = await fs.open(filePath, 'ax', options.mode ?? 0o600);
                    created = true;
                    mutationApplied = true;
                } catch (error) {
                    if (errorCode(error) !== 'EEXIST') throw error;
                    handle = await fs.open(filePath, 'a', options.mode ?? 0o600);
                }
                await handle.writeFile(buffer);
                mutationApplied = true;
                let fileSync = null;
                if (shouldFlushFile(durability)) {
                    fileSync = await syncFileHandleBestEffort(handle);
                    assertSuccessfulSync(fileSync, {
                        code: 'EFILESYNC',
                        message: `Falha ao sincronizar append configurado: ${filePath}`,
                    });
                }
                const directorySync = created ? await syncConfiguredParent(filePath, durability) : null;
                return {
                    path: filePath,
                    bytesWritten: buffer.byteLength,
                    created,
                    durability: { durability, fileSync, directorySync },
                    io: configuredIoMeta(filePath, 'write', {
                        targetKind: 'file',
                        engine: 'io-engine.fs.append.configured',
                        riskClass: 'medium',
                        cache: 'none',
                    }),
                };
            } catch (error) {
                throw mutationApplied ? markConfiguredMutationApplied(error, 'append', [filePath]) : error;
            } finally {
                await handle?.close().catch(() => undefined);
            }
        },
        { operation: 'configured-append', riskClass: 'medium' },
    );
}

/**
 * Open a file descriptor that intentionally escapes the configured lock for detached child-process stdio.
 * @param {string} filePath
 * @param {{mode?:number;durability?:ConfiguredPhysicalDurability}} [options]
 * @param {() => Promise<void>} [revalidate]
 */
export async function openConfiguredDetachedAppendSink(filePath, options = {}, revalidate = undefined) {
    const durability = durabilityMode(options.durability);
    return withConfiguredResourceLocks(
        [filePath],
        async () => {
            await ensureConfiguredDirectoryPath(path.dirname(filePath), { durability });
            await revalidate?.();
            /** @type {import('node:fs/promises').FileHandle | null} */
            let handle = null;
            let created = false;
            try {
                try {
                    handle = await fs.open(filePath, 'ax', options.mode ?? 0o600);
                    created = true;
                } catch (error) {
                    if (errorCode(error) !== 'EEXIST') throw error;
                    handle = await fs.open(filePath, 'a', options.mode ?? 0o600);
                }
                const directorySync = created ? await syncConfiguredParent(filePath, durability) : null;
                return { handle, created, durability, directorySync };
            } catch (error) {
                await handle?.close().catch(() => undefined);
                throw created ? markConfiguredMutationApplied(error, 'append-sink-directory-sync', [filePath]) : error;
            }
        },
        { operation: 'configured-append', riskClass: 'medium' },
    );
}

/** @param {string} filePath @param {number} mode @param {{durability?:ConfiguredPhysicalDurability}} [options] */
export async function chmodConfiguredFile(filePath, mode, options = {}) {
    const durability = durabilityMode(options.durability);
    return withConfiguredResourceLocks(
        [filePath],
        async () => {
            const before = await fs.stat(filePath);
            const previousMode = before.mode & 0o777;
            const effectiveMode = mode & 0o777;
            if (previousMode === effectiveMode) return { changed: false, previousMode, mode: effectiveMode };
            const handle = await fs.open(filePath, 'r');
            try {
                await handle.chmod(effectiveMode);
                if (shouldFlushFile(durability)) {
                    const fileSync = await syncFileHandleBestEffort(handle);
                    assertSuccessfulSync(fileSync, {
                        code: 'EFILESYNC',
                        message: `Falha ao sincronizar chmod configurado: ${filePath}`,
                    });
                }
            } finally {
                await handle.close().catch(() => undefined);
            }
            return { changed: true, previousMode, mode: effectiveMode };
        },
        { operation: 'configured-chmod', riskClass: 'medium' },
    );
}

/**
 * @param {string} targetPath
 * @param {import('node:fs').WatchOptionsWithStringEncoding} options
 * @param {import('node:fs').WatchListener<string>} listener
 */
export function watchConfiguredPath(targetPath, options, listener) {
    return watch(targetPath, options, listener);
}
