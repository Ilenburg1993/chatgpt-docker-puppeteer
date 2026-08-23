// @ts-check
/**
 * JSONL writer bound to an already-authorized filesystem capability.
 *
 * Queue/backpressure semantics remain owned by the canonical pure JSONL queue. This adapter owns only the physical
 * append/rotation protocol and never mints authority from a path supplied at operation time.
 *
 * @module copilot/infra/persistence/jsonl/bound/writer
 */

import { markMutationAppliedError } from '#copilot/infra/internal/policy/mutation-state';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { createJsonlBatchQueue } from '../queue/index.js';
import { createJsonlSizeTracker } from '../size-tracker/index.js';

const DEFAULT_SIZE_REVALIDATE_MS = 250;
const MAX_SIZE_REVALIDATE_MS = 10_000;

/**
 * @typedef {'file-and-directory'|'file'|'none'} BoundJsonlDurability
 * @typedef {{
 *   withPathLock:<T>(filePath:string, operation:'append', callback:()=>Promise<T>, options?:{riskClass?:'low'|'medium'|'high'|'critical'})=>Promise<T>;
 *   appendText:(filePath:string, content:string, options?:{durability?:BoundJsonlDurability})=>Promise<unknown>;
 *   statPath?:(filePath:string)=>Promise<{stats:{size:number}}>;
 *   moveFile?:(source:string,destination:string,options?:{overwrite?:boolean;durability?:BoundJsonlDurability})=>Promise<unknown>;
 * }} AuthorizedJsonlIo
 * @typedef {AuthorizedJsonlIo & {
 *   statPath:(filePath:string)=>Promise<{stats:{size:number}}>;
 *   moveFile:(source:string,destination:string,options?:{overwrite?:boolean;durability?:BoundJsonlDurability})=>Promise<unknown>;
 * }} RotatingAuthorizedJsonlIo
 */

/**
 * @param {{
 *   filePath:string|(()=>string);
 *   io:AuthorizedJsonlIo;
 *   maxBytes?:number;
 *   batchLines?:number;
 *   maxQueueLines?:number;
 *   softQueueLines?:number;
 *   maxTrackedFiles?:number;
 *   autoFlush?:boolean;
 *   flushToDisk?:boolean;
 *   durability?:BoundJsonlDurability;
 *   sizeRevalidateMs?:number;
 *   resolveRotatedPath?:(filePath:string)=>string;
 *   onError?:(error:unknown)=>void;
 *   onSuccess?:()=>void;
 *   onPhase?:(phase:string, details:Record<string,unknown>)=>void|Promise<void>;
 * }} options
 */
export function createBoundJsonlFileWriter(options) {
    const resolveFilePath = createBoundPathResolver(options?.filePath);
    const maxTrackedFiles = Math.max(1, Math.trunc(options.maxTrackedFiles ?? 64));
    const durability = options.durability ?? (options.flushToDisk === true ? 'file' : 'none');
    const sizeRevalidateMs = Math.max(
        0,
        Math.min(MAX_SIZE_REVALIDATE_MS, Math.trunc(options.sizeRevalidateMs ?? DEFAULT_SIZE_REVALIDATE_MS)),
    );
    const maxBytes =
        Number.isFinite(options.maxBytes) && Number(options.maxBytes) > 0 ? Math.trunc(Number(options.maxBytes)) : null;
    const io = assertAuthorizedJsonlIo(options?.io);
    const rotationIo = maxBytes === null ? null : requireRotationIo(io);
    const resolveRotatedPath = options.resolveRotatedPath ?? ((filePath) => `${filePath}.1`);
    const sizeTracker = rotationIo
        ? createJsonlSizeTracker({
              maxTrackedFiles,
              sizeRevalidateMs,
              readPhysicalSize: async (filePath) => (await rotationIo.statPath(filePath)).stats.size,
          })
        : null;
    let rotations = 0;

    /** @param {string} filePath @param {string} data */
    async function persist(filePath, data) {
        const dataBytes = Buffer.byteLength(data, 'utf8');
        await io.withPathLock(
            filePath,
            'append',
            async () => {
                let currentSize = maxBytes === null ? 0 : await resolvePhysicalSize(filePath);
                /** @type {string|null} */
                let rotatedPath = null;
                try {
                    if (
                        maxBytes !== null &&
                        rotationIo &&
                        sizeTracker &&
                        currentSize > 0 &&
                        currentSize + dataBytes >= maxBytes
                    ) {
                        rotatedPath = path.resolve(resolveRotatedPath(filePath));
                        await options.onPhase?.('before-rotate', { filePath, rotatedPath, currentSize, dataBytes });
                        await rotationIo.moveFile(filePath, rotatedPath, { overwrite: true, durability });
                        sizeTracker.discard(filePath);
                        currentSize = 0;
                        rotations += 1;
                        await options.onPhase?.('after-rotate', { filePath, rotatedPath, dataBytes });
                    }
                    await options.onPhase?.('before-append', { filePath, dataBytes });
                    await io.appendText(filePath, data, { durability });
                    if (sizeTracker) sizeTracker.set(filePath, currentSize + dataBytes);
                    try {
                        await options.onPhase?.('after-append', { filePath, dataBytes, rotatedPath });
                    } catch (error) {
                        throw markMutationAppliedError(error, { phase: 'jsonl-after-append', paths: [filePath] });
                    }
                } catch (error) {
                    sizeTracker?.discard(filePath);
                    throw error;
                }
            },
            { riskClass: 'medium' },
        );
    }

    /** @param {string} filePath */
    async function resolvePhysicalSize(filePath) {
        if (!sizeTracker) return 0;
        try {
            return await sizeTracker.resolve(filePath);
        } catch (error) {
            const code = /** @type {{code?:unknown}} */ (error)?.code;
            if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
            sizeTracker.set(filePath, 0, { physicallyValidated: true });
            return 0;
        }
    }

    return createJsonlBatchQueue({
        persistBatch: async (data) => persist(resolveFilePath(), data),
        ...(options.batchLines === undefined ? {} : { batchLines: options.batchLines }),
        ...(options.maxQueueLines === undefined ? {} : { maxQueueLines: options.maxQueueLines }),
        ...(options.softQueueLines === undefined ? {} : { softQueueLines: options.softQueueLines }),
        ...(options.autoFlush === undefined ? {} : { autoFlush: options.autoFlush }),
        ...(options.onError === undefined ? {} : { onError: options.onError }),
        ...(options.onSuccess === undefined ? {} : { onSuccess: options.onSuccess }),
        resetExtra: () => {
            sizeTracker?.reset();
            rotations = 0;
        },
        getExtraState: () => ({
            durability,
            rotations,
            ...(sizeTracker?.stats() ?? {
                trackedFiles: 0,
                maxTrackedFiles,
                sizeRevalidateMs,
                sizeCacheHits: 0,
                sizeStatReads: 0,
                sizeExternalCorrections: 0,
            }),
        }),
    });
}

/** @param {unknown} value */
function assertAuthorizedJsonlIo(value) {
    const io = /** @type {Partial<AuthorizedJsonlIo>|null|undefined} */ (value);
    for (const method of ['withPathLock', 'appendText']) {
        if (!io || typeof io[/** @type {keyof AuthorizedJsonlIo} */ (method)] !== 'function') {
            throw new TypeError(`createBoundJsonlFileWriter requires already-authorized ${method} IO.`);
        }
    }
    return /** @type {AuthorizedJsonlIo} */ (io);
}

/** @param {AuthorizedJsonlIo} io @returns {RotatingAuthorizedJsonlIo} */
function requireRotationIo(io) {
    if (typeof io.statPath !== 'function' || typeof io.moveFile !== 'function') {
        throw new TypeError('JSONL rotation requires already-authorized statPath/moveFile IO.');
    }
    return /** @type {RotatingAuthorizedJsonlIo} */ (io);
}

/** @param {unknown} input */
function createBoundPathResolver(input) {
    if (typeof input === 'function') {
        return () => path.resolve(assertPath(input()));
    }
    const fixed = path.resolve(assertPath(input));
    return () => fixed;
}

/** @param {unknown} value */
function assertPath(value) {
    if (typeof value !== 'string' || !value.trim())
        throw new TypeError('JSONL bound filePath must be a non-empty string.');
    return value;
}
