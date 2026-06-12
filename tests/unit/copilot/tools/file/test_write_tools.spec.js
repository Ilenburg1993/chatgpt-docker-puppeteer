// @ts-check
/**
 * @file Faixa 35 — Write Tools Test Suite (F181-F188)
 *
 *   Testes para src/copilot/tools/file/write-tools.js:
 *
 *   - write_file_content, create_file, delete_file, copy_file, move_file, patch_file
 *   - atomicWrite, validatePath safety, export shape
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
    mockLog: vi.fn(),
    buildTool: vi.fn((config) => config),
    withSkipPermission: vi.fn((tool) => tool),
    streamPayloads: new Map(),
}));

vi.mock('node:fs', async () => {
    const actual = /** @type {Record<string, unknown>} */ (await vi.importActual('node:fs'));
    const streamActual = /** @type {{ Readable: { from: (chunks: unknown[]) => unknown } }} */ (
        await vi.importActual('node:stream')
    );
    return {
        ...actual,
        createReadStream: vi.fn((filePath) =>
            streamActual.Readable.from([mocks.streamPayloads.get(String(filePath)) ?? Buffer.alloc(0)]),
        ),
    };
});

vi.mock('../../../../../src/copilot/tools/infra/logger.js', () => ({
    log: mocks.mockLog,
}));

/**
 * @type {{
 *     access: import('vitest').Mock;
 *     writeFile: import('vitest').Mock;
 *     rename: import('vitest').Mock;
 *     mkdir: import('vitest').Mock;
 *     stat: import('vitest').Mock;
 *     unlink: import('vitest').Mock;
 *     copyFile: import('vitest').Mock;
 *     readFile: import('vitest').Mock;
 *     link: import('vitest').Mock;
 *     open: import('vitest').Mock;
 * }}
 */
const fsMock = {
    access: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    copyFile: vi.fn(),
    readFile: vi.fn(),
    link: vi.fn(),
    open: vi.fn(async () => {
        throw Object.assign(new Error('ENOTSUP'), { code: 'ENOTSUP' });
    }),
};

vi.mock('node:fs/promises', () => fsMock);

const mockValidatePath = vi.fn();
vi.mock('#copilot/tools/file/shared', () => ({
    validatePath: mockValidatePath,
    WORKSPACE_ROOT: '/workspace',
}));

// buildTool mock: retorna o handler diretamente para teste isolado
vi.mock('../../../../../src/copilot/tools/infra/tool-factory.js', () => ({
    buildTool: mocks.buildTool,
    withSkipPermission: mocks.withSkipPermission,
}));

// crypto mock para atomicWrite
vi.mock('node:crypto', () => ({
    createHash: vi.fn(() => {
        /** @type {{ update: import('vitest').Mock; digest: import('vitest').Mock }} */
        const hash = {
            update: vi.fn(() => hash),
            digest: vi.fn(() => 'mock-sha256'),
        };
        return hash;
    }),
    randomBytes: vi.fn(() => ({ toString: () => 'abcd1234' })),
    randomUUID: vi.fn(() => 'op-test-id'),
}));

// ─── Import após mocks ──────────────────────────────────────────────────────

const { fileWriteTools } = await import('../../../../../src/copilot/tools/file/index.js');

/** @param {string} name */
function requireTool(name) {
    const tool = fileWriteTools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool não encontrada: ${name}`);
    return /** @type {any} */ (tool);
}

const writeFileContentTool = requireTool('write_file_content');
const createFileTool = requireTool('create_file');
const deleteFileTool = requireTool('delete_file');
const copyFileTool = requireTool('copy_file');
const moveFileTool = requireTool('move_file');
const patchFileTool = requireTool('patch_file');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Helper para configurar validatePath como sucesso */
function pathOk(resolved = '/workspace/test.txt') {
    mockValidatePath.mockResolvedValue({ ok: true, resolved, reason: undefined });
}

/** Helper para configurar validatePath como falha */
function pathFail(reason = 'Caminho inválido') {
    mockValidatePath.mockResolvedValue({ ok: false, resolved: undefined, reason });
}

/** @returns {Error & { code: string }} */
function enoent() {
    return /** @type {Error & { code: string }} */ (Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
}

/** @returns {Error & { code: string }} */
function exdev() {
    return /** @type {Error & { code: string }} */ (Object.assign(new Error('EXDEV'), { code: 'EXDEV' }));
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.streamPayloads.clear();
});

/**
 * @param {string} filePath
 * @param {string | Buffer} content
 */
function streamPayload(filePath, content) {
    mocks.streamPayloads.set(filePath, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// F181-F182: write_file_content
// ═══════════════════════════════════════════════════════════════════════════════

describe('F35 — write_file_content (F181-F182)', () => {
    const handler = /** @type {any} */ (writeFileContentTool.handler);

    it('escreve conteúdo em arquivo existente (utf8)', async () => {
        pathOk('/workspace/file.txt');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({ path: 'file.txt', content: 'hello', encoding: 'utf8' });

        expect(result).toMatchObject({ success: true, path: '/workspace/file.txt' });
        expect(result.io?.operation).toBe('write');
        expect(result.operation).toMatchObject({
            operationId: 'op-test-id',
            capability: 'file.write',
            status: 'applied',
        });
        expect(result.bytesWritten).toBe(5);
        expect(fsMock.writeFile).toHaveBeenCalledOnce();
        expect(fsMock.rename).toHaveBeenCalledOnce();
    });

    it('escreve em base64', async () => {
        pathOk('/workspace/binary.bin');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        const b64 = Buffer.from('binary content').toString('base64');
        const result = await handler({ path: 'binary.bin', content: b64, encoding: 'base64' });

        expect(result.success).toBe(true);
        expect(result.bytesWritten).toBe(14); // 'binary content'.length
    });

    it('rejeita base64 inválido antes de escrever', async () => {
        pathOk('/workspace/binary.bin');

        const result = await handler({ path: 'binary.bin', content: '%%%', encoding: 'base64' });

        expect(result.success).toBe(false);
        expect(result.toolFeedback).toMatchObject({
            toolName: 'write_file_content',
            category: 'invalid-parameters',
            receivedParameters: expect.objectContaining({ encoding: 'base64' }),
        });
        expect(fsMock.writeFile).not.toHaveBeenCalled();
    });

    it('falha se arquivo não existe', async () => {
        pathOk('/workspace/nofile.txt');
        fsMock.access.mockRejectedValue(new Error('ENOENT'));

        const result = await handler({ path: 'nofile.txt', content: 'x', encoding: 'utf8' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Arquivo não encontrado');
        expect(result.operation).toMatchObject({ capability: 'file.write', status: 'failed' });
    });

    it('falha se validatePath rejeita', async () => {
        pathFail('Path traversal blocked');

        const result = await handler({ path: '../../etc/passwd', content: 'x', encoding: 'utf8' });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Path traversal blocked');
    });

    it('retorna erro em exceção de fs.writeFile', async () => {
        pathOk('/workspace/file.txt');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.writeFile.mockRejectedValue(new Error('ENOSPC'));

        const result = await handler({ path: 'file.txt', content: 'x', encoding: 'utf8' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('ENOSPC');
    });

    it('usa atomicWrite durável por temp exclusivo + rename', async () => {
        pathOk('/workspace/f.txt');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        await handler({ path: 'f.txt', content: 'ok', encoding: 'utf8' });

        const tmpPath = /** @type {string} */ (fsMock.writeFile.mock.calls[0]?.[0]);
        const writeOptions = /** @type {Record<string, unknown>} */ (fsMock.writeFile.mock.calls[0]?.[2]);
        expect(tmpPath).toContain('.tmp');
        expect(writeOptions).toMatchObject({ flag: 'wx', flush: true });
        expect(fsMock.rename).toHaveBeenCalledWith(tmpPath, '/workspace/f.txt');
    });

    it('loga a operação de escrita', async () => {
        pathOk('/workspace/logged.txt');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        await handler({ path: 'logged.txt', content: 'x', encoding: 'utf8' });

        expect(mocks.mockLog).toHaveBeenCalledWith('INFO', expect.stringContaining('write_file_content'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F184: create_file
// ═══════════════════════════════════════════════════════════════════════════════

describe('F35 — create_file (F184)', () => {
    const handler = /** @type {any} */ (createFileTool.handler);

    it('cria novo arquivo com conteúdo', async () => {
        pathOk('/workspace/new.txt');
        fsMock.access.mockRejectedValue(enoent());
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({
            path: 'new.txt',
            content: 'hello world',
            createParentDirs: true,
            overwrite: false,
        });

        expect(result.success).toBe(true);
        expect(result.bytesWritten).toBe(11);
        expect(fsMock.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('falha se arquivo já existe e overwrite=false', async () => {
        pathOk('/workspace/existing.txt');
        fsMock.access.mockResolvedValue(undefined);

        const result = await handler({
            path: 'existing.txt',
            content: 'x',
            createParentDirs: true,
            overwrite: false,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('já existe');
    });

    it('sobrescreve arquivo existente com overwrite=true', async () => {
        pathOk('/workspace/existing.txt');
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({
            path: 'existing.txt',
            content: 'replaced',
            createParentDirs: true,
            overwrite: true,
        });

        expect(result.success).toBe(true);
    });

    it('cria diretórios intermediários quando createParentDirs=true', async () => {
        pathOk('/workspace/deep/nested/file.txt');
        fsMock.access.mockRejectedValue(enoent());
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        await handler({
            path: 'deep/nested/file.txt',
            content: '',
            createParentDirs: true,
            overwrite: false,
        });

        expect(fsMock.mkdir).toHaveBeenCalledWith('/workspace/deep/nested', { recursive: true });
    });

    it('cria arquivo vazio quando content omitido', async () => {
        pathOk('/workspace/empty.txt');
        fsMock.access.mockRejectedValue(enoent());
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({
            path: 'empty.txt',
            content: '',
            createParentDirs: true,
            overwrite: false,
        });

        expect(result.success).toBe(true);
        expect(result.bytesWritten).toBe(0);
    });

    it('retorna bytes escritos reais para UTF-8 multibyte', async () => {
        pathOk('/workspace/unicode.txt');
        fsMock.access.mockRejectedValue(enoent());
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({
            path: 'unicode.txt',
            content: 'ação 🚀',
            createParentDirs: true,
            overwrite: false,
        });

        expect(result.success).toBe(true);
        expect(result.bytesWritten).toBe(Buffer.byteLength('ação 🚀', 'utf8'));
    });

    it('falha se validatePath rejeita', async () => {
        pathFail('Blocked');

        const result = await handler({
            path: '../evil',
            content: 'x',
            createParentDirs: true,
            overwrite: false,
        });

        expect(result).toMatchObject({ success: false, error: 'Blocked' });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F185: delete_file
// ═══════════════════════════════════════════════════════════════════════════════

describe('F35 — delete_file (F185)', () => {
    const handler = /** @type {any} */ (deleteFileTool.handler);

    it('deleta arquivo existente', async () => {
        pathOk('/workspace/doomed.txt');
        fsMock.stat.mockResolvedValue({ isDirectory: () => false });
        fsMock.readFile.mockResolvedValue(Buffer.from('doomed', 'utf8'));
        streamPayload('/workspace/doomed.txt', 'doomed');
        fsMock.unlink.mockResolvedValue(undefined);

        const result = await handler({ path: 'doomed.txt' });

        expect(result).toMatchObject({ success: true, deleted: true });
        expect(result.io?.operation).toBe('delete');
        expect(result.previousHash).toBe('mock-sha256');
        expect(result.previousBytes).toBe(6);
        expect(result.operation).toMatchObject({ capability: 'file.delete', status: 'applied' });
        expect(result.changeSet?.rollback?.stepCount).toBeGreaterThanOrEqual(1);
        expect(result.changeSet?.rollback?.steps?.[0]?.snapshotBase64).toBeTypeOf('string');
        expect(fsMock.unlink).toHaveBeenCalledWith('/workspace/doomed.txt');
    });

    it('falha se é diretório', async () => {
        pathOk('/workspace/somedir');
        fsMock.unlink.mockRejectedValue(Object.assign(new Error('EISDIR'), { code: 'EISDIR' }));

        const result = await handler({ path: 'somedir' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('diretório');
    });

    it('falha se stat lança (arquivo não existe)', async () => {
        pathOk('/workspace/ghost.txt');
        fsMock.unlink.mockRejectedValue(enoent());

        const result = await handler({ path: 'ghost.txt' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('ENOENT');
    });

    it('falha se validatePath rejeita', async () => {
        pathFail('Nope');

        const result = await handler({ path: '../etc/passwd' });

        expect(result).toMatchObject({ success: false, error: 'Nope' });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F186: copy_file + move_file
// ═══════════════════════════════════════════════════════════════════════════════

describe('F35 — copy_file (F186)', () => {
    const handler = /** @type {any} */ (copyFileTool.handler);

    it('copia arquivo com sucesso', async () => {
        mockValidatePath
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/src.txt', reason: undefined })
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/dst.txt', reason: undefined });
        fsMock.access.mockRejectedValue(new Error('ENOENT'));
        fsMock.readFile.mockResolvedValue(Buffer.from('source', 'utf8'));
        streamPayload('/workspace/src.txt', 'source');
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.copyFile.mockResolvedValue(undefined);
        fsMock.stat.mockResolvedValue({ size: 42 });

        const result = await handler({ source: 'src.txt', destination: 'dst.txt', overwrite: false });

        expect(result).toMatchObject({ success: true, bytesWritten: 42 });
        expect(result.sourceHash).toBe('mock-sha256');
        expect(result.sourceBytes).toBe(6);
        expect(result.io?.operation).toBe('copy');
        expect(fsMock.copyFile).toHaveBeenCalledWith('/workspace/src.txt', '/workspace/dst.txt', expect.any(Number));
        expect(mockValidatePath.mock.calls[1]?.[1]).toEqual({ mode: 'write' });
    });

    it('falha se destino existe e overwrite=false', async () => {
        mockValidatePath
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/src.txt', reason: undefined })
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/dst.txt', reason: undefined });
        fsMock.access.mockResolvedValue(undefined);

        const result = await handler({ source: 'src.txt', destination: 'dst.txt', overwrite: false });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Destino já existe');
    });

    it('sobrescreve com overwrite=true', async () => {
        mockValidatePath
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/a.txt', reason: undefined })
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/b.txt', reason: undefined });
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue(Buffer.from('copy', 'utf8'));
        streamPayload('/workspace/a.txt', 'copy');
        streamPayload('/workspace/b.txt', 'copy');
        fsMock.copyFile.mockResolvedValue(undefined);
        fsMock.stat.mockResolvedValue({ size: 10 });

        const result = await handler({ source: 'a.txt', destination: 'b.txt', overwrite: true });

        expect(result.success).toBe(true);
        expect(result.sourceHash).toBe('mock-sha256');
        expect(result.operation).toMatchObject({ capability: 'file.copy', status: 'applied' });
        expect(result.changeSet?.rollback?.stepCount).toBeGreaterThanOrEqual(1);
        expect(result.changeSet?.rollback?.steps?.[0]?.action).toBe('write');
    });

    it('falha se source path inválido', async () => {
        mockValidatePath.mockResolvedValueOnce({ ok: false, reason: 'Invalid source' });

        const result = await handler({ source: '../bad', destination: 'ok.txt', overwrite: false });

        expect(result).toMatchObject({ success: false, error: 'Invalid source' });
    });
});

describe('F35 — move_file (F186)', () => {
    const handler = /** @type {any} */ (moveFileTool.handler);

    it('move arquivo com sucesso', async () => {
        mockValidatePath
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/old.txt', reason: undefined })
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/new.txt', reason: undefined });
        fsMock.access.mockRejectedValue(new Error('ENOENT'));
        fsMock.readFile.mockResolvedValue(Buffer.from('move', 'utf8'));
        streamPayload('/workspace/old.txt', 'move');
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({ source: 'old.txt', destination: 'new.txt', overwrite: false });

        expect(result).toMatchObject({
            success: true,
            source: '/workspace/old.txt',
            destination: '/workspace/new.txt',
            sourceHash: 'mock-sha256',
            sourceBytes: 4,
        });
        expect(mockValidatePath.mock.calls[1]?.[1]).toEqual({ mode: 'write' });
    });

    it('falha se destino existe sem overwrite', async () => {
        mockValidatePath
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/old.txt', reason: undefined })
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/exists.txt', reason: undefined });
        fsMock.access.mockResolvedValue(undefined);

        const result = await handler({ source: 'old.txt', destination: 'exists.txt', overwrite: false });

        expect(result.success).toBe(false);
    });

    it('move com overwrite=true', async () => {
        mockValidatePath
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/a.txt', reason: undefined })
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/b.txt', reason: undefined });
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue(Buffer.from('move', 'utf8'));
        streamPayload('/workspace/a.txt', 'move');
        streamPayload('/workspace/b.txt', 'move');
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({ source: 'a.txt', destination: 'b.txt', overwrite: true });

        expect(result.success).toBe(true);
        expect(result.sourceHash).toBe('mock-sha256');
        expect(result.operation).toMatchObject({ capability: 'file.move', status: 'applied' });
        expect(result.changeSet?.rollback?.stepCount).toBe(2);
    });

    it('move EXDEV publica via temp verificado antes de remover origem', async () => {
        mockValidatePath
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/a.txt', reason: undefined })
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/b.txt', reason: undefined });
        fsMock.access.mockRejectedValue(enoent());
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.rename.mockRejectedValueOnce(exdev());
        fsMock.copyFile.mockResolvedValue(undefined);
        fsMock.link.mockResolvedValue(undefined);
        fsMock.unlink.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue(Buffer.from('move', 'utf8'));
        fsMock.stat.mockResolvedValue({ size: 4 });
        streamPayload('/workspace/a.txt', 'move');

        const result = await handler({ source: 'a.txt', destination: 'b.txt', overwrite: false });

        expect(result.success).toBe(true);
        expect(result.crossDevice).toBe(true);
        expect(result.duplicatedAfterCrossDeviceMove).toBe(false);
        expect(fsMock.copyFile).toHaveBeenCalledWith('/workspace/a.txt', expect.stringContaining('.b.txt.'));
        expect(fsMock.link).toHaveBeenCalledWith(expect.stringContaining('.b.txt.'), '/workspace/b.txt');
        expect(fsMock.unlink).toHaveBeenCalledWith('/workspace/a.txt');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F187: patch_file
// ═══════════════════════════════════════════════════════════════════════════════

describe('F35 — patch_file (F187)', () => {
    const handler = /** @type {any} */ (patchFileTool.handler);

    it('aplica patch com sucesso', async () => {
        pathOk('/workspace/target.js');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue('const x = 1;\nconst y = 2;\n');
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({
            path: 'target.js',
            old_string: 'const x = 1;',
            new_string: 'const x = 42;',
        });

        expect(result.success).toBe(true);
        expect(result.operation).toMatchObject({ capability: 'file.patch', status: 'applied' });
    });

    it('simula patch com dryRun sem escrever no disco', async () => {
        pathOk('/workspace/target.js');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue('const x = 1;\n');

        const result = await handler({
            path: 'target.js',
            old_string: 'const x = 1;',
            new_string: 'const x = 42;',
            dryRun: true,
        });

        expect(result.success).toBe(true);
        expect(result.dryRun).toBe(true);
        expect(result.operation).toMatchObject({ capability: 'file.patch', status: 'dry-run' });
        expect(result.changeSet?.status).toBe('aborted');
        expect(result.diffPreview).toContain('-const x = 1;');
        expect(result.diffPreview).toContain('+const x = 42;');
        expect(result.diffPreviewTruncated).toBe(false);
        expect(fsMock.writeFile).not.toHaveBeenCalled();
        expect(fsMock.rename).not.toHaveBeenCalled();
    });

    it('aplica occurrence_index para old_string repetido', async () => {
        pathOk('/workspace/repeated.txt');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue('same\nmiddle\nsame\n');
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({
            path: 'repeated.txt',
            old_string: 'same',
            new_string: 'changed',
            occurrence_index: 2,
        });

        expect(result.success).toBe(true);
        expect(result.occurrences).toBe(2);
        expect(result.replacedOccurrences).toBe(1);
        expect(result.occurrenceIndex).toBe(2);
        const writtenContent = String(fsMock.writeFile.mock.calls[0]?.[1]);
        expect(writtenContent).toBe('same\nmiddle\nchanged\n');
    });

    it('falha com feedback claro quando replace_all e occurrence_index conflitam', async () => {
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
            toolFeedback: {
                category: 'invalid-parameters',
            },
        });
        expect(result.toolFeedback.fix).toContain('Escolha apenas um modo');
        expect(result.terminalSummary).toMatchObject({
            operation: 'patch',
            status: 'failed',
            code: 'ERR_PATCH_CONFLICTING_MODE',
            nextAction: expect.stringContaining('replace_all'),
        });
        expect(result.presentation).toMatchObject({
            operation: 'patch',
            status: 'failed',
            targetKinds: ['file'],
            summary: expect.stringContaining('Patch falhou'),
        });
        expect(fsMock.readFile).not.toHaveBeenCalled();
    });

    it('falha se old_string não encontrada', async () => {
        pathOk('/workspace/file.txt');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue('hello world');

        const result = await handler({
            path: 'file.txt',
            old_string: 'not in file',
            new_string: 'replaced',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('não encontrado');
        expect(result.toolFeedback).toMatchObject({
            category: 'not-found',
            details: {
                code: 'ERR_PATCH_NOT_FOUND',
                path: '/workspace/file.txt',
            },
        });
        expect(result.toolFeedback.fix).toContain('Releia o arquivo');
        expect(result.operationName).toBe('patch');
        expect(result.terminalSummary).toMatchObject({
            operation: 'patch',
            status: 'failed',
            code: 'ERR_PATCH_NOT_FOUND',
            nextAction: expect.stringContaining('old_string'),
        });
        expect(result.presentation.summary).toContain('/workspace/file.txt');
    });

    it('falha se old_string encontrada múltiplas vezes', async () => {
        pathOk('/workspace/file.txt');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue('aaa bbb aaa');

        const result = await handler({
            path: 'file.txt',
            old_string: 'aaa',
            new_string: 'ccc',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('2 vezes');
        expect(result.toolFeedback).toMatchObject({
            category: 'invalid-parameters',
            details: {
                code: 'ERR_PATCH_AMBIGUOUS_MATCH',
                occurrenceCount: 2,
            },
        });
        expect(result.toolFeedback.fix).toContain('occurrence_index');
        expect(result.terminalSummary).toMatchObject({
            operation: 'patch',
            status: 'failed',
            code: 'ERR_PATCH_AMBIGUOUS_MATCH',
            nextAction: expect.stringContaining('occurrence_index'),
        });
    });

    it('falha antes de ler quando old_string é vazia', async () => {
        pathOk('/workspace/empty-old.txt');

        const result = await handler({
            path: 'empty-old.txt',
            old_string: '',
            new_string: 'x',
        });

        expect(result).toMatchObject({
            success: false,
            code: 'ERR_PATCH_INVALID_OLD_STRING',
            toolFeedback: {
                category: 'invalid-parameters',
            },
        });
        expect(result.terminalSummary).toMatchObject({
            operation: 'patch',
            status: 'failed',
            code: 'ERR_PATCH_INVALID_OLD_STRING',
            nextAction: expect.stringContaining('old_string'),
        });
        expect(fsMock.readFile).not.toHaveBeenCalled();
    });

    it('falha se arquivo não existe', async () => {
        pathOk('/workspace/nope.txt');
        fsMock.access.mockRejectedValue(new Error('ENOENT'));

        const result = await handler({
            path: 'nope.txt',
            old_string: 'x',
            new_string: 'y',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('não encontrado');
    });

    it('falha se validatePath rejeita', async () => {
        pathFail('Blocked');

        const result = await handler({
            path: '../evil',
            old_string: 'x',
            new_string: 'y',
        });

        expect(result.success).toBe(false);
    });

    it('escapa $ em new_string (BUG-HIGH-01 fix)', async () => {
        pathOk('/workspace/dollar.js');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue('placeholder');
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        await handler({
            path: 'dollar.js',
            old_string: 'placeholder',
            new_string: 'cost is $100',
        });

        // O conteúdo escrito deve conter $100 literalmente
        const writtenContent = String(fsMock.writeFile.mock.calls[0]?.[1]);
        expect(writtenContent).toContain('$100');
    });

    it('pode deletar texto (new_string vazio)', async () => {
        pathOk('/workspace/del.txt');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue('keep this remove this keep that');
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({
            path: 'del.txt',
            old_string: ' remove this',
            new_string: '',
        });

        expect(result.success).toBe(true);
        const writtenContent = String(fsMock.writeFile.mock.calls[0]?.[1]);
        expect(writtenContent).toBe('keep this keep that');
    });

    it('falha em erro de leitura de arquivo', async () => {
        pathOk('/workspace/unreadable.txt');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.readFile.mockRejectedValue(new Error('EPERM'));

        const result = await handler({
            path: 'unreadable.txt',
            old_string: 'x',
            new_string: 'y',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('EPERM');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F188: Export shape
// ═══════════════════════════════════════════════════════════════════════════════

describe('F35 — fileWriteTools export shape (F188)', () => {
    it('exporta array com 6 tools', () => {
        expect(fileWriteTools).toHaveLength(6);
    });

    it('cada tool tem name, description, handler', () => {
        for (const tool of fileWriteTools) {
            expect(tool).toHaveProperty('name');
            expect(tool).toHaveProperty('description');
            expect(tool).toHaveProperty('handler');
        }
    });

    it('nomes de tools são únicos', () => {
        const names = fileWriteTools.map((t) => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('exporta named exports individuais', () => {
        expect(writeFileContentTool.name).toBe('write_file_content');
        expect(createFileTool.name).toBe('create_file');
        expect(deleteFileTool.name).toBe('delete_file');
        expect(copyFileTool.name).toBe('copy_file');
        expect(moveFileTool.name).toBe('move_file');
        expect(patchFileTool.name).toBe('patch_file');
    });

    it('descriptions não prometem aprovação manual', () => {
        for (const tool of fileWriteTools) {
            expect(tool.description).not.toMatch(/requer aprovação|approval|ask_user/i);
        }
    });
});
