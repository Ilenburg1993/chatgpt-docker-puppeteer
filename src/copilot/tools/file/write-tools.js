// @ts-check
/**
 * src/copilot/tools/file/write-tools.js
 *
 * Tools de escrita do filesystem: write_file_content, create_file, delete_file, copy_file, move_file, patch_file.
 *
 * @module copilot/tools/file/write-tools
 * @see module:copilot/tools/file/shared
 */

import { log } from '#copilot/observability/logger';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { buildTool } from '../tool-factory.js';
import { validatePath } from './shared.js';

/**
 * Escrita atômica: grava em arquivo temporário e renomeia (evita corrupção se crash durante write).
 *
 * @param {string} filePath - Caminho final do arquivo
 * @param {string | Buffer} content - Conteúdo a escrever
 * @param {BufferEncoding} [encoding] - Encoding (utf8 se string)
 * @returns {Promise<void>}
 */
async function atomicWrite(filePath, content, encoding) {
    const tmpPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmpPath, content, encoding);
    await fs.rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Tool: write_file_content
// ---------------------------------------------------------------------------

/**
 * Tool: write_file_content — escreve conteúdo em um arquivo existente.
 */
const writeFileContentTool = buildTool({
    name: 'write_file_content',
    description:
        'Escreve conteúdo em um arquivo existente no workspace. ' +
        '⚠️ REQUER APROVAÇÃO — sobrescreve conteúdo existente. Use create_file para arquivos novos.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo (deve existir)'),
        content: z.string().describe('Novo conteúdo completo do arquivo'),
        encoding: z
            .enum(['utf8', 'base64'])
            .optional()
            .default('utf8')
            .describe('Codificação do conteúdo (utf8 para texto, base64 para binário)'),
    }),
    handler: async ({ path: filePath, content, encoding }) => {
        const { ok, reason, resolved } = await validatePath(filePath);
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/write_file_content] ${resolved}`);

        try {
            try {
                await fs.access(resolved);
            } catch {
                return { success: false, error: 'Arquivo não encontrado. Use create_file para criar um novo arquivo.' };
            }
            const buf = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
            await atomicWrite(resolved, buf);
            return {
                success: true,
                path: resolved,
                bytesWritten: buf.length,
            };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: create_file
// ---------------------------------------------------------------------------

/**
 * Tool: create_file — cria um novo arquivo com conteúdo opcional.
 */
const createFileTool = buildTool({
    name: 'create_file',
    description:
        'Cria um novo arquivo no workspace com conteúdo opcional. ' +
        '⚠️ REQUER APROVAÇÃO — o arquivo não deve existir previamente (use write_file_content para sobrescrever).',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo a criar'),
        content: z.string().optional().default('').describe('Conteúdo inicial do arquivo'),
        createParentDirs: z
            .boolean()
            .optional()
            .default(true)
            .describe('Se true, cria diretórios intermediários se não existirem'),
        overwrite: z
            .boolean()
            .optional()
            .default(false)
            .describe('Se true, sobrescreve o arquivo se já existir (⚠️ destrutivo)'),
    }),
    handler: async ({ path: filePath, content, createParentDirs, overwrite }) => {
        const { ok, reason, resolved } = await validatePath(filePath);
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/create_file] ${resolved}`);

        try {
            if (!overwrite) {
                try {
                    await fs.access(resolved);
                    return {
                        success: false,
                        error: 'Arquivo já existe. Passe overwrite: true para sobrescrever ou use write_file_content.',
                    };
                } catch {
                    /* file does not exist — ok */
                }
            }
            if (createParentDirs) {
                await fs.mkdir(path.dirname(resolved), { recursive: true });
            }
            await atomicWrite(resolved, content ?? '', 'utf8');
            return {
                success: true,
                path: resolved,
                bytesWritten: (content ?? '').length,
            };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: delete_file
// ---------------------------------------------------------------------------

/**
 * Tool: delete_file — deleta um arquivo do workspace.
 */
const deleteFileTool = buildTool({
    name: 'delete_file',
    description:
        'Deleta um arquivo do workspace. ' + '⚠️ REQUER APROVAÇÃO — OPERAÇÃO IRREVERSÍVEL. Não deleta diretórios.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo a deletar'),
    }),
    handler: async ({ path: filePath }) => {
        const { ok, reason, resolved } = await validatePath(filePath);
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/delete_file] ${resolved}`);

        try {
            const stats = await fs.stat(resolved);
            if (stats.isDirectory()) {
                return { success: false, error: 'É um diretório. delete_file só opera em arquivos.' };
            }
            await fs.unlink(resolved);
            return { success: true, path: resolved, deleted: true };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: copy_file
// ---------------------------------------------------------------------------

/**
 * Tool: copy_file — copia um arquivo para outro caminho no workspace.
 */
const copyFileTool = buildTool({
    name: 'copy_file',
    description: 'Copia um arquivo para outro caminho no workspace. ' + '⚠️ REQUER APROVAÇÃO se o destino já existe.',
    parameters: z.object({
        source: z.string().describe('Caminho do arquivo de origem'),
        destination: z.string().describe('Caminho de destino'),
        overwrite: z.boolean().optional().default(false).describe('Sobrescrever destino se existir'),
    }),
    handler: async ({ source, destination, overwrite }) => {
        const src = await validatePath(source, { mode: 'read' });
        if (!src.ok) return { success: false, error: src.reason };

        const dst = await validatePath(destination);
        if (!dst.ok) return { success: false, error: dst.reason };

        log('INFO', `[copilot/copy_file] ${src.resolved} → ${dst.resolved}`);

        try {
            if (!overwrite) {
                try {
                    await fs.access(dst.resolved);
                    return {
                        success: false,
                        error: 'Destino já existe. Passe overwrite: true para sobrescrever.',
                    };
                } catch {
                    /* dest does not exist — ok */
                }
            }
            await fs.mkdir(path.dirname(dst.resolved), { recursive: true });
            await fs.copyFile(src.resolved, dst.resolved);
            const stats = await fs.stat(dst.resolved);
            return { success: true, source: src.resolved, destination: dst.resolved, bytesWritten: stats.size };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: move_file
// ---------------------------------------------------------------------------

/**
 * Tool: move_file — move/renomeia um arquivo para outro caminho no workspace.
 */
const moveFileTool = buildTool({
    name: 'move_file',
    description: 'Move ou renomeia um arquivo no workspace. ' + '⚠️ REQUER APROVAÇÃO — remove o arquivo de origem.',
    parameters: z.object({
        source: z.string().describe('Caminho do arquivo de origem'),
        destination: z.string().describe('Caminho de destino'),
        overwrite: z.boolean().optional().default(false).describe('Sobrescrever destino se existir'),
    }),
    handler: async ({ source, destination, overwrite }) => {
        const src = await validatePath(source, { mode: 'read' });
        if (!src.ok) return { success: false, error: src.reason };

        const dst = await validatePath(destination);
        if (!dst.ok) return { success: false, error: dst.reason };

        log('INFO', `[copilot/move_file] ${src.resolved} → ${dst.resolved}`);

        try {
            if (!overwrite) {
                try {
                    await fs.access(dst.resolved);
                    return {
                        success: false,
                        error: 'Destino já existe. Passe overwrite: true para sobrescrever.',
                    };
                } catch {
                    /* dest does not exist — ok */
                }
            }
            await fs.mkdir(path.dirname(dst.resolved), { recursive: true });
            await fs.rename(src.resolved, dst.resolved);
            return { success: true, source: src.resolved, destination: dst.resolved };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: patch_file
// ---------------------------------------------------------------------------

/**
 * Tool: patch_file — edição cirúrgica por substituição de string exata.
 */
const patchFileTool = buildTool({
    name: 'patch_file',
    description:
        'Aplica uma substituição cirúrgica num arquivo: substitui `old_string` por `new_string`. ' +
        '`old_string` deve ocorrer EXATAMENTE UMA VEZ no arquivo (inclua ≥3 linhas de contexto). ' +
        '⚠️ REQUER APROVAÇÃO — modifica o arquivo em disco.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo (relativo ao workspace ou absoluto)'),
        old_string: z.string().min(1).describe('Texto exato a substituir. Deve ocorrer exatamente 1 vez no arquivo.'),
        new_string: z.string().describe('Texto de substituição (pode ser string vazia para deletar)'),
    }),
    handler: async ({ path: filePath, old_string, new_string }) => {
        const v = await validatePath(filePath);
        if (!v.ok) return { success: false, error: v.reason };

        try {
            await fs.access(v.resolved);
        } catch {
            return { success: false, error: `Arquivo não encontrado: ${v.resolved}` };
        }

        let content;
        try {
            content = await fs.readFile(v.resolved, 'utf8');
        } catch (/** @type {any} */ e) {
            return { success: false, error: `Erro ao ler arquivo: ${e.message}` };
        }

        const occurrences = content.split(old_string).length - 1;
        if (occurrences === 0) {
            return { success: false, error: 'old_string não encontrado no arquivo.' };
        }
        if (occurrences > 1) {
            return {
                success: false,
                error: `old_string encontrado ${occurrences} vezes. Inclua mais contexto para identificar unicamente.`,
            };
        }

        // BUG-HIGH-01 fix: escapar padrões especiais de substituição ($&, $', $`, $$, $n)
        const safeNewString = new_string.replace(/\$/g, '$$$$');
        const updated = content.replace(old_string, safeNewString);
        try {
            await atomicWrite(v.resolved, updated, 'utf8');
            log('INFO', `[copilot/patch_file] Patch aplicado: ${v.resolved}`);
            return { success: true, path: v.resolved };
        } catch (/** @type {any} */ e) {
            return { success: false, error: `Erro ao escrever arquivo: ${e.message}` };
        }
    },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { copyFileTool, createFileTool, deleteFileTool, moveFileTool, patchFileTool, writeFileContentTool };

/**
 * Tools de escrita do filesystem (requirePermission — aprovação obrigatória).
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const fileWriteTools = [
    writeFileContentTool,
    createFileTool,
    deleteFileTool,
    copyFileTool,
    moveFileTool,
    patchFileTool,
];
