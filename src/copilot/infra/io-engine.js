// @ts-check
/**
 * Engine canônica de I/O local para `src/copilot`.
 *
 * Limites de tamanho são informativos por desenho: a engine mede bytes e sinaliza advisory metadata, mas não bloqueia
 * operações por tamanho. Barreiras de segurança continuam pertencendo às policies de path/URL dos adapters.
 *
 * @module copilot/infra/io-engine
 */

import { isUtf8 } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildIoMeta, createIoTraceId, withIoMeta } from '../core/io-contracts.js';
import { withIoResourceLock, withIoResourceLocks } from './io-locks.js';
import { nowIoMs, publishIoOperation } from './io-observability.js';

/**
 * @param {string | Buffer} content
 * @param {BufferEncoding} [encoding]
 * @returns {Buffer}
 */
function toBuffer(content, encoding = 'utf8') {
    return Buffer.isBuffer(content) ? content : Buffer.from(content, encoding);
}

/**
 * @param {number} startedAt
 * @returns {number}
 */
function elapsedMs(startedAt) {
    return Math.max(0, Math.round(nowIoMs() - startedAt));
}

/**
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {BufferEncoding} encoding
 * @returns {{ payload: string | Buffer; bytes: number }}
 */
function normalizeWritePayload(filePath, content, encoding) {
    void filePath;
    const buf = toBuffer(content, encoding);
    return {
        payload: Buffer.isBuffer(content) ? content : String(content),
        bytes: buf.byteLength,
    };
}

/**
 * Escrita atômica sem lock. O caller deve segurar o lock correto.
 *
 * @param {string} filePath
 * @param {string | Buffer} payload
 * @param {{ mode?: number }} [options]
 * @returns {Promise<void>}
 */
async function writeAtomicUnlocked(filePath, payload, options = {}) {
    const tmpPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
    try {
        await fs.writeFile(tmpPath, payload, options.mode === undefined ? undefined : { mode: options.mode });
        await fs.rename(tmpPath, filePath);
    } catch (error) {
        try {
            await fs.unlink(tmpPath);
        } catch {
            // best-effort cleanup
        }
        throw error;
    }
}

/**
 * Falha se o destino já existir quando a operação não autoriza overwrite.
 *
 * @param {string} destination
 * @param {boolean | undefined} overwrite
 * @returns {Promise<void>}
 */
async function assertDestinationWritable(destination, overwrite) {
    if (overwrite) return;
    try {
        await fs.access(destination);
    } catch (error) {
        const err = /** @type {{ code?: unknown; message?: unknown }} */ (error);
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR' || String(err.message ?? '').includes('ENOENT')) return;
        throw error;
    }
    const error = new Error(`Destino já existe: ${destination}`);
    /** @type {{ code?: string }} */ (error).code = 'EEXIST';
    throw error;
}

/**
 * @param {import('../core/io-contracts.js').IoMeta} io
 * @param {boolean} success
 * @param {unknown} [error]
 * @returns {import('../core/io-contracts.js').IoMeta}
 */
function publishAndReturn(io, success, error) {
    publishIoOperation(io, { success, ...(error !== undefined ? { error } : {}) });
    return io;
}

/**
 * Lê bytes completos de um arquivo.
 *
 * @param {string} filePath
 * @param {{ traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 * @returns {Promise<{
 *     path: string;
 *     content: Buffer;
 *     bytesRead: number;
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function readBytes(filePath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const content = await fs.readFile(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                bytesRead: content.byteLength,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.readFile.bytes',
                riskClass: 'low',
                traceId,
                ...(options.advisoryLimits !== undefined ? { advisoryLimits: options.advisoryLimits } : {}),
            }),
            true,
        );
        return { path: filePath, content, bytesRead: content.byteLength, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.readFile.bytes',
                riskClass: 'low',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Lê texto UTF-8 completo ou um range de linhas.
 *
 * @param {string} filePath
 * @param {{
 *     startLine?: number;
 *     endLine?: number;
 *     traceId?: string;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     content: string;
 *     bytesRead: number;
 *     totalLines: number;
 *     returnedLines: { start: number; end: number };
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function readText(filePath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    let failurePublished = false;
    try {
        const raw = await fs.readFile(filePath);
        const baseMeta = {
            operation: /** @type {const} */ ('read'),
            target: filePath,
            targetKind: /** @type {const} */ ('file'),
            bytesRead: raw.byteLength,
            durationMs: elapsedMs(startedAt),
            engine: 'io-engine.fs.readFile.text',
            riskClass: /** @type {const} */ ('low'),
            traceId,
            advisoryLimits: {
                ...(options.advisoryLimits ?? {}),
                ...(options.startLine !== undefined ? { startLine: options.startLine } : {}),
                ...(options.endLine !== undefined ? { endLine: options.endLine } : {}),
            },
        };
        if (!isUtf8(raw)) {
            const error = new Error('Arquivo binário detectado (bytes inválidos para UTF-8).');
            publishAndReturn(buildIoMeta(baseMeta), false, error);
            failurePublished = true;
            throw error;
        }
        const text = raw.toString('utf8');
        const lines = text.split('\n');
        const totalLines = lines.length;
        const requestedStart = Math.max(1, options.startLine ?? 1);
        const start = Math.min(requestedStart, totalLines + 1);
        const end = start > totalLines ? totalLines : Math.min(options.endLine ?? totalLines, totalLines);
        const content = start > totalLines ? '' : lines.slice(start - 1, end).join('\n');
        const io = publishAndReturn(buildIoMeta(baseMeta), true);
        return {
            path: filePath,
            content,
            bytesRead: raw.byteLength,
            totalLines,
            returnedLines: { start, end },
            io,
        };
    } catch (error) {
        if (!failurePublished) {
            publishAndReturn(
                buildIoMeta({
                    operation: 'read',
                    target: filePath,
                    targetKind: 'file',
                    durationMs: elapsedMs(startedAt),
                    engine: 'io-engine.fs.readFile.text',
                    riskClass: 'low',
                    traceId,
                }),
                false,
                error,
            );
        }
        throw error;
    }
}

/**
 * Lê linhas UTF-8.
 *
 * @param {string} filePath
 * @param {Parameters<typeof readText>[1]} [options]
 */
export async function readLines(filePath, options = {}) {
    const result = await readText(filePath, options);
    return { ...result, lines: result.content.split('\n') };
}

/**
 * Escrita atômica central: tmp no mesmo diretório + rename. Usa lock por path real para evitar corrida intra-processo.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {{
 *     encoding?: BufferEncoding;
 *     riskClass?: import('../core/io-contracts.js').IoRiskClass;
 *     traceId?: string;
 *     mode?: number;
 *     lockTimeoutMs?: number;
 *     signal?: AbortSignal;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     bytesWritten: number;
 *     io: import('../core/io-contracts.js').IoMeta;
 *     lockWaitMs: number;
 * }>}
 */
export async function writeFileAtomic(filePath, content, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const { payload, bytes } = normalizeWritePayload(filePath, content, options.encoding ?? 'utf8');
    try {
        const { value, waitMs } = await withIoResourceLock(
            filePath,
            async () => {
                await writeAtomicUnlocked(filePath, payload, options.mode === undefined ? {} : { mode: options.mode });
                return { path: filePath, bytesWritten: bytes };
            },
            {
                ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            },
        );
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'write',
                target: filePath,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.atomic-write',
                riskClass: options.riskClass ?? 'medium',
                traceId,
                advisoryLimits: { ...(options.advisoryLimits ?? {}), lockWaitMs: waitMs },
            }),
            true,
        );
        return { ...value, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'write',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.atomic-write',
                riskClass: options.riskClass ?? 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Garante diretório pai e escreve de forma atômica.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {Parameters<typeof writeFileAtomic>[2] & { createParentDirs?: boolean }} [options]
 */
export async function createOrReplaceFileAtomic(filePath, content, options = {}) {
    if (options.createParentDirs !== false) {
        await fs.mkdir(dirname(filePath), { recursive: true });
    }
    return writeFileAtomic(filePath, content, options);
}

/**
 * Append com lock por path. Mantém append separado de write para observabilidade e política de risco.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {{
 *     encoding?: BufferEncoding;
 *     mode?: number;
 *     traceId?: string;
 *     lockTimeoutMs?: number;
 *     signal?: AbortSignal;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 */
export async function appendTextLocked(filePath, content, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const { payload, bytes } = normalizeWritePayload(filePath, content, options.encoding ?? 'utf8');
    try {
        const { waitMs } = await withIoResourceLock(
            filePath,
            async () =>
                fs.appendFile(filePath, payload, options.mode === undefined ? undefined : { mode: options.mode }),
            {
                ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            },
        );
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                bytesWritten: bytes,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.appendFile',
                riskClass: 'medium',
                traceId,
                advisoryLimits: { ...(options.advisoryLimits ?? {}), lockWaitMs: waitMs },
            }),
            true,
        );
        return { path: filePath, bytesWritten: bytes, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.appendFile',
                riskClass: 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Stat canônico com observabilidade. Leitura metadata-only, sem bloqueio por tamanho.
 *
 * @param {string} filePath
 * @param {{ traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 * @returns {Promise<{
 *     path: string;
 *     stats: import('node:fs').Stats;
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function statPath(filePath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const stats = await fs.stat(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'stat',
                target: filePath,
                targetKind: stats.isDirectory() ? 'directory' : 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.stat',
                riskClass: 'low',
                traceId,
                ...(options.advisoryLimits !== undefined ? { advisoryLimits: options.advisoryLimits } : {}),
            }),
            true,
        );
        return { path: filePath, stats, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'stat',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.stat',
                riskClass: 'low',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Cria diretório com lock por path, preservando a semântica do SDK SessionFsProvider.mkdir().
 *
 * @param {string} dirPath
 * @param {{ recursive?: boolean; mode?: number; traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 * @returns {Promise<{
 *     path: string;
 *     created: true;
 *     io: import('../core/io-contracts.js').IoMeta;
 *     lockWaitMs: number;
 * }>}
 */
export async function mkdirPathLocked(dirPath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { waitMs } = await withIoResourceLock(dirPath, async () =>
            fs.mkdir(
                dirPath,
                options.mode === undefined
                    ? { recursive: Boolean(options.recursive) }
                    : { recursive: Boolean(options.recursive), mode: options.mode },
            ),
        );
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'mkdir',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.mkdir',
                riskClass: 'medium',
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    lockWaitMs: waitMs,
                    recursive: Boolean(options.recursive),
                },
            }),
            true,
        );
        return withIoMeta({ path: dirPath, created: /** @type {const} */ (true), lockWaitMs: waitMs }, io);
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'mkdir',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.mkdir',
                riskClass: 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Remove arquivo com lock por path.
 *
 * @param {string} filePath
 * @returns {Promise<{
 *     path: string;
 *     deleted: true;
 *     io: import('../core/io-contracts.js').IoMeta;
 *     lockWaitMs: number;
 * }>}
 */
export async function deleteFileLocked(filePath) {
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { waitMs } = await withIoResourceLock(filePath, async () => fs.unlink(filePath));
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.unlink',
                riskClass: 'high',
                traceId,
                advisoryLimits: { lockWaitMs: waitMs },
            }),
            true,
        );
        return withIoMeta({ path: filePath, deleted: /** @type {const} */ (true), lockWaitMs: waitMs }, io);
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.unlink',
                riskClass: 'high',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Remove arquivo ou diretório com lock por path. Usado por Session FS para cobrir `rm` recursivo sem bypass.
 *
 * @param {string} filePath
 * @param {{ recursive?: boolean; force?: boolean; traceId?: string }} [options]
 * @returns {Promise<{
 *     path: string;
 *     deleted: true;
 *     io: import('../core/io-contracts.js').IoMeta;
 *     lockWaitMs: number;
 * }>}
 */
export async function removePathLocked(filePath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { waitMs } = await withIoResourceLock(filePath, async () =>
            fs.rm(filePath, { recursive: Boolean(options.recursive), force: Boolean(options.force) }),
        );
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rm',
                riskClass: 'high',
                traceId,
                advisoryLimits: {
                    lockWaitMs: waitMs,
                    recursive: Boolean(options.recursive),
                    force: Boolean(options.force),
                },
            }),
            true,
        );
        return withIoMeta({ path: filePath, deleted: /** @type {const} */ (true), lockWaitMs: waitMs }, io);
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rm',
                riskClass: 'high',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Copia arquivo com lock no destino.
 *
 * @param {string} source
 * @param {string} destination
 * @param {{ overwrite?: boolean; traceId?: string }} [options]
 */
export async function copyFileLocked(source, destination, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { value, waitMs } = await withIoResourceLocks([source, destination], async () => {
            await assertDestinationWritable(destination, options.overwrite);
            await fs.mkdir(dirname(destination), { recursive: true });
            await fs.copyFile(source, destination);
            const stats = await fs.stat(destination);
            return { bytesWritten: stats.size };
        });
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'copy',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.copyFile',
                riskClass: options.overwrite ? 'high' : 'medium',
                traceId,
                advisoryLimits: { lockWaitMs: waitMs },
            }),
            true,
        );
        return { source, destination, bytesWritten: value.bytesWritten, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'copy',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.copyFile',
                riskClass: options.overwrite ? 'high' : 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Move/rename com locks no source e destination.
 *
 * @param {string} source
 * @param {string} destination
 * @param {{ overwrite?: boolean; traceId?: string }} [options]
 */
export async function moveFileLocked(source, destination, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { waitMs } = await withIoResourceLocks([source, destination], async () => {
            await assertDestinationWritable(destination, options.overwrite);
            await fs.mkdir(dirname(destination), { recursive: true });
            try {
                await fs.rename(source, destination);
            } catch (error) {
                const errCode = /** @type {{ code?: unknown }} */ (error)?.code;
                if (errCode !== 'EXDEV') throw error;
                await fs.copyFile(source, destination);
                await fs.unlink(source);
            }
        });
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'move',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rename',
                riskClass: 'high',
                traceId,
                advisoryLimits: { lockWaitMs: waitMs },
            }),
            true,
        );
        return { source, destination, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'move',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rename',
                riskClass: 'high',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Patch textual com read + write dentro do mesmo lock.
 *
 * @param {string} filePath
 * @param {{
 *     oldString: string;
 *     newString: string;
 *     replaceAll?: boolean;
 *     expectedOccurrences?: number;
 *     advisoryLimits?: Record<string, unknown>;
 * }} options
 */
export async function patchTextLocked(filePath, options) {
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { value, waitMs } = await withIoResourceLock(filePath, async () => {
            const content = await fs.readFile(filePath, 'utf8');
            const occurrences = content.split(options.oldString).length - 1;
            if (occurrences === 0) throw new Error('old_string não encontrado no arquivo.');
            if (options.expectedOccurrences !== undefined && options.expectedOccurrences !== occurrences) {
                throw new Error(`expected_occurrences=${options.expectedOccurrences}, mas encontrado=${occurrences}.`);
            }
            if (!options.replaceAll && options.expectedOccurrences === undefined && occurrences > 1) {
                throw new Error(
                    `old_string encontrado ${occurrences} vezes. Inclua mais contexto para identificar unicamente.`,
                );
            }

            const updated = options.replaceAll
                ? content.split(options.oldString).join(options.newString)
                : content.replace(options.oldString, () => options.newString);
            await writeAtomicUnlocked(filePath, updated);
            return {
                replacedOccurrences: options.replaceAll ? occurrences : 1,
                bytesWritten: Buffer.byteLength(updated, 'utf8'),
            };
        });
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'patch',
                target: filePath,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.patchTextLocked',
                riskClass: 'high',
                traceId,
                advisoryLimits: { ...(options.advisoryLimits ?? {}), lockWaitMs: waitMs },
            }),
            true,
        );
        return { path: filePath, ...value, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'patch',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.patchTextLocked',
                riskClass: 'high',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Diff textual simples, sem invocar processo externo.
 *
 * @param {string} pathA
 * @param {string} pathB
 * @param {{ contextLines?: number }} [options]
 */
export async function diffText(pathA, pathB, options = {}) {
    const startedAt = nowIoMs();
    const traceId = createIoTraceId();
    try {
        const [a, b] = await Promise.all([readText(pathA), readText(pathB)]);
        const aLines = a.content.split('\n');
        const bLines = b.content.split('\n');
        const max = Math.max(aLines.length, bLines.length);
        const contextLines = Math.max(0, options.contextLines ?? 3);
        /** @type {string[]} */
        const out = [];
        for (let i = 0; i < max; i++) {
            if (aLines[i] === bLines[i]) continue;
            const start = Math.max(0, i - contextLines);
            const end = Math.min(max, i + contextLines + 1);
            out.push(`@@ ${start + 1},${end - start} @@`);
            for (let j = start; j < end; j++) {
                if (aLines[j] === bLines[j]) {
                    if (aLines[j] !== undefined) out.push(` ${aLines[j]}`);
                } else {
                    if (aLines[j] !== undefined) out.push(`-${aLines[j]}`);
                    if (bLines[j] !== undefined) out.push(`+${bLines[j]}`);
                }
            }
            i = end - 1;
        }
        const diff = out.join('\n');
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'diff',
                target: `${pathA} <-> ${pathB}`,
                targetKind: 'file',
                bytesRead: a.bytesRead + b.bytesRead,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.diffText',
                riskClass: 'low',
                traceId,
                advisoryLimits: { contextLines },
            }),
            true,
        );
        return { pathA, pathB, diff, identical: diff.trim() === '', io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'diff',
                target: `${pathA} <-> ${pathB}`,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.diffText',
                riskClass: 'low',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

export { withIoResourceLock };
