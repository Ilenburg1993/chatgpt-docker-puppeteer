// @ts-check
/**
 * tests/unit/copilot/test_file_tools.spec.js
 *
 * Testes unitários para src/copilot/tools/file-tools.js (Sprint 17).
 *
 * Valida:
 *
 * - Exportações do módulo (fileTools, fileReadTools, fileWriteTools)
 * - allTools em index.js inclui as fileTools
 * - read_file_content: leitura básica, range de linhas, arquivo inexistente, caminho bloqueado
 * - list_directory: estrutura, diretório inválido
 * - search_in_files: retorna output, input inválido
 * - write_file_content: arquivo inexistente retorna erro
 * - create_file: valida estrutura básica
 * - delete_file: arquivo inexistente retorna erro
 * - copy_file: origem inexistente retorna erro
 * - move_file: origem inexistente retorna erro
 * - Segurança: path traversal fora do workspace, arquivo bloqueado (.env)
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';

import {
    fileReadTools,
    fileTools,
    fileWriteTools,
    indexTools,
    scopeTools,
} from '../../../src/copilot/tools/file/index.js';
import { searchTools } from '../../../src/copilot/tools/search/index.js';
import { allTools } from '../../../src/copilot/tools/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Encontra uma tool pelo nome em um array de tools */
function findTool(/** @type {any[]} */ tools, /** @type {string} */ name) {
    return tools.find((/** @type {any} */ t) => t.name === name);
}

/**
 * Chama o handler de uma tool com os parâmetros dados.
 *
 * @param {import('@github/copilot-sdk').Tool<any>} tool
 * @param {Record<string, any>} params
 */
async function callTool(tool, params) {
    return await /** @type {any} */ (tool).handler(params);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: diretório temporário DENTRO do workspace simulado
// ─────────────────────────────────────────────────────────────────────────────

// O WORKSPACE_ROOT interno é derivado de import.meta.url do file-tools.js.
// Para os testes usaremos caminhos de /workspaces/chatgpt-docker-puppeteer diretamente.
const WORKSPACE_ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);
const TMP_DIR = path.join(WORKSPACE_ROOT, 'tests', 'tmp', 'file-tools-test');

let tmpFile = '';
let tmpSubDir = '';

beforeEach(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    tmpSubDir = path.join(TMP_DIR, 'subdir');
    fs.mkdirSync(tmpSubDir, { recursive: true });
    tmpFile = path.join(TMP_DIR, 'sample.txt');
    fs.writeFileSync(tmpFile, 'linha 1\nlinha 2\nlinha 3\n', 'utf8');
});

afterEach(() => {
    try {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
        // ignora erros de limpeza
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite principal
// ─────────────────────────────────────────────────────────────────────────────

describe('fileTools — exportações do módulo', () => {
    it('fileReadTools é um Array com pelo menos 3 elementos', () => {
        assert.ok(Array.isArray(fileReadTools));
        assert.ok(fileReadTools.length >= 3);
    });

    it('fileWriteTools é um Array com 6 elementos', () => {
        assert.ok(Array.isArray(fileWriteTools));
        assert.equal(fileWriteTools.length, 6);
    });

    it('fileTools = fileReadTools + indexTools + scopeTools + fileWriteTools', () => {
        assert.ok(Array.isArray(fileTools));
        assert.equal(
            fileTools.length,
            fileReadTools.length + indexTools.length + scopeTools.length + fileWriteTools.length,
        );
    });

    it('fileReadTools inclui read_file_content, list_directory, diff_files', () => {
        const names = fileReadTools.map((t) => /** @type {any} */ (t).name);
        assert.ok(names.includes('read_file_content'));
        assert.ok(names.includes('list_directory'));
        assert.ok(names.includes('diff_files'));
    });

    it('searchTools inclui search_in_files', () => {
        const names = searchTools.map((t) => /** @type {any} */ (t).name);
        assert.ok(names.includes('search_in_files'));
    });

    it('fileWriteTools inclui write_file_content, create_file, delete_file, copy_file, move_file, patch_file', () => {
        const names = fileWriteTools.map((t) => /** @type {any} */ (t).name);
        assert.ok(names.includes('write_file_content'));
        assert.ok(names.includes('create_file'));
        assert.ok(names.includes('delete_file'));
        assert.ok(names.includes('copy_file'));
        assert.ok(names.includes('move_file'));
        assert.ok(names.includes('patch_file'));
    });

    it('allTools em index.js inclui todas as fileTools', () => {
        const allToolNames = allTools.map((tool) => /** @type {any} */ (tool).name);
        for (const tool of fileTools) {
            assert.ok(
                allToolNames.includes(/** @type {any} */ (tool).name),
                `allTools deveria incluir ${/** @type {any} */ (tool).name}`,
            );
        }
    });

    it('todas as tools têm name (string) e description (string não vazia)', () => {
        for (const tool of fileTools) {
            const t = /** @type {any} */ (tool);
            assert.equal(typeof t.name, 'string', `${t.name}: name deve ser string`);
            assert.ok(t.description && t.description.length > 0, `${t.name}: description não deve ser vazia`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// read_file_content
// ─────────────────────────────────────────────────────────────────────────────

describe('read_file_content', () => {
    const tool = findTool(fileReadTools, 'read_file_content');

    it('retorna conteúdo completo de um arquivo existente', async () => {
        const result = await callTool(tool, { path: tmpFile });
        assert.equal(result.success, true);
        assert.ok(result.content.includes('linha 1'));
        assert.ok(result.content.includes('linha 3'));
        assert.equal(typeof result.totalLines, 'number');
    });

    it('retorna range de linhas correto (startLine/endLine)', async () => {
        const result = await callTool(tool, { path: tmpFile, startLine: 2, endLine: 2 });
        assert.equal(result.success, true);
        assert.ok(result.content.includes('linha 2'));
        assert.ok(!result.content.includes('linha 1'));
        assert.ok(!result.content.includes('linha 3'));
    });

    it('retorna success=false para arquivo inexistente', async () => {
        const result = await callTool(tool, { path: path.join(TMP_DIR, 'nao_existe.txt') });
        assert.equal(result.success, false);
        assert.ok(result.error);
    });

    it('retorna success=false para caminho bloqueado (.env)', async () => {
        const result = await callTool(tool, { path: path.join(WORKSPACE_ROOT, '.env') });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('protegido') || result.error?.includes('Acesso negado'));
    });

    it('retorna success=false para path traversal fora do workspace', async () => {
        const result = await callTool(tool, { path: '/etc/passwd' });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('Acesso negado') || result.error?.includes('fora do workspace'));
    });

    it('retorna success=false quando path aponta para diretório', async () => {
        const result = await callTool(tool, { path: TMP_DIR });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('diretório'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// list_directory
// ─────────────────────────────────────────────────────────────────────────────

describe('list_directory', () => {
    const tool = findTool(fileReadTools, 'list_directory');

    it('lista os arquivos de um diretório com sucesso', async () => {
        const result = await callTool(tool, { path: TMP_DIR });
        assert.equal(result.success, true);
        assert.ok(Array.isArray(result.entries));
        assert.ok(result.entries.length > 0);
    });

    it('cada entrada tem name, type e path', async () => {
        const result = await callTool(tool, { path: TMP_DIR });
        assert.equal(result.success, true);
        for (const entry of result.entries) {
            assert.equal(typeof entry.name, 'string');
            assert.ok(['file', 'dir'].includes(entry.type));
            assert.equal(typeof entry.path, 'string');
        }
    });

    it('retorna success=false para arquivo (não-diretório)', async () => {
        const result = await callTool(tool, { path: tmpFile });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('diretório'));
    });

    it('retorna success=false para path traversal fora do workspace', async () => {
        const result = await callTool(tool, { path: '/tmp' });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('Acesso negado') || result.error?.includes('fora do workspace'));
    });

    it('lista recursivamente com depth=2', async () => {
        const innerFile = path.join(tmpSubDir, 'inner.txt');
        fs.writeFileSync(innerFile, 'inner', 'utf8');
        const result = await callTool(tool, { path: TMP_DIR, recursive: true, depth: 2 });
        assert.equal(result.success, true);
        // O subdiretório deve estar presente
        const subDirEntry = result.entries.find((/** @type {any} */ e) => e.type === 'dir');
        assert.ok(subDirEntry, 'deve encontrar entrada do tipo dir');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// search_in_files
// ─────────────────────────────────────────────────────────────────────────────

describe('search_in_files', () => {
    const tool = findTool(searchTools, 'search_in_files');

    it('encontra texto em um arquivo', async () => {
        const result = await callTool(tool, { pattern: 'linha 2', path: tmpFile });
        assert.equal(result.success, true);
        assert.ok(result.output.includes('linha 2'));
    });

    it('retorna output vazio quando não há matches', async () => {
        const result = await callTool(tool, { pattern: 'xyzzy_nao_existe', path: TMP_DIR });
        assert.equal(result.success, true);
        assert.equal(result.output.trim(), '');
    });

    it('retorna success=false para path fora do workspace', async () => {
        const result = await callTool(tool, { pattern: 'root', path: '/etc' });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('Acesso negado') || result.error?.includes('fora do workspace'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// write_file_content
// ─────────────────────────────────────────────────────────────────────────────

describe('write_file_content', () => {
    const tool = findTool(fileWriteTools, 'write_file_content');

    it('sobrescreve conteúdo de um arquivo existente', async () => {
        const result = await callTool(tool, { path: tmpFile, content: 'conteúdo novo' });
        assert.equal(result.success, true);
        assert.equal(fs.readFileSync(tmpFile, 'utf8'), 'conteúdo novo');
    });

    it('retorna success=false para arquivo inexistente', async () => {
        const result = await callTool(tool, {
            path: path.join(TMP_DIR, 'nao_existe.txt'),
            content: 'algo',
        });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('não encontrado') || result.error?.includes('create_file'));
    });

    it('retorna success=false para path fora do workspace', async () => {
        const result = await callTool(tool, { path: '/tmp/hack.txt', content: 'x' });
        assert.equal(result.success, false);
    });

    it('retorna success=false para arquivo bloqueado (.env)', async () => {
        // Cria .env temporário dentro do workspace para testar
        const envPath = path.join(TMP_DIR, '.env');
        const result = await callTool(tool, { path: envPath, content: 'x' });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('protegido') || result.error?.includes('Acesso negado'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// create_file
// ─────────────────────────────────────────────────────────────────────────────

describe('create_file', () => {
    const tool = findTool(fileWriteTools, 'create_file');

    it('cria um novo arquivo com conteúdo', async () => {
        const newFile = path.join(TMP_DIR, 'novo.txt');
        const result = await callTool(tool, { path: newFile, content: 'hello world' });
        assert.equal(result.success, true);
        assert.ok(fs.existsSync(newFile));
        assert.equal(fs.readFileSync(newFile, 'utf8'), 'hello world');
    });

    it('retorna success=false se arquivo já existe e overwrite=false', async () => {
        const result = await callTool(tool, { path: tmpFile, content: 'x', overwrite: false });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('já existe') || result.error?.includes('write_file_content'));
    });

    it('sobrescreve arquivo se overwrite=true', async () => {
        const result = await callTool(tool, { path: tmpFile, content: 'sobrescrito', overwrite: true });
        assert.equal(result.success, true);
        assert.equal(fs.readFileSync(tmpFile, 'utf8'), 'sobrescrito');
    });

    it('cria diretórios intermediários com createParentDirs=true', async () => {
        const nested = path.join(TMP_DIR, 'a', 'b', 'c.txt');
        const result = await callTool(tool, { path: nested, content: 'deep', createParentDirs: true });
        assert.equal(result.success, true);
        assert.ok(fs.existsSync(nested));
    });

    it('retorna success=false para path fora do workspace', async () => {
        const result = await callTool(tool, { path: '/tmp/new.txt', content: 'x' });
        assert.equal(result.success, false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// delete_file
// ─────────────────────────────────────────────────────────────────────────────

describe('delete_file', () => {
    const tool = findTool(fileWriteTools, 'delete_file');

    it('deleta arquivo existente', async () => {
        const result = await callTool(tool, { path: tmpFile });
        assert.equal(result.success, true);
        assert.equal(result.deleted, true);
        assert.ok(!fs.existsSync(tmpFile));
    });

    it('retorna success=false para arquivo inexistente', async () => {
        const result = await callTool(tool, { path: path.join(TMP_DIR, 'ghost.txt') });
        assert.equal(result.success, false);
        assert.ok(result.error);
    });

    it('retorna success=false para diretório (não-arquivo)', async () => {
        const result = await callTool(tool, { path: TMP_DIR });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('diretório'));
    });

    it('retorna success=false para path fora do workspace', async () => {
        const result = await callTool(tool, { path: '/usr/bin/node' });
        assert.equal(result.success, false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// copy_file
// ─────────────────────────────────────────────────────────────────────────────

describe('copy_file', () => {
    const tool = findTool(fileWriteTools, 'copy_file');

    it('copia arquivo para novo destino', async () => {
        const dest = path.join(TMP_DIR, 'copia.txt');
        const result = await callTool(tool, { source: tmpFile, destination: dest });
        assert.equal(result.success, true);
        assert.ok(fs.existsSync(dest));
        assert.equal(fs.readFileSync(dest, 'utf8'), fs.readFileSync(tmpFile, 'utf8'));
    });

    it('retorna success=false se destino existe e overwrite=false', async () => {
        const dest = path.join(TMP_DIR, 'copia.txt');
        fs.writeFileSync(dest, 'existente', 'utf8');
        const result = await callTool(tool, { source: tmpFile, destination: dest, overwrite: false });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('Destino já existe') || result.error?.includes('overwrite'));
    });

    it('retorna success=false se source é fora do workspace', async () => {
        const result = await callTool(tool, {
            source: '/etc/passwd',
            destination: path.join(TMP_DIR, 'out.txt'),
        });
        assert.equal(result.success, false);
    });

    it('retorna success=false se destination é fora do workspace', async () => {
        const result = await callTool(tool, {
            source: tmpFile,
            destination: '/tmp/out.txt',
        });
        assert.equal(result.success, false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// move_file
// ─────────────────────────────────────────────────────────────────────────────

describe('move_file', () => {
    const tool = findTool(fileWriteTools, 'move_file');

    it('move arquivo para novo destino', async () => {
        const dest = path.join(TMP_DIR, 'movido.txt');
        const originalContent = fs.readFileSync(tmpFile, 'utf8');
        const result = await callTool(tool, { source: tmpFile, destination: dest });
        assert.equal(result.success, true);
        assert.ok(!fs.existsSync(tmpFile), 'origem deve ser removida após move');
        assert.equal(fs.readFileSync(dest, 'utf8'), originalContent);
    });

    it('retorna success=false se destino existe e overwrite=false', async () => {
        const dest = path.join(TMP_DIR, 'existente.txt');
        fs.writeFileSync(dest, 'bloqueio', 'utf8');
        const result = await callTool(tool, { source: tmpFile, destination: dest, overwrite: false });
        assert.equal(result.success, false);
        assert.ok(result.error?.includes('Destino já existe') || result.error?.includes('overwrite'));
    });

    it('retorna success=false se source é fora do workspace', async () => {
        const result = await callTool(tool, {
            source: '/etc/hosts',
            destination: path.join(TMP_DIR, 'out.txt'),
        });
        assert.equal(result.success, false);
    });
});
