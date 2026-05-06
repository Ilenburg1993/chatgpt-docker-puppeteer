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
}));

vi.mock('../../../../../src/copilot/tools/logger.js', () => ({
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
};

vi.mock('node:fs/promises', () => fsMock);

const mockValidatePath = vi.fn();
vi.mock('#copilot/tools/file/shared', () => ({
    validatePath: mockValidatePath,
    WORKSPACE_ROOT: '/workspace',
}));

// buildTool mock: retorna o handler diretamente para teste isolado
vi.mock('#copilot/tools/tool-factory', () => ({
    buildTool: mocks.buildTool,
}));

// crypto mock para atomicWrite
vi.mock('node:crypto', () => ({
    randomBytes: vi.fn(() => ({ toString: () => 'abcd1234' })),
}));

// ─── Import após mocks ──────────────────────────────────────────────────────

const {
    writeFileContentTool,
    createFileTool,
    deleteFileTool,
    copyFileTool,
    moveFileTool,
    patchFileTool,
    fileWriteTools,
} = await import('#copilot/tools/file/write-tools');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Helper para configurar validatePath como sucesso */
function pathOk(resolved = '/workspace/test.txt') {
    mockValidatePath.mockResolvedValue({ ok: true, resolved, reason: undefined });
}

/** Helper para configurar validatePath como falha */
function pathFail(reason = 'Caminho inválido') {
    mockValidatePath.mockResolvedValue({ ok: false, resolved: undefined, reason });
}

beforeEach(() => {
    vi.clearAllMocks();
});

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

    it('falha se arquivo não existe', async () => {
        pathOk('/workspace/nofile.txt');
        fsMock.access.mockRejectedValue(new Error('ENOENT'));

        const result = await handler({ path: 'nofile.txt', content: 'x', encoding: 'utf8' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('create_file');
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

    it('usa atomicWrite (writeFile + rename)', async () => {
        pathOk('/workspace/f.txt');
        fsMock.access.mockResolvedValue(undefined);
        fsMock.writeFile.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        await handler({ path: 'f.txt', content: 'ok', encoding: 'utf8' });

        const tmpPath = /** @type {string} */ (fsMock.writeFile.mock.calls[0]?.[0]);
        expect(tmpPath).toContain('.tmp');
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
        fsMock.access.mockRejectedValue(new Error('ENOENT'));
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
        fsMock.access.mockRejectedValue(new Error('ENOENT'));
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
        fsMock.access.mockRejectedValue(new Error('ENOENT'));
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
        fsMock.access.mockRejectedValue(new Error('ENOENT'));
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
        fsMock.unlink.mockResolvedValue(undefined);

        const result = await handler({ path: 'doomed.txt' });

        expect(result).toMatchObject({ success: true, deleted: true });
        expect(result.io?.operation).toBe('delete');
        expect(fsMock.unlink).toHaveBeenCalledWith('/workspace/doomed.txt');
    });

    it('falha se é diretório', async () => {
        pathOk('/workspace/somedir');
        fsMock.stat.mockResolvedValue({ isDirectory: () => true });

        const result = await handler({ path: 'somedir' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('diretório');
    });

    it('falha se stat lança (arquivo não existe)', async () => {
        pathOk('/workspace/ghost.txt');
        fsMock.stat.mockRejectedValue(new Error('ENOENT'));

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
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.copyFile.mockResolvedValue(undefined);
        fsMock.stat.mockResolvedValue({ size: 42 });

        const result = await handler({ source: 'src.txt', destination: 'dst.txt', overwrite: false });

        expect(result).toMatchObject({ success: true, bytesWritten: 42 });
        expect(result.io?.operation).toBe('copy');
        expect(fsMock.copyFile).toHaveBeenCalledWith('/workspace/src.txt', '/workspace/dst.txt');
        expect(mockValidatePath.mock.calls[1]?.[1]).toEqual({ mode: 'write' });
    });

    it('falha se destino existe e overwrite=false', async () => {
        mockValidatePath
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/src.txt', reason: undefined })
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/dst.txt', reason: undefined });
        fsMock.access.mockResolvedValue(undefined);

        const result = await handler({ source: 'src.txt', destination: 'dst.txt', overwrite: false });

        expect(result.success).toBe(false);
        expect(result.error).toContain('overwrite');
    });

    it('sobrescreve com overwrite=true', async () => {
        mockValidatePath
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/a.txt', reason: undefined })
            .mockResolvedValueOnce({ ok: true, resolved: '/workspace/b.txt', reason: undefined });
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.copyFile.mockResolvedValue(undefined);
        fsMock.stat.mockResolvedValue({ size: 10 });

        const result = await handler({ source: 'a.txt', destination: 'b.txt', overwrite: true });

        expect(result.success).toBe(true);
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
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({ source: 'old.txt', destination: 'new.txt', overwrite: false });

        expect(result).toMatchObject({
            success: true,
            source: '/workspace/old.txt',
            destination: '/workspace/new.txt',
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
        fsMock.rename.mockResolvedValue(undefined);

        const result = await handler({ source: 'a.txt', destination: 'b.txt', overwrite: true });

        expect(result.success).toBe(true);
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
        const writtenContent = /** @type {string} */ (fsMock.writeFile.mock.calls[0]?.[1]);
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
        const writtenContent = /** @type {string} */ (fsMock.writeFile.mock.calls[0]?.[1]);
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
});
