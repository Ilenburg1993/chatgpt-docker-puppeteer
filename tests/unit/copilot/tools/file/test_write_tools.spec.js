// @ts-check
/**
 * File write tools — semantic boundary tests.
 *
 * These tests intentionally stop at the workspace-io boundary. Atomic publish, fsync, EXDEV fallback, descriptor
 * lifecycle and rollback sidecar durability are covered by the infra/io suites; this file proves that tools issue the
 * right path capabilities, preserve mutation preconditions, map IO outcomes to tool envelopes and never fall back to a
 * string path after validatePath already issued a validated capability.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toolMocks = vi.hoisted(() => ({
    log: vi.fn(),
    buildTool: vi.fn((config) => config),
    withSkipPermission: vi.fn((tool) => tool),
}));

const workspaceIoMocks = vi.hoisted(() => ({
    writeFileAtomic: vi.fn(),
    writeFileAtomicValidated: vi.fn(),
    createOrReplaceFileAtomic: vi.fn(),
    createOrReplaceFileAtomicValidated: vi.fn(),
    deleteFileLocked: vi.fn(),
    copyFileLocked: vi.fn(),
    copyFileLockedValidated: vi.fn(),
    moveFileLocked: vi.fn(),
    moveFileLockedValidated: vi.fn(),
    patchTextLocked: vi.fn(),
    patchTextLockedValidated: vi.fn(),
    patchTextBatchLocked: vi.fn(),
    patchTextBatchLockedValidated: vi.fn(),
}));

const mockValidatePath = vi.hoisted(() => vi.fn());

vi.mock('#copilot/infra/public/filesystem/workspace', () => ({
    createWorkspaceIo: vi.fn(() => workspaceIoMocks),
}));

vi.mock('#copilot/tools/file/shared', () => ({
    validatePath: mockValidatePath,
    WORKSPACE_ROOT: '/workspace',
}));

vi.mock('../../../../../src/copilot/tools/infra/logger.js', () => ({
    log: toolMocks.log,
}));

vi.mock('../../../../../src/copilot/tools/infra/tool-factory.js', () => ({
    buildTool: toolMocks.buildTool,
    withSkipPermission: toolMocks.withSkipPermission,
}));

const { fileWriteTools } = await import('../../../../../src/copilot/tools/file/write-tools.js');

/** @param {string} name */
function requireTool(name) {
    const tool = fileWriteTools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Tool não encontrada: ${name}`);
    return /** @type {any} */ (tool);
}

const writeFileContentTool = requireTool('write_file_content');
const createFileTool = requireTool('create_file');
const deleteFileTool = requireTool('delete_file');
const copyFileTool = requireTool('copy_file');
const moveFileTool = requireTool('move_file');
const patchFileTool = requireTool('patch_file');
const rollbackFileChangesTool = requireTool('rollback_file_changes');
const rollbackSidecarsStatusTool = requireTool('rollback_sidecars_status');

/** @param {string} operation @param {string} traceId */
function ioMeta(operation, traceId) {
    return {
        operation,
        targetKind: 'file',
        traceId,
        durationMs: 1,
    };
}

/** @param {number} [bytesWritten] */
function writeOutcome(bytesWritten = 5) {
    return {
        bytesWritten,
        previousHash: 'previous-hash',
        contentHash: 'content-hash',
        previousBytes: 3,
        previousSnapshotBase64: Buffer.from('old').toString('base64'),
        previousRollbackSidecar: null,
        io: ioMeta('write', 'trace-write'),
    };
}

/** @param {{ overwrite?: boolean; bytesWritten?: number }} [options] */
function createOutcome(options = {}) {
    const overwrite = options.overwrite === true;
    const bytesWritten = options.bytesWritten ?? 5;
    return {
        bytesWritten,
        previousHash: overwrite ? 'previous-hash' : null,
        contentHash: 'content-hash',
        previousBytes: overwrite ? 3 : 0,
        previousSnapshotBase64: overwrite ? Buffer.from('old').toString('base64') : null,
        previousRollbackSidecar: null,
        io: ioMeta('write', 'trace-create'),
    };
}

function deleteOutcome() {
    return {
        deleted: true,
        path: '/workspace/doomed.txt',
        previousHash: 'previous-hash',
        previousBytes: 6,
        previousSnapshotBase64: Buffer.from('doomed').toString('base64'),
        previousRollbackSidecar: null,
        io: ioMeta('delete', 'trace-delete'),
    };
}

function copyOutcome() {
    return {
        bytesWritten: 6,
        sourceBytes: 6,
        sourceHash: 'source-hash',
        destinationHash: 'destination-hash',
        staged: true,
        destinationPreviousHash: null,
        destinationPreviousBytes: 0,
        destinationPreviousSnapshotBase64: null,
        destinationPreviousSnapshotTruncated: false,
        destinationPreviousRollbackSidecar: null,
        lockWaitMs: 0,
        io: ioMeta('copy', 'trace-copy'),
    };
}

/** @param {{ crossDevice?: boolean; overwrite?: boolean }} [options] */
function moveOutcome(options = {}) {
    return {
        sourceBytes: 4,
        sourceHash: 'source-hash',
        destinationPreviousHash: options.overwrite ? 'destination-previous-hash' : null,
        destinationPreviousBytes: options.overwrite ? 7 : 0,
        destinationPreviousSnapshotBase64: options.overwrite ? Buffer.from('old-dst').toString('base64') : null,
        destinationPreviousSnapshotTruncated: false,
        destinationPreviousRollbackSidecar: null,
        crossDevice: options.crossDevice === true,
        duplicatedAfterCrossDeviceMove: false,
        sourceUnlinkErrorCode: null,
        destinationHash: 'source-hash',
        destinationBytes: 4,
        lockWaitMs: 0,
        io: ioMeta('move', 'trace-move'),
    };
}

/** @param {Partial<Record<string, unknown>>} [overrides] */
function patchOutcome(overrides = {}) {
    return {
        dryRun: false,
        occurrences: 1,
        replacedOccurrences: 1,
        projectedBytes: 13,
        previousBytes: 12,
        byteDelta: 1,
        firstMatchLine: 1,
        lastMatchLine: 1,
        lineDelta: 0,
        occurrenceIndex: null,
        noop: false,
        diffPreview: '-old\n+new',
        diffPreviewTruncated: false,
        diffPreviewLines: 2,
        diffPreviewBytes: 9,
        diffContextLines: 3,
        previousHash: 'previous-hash',
        contentHash: 'content-hash',
        previousSnapshotBase64: Buffer.from('old').toString('base64'),
        previousRollbackSidecar: null,
        io: ioMeta('patch', 'trace-patch'),
        ...overrides,
    };
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {Error & { code: string; details?: Record<string, unknown> }}
 */
function codedError(code, message, details) {
    return /** @type {Error & { code: string; details?: Record<string, unknown> }} */ (
        Object.assign(new Error(message), { code, ...(details ? { details } : {}) })
    );
}

/** @param {string} resolved @param {{ read?: boolean; write?: boolean }} [capabilities] */
function pathOk(resolved = '/workspace/test.txt', capabilities = { write: true }) {
    const result = {
        ok: true,
        resolved,
        reason: undefined,
        ...(capabilities.read ? { validatedReadPath: Object.freeze({ kind: 'read-capability', resolved }) } : {}),
        ...(capabilities.write ? { validatedWritePath: Object.freeze({ kind: 'write-capability', resolved }) } : {}),
    };
    mockValidatePath.mockResolvedValue(result);
    return result;
}

/** @param {string} source @param {string} destination @param {'copy' | 'move'} mode */
function pathPairOk(source, destination, mode) {
    const sourceCapability = Object.freeze({ kind: mode === 'copy' ? 'read-capability' : 'write-capability', source });
    const destinationCapability = Object.freeze({ kind: 'write-capability', destination });
    mockValidatePath
        .mockResolvedValueOnce({
            ok: true,
            resolved: source,
            ...(mode === 'copy' ? { validatedReadPath: sourceCapability } : { validatedWritePath: sourceCapability }),
        })
        .mockResolvedValueOnce({ ok: true, resolved: destination, validatedWritePath: destinationCapability });
    return { sourceCapability, destinationCapability };
}

function pathFail(reason = 'Path traversal blocked') {
    mockValidatePath.mockResolvedValue({ ok: false, reason });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'true');
    workspaceIoMocks.writeFileAtomic.mockResolvedValue(writeOutcome());
    workspaceIoMocks.writeFileAtomicValidated.mockResolvedValue(writeOutcome());
    workspaceIoMocks.createOrReplaceFileAtomic.mockResolvedValue(createOutcome());
    workspaceIoMocks.createOrReplaceFileAtomicValidated.mockResolvedValue(createOutcome());
    workspaceIoMocks.deleteFileLocked.mockResolvedValue(deleteOutcome());
    workspaceIoMocks.copyFileLocked.mockResolvedValue(copyOutcome());
    workspaceIoMocks.copyFileLockedValidated.mockResolvedValue(copyOutcome());
    workspaceIoMocks.moveFileLocked.mockResolvedValue(moveOutcome());
    workspaceIoMocks.moveFileLockedValidated.mockResolvedValue(moveOutcome());
    workspaceIoMocks.patchTextLocked.mockResolvedValue(patchOutcome());
    workspaceIoMocks.patchTextLockedValidated.mockResolvedValue(patchOutcome());
    workspaceIoMocks.patchTextBatchLocked.mockResolvedValue({
        operations: [],
        bytesWritten: 0,
        io: ioMeta('patch', 'trace-patch-batch'),
    });
    workspaceIoMocks.patchTextBatchLockedValidated.mockResolvedValue({
        operations: [],
        bytesWritten: 0,
        io: ioMeta('patch', 'trace-patch-batch'),
    });
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('write_file_content — validated mutation capability', () => {
    const handler = /** @type {Function} */ (writeFileContentTool.handler);

    it('usa capability validada até a porta workspace-io e retorna envelope/changeSet', async () => {
        const validation = pathOk('/workspace/file.txt');

        const result = await handler({ path: 'file.txt', content: 'hello', encoding: 'utf8' });

        expect(result).toMatchObject({ success: true, path: '/workspace/file.txt', bytesWritten: 5 });
        expect(result.operation).toMatchObject({ capability: 'file.write', status: 'applied' });
        expect(result.changeSet?.rollback?.steps?.[0]).toMatchObject({
            action: 'write',
            target: '/workspace/file.txt',
            previousHash: 'previous-hash',
            contentHash: 'content-hash',
        });
        expect(workspaceIoMocks.writeFileAtomicValidated).toHaveBeenCalledWith(
            validation.validatedWritePath,
            Buffer.from('hello'),
            expect.objectContaining({ requireExists: true, captureRollback: true, riskClass: 'high' }),
        );
        expect(workspaceIoMocks.writeFileAtomic).not.toHaveBeenCalled();
        expect(mockValidatePath).toHaveBeenCalledWith('file.txt', {
            mode: 'write',
            issueMutableCapability: true,
        });
    });

    it('preserva expectedHash e durability na primitive validada', async () => {
        pathOk('/workspace/file.txt');

        await handler({
            path: 'file.txt',
            content: 'next',
            encoding: 'utf8',
            expectedHash: 'expected-current-hash',
            durability: 'none',
        });

        expect(workspaceIoMocks.writeFileAtomicValidated).toHaveBeenCalledWith(
            expect.anything(),
            Buffer.from('next'),
            expect.objectContaining({ expectedHash: 'expected-current-hash', durability: 'none' }),
        );
    });

    it('decodifica base64 antes da porta e rejeita base64 inválido sem IO', async () => {
        pathOk('/workspace/binary.bin');
        const payload = Buffer.from([0x00, 0xff, 0x7f]);

        const ok = await handler({ path: 'binary.bin', content: payload.toString('base64'), encoding: 'base64' });
        expect(ok).toMatchObject({ success: true, bytesWritten: 3 });
        expect(workspaceIoMocks.writeFileAtomicValidated.mock.calls[0]?.[1]).toEqual(payload);

        vi.clearAllMocks();
        pathOk('/workspace/binary.bin');
        const invalid = await handler({ path: 'binary.bin', content: '%%%', encoding: 'base64' });
        expect(invalid).toMatchObject({ success: false });
        expect(invalid.toolFeedback).toMatchObject({ category: 'invalid-parameters' });
        expect(workspaceIoMocks.writeFileAtomicValidated).not.toHaveBeenCalled();
    });

    it('converte falha da porta em feedback da tool e não mascara a causa', async () => {
        pathOk('/workspace/file.txt');
        workspaceIoMocks.writeFileAtomicValidated.mockRejectedValue(new Error('ENOSPC: disk full'));

        const result = await handler({ path: 'file.txt', content: 'x', encoding: 'utf8' });

        expect(result).toMatchObject({ success: false });
        expect(result.error).toContain('ENOSPC');
        expect(result.operation).toMatchObject({ capability: 'file.write', status: 'failed' });
    });

    it('nega antes de criar envelope de IO quando validatePath falha', async () => {
        pathFail();
        const result = await handler({ path: '../../etc/passwd', content: 'x', encoding: 'utf8' });
        expect(result).toMatchObject({ success: false, error: 'Path traversal blocked' });
        expect(workspaceIoMocks.writeFileAtomicValidated).not.toHaveBeenCalled();
        expect(workspaceIoMocks.writeFileAtomic).not.toHaveBeenCalled();
    });

    it('mantém rollback automático desabilitável por política sem impedir a escrita', async () => {
        vi.stubEnv('COPILOT_IO_ROLLBACK_ENABLED', 'false');
        pathOk('/workspace/file.txt');

        const result = await handler({ path: 'file.txt', content: 'hello', encoding: 'utf8' });

        expect(result.success).toBe(true);
        expect(result.changeSet?.rollback).toMatchObject({
            enabled: false,
            token: null,
            stepCount: 0,
            steps: [],
            reason: 'disabled_by_default',
        });
    });
});

describe('create_file — create/overwrite contract', () => {
    const handler = /** @type {Function} */ (createFileTool.handler);

    it('cria arquivo novo pela capability validada e preserva createParentDirs', async () => {
        const validation = pathOk('/workspace/new.txt');
        workspaceIoMocks.createOrReplaceFileAtomicValidated.mockResolvedValue(createOutcome({ bytesWritten: 11 }));

        const result = await handler({
            path: 'new.txt',
            content: 'hello world',
            createParentDirs: true,
            overwrite: false,
        });

        expect(result).toMatchObject({ success: true, path: '/workspace/new.txt', bytesWritten: 11 });
        expect(result.operation).toMatchObject({ capability: 'file.create', status: 'applied' });
        expect(result.changeSet?.rollback?.steps?.[0]).toMatchObject({
            action: 'delete',
            target: '/workspace/new.txt',
            previousHash: null,
        });
        expect(workspaceIoMocks.createOrReplaceFileAtomicValidated).toHaveBeenCalledWith(
            validation.validatedWritePath,
            Buffer.from('hello world'),
            expect.objectContaining({ createParentDirs: true, failIfExists: true, captureRollback: false }),
        );
        expect(workspaceIoMocks.createOrReplaceFileAtomic).not.toHaveBeenCalled();
    });

    it('overwrite=true preserva snapshot anterior no rollback', async () => {
        pathOk('/workspace/existing.txt');
        workspaceIoMocks.createOrReplaceFileAtomicValidated.mockResolvedValue(
            createOutcome({ overwrite: true, bytesWritten: 8 }),
        );

        const result = await handler({
            path: 'existing.txt',
            content: 'replaced',
            createParentDirs: true,
            overwrite: true,
        });

        expect(result.success).toBe(true);
        expect(result.operation).toMatchObject({ capability: 'file.create-or-overwrite', status: 'applied' });
        expect(result.changeSet?.rollback?.steps?.[0]).toMatchObject({
            action: 'write',
            previousHash: 'previous-hash',
            snapshotBase64: expect.any(String),
        });
        expect(workspaceIoMocks.createOrReplaceFileAtomicValidated).toHaveBeenCalledWith(
            expect.anything(),
            Buffer.from('replaced'),
            expect.objectContaining({ failIfExists: false, captureRollback: true }),
        );
    });

    it('propaga EEXIST da primitive em vez de reproduzir check-then-act na tool', async () => {
        pathOk('/workspace/existing.txt');
        workspaceIoMocks.createOrReplaceFileAtomicValidated.mockRejectedValue(
            codedError('EEXIST', 'Arquivo já existe: /workspace/existing.txt'),
        );

        const result = await handler({
            path: 'existing.txt',
            content: 'x',
            createParentDirs: true,
            overwrite: false,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('já existe');
    });

    it('retorna contagem real de bytes UTF-8 e binários', async () => {
        pathOk('/workspace/unicode.txt');
        const unicodeBytes = Buffer.byteLength('ação 🚀', 'utf8');
        workspaceIoMocks.createOrReplaceFileAtomicValidated.mockResolvedValue(
            createOutcome({ bytesWritten: unicodeBytes }),
        );
        const unicode = await handler({
            path: 'unicode.txt',
            content: 'ação 🚀',
            createParentDirs: true,
            overwrite: false,
        });
        expect(unicode.bytesWritten).toBe(unicodeBytes);

        vi.clearAllMocks();
        pathOk('/workspace/new.bin');
        const payload = Buffer.from([0x00, 0xff, 0x7f]);
        workspaceIoMocks.createOrReplaceFileAtomicValidated.mockResolvedValue(createOutcome({ bytesWritten: 3 }));
        const binary = await handler({
            path: 'new.bin',
            content: payload.toString('base64'),
            encoding: 'base64',
            createParentDirs: true,
            overwrite: false,
        });
        expect(binary).toMatchObject({ success: true, bytesWritten: 3 });
        expect(workspaceIoMocks.createOrReplaceFileAtomicValidated.mock.calls[0]?.[1]).toEqual(payload);
    });
});

describe('delete_file — semantic delete boundary', () => {
    const handler = /** @type {Function} */ (deleteFileTool.handler);

    it('delega delete à primitive e preserva snapshot de rollback', async () => {
        pathOk('/workspace/doomed.txt', { write: false });
        const result = await handler({ path: 'doomed.txt' });

        expect(result).toMatchObject({ success: true, deleted: true, previousHash: 'previous-hash', previousBytes: 6 });
        expect(result.operation).toMatchObject({ capability: 'file.delete', status: 'applied' });
        expect(result.changeSet?.rollback?.steps?.[0]).toMatchObject({
            action: 'write',
            target: '/workspace/doomed.txt',
            snapshotBase64: expect.any(String),
        });
        expect(workspaceIoMocks.deleteFileLocked).toHaveBeenCalledWith('/workspace/doomed.txt');
        expect(mockValidatePath).toHaveBeenCalledWith('doomed.txt', { mode: 'write' });
    });

    it('traduz EISDIR para erro de parâmetros e preserva ENOENT genérico', async () => {
        pathOk('/workspace/somedir', { write: false });
        workspaceIoMocks.deleteFileLocked.mockRejectedValue(codedError('EISDIR', 'is a directory'));
        const directory = await handler({ path: 'somedir' });
        expect(directory.success).toBe(false);
        expect(directory.error).toContain('diretório');
        expect(directory.toolFeedback).toMatchObject({ category: 'invalid-parameters' });

        vi.clearAllMocks();
        pathOk('/workspace/ghost.txt', { write: false });
        workspaceIoMocks.deleteFileLocked.mockRejectedValue(codedError('ENOENT', 'ENOENT: ghost'));
        const missing = await handler({ path: 'ghost.txt' });
        expect(missing.success).toBe(false);
        expect(missing.error).toContain('ENOENT');
    });
});

describe('copy_file — validated source/destination pair', () => {
    const handler = /** @type {Function} */ (copyFileTool.handler);

    it('consome read capability + mutable capability sem revalidar paths na porta', async () => {
        const caps = pathPairOk('/workspace/src.txt', '/workspace/dst.txt', 'copy');

        const result = await handler({ source: 'src.txt', destination: 'dst.txt', overwrite: false });

        expect(result).toMatchObject({
            success: true,
            source: '/workspace/src.txt',
            destination: '/workspace/dst.txt',
            sourceHash: 'source-hash',
            destinationHash: 'destination-hash',
            bytesWritten: 6,
            staged: true,
        });
        expect(workspaceIoMocks.copyFileLockedValidated).toHaveBeenCalledWith(
            caps.sourceCapability,
            caps.destinationCapability,
            { overwrite: false },
        );
        expect(workspaceIoMocks.copyFileLocked).not.toHaveBeenCalled();
        expect(mockValidatePath.mock.calls[0]?.[1]).toEqual({ mode: 'read', issueReadCapability: true });
        expect(mockValidatePath.mock.calls[1]?.[1]).toEqual({ mode: 'write', issueMutableCapability: true });
    });

    it('preserva expectedSourceHash e overwrite na primitive', async () => {
        pathPairOk('/workspace/src.txt', '/workspace/dst.txt', 'copy');
        await handler({
            source: 'src.txt',
            destination: 'dst.txt',
            overwrite: true,
            expectedSourceHash: 'source-precondition',
        });
        expect(workspaceIoMocks.copyFileLockedValidated).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
            overwrite: true,
            expectedSourceHash: 'source-precondition',
        });
    });

    it('interrompe após source inválida sem validar destination', async () => {
        mockValidatePath.mockResolvedValueOnce({ ok: false, reason: 'Invalid source' });
        const result = await handler({ source: '../bad', destination: 'ok.txt', overwrite: false });
        expect(result).toMatchObject({ success: false, error: 'Invalid source' });
        expect(mockValidatePath).toHaveBeenCalledTimes(1);
        expect(workspaceIoMocks.copyFileLockedValidated).not.toHaveBeenCalled();
    });
});

describe('move_file — atomic semantic move boundary', () => {
    const handler = /** @type {Function} */ (moveFileTool.handler);

    it('usa duas mutable capabilities e expõe metadados da primitive', async () => {
        const caps = pathPairOk('/workspace/old.txt', '/workspace/new.txt', 'move');

        const result = await handler({ source: 'old.txt', destination: 'new.txt', overwrite: false });

        expect(result).toMatchObject({
            success: true,
            source: '/workspace/old.txt',
            destination: '/workspace/new.txt',
            sourceHash: 'source-hash',
            sourceBytes: 4,
            crossDevice: false,
        });
        expect(workspaceIoMocks.moveFileLockedValidated).toHaveBeenCalledWith(
            caps.sourceCapability,
            caps.destinationCapability,
            { overwrite: false },
        );
        expect(workspaceIoMocks.moveFileLocked).not.toHaveBeenCalled();
    });

    it('não reimplementa EXDEV na tool: propaga o resultado cross-device da primitive', async () => {
        pathPairOk('/workspace/a.txt', '/workspace/b.txt', 'move');
        workspaceIoMocks.moveFileLockedValidated.mockResolvedValue(moveOutcome({ crossDevice: true }));

        const result = await handler({ source: 'a.txt', destination: 'b.txt', overwrite: false });

        expect(result).toMatchObject({
            success: true,
            crossDevice: true,
            duplicatedAfterCrossDeviceMove: false,
            sourceUnlinkErrorCode: null,
        });
    });

    it('overwrite conserva restauração do destino e retorno da origem no changeSet', async () => {
        pathPairOk('/workspace/a.txt', '/workspace/b.txt', 'move');
        workspaceIoMocks.moveFileLockedValidated.mockResolvedValue(moveOutcome({ overwrite: true }));

        const result = await handler({ source: 'a.txt', destination: 'b.txt', overwrite: true });

        expect(result.success).toBe(true);
        expect(result.changeSet?.rollback?.stepCount).toBe(2);
        expect(result.changeSet?.rollback?.steps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    action: 'move',
                    source: '/workspace/b.txt',
                    destination: '/workspace/a.txt',
                }),
                expect.objectContaining({ action: 'write', target: '/workspace/b.txt' }),
            ]),
        );
    });
});

describe('patch_file — exact patch contract over validated path', () => {
    const handler = /** @type {Function} */ (patchFileTool.handler);

    it('usa patchTextLockedValidated e publica resumo estrutural', async () => {
        const validation = pathOk('/workspace/target.js');

        const result = await handler({
            path: 'target.js',
            old_string: 'const x = 1;',
            new_string: 'const x = 42;',
        });

        expect(result).toMatchObject({
            success: true,
            path: '/workspace/target.js',
            dryRun: false,
            occurrences: 1,
            replacedOccurrences: 1,
            previousHash: 'previous-hash',
            contentHash: 'content-hash',
        });
        expect(result.operation).toMatchObject({ capability: 'file.patch', status: 'applied' });
        expect(workspaceIoMocks.patchTextLockedValidated).toHaveBeenCalledWith(
            validation.validatedWritePath,
            expect.objectContaining({ oldString: 'const x = 1;', newString: 'const x = 42;' }),
        );
        expect(workspaceIoMocks.patchTextLocked).not.toHaveBeenCalled();
    });

    it('preserva occurrence_index, expectedHash e durability', async () => {
        pathOk('/workspace/repeated.txt');
        workspaceIoMocks.patchTextLockedValidated.mockResolvedValue(
            patchOutcome({ occurrences: 2, occurrenceIndex: 2, replacedOccurrences: 1 }),
        );

        const result = await handler({
            path: 'repeated.txt',
            old_string: 'same',
            new_string: 'changed',
            occurrence_index: 2,
            expectedHash: 'expected-current',
            durability: 'file',
        });

        expect(result).toMatchObject({ success: true, occurrences: 2, occurrenceIndex: 2 });
        expect(workspaceIoMocks.patchTextLockedValidated).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ occurrenceIndex: 2, expectedHash: 'expected-current', durability: 'file' }),
        );
    });

    it('dryRun retorna changeSet abortado sem mudar o contrato da capability', async () => {
        pathOk('/workspace/target.js');
        workspaceIoMocks.patchTextLockedValidated.mockResolvedValue(
            patchOutcome({ dryRun: true, contentHash: 'previous-hash' }),
        );

        const result = await handler({
            path: 'target.js',
            old_string: 'const x = 1;',
            new_string: 'const x = 42;',
            dryRun: true,
        });

        expect(result).toMatchObject({ success: true, dryRun: true });
        expect(result.operation).toMatchObject({ capability: 'file.patch', status: 'dry-run' });
        expect(result.changeSet?.status).toBe('aborted');
    });

    it('rejeita modos conflitantes antes de chamar workspace-io', async () => {
        pathOk('/workspace/conflict.txt');
        const result = await handler({
            path: 'conflict.txt',
            old_string: 'same',
            new_string: 'changed',
            replace_all: true,
            occurrence_index: 1,
        });
        expect(result).toMatchObject({
            success: false,
            code: 'ERR_PATCH_CONFLICTING_MODE',
            toolFeedback: { category: 'invalid-parameters' },
        });
        expect(workspaceIoMocks.patchTextLockedValidated).not.toHaveBeenCalled();
    });

    it('mantém códigos e detalhes causais de not-found/ambiguous da primitive', async () => {
        pathOk('/workspace/file.txt');
        workspaceIoMocks.patchTextLockedValidated.mockRejectedValue(
            codedError('ERR_PATCH_NOT_FOUND', 'old_string não encontrado', { occurrenceCount: 0 }),
        );
        const missing = await handler({ path: 'file.txt', old_string: 'absent', new_string: 'next' });
        expect(missing).toMatchObject({
            success: false,
            code: 'ERR_PATCH_NOT_FOUND',
            toolFeedback: { category: 'not-found' },
        });
        expect(missing.toolFeedback.fix).toContain('Releia o arquivo');

        vi.clearAllMocks();
        pathOk('/workspace/file.txt');
        workspaceIoMocks.patchTextLockedValidated.mockRejectedValue(
            codedError('ERR_PATCH_AMBIGUOUS_MATCH', 'old_string encontrado 2 vezes', { occurrenceCount: 2 }),
        );
        const ambiguous = await handler({ path: 'file.txt', old_string: 'same', new_string: 'next' });
        expect(ambiguous).toMatchObject({
            success: false,
            code: 'ERR_PATCH_AMBIGUOUS_MATCH',
            toolFeedback: { category: 'invalid-parameters' },
        });
        expect(ambiguous.toolFeedback.fix).toContain('occurrence_index');
    });

    it('new_string com $ e string vazia atravessam literalmente a porta', async () => {
        pathOk('/workspace/dollar.js');
        await handler({ path: 'dollar.js', old_string: 'placeholder', new_string: 'cost is $100' });
        expect(workspaceIoMocks.patchTextLockedValidated).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ newString: 'cost is $100' }),
        );

        vi.clearAllMocks();
        pathOk('/workspace/del.txt');
        await handler({ path: 'del.txt', old_string: ' remove this', new_string: '' });
        expect(workspaceIoMocks.patchTextLockedValidated).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ newString: '' }),
        );
    });
});

describe('fileWriteTools surface', () => {
    it('mantém as 10 tools, nomes únicos e exports operacionais esperados', () => {
        expect(fileWriteTools).toHaveLength(10);
        const names = fileWriteTools.map((tool) => tool.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toEqual(
            expect.arrayContaining([
                'write_file_content',
                'create_file',
                'delete_file',
                'patch_bundle_plan',
                'patch_files_batch',
                'copy_file',
                'move_file',
                'patch_file',
                'rollback_file_changes',
                'rollback_sidecars_status',
            ]),
        );
        expect(rollbackFileChangesTool.name).toBe('rollback_file_changes');
        expect(rollbackSidecarsStatusTool.name).toBe('rollback_sidecars_status');
        for (const tool of fileWriteTools) {
            expect(tool).toMatchObject({
                name: expect.any(String),
                description: expect.any(String),
                handler: expect.any(Function),
            });
            expect(tool.description).not.toMatch(/requer aprovação|approval|ask_user/iu);
        }
    });
});
