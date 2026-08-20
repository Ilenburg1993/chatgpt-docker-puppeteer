// @ts-check

import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as ioCacheL2Registry from '../../../../src/copilot/infra/io-cache-l2-registry.js';
import { resetIoL1CacheForTest } from '../../../../src/copilot/infra/io-cache.js';
import {
    copyFileLocked,
    createOrReplaceFileAtomic,
    deleteFileLocked,
    mkdirPathLocked,
    moveFileLocked,
    patchTextLocked,
    readBytes,
    readLines,
    readText,
    readTextChunks,
    removePathLocked,
    searchText,
    searchWorkspaceSymbols,
    withIoResourceLock,
    writeFileAtomic,
} from '../../../../src/copilot/infra/io-engine.js';
import { scanDirectory } from '../../../../src/copilot/infra/io-scanner.js';
import { patchTextBatchLocked } from '../../../../src/copilot/infra/io/fs/locked-mutations.js';
import { acquireIoResourceLock, getIoLockStats } from '../../../../src/copilot/infra/io-locks.js';
import { getFileResourceLockPath } from '../../../../src/copilot/infra/locks/file-resource-lock.js';
import { sha256 } from '../../../../src/copilot/infra/shared/hash.js';

/** @type {string[]} */
const TEMP_DIRS = [];

afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetIoL1CacheForTest();
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

async function createTempDir() {
    const dir = await mkdtemp(join(tmpdir(), 'copilot-io-engine-'));
    TEMP_DIRS.push(dir);
    return dir;
}

describe('infra/io-engine', () => {
    it('rejeita parâmetros inválidos em searchText/searchWorkspaceSymbols', async () => {
        await expect(searchText('/tmp/ok', { pattern: '' })).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
        await expect(
            searchText('/tmp/ok', { pattern: 'alpha', includePattern: '*.js\u0000bad' }),
        ).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
        await expect(searchWorkspaceSymbols('/tmp/ok', { symbolName: '   ' })).rejects.toMatchObject({
            code: 'ERR_INVALID_ARG_VALUE',
        });
        await expect(
            searchWorkspaceSymbols('/tmp/ok', { symbolName: 'foo', includePattern: '*.ts\u0000bad' }),
        ).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
    });

    it('searchText pagina e conta somente a visão sanitizada', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'search-redaction.txt');
        const jwtLike = `ey${'a'.repeat(24)}.${'b'.repeat(24)}`;
        await writeFile(file, `needle ${jwtLike}\nneedle visible\n`, 'utf8');

        const result = await searchText(file, {
            pattern: 'needle',
            isRegex: false,
            caseSensitive: true,
            contextLines: 0,
            maxResults: 1,
        });

        expect(result.output).toContain('needle visible');
        expect(result.output).not.toContain(jwtLike);
        expect(result).toMatchObject({
            matchCount: 1,
            returnedMatchCount: 1,
            returnedLineCount: 1,
            totalMatches: 1,
            totalMatchCount: 1,
            totalLineCount: 1,
            sanitized: true,
            redactions: 1,
            truncated: false,
            nextCursor: null,
            countsPostSanitization: true,
        });
    });

    it('searchText interrompe stdout quando janela sanitizada já tem lookahead suficiente', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'search-early-stop.txt');
        await writeFile(
            file,
            Array.from({ length: 200 }, (_, index) => `needle ${String(index).padStart(3, '0')}`).join('\n'),
            'utf8',
        );

        const result = await searchText(file, {
            pattern: 'needle',
            isRegex: false,
            caseSensitive: true,
            contextLines: 0,
            maxResults: 2,
        });

        expect(result.output.split('\n')).toHaveLength(2);
        expect(result).toMatchObject({
            truncated: true,
            nextCursor: '2',
            returnedMatchCount: 2,
            returnedLineCount: 2,
            totalLineCount: 3,
            countsPostSanitization: true,
        });
        expect(result.io.advisoryLimits?.['streamStoppedEarly']).toBe(true);
    });

    it('searchWorkspaceSymbols interrompe stdout do rg com lookahead suficiente', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'symbols-early-stop.js');
        await writeFile(
            file,
            Array.from({ length: 80 }, () => 'function runNeedle() {}').join('\n'),
            'utf8',
        );

        const result = await searchWorkspaceSymbols(file, {
            symbolName: 'runNeedle',
            kind: 'function',
            caseSensitive: true,
            maxResults: 2,
        });

        expect(result.output.split('\n')).toHaveLength(2);
        expect(result).toMatchObject({
            truncated: true,
            nextCursor: '2',
            matchCount: 2,
            totalMatches: 3,
            countsPostSanitization: true,
        });
        expect(result.io.advisoryLimits?.['streamStoppedEarly']).toBe(true);
    });

    it('mantém contratos de retorno estáveis para readBytes/readText/writeFileAtomic', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'contract-shapes.txt');
        await writeFile(file, 'alpha\nbeta', 'utf8');

        const bytesResult = await readBytes(file);
        expect(bytesResult).toEqual(
            expect.objectContaining({
                path: file,
                content: expect.any(Buffer),
                bytesRead: expect.any(Number),
                io: expect.any(Object),
            }),
        );

        const textResult = await readText(file, { startLine: 1, endLine: 1 });
        expect(textResult).toEqual(
            expect.objectContaining({
                path: file,
                content: 'alpha',
                bytesRead: expect.any(Number),
                sizeBytes: Buffer.byteLength('alpha\nbeta', 'utf8'),
                mtimeMs: expect.any(Number),
                ctimeMs: expect.any(Number),
                dev: expect.any(Number),
                ino: expect.any(Number),
                contentHash: sha256('alpha\nbeta'),
                returnedContentHash: sha256('alpha'),
                cacheFingerprintStrategy: 'fs-read',
                totalLines: 2,
                returnedLines: { start: 1, end: 1 },
                io: expect.any(Object),
            }),
        );

        const writeResult = await writeFileAtomic(file, 'gamma');
        expect(writeResult).toEqual(
            expect.objectContaining({
                path: file,
                bytesWritten: Buffer.byteLength('gamma', 'utf8'),
                lockWaitMs: expect.any(Number),
                previousHash: null,
                contentHash: expect.any(String),
                durability: expect.objectContaining({
                    durability: 'file-and-directory',
                    fileFlushRequested: true,
                    directorySync: expect.objectContaining({ attempted: true, ok: true }),
                    capacityPreflight: expect.objectContaining({ checked: false, reason: 'below-threshold' }),
                }),
                io: expect.any(Object),
            }),
        );
        expect(writeResult.io.advisoryLimits?.['durability']).toEqual(writeResult.durability);
    });

    it.skipIf(process.platform === 'win32')('preserva permissões POSIX existentes quando atomic replace não recebe mode explícito', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'executable-script.sh');
        await writeFile(file, '#!/usr/bin/env bash\necho before\n', 'utf8');
        await chmod(file, 0o755);

        const result = await writeFileAtomic(file, '#!/usr/bin/env bash\necho after\n');
        const info = await stat(file);

        expect(info.mode & 0o777).toBe(0o755);
        expect(result.durability).toMatchObject({
            effectiveMode: 0o755,
            modeSource: 'preserved-existing',
        });
    });

    it('expõe perfis de durability sem alterar atomic publish, policy ou conteúdo final', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'durability-profiles.txt');
        await writeFile(file, 'initial', 'utf8');

        const fileProfile = await writeFileAtomic(file, 'file-profile', { durability: 'file' });
        expect(fileProfile.durability).toMatchObject({
            durability: 'file',
            fileFlushRequested: true,
            directorySync: null,
            phaseTimings: expect.objectContaining({
                tempWriteMs: expect.any(Number),
                publishMs: expect.any(Number),
                totalMs: expect.any(Number),
            }),
        });
        expect(fileProfile.durability.phaseTimings.totalMs).toBeGreaterThanOrEqual(
            fileProfile.durability.phaseTimings.publishMs,
        );
        await expect(readFile(file, 'utf8')).resolves.toBe('file-profile');

        const noneProfile = await writeFileAtomic(file, 'none-profile', { durability: 'none' });
        expect(noneProfile.durability).toMatchObject({
            durability: 'none',
            fileFlushRequested: false,
            directorySync: null,
            phaseTimings: expect.objectContaining({
                tempWriteMs: expect.any(Number),
                publishMs: expect.any(Number),
                totalMs: expect.any(Number),
            }),
        });
        await expect(readFile(file, 'utf8')).resolves.toBe('none-profile');
    });

    it('writeFileAtomic com failIfExists preserva ENOTDIR em componente intermediário', async () => {
        const dir = await createTempDir();
        const fileComponent = join(dir, 'not-a-dir');
        await writeFile(fileComponent, 'leaf', 'utf8');

        await expect(writeFileAtomic(join(fileComponent, 'child.txt'), 'payload', { failIfExists: true })).rejects.toMatchObject({
            code: 'ENOTDIR',
        });
    });

    it('mkdirPathLocked informa created=false quando diretório recursivo já existia', async () => {
        const dir = await createTempDir();
        const nested = join(dir, 'existing');
        await mkdir(nested, { recursive: true });

        const result = await mkdirPathLocked(nested, { recursive: true });

        expect(result.created).toBe(false);
        expect(result.createdPath).toBeUndefined();
        expect(result.io.advisoryLimits?.['created']).toBe(false);
    });

    it('removePathLocked exige confirmação exata antes de remoção recursiva', async () => {
        const dir = await createTempDir();
        const target = join(dir, 'recursive-target');
        await mkdir(join(target, 'nested'), { recursive: true });
        await writeFile(join(target, 'nested', 'keep.txt'), 'keep', 'utf8');

        await expect(removePathLocked(target, { recursive: true, force: true })).rejects.toMatchObject({
            code: 'ERECURSIVEREMOVECONFIRMATION',
        });
        await expect(removePathLocked(target, { recursive: true, force: true, recursiveConfirmation: `${target}-wrong` })).rejects.toMatchObject({
            code: 'ERECURSIVEREMOVECONFIRMATION',
        });
        await expect(readFile(join(target, 'nested', 'keep.txt'), 'utf8')).resolves.toBe('keep');

        const result = await removePathLocked(target, { recursive: true, force: true, recursiveConfirmation: target });
        expect(result.io.advisoryLimits?.['recursiveConfirmed']).toBe(true);
        await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('readText retorna range vazio consistente quando startLine passa do fim', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'notes.txt');
        await writeFile(file, 'a\nb\nc', 'utf8');

        const result = await readText(file, { startLine: 10 });

        expect(result.content).toBe('');
        expect(result.totalLines).toBe(3);
        expect(result.returnedLines).toEqual({ start: 4, end: 3 });
        expect(result.io.engine).toBe('io-engine.fs.readFile.text');
    });

    it('readText reutiliza cache completo e ainda respeita ranges posteriores', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'cached-range.txt');
        await writeFile(file, 'one\ntwo\nthree', 'utf8');

        const full = await readText(file);
        const range = await readText(file, { startLine: 2, endLine: 2 });

        expect(full.content).toBe('one\ntwo\nthree');
        expect(range.content).toBe('two');
        expect(range.contentHash).toBe(sha256('one\ntwo\nthree'));
        expect(range.returnedContentHash).toBe(sha256('two'));
        expect(range.cacheFingerprintStrategy).toBe('fs-read');
        expect(range.totalLines).toBe(3);
        expect(range.returnedLines).toEqual({ start: 2, end: 2 });
        expect(range.io.cache).toBe('l1-hit');
    });

    it('readText e readLines compartilham semântica física para CRLF e CR isolado', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'physical-lines.txt');
        await writeFile(file, 'one\r\ntwo\rthree\nfour', 'utf8');

        const range = await readText(file, { startLine: 2, endLine: 3 });
        const lines = await readLines(file, { startLine: 2, endLine: 3 });

        expect(range.content).toBe('two\rthree');
        expect(range.totalLines).toBe(4);
        expect(lines.content).toBe('two\rthree');
        expect(lines.lines).toEqual(['two', 'three']);
        expect(lines.totalLines).toBe(4);
    });

    it('readBytes usa L2 em miss de L1 e reaquece L1 para próxima leitura', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'l2-hit.bin');
        const payload = Buffer.from('L2_PAYLOAD', 'utf8');
        await writeFile(file, payload);
        const fileStat = await stat(file);

        const l2Mock = {
            get: vi.fn(() => ({
                key: 'mock-key',
                path: file,
                kind: 'bytes',
                payload,
                sizeBytes: payload.length,
                mtimeMs: Number(fileStat.mtimeMs),
                createdAtMs: Date.now(),
                expiresAtMs: Date.now() + 60_000,
            })),
            set: vi.fn(),
            invalidatePath: vi.fn(),
        };
        vi.spyOn(ioCacheL2Registry, 'getIoL2Cache').mockReturnValue(/** @type {any} */ (l2Mock));

        const first = await readBytes(file);
        expect(first.content.toString('utf8')).toBe('L2_PAYLOAD');
        expect(first.io.cache).toBe('l2-hit');
        expect(first.contentHash).toBe(sha256(payload));
        expect(first.cacheFingerprintStrategy).toBe('l2-mtime-size');
        expect(l2Mock.get).toHaveBeenCalledTimes(1);

        const second = await readBytes(file);
        expect(second.content.toString('utf8')).toBe('L2_PAYLOAD');
        expect(second.io.cache).toBe('l1-hit');
        expect(l2Mock.get).toHaveBeenCalledTimes(1);
    });

    it('writeFileAtomic não falha quando invalidação L2 lança erro (best-effort)', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'invalidate-best-effort.txt');
        await writeFile(file, 'before', 'utf8');

        const l2Mock = {
            get: vi.fn(() => null),
            set: vi.fn(),
            invalidatePath: vi.fn(() => {
                throw new Error('l2 invalidate failed');
            }),
        };
        vi.spyOn(ioCacheL2Registry, 'getIoL2Cache').mockReturnValue(/** @type {any} */ (l2Mock));

        const result = await writeFileAtomic(file, 'after');
        expect(result.bytesWritten).toBe(Buffer.byteLength('after', 'utf8'));
        await expect(readFile(file, 'utf8')).resolves.toBe('after');
        expect(l2Mock.invalidatePath).toHaveBeenCalled();
    });

    it('readTextChunks pagina leitura por linhas com metadados observáveis', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'chunks.txt');
        await writeFile(file, 'l1\nl2\nl3\nl4\nl5', 'utf8');

        const result = await readTextChunks(file, { chunkLines: 2, startLine: 2, endLine: 5 });

        expect(result.totalLines).toBe(5);
        expect(result.chunks).toEqual([
            { index: 0, startLine: 2, endLine: 3, content: 'l2\nl3', bytes: 5 },
            { index: 1, startLine: 4, endLine: 5, content: 'l4\nl5', bytes: 5 },
        ]);
        expect(result.totalLinesKnown).toBe(true);
        expect(result.fileTotalLinesKnown).toBe(true);
        expect(result.fileTotalLines).toBe(5);
        expect(result.cacheFingerprintStrategy).toBe('byte-line-index');
        expect(result.io.engine).toBe('io-engine.fs.createReadStream.textChunks.byteSeek');
        expect(result.io.advisoryLimits?.['limitMode']).toBe('informative');
    });

    it('readTextChunks usa byte seek com UTF-8 multibyte sem cortar caracteres', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'chunks-multibyte.txt');
        await writeFile(file, ['linha 1', 'ação 🚀', '日本語', 'emoji 😀 final'].join('\n'), 'utf8');

        const result = await readTextChunks(file, { chunkLines: 1, startLine: 2, endLine: 4 });

        expect(result.chunks.map((chunk) => chunk.content)).toEqual(['ação 🚀', '日本語', 'emoji 😀 final']);
        expect(result.totalLines).toBe(4);
        expect(result.totalLinesKnown).toBe(true);
        expect(result.cacheFingerprintStrategy).toBe('byte-line-index');
        expect(result.io.engine).toBe('io-engine.fs.createReadStream.textChunks.byteSeek');
    });

    it('readTextChunks preserva fallback de stream scan quando byte-line index é desativado', async () => {
        vi.stubEnv('COPILOT_IO_BYTE_LINE_INDEX_DISABLE', 'true');
        const dir = await createTempDir();
        const file = join(dir, 'chunks-fallback.txt');
        await writeFile(file, 'a\nb\nc\nd', 'utf8');

        const result = await readTextChunks(file, { chunkLines: 2, startLine: 2, endLine: 3 });

        expect(result.chunks.map((chunk) => chunk.content)).toEqual(['b\nc']);
        expect(result.cacheFingerprintStrategy).toBe('stream-bypass');
        expect(result.io.engine).toBe('io-engine.fs.createReadStream.textChunks');
    });

    it('createOrReplaceFileAtomic reporta bytes reais de UTF-8 multibyte', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'emoji.txt');

        const result = await createOrReplaceFileAtomic(file, 'ação 🚀');

        expect(result.bytesWritten).toBe(Buffer.byteLength('ação 🚀', 'utf8'));
        await expect(readFile(file, 'utf8')).resolves.toBe('ação 🚀');
        expect(result.io.operation).toBe('write');
    });

    it('copyFileLocked falha em overwrite direto quando destino existe', async () => {
        const dir = await createTempDir();
        const source = join(dir, 'source.txt');
        const destination = join(dir, 'destination.txt');
        await writeFile(source, 'source', 'utf8');
        await writeFile(destination, 'existing', 'utf8');

        await expect(copyFileLocked(source, destination, { overwrite: false })).rejects.toMatchObject({
            code: 'EEXIST',
        });
        await expect(readFile(destination, 'utf8')).resolves.toBe('existing');
    });

    it('copyFileLocked com overwrite captura snapshot/hash do destino anterior para rollback', async () => {
        const dir = await createTempDir();
        const source = join(dir, 'copy-source.txt');
        const destination = join(dir, 'copy-destination.txt');
        await writeFile(source, 'source-content', 'utf8');
        await writeFile(destination, 'old-destination', 'utf8');
        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'true');

        const result = await copyFileLocked(source, destination, { overwrite: true });

        expect(result.destinationPreviousHash).toBe(sha256('old-destination'));
        expect(result.destinationPreviousBytes).toBe(Buffer.byteLength('old-destination', 'utf8'));
        expect(result.destinationPreviousSnapshotBase64).toBe(
            Buffer.from('old-destination', 'utf8').toString('base64'),
        );
        expect(result.destinationPreviousSnapshotTruncated).toBe(false);
        expect(result.fileSync).toMatchObject({ attempted: true, ok: true });
        expect(result.destinationDirectorySync).toMatchObject({ attempted: true, ok: true });
        expect(result.io.advisoryLimits?.['fileSync']).toEqual(result.fileSync);
        expect(result.io.advisoryLimits?.['destinationDirectorySync']).toEqual(result.destinationDirectorySync);
        expect(result.io.advisoryLimits?.['capacityPreflight']).toEqual(result.capacityPreflight);
        await expect(readFile(destination, 'utf8')).resolves.toBe('source-content');
    });

    it('copyFileLocked aguarda lock ativo no source', async () => {
        const dir = await createTempDir();
        const source = join(dir, 'source.txt');
        const destination = join(dir, 'destination.txt');
        await writeFile(source, 'source', 'utf8');
        await mkdir(join(dir, 'nested'), { recursive: true });

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            source,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let copied = false;
        const copy = copyFileLocked(source, destination).then((result) => {
            copied = true;
            return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(copied).toBe(false);

        release();
        await holder;
        const result = await copy;
        expect(copied).toBe(true);
        expect(result.lockWaitMs).toBeGreaterThanOrEqual(1);
        expect(result.sourceHash).toBe(sha256('source'));
        expect(result.sourceBytes).toBe(Buffer.byteLength('source', 'utf8'));
        await expect(readFile(destination, 'utf8')).resolves.toBe('source');
    });

    it('writeFileAtomic aguarda lock ativo no mesmo arquivo antes de escrever', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'write-vs-write.txt');
        await writeFile(file, 'before', 'utf8');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            file,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let written = false;
        const write = writeFileAtomic(file, 'after').then((result) => {
            written = true;
            return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(written).toBe(false);
        await expect(readFile(file, 'utf8')).resolves.toBe('before');

        release();
        await holder;
        const result = await write;

        expect(written).toBe(true);
        expect(result.lockWaitMs).toBeGreaterThanOrEqual(1);
        await expect(readFile(file, 'utf8')).resolves.toBe('after');
    });

    it('writeFileAtomic respeita expectedHash antes de sobrescrever', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'expected-hash-write.txt');
        await writeFile(file, 'before', 'utf8');

        const ok = await writeFileAtomic(file, 'after', { expectedHash: sha256('before') });

        expect(ok.previousHash).toBe(sha256('before'));
        expect(ok.contentHash).toBe(sha256('after'));
        await expect(readFile(file, 'utf8')).resolves.toBe('after');

        await expect(writeFileAtomic(file, 'nope', { expectedHash: sha256('stale') })).rejects.toMatchObject({
            code: 'EEXPECTEDHASH',
        });
        await expect(readFile(file, 'utf8')).resolves.toBe('after');
    });

    it('writeFileAtomic com failIfExists não sobrescreve destino existente', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'exclusive-create.txt');
        await writeFile(file, 'existing', 'utf8');

        await expect(writeFileAtomic(file, 'incoming', { failIfExists: true })).rejects.toMatchObject({
            code: 'EEXIST',
        });
        await expect(readFile(file, 'utf8')).resolves.toBe('existing');
    });

    it('patchTextBatchLocked encadeia hashes sem alterar preconditions ou hashes externos', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'hash-chain-patch.txt');
        const initial = 'alpha beta gamma';
        const afterFirst = 'alpha BETA gamma';
        const final = 'alpha BETA GAMMA';
        await writeFile(file, initial, 'utf8');

        const result = await patchTextBatchLocked(file, {
            dryRun: true,
            operations: [
                { oldString: 'beta', newString: 'BETA', expectedHash: sha256(initial) },
                { oldString: 'gamma', newString: 'GAMMA', expectedHash: sha256(afterFirst) },
            ],
        });

        expect(result.previousHash).toBe(sha256(initial));
        expect(result.operations[0]?.['previousHash']).toBe(sha256(initial));
        expect(result.operations[0]?.['contentHash']).toBe(sha256(afterFirst));
        expect(result.operations[1]?.['previousHash']).toBe(sha256(afterFirst));
        expect(result.operations[1]?.['contentHash']).toBe(sha256(final));
        expect(result.contentHash).toBe(sha256(final));
        await expect(readFile(file, 'utf8')).resolves.toBe(initial);
    });

    it('patchTextLocked respeita expectedHash antes de aplicar patch', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'expected-hash-patch.txt');
        await writeFile(file, 'alpha beta', 'utf8');

        const patched = await patchTextLocked(file, {
            oldString: 'beta',
            newString: 'gamma',
            expectedHash: sha256('alpha beta'),
        });

        expect(patched.previousHash).toBe(sha256('alpha beta'));
        expect(patched.contentHash).toBe(sha256('alpha gamma'));
        await expect(readFile(file, 'utf8')).resolves.toBe('alpha gamma');

        await expect(
            patchTextLocked(file, { oldString: 'gamma', newString: 'delta', expectedHash: sha256('alpha beta') }),
        ).rejects.toMatchObject({ code: 'EEXPECTEDHASH' });
        await expect(readFile(file, 'utf8')).resolves.toBe('alpha gamma');
    });

    it('patchTextLocked dryRun calcula patch sem escrever no disco', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'dry-run-patch.txt');
        await writeFile(file, 'alpha beta', 'utf8');

        const result = await patchTextLocked(file, {
            oldString: 'beta',
            newString: 'gamma',
            expectedHash: sha256('alpha beta'),
            dryRun: true,
        });

        expect(result.dryRun).toBe(true);
        expect(result.bytesWritten).toBe(0);
        expect(result.projectedBytes).toBe(Buffer.byteLength('alpha gamma', 'utf8'));
        expect(result.contentHash).toBe(sha256('alpha gamma'));
        expect(result.diffPreview).toContain('-alpha beta');
        expect(result.diffPreview).toContain('+alpha gamma');
        expect(result.diffPreviewTruncated).toBe(false);
        await expect(readFile(file, 'utf8')).resolves.toBe('alpha beta');
    });

    it('patchTextLocked allowNoop não regrava nem invalida o arquivo', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'noop-patch.txt');
        await writeFile(file, 'stable content', 'utf8');
        const before = await stat(file);

        const result = await patchTextLocked(file, {
            oldString: 'stable content',
            newString: 'stable content',
            allowNoop: true,
        });
        const after = await stat(file);

        expect(result).toMatchObject({
            noop: true,
            bytesWritten: 0,
            previousSnapshotBase64: null,
            previousRollbackSidecar: null,
            capacityPreflight: null,
        });
        expect(after.ino).toBe(before.ino);
        expect(after.mtimeMs).toBe(before.mtimeMs);
        await expect(readFile(file, 'utf8')).resolves.toBe('stable content');
    });

    it('patchTextLocked rejeita bytes inválidos para UTF-8 sem regravar arquivo', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'binary-patch.bin');
        const original = Buffer.from([0xff, 0x00, 0x61]);
        await writeFile(file, original);

        await expect(
            patchTextLocked(file, {
                oldString: 'a',
                newString: 'b',
            }),
        ).rejects.toMatchObject({ name: 'BinaryFileError' });
        await expect(readFile(file)).resolves.toEqual(original);
    });

    it('patchTextLocked aplica occurrenceIndex para conteúdo repetido', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'occurrence-index-patch.txt');
        await writeFile(file, 'value=1\nvalue=1\n', 'utf8');

        const result = await patchTextLocked(file, {
            oldString: 'value=1',
            newString: 'value=2',
            occurrenceIndex: 2,
        });

        expect(result.occurrences).toBe(2);
        expect(result.replacedOccurrences).toBe(1);
        expect(result.occurrenceIndex).toBe(2);
        expect(result.firstMatchLine).toBe(1);
        expect(result.lastMatchLine).toBe(2);
        await expect(readFile(file, 'utf8')).resolves.toBe('value=1\nvalue=2\n');
    });

    it('moveFileLocked aguarda lock ativo no source antes de mover', async () => {
        const dir = await createTempDir();
        const source = join(dir, 'write-vs-move.txt');
        const destination = join(dir, 'moved.txt');
        await writeFile(source, 'source', 'utf8');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            source,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let moved = false;
        const move = moveFileLocked(source, destination).then((result) => {
            moved = true;
            return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(moved).toBe(false);
        await expect(readFile(source, 'utf8')).resolves.toBe('source');

        release();
        await holder;
        const result = await move;

        expect(moved).toBe(true);
        expect(result.lockWaitMs).toBeGreaterThanOrEqual(1);
        expect(result.sourceHash).toBe(sha256('source'));
        expect(result.sourceBytes).toBe(Buffer.byteLength('source', 'utf8'));
        await expect(readFile(destination, 'utf8')).resolves.toBe('source');
        await expect(readFile(source, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('moveFileLocked com overwrite captura snapshot/hash do destino anterior para rollback', async () => {
        const dir = await createTempDir();
        const source = join(dir, 'move-source.txt');
        const destination = join(dir, 'move-destination.txt');
        await writeFile(source, 'incoming', 'utf8');
        await writeFile(destination, 'existing-destination', 'utf8');
        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'true');

        const result = await moveFileLocked(source, destination, { overwrite: true });

        expect(result.destinationPreviousHash).toBe(sha256('existing-destination'));
        expect(result.destinationPreviousBytes).toBe(Buffer.byteLength('existing-destination', 'utf8'));
        expect(result.destinationPreviousSnapshotBase64).toBe(
            Buffer.from('existing-destination', 'utf8').toString('base64'),
        );
        expect(result.destinationPreviousSnapshotTruncated).toBe(false);
        expect(result.fileSync).toBeNull();
        expect(result.destinationDirectorySync).toMatchObject({ attempted: true, ok: true });
        expect(result.sourceDirectorySync).toBeNull();
        expect(result.capacityPreflight).toBeNull();
        expect(result.io.advisoryLimits?.['destinationDirectorySync']).toEqual(result.destinationDirectorySync);
        await expect(readFile(destination, 'utf8')).resolves.toBe('incoming');
        await expect(readFile(source, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('patchTextLocked retorna snapshot base64 do conteúdo anterior para rollback', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'patch-snapshot.txt');
        await writeFile(file, 'before patch', 'utf8');
        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'true');

        const result = await patchTextLocked(file, {
            oldString: 'before',
            newString: 'after',
        });

        expect(result.previousSnapshotBase64).toBe(Buffer.from('before patch', 'utf8').toString('base64'));
        expect(result.previousSnapshotTruncated).toBe(false);
        await expect(readFile(file, 'utf8')).resolves.toBe('after patch');
    });

    it('deleteFileLocked preserva arquivo grande em sidecar antes de remover', async () => {
        const dir = await createTempDir();
        const rollbackDirectory = join(dir, 'rollback-delete');
        const file = join(dir, 'delete-large.bin');
        const payload = Buffer.alloc(300 * 1024, 'd');
        vi.stubEnv('COPILOT_IO_ROLLBACK_DIR', rollbackDirectory);
        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'true');
        await writeFile(file, payload);

        const result = await deleteFileLocked(file);

        expect(result.previousSnapshotBase64).toBeNull();
        expect(result.previousSnapshotTruncated).toBe(true);
        expect(result.previousRollbackSidecar).toMatchObject({
            contentHash: sha256(payload),
            bytes: payload.byteLength,
        });
        await expect(readFile(result.previousRollbackSidecar?.path ?? '')).resolves.toEqual(payload);
        await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('patchTextLocked referencia sidecar do conteúdo grande anterior', async () => {
        const dir = await createTempDir();
        const rollbackDirectory = join(dir, 'rollback-patch');
        const file = join(dir, 'patch-large.txt');
        const content = `${'a'.repeat(300 * 1024)} before`;
        vi.stubEnv('COPILOT_IO_ROLLBACK_DIR', rollbackDirectory);
        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'true');
        await writeFile(file, content, 'utf8');

        const result = await patchTextLocked(file, {
            oldString: 'before',
            newString: 'after',
            computeDiff: false,
        });

        expect(result.previousSnapshotBase64).toBeNull();
        expect(result.previousRollbackSidecar).toMatchObject({
            contentHash: sha256(content),
            bytes: Buffer.byteLength(content),
        });
        await expect(readFile(result.previousRollbackSidecar?.path ?? '', 'utf8')).resolves.toBe(content);
        await expect(readFile(file, 'utf8')).resolves.toBe(`${'a'.repeat(300 * 1024)} after`);
    });

    it('patchTextLocked não materializa snapshot nem sidecar quando rollback automático está desligado', async () => {
        const dir = await createTempDir();
        const rollbackDirectory = join(dir, 'rollback-default-off');
        const file = join(dir, 'patch-default-off.txt');
        const content = `${'z'.repeat(300 * 1024)} before`;
        vi.stubEnv('COPILOT_IO_ROLLBACK_DIR', rollbackDirectory);
        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'false');
        await writeFile(file, content, 'utf8');

        const result = await patchTextLocked(file, {
            oldString: 'before',
            newString: 'after',
            computeDiff: false,
        });

        expect(result.rollbackCaptureEnabled).toBe(false);
        expect(result.previousSnapshotBase64).toBeNull();
        expect(result.previousSnapshotTruncated).toBe(false);
        expect(result.previousRollbackSidecar).toBeNull();
        await expect(readdir(rollbackDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(file, 'utf8')).resolves.toBe(`${'z'.repeat(300 * 1024)} after`);
    });

    it('deleteFileLocked mantém hash/tamanho sem persistir rollback quando a política está desligada', async () => {
        const dir = await createTempDir();
        const rollbackDirectory = join(dir, 'rollback-delete-default-off');
        const file = join(dir, 'delete-default-off.bin');
        const payload = Buffer.alloc(300 * 1024, 'q');
        vi.stubEnv('COPILOT_IO_ROLLBACK_DIR', rollbackDirectory);
        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'false');
        await writeFile(file, payload);

        const result = await deleteFileLocked(file);

        expect(result.previousHash).toBe(sha256(payload));
        expect(result.previousBytes).toBe(payload.byteLength);
        expect(result.previousSnapshotBase64).toBeNull();
        expect(result.previousSnapshotTruncated).toBe(false);
        expect(result.previousRollbackSidecar).toBeNull();
        await expect(readdir(rollbackDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('patchTextLocked dry-run não cria sidecar para conteúdo grande', async () => {
        const dir = await createTempDir();
        const rollbackDirectory = join(dir, 'rollback-patch-dry-run');
        const file = join(dir, 'patch-large-dry-run.txt');
        const content = `${'a'.repeat(300 * 1024)} before`;
        vi.stubEnv('COPILOT_IO_ROLLBACK_DIR', rollbackDirectory);
        await writeFile(file, content, 'utf8');

        const result = await patchTextLocked(file, {
            oldString: 'before',
            newString: 'after',
            computeDiff: false,
            dryRun: true,
        });

        expect(result.rollbackCaptureEnabled).toBe(false);
        expect(result.previousSnapshotTruncated).toBe(false);
        expect(result.previousRollbackSidecar).toBeNull();
        await expect(readdir(rollbackDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(file, 'utf8')).resolves.toBe(content);
    });

    it('mkdirPathLocked aguarda lock ativo no diretório antes de criar', async () => {
        const dir = await createTempDir();
        const nested = join(dir, 'locked-dir');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            nested,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let created = false;
        const creation = mkdirPathLocked(nested, { recursive: true }).then((result) => {
            created = true;
            return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(created).toBe(false);

        release();
        await holder;
        const result = await creation;

        expect(created).toBe(true);
        expect(result.lockWaitMs).toBeGreaterThanOrEqual(1);
        await expect(stat(nested)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
        expect((await stat(nested)).isDirectory()).toBe(true);
        expect(result.io.operation).toBe('mkdir');
        expect(result.io.engine).toBe('io-engine.fs.mkdir');
    });

    it('deleteFileLocked aguarda lock ativo no arquivo antes de deletar', async () => {
        const dir = await createTempDir();
        const file = join(dir, 'write-vs-delete.txt');
        await writeFile(file, 'source', 'utf8');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            file,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let deleted = false;
        const deletion = deleteFileLocked(file).then((result) => {
            deleted = true;
            return result;
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(deleted).toBe(false);
        await expect(readFile(file, 'utf8')).resolves.toBe('source');

        release();
        await holder;
        const result = await deletion;

        expect(deleted).toBe(true);
        expect(result.lockWaitMs).toBeGreaterThanOrEqual(1);
        expect(result.previousHash).toBe(sha256('source'));
        expect(result.previousBytes).toBe(Buffer.byteLength('source', 'utf8'));
        await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('withIoResourceLock respeita timeout enquanto aguarda lock anterior', async () => {
        const dir = await createTempDir();
        const resource = join(dir, 'busy.txt');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            resource,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        let executed = false;

        try {
            await expect(
                withIoResourceLock(
                    resource,
                    async () => {
                        executed = true;
                    },
                    { timeoutMs: 5 },
                ),
            ).rejects.toMatchObject({ code: 'ETIMEDOUT', name: 'TimeoutError' });
            expect(executed).toBe(false);
        } finally {
            release();
            await holder;
        }
    });

    it('withIoResourceLock respeita AbortSignal antes de executar operação protegida', async () => {
        const dir = await createTempDir();
        const resource = join(dir, 'abort.txt');

        /** @type {() => void} */
        let release = () => {};
        const holder = withIoResourceLock(
            resource,
            () =>
                new Promise((resolve) => {
                    release = () => resolve(undefined);
                }),
        );
        const controller = new AbortController();
        let executed = false;

        const queued = withIoResourceLock(
            resource,
            async () => {
                executed = true;
            },
            { signal: controller.signal },
        );
        controller.abort();

        try {
            await expect(queued).rejects.toMatchObject({ code: 'ABORT_ERR', name: 'AbortError' });
            expect(executed).toBe(false);
        } finally {
            release();
            await holder;
        }
    });

    it('acquireIoResourceLock cria lockfile L1 quando habilitado explicitamente', async () => {
        const dir = await createTempDir();
        const lockDir = join(dir, '.locks');
        const resource = join(dir, 'locked.txt');

        const lease = await acquireIoResourceLock(resource, {
            fileLock: true,
            fileLockDir: lockDir,
            operation: 'unit-test',
            target: resource,
            timeoutMs: 500,
        });
        try {
            expect(lease.fileLockEnabled).toBe(true);
            expect(lease.fileLockPath).toBe(getFileResourceLockPath(resource, lockDir));
            expect(await readdir(lockDir)).toHaveLength(1);
            expect(getIoLockStats().fileLocks.activeLeases).toBeGreaterThanOrEqual(1);
        } finally {
            await lease.releaseAsync();
        }

        expect(await readdir(lockDir)).toEqual([]);
    });

    it('acquireIoResourceLock recupera lockfile stale por PID morto', async () => {
        const dir = await createTempDir();
        const lockDir = join(dir, '.locks');
        const resource = join(dir, 'stale.txt');
        await mkdir(lockDir, { recursive: true });
        const lockPath = getFileResourceLockPath(resource, lockDir);
        await writeFile(
            lockPath,
            `${JSON.stringify({
                schemaVersion: 1,
                token: 'stale-token',
                pid: 999_999_999,
                hostname: hostname(),
                resourceKey: resource,
                resourceHash: 'stale-hash',
                operation: 'stale-test',
                target: resource,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                startedAtMs: Date.now() - 60_000,
            })}\n`,
            'utf8',
        );

        const lease = await acquireIoResourceLock(resource, {
            fileLock: true,
            fileLockDir: lockDir,
            operation: 'unit-test',
            target: resource,
            timeoutMs: 500,
        });
        try {
            expect(lease.fileLockEnabled).toBe(true);
            expect(lease.staleFileLockRecovered).toBe(true);
            const metadata = JSON.parse(await readFile(lockPath, 'utf8'));
            expect(metadata.token).not.toBe('stale-token');
            expect(metadata.pid).toBe(process.pid);
        } finally {
            await lease.releaseAsync();
        }
    });

    it('acquireIoResourceLock não rouba lock local antigo de PID vivo', async () => {
        const dir = await createTempDir();
        const lockDir = join(dir, '.locks');
        const resource = join(dir, 'live-old.txt');
        await mkdir(lockDir, { recursive: true });
        const lockPath = getFileResourceLockPath(resource, lockDir);
        await writeFile(
            lockPath,
            `${JSON.stringify({
                schemaVersion: 1,
                token: 'live-token',
                pid: process.pid,
                hostname: hostname(),
                resourceKey: resource,
                resourceHash: 'live-hash',
                operation: 'long-running-test',
                target: resource,
                startedAt: new Date(Date.now() - 60_000).toISOString(),
                startedAtMs: Date.now() - 60_000,
            })}\n`,
            'utf8',
        );

        await expect(
            acquireIoResourceLock(resource, {
                fileLock: true,
                fileLockDir: lockDir,
                operation: 'contender',
                target: resource,
                timeoutMs: 30,
                fileLockStaleMs: 10,
            }),
        ).rejects.toMatchObject({ code: 'ETIMEDOUT', name: 'TimeoutError' });
        expect(JSON.parse(await readFile(lockPath, 'utf8')).token).toBe('live-token');
    });

    it('acquireIoResourceLock não remove metadata inválida recente', async () => {
        const dir = await createTempDir();
        const lockDir = join(dir, '.locks');
        const resource = join(dir, 'partial-metadata.txt');
        await mkdir(lockDir, { recursive: true });
        const lockPath = getFileResourceLockPath(resource, lockDir);
        await writeFile(lockPath, '', 'utf8');

        await expect(
            acquireIoResourceLock(resource, {
                fileLock: true,
                fileLockDir: lockDir,
                operation: 'contender',
                target: resource,
                timeoutMs: 30,
                fileLockStaleMs: 1_000,
            }),
        ).rejects.toMatchObject({ code: 'ETIMEDOUT', name: 'TimeoutError' });
        expect(await readFile(lockPath, 'utf8')).toBe('');
    });

    it('scanDirectory centraliza listagem, filtro, hidden e metadata de scan', async () => {
        const dir = await createTempDir();
        await writeFile(join(dir, 'visible.txt'), 'visible', 'utf8');
        await writeFile(join(dir, 'ignored.log'), 'ignored', 'utf8');
        await writeFile(join(dir, '.gitignore'), 'ignored.log\n', 'utf8');
        await writeFile(join(dir, '.hidden.txt'), 'hidden', 'utf8');
        await mkdir(join(dir, 'sub'), { recursive: true });
        await writeFile(join(dir, 'sub', 'nested.md'), 'nested', 'utf8');
        await writeFile(join(dir, 'sub', 'skip.tmp'), 'skip', 'utf8');
        await mkdir(join(dir, '.git'), { recursive: true });
        await writeFile(join(dir, '.git', 'config'), 'protected', 'utf8');
        await mkdir(join(dir, 'node_modules'), { recursive: true });
        await writeFile(join(dir, 'node_modules', 'pkg.js'), 'protected', 'utf8');

        const shallow = await scanDirectory(dir, { workspaceRoot: dir, recursive: false, respectGitignore: true });
        expect(shallow.io.operation).toBe('scan');
        expect(shallow.io.engine).toBe('io-scanner.fs.readdir');
        expect(shallow.entries.map((entry) => entry.name)).toEqual(['sub', 'visible.txt']);
        expect(shallow.entries.some((entry) => entry.name === 'ignored.log')).toBe(false);
        expect(shallow.entries.find((entry) => entry.name === 'visible.txt')?.fingerprint).toMatchObject({
            size: 'visible'.length,
        });

        const visibleOnly = await scanDirectory(dir, {
            workspaceRoot: dir,
            recursive: true,
            depth: 2,
            filter: '*.md',
        });
        const sub = visibleOnly.entries.find((entry) => entry.name === 'sub');
        expect(sub?.children?.map((entry) => entry.name)).toEqual(['nested.md']);
        expect(visibleOnly.entries.some((entry) => entry.name === '.hidden.txt')).toBe(false);

        const withHidden = await scanDirectory(dir, { workspaceRoot: dir, showHidden: true, respectGitignore: true });
        expect(withHidden.entries.map((entry) => entry.name)).toContain('.hidden.txt');
        expect(withHidden.entries.map((entry) => entry.name)).not.toContain('.git');
        expect(withHidden.entries.map((entry) => entry.name)).not.toContain('node_modules');
        expect(withHidden.io.advisoryLimits).toMatchObject({ denylist: 'enabled', gitignore: 'enabled' });

        const included = await scanDirectory(dir, {
            workspaceRoot: dir,
            recursive: true,
            depth: 2,
            include: ['*.md'],
            exclude: ['skip.tmp'],
            concurrency: 2,
        });
        const includedSub = included.entries.find((entry) => entry.name === 'sub');
        expect(includedSub?.children?.map((entry) => entry.name)).toEqual(['nested.md']);
        expect(included.io.advisoryLimits).toMatchObject({
            includePatternCount: 1,
            excludePatternCount: 1,
            concurrency: 2,
            fingerprint: true,
        });
    });
});
