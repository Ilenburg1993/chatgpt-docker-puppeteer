// @ts-check
/**
 * src/copilot/tools/git/index.js
 *
 * Custom Tools para operações Git. Permite ao agente verificar estado do repositório, visualizar diffs e realizar
 * commits.
 *
 * @module copilot/tools/git
 */

import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { withSkipPermission } from '../tool-factory.js';

const execAsync = promisify(exec);

const ROOT = new URL('../../../..', import.meta.url).pathname;

/**
 * @param {string} cmd
 * @param {number} [timeoutMs]
 * @returns {Promise<{ stdout: string; exitCode: number; error?: string }>}
 */
async function safeGit(cmd, timeoutMs = 15000) {
    try {
        const { stdout } = await execAsync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs });
        return { stdout: stdout.slice(0, 4000), exitCode: 0 };
    } catch (/** @type {any} */ e) {
        return {
            stdout: (e.stdout ?? '').slice(0, 2000),
            exitCode: e.code ?? 1,
            error: (e.stderr ?? e.message ?? '').slice(0, 1000),
        };
    }
}

/**
 * Tool: git_status — mostra o status do repositório.
 */
const gitStatusTool = defineTool('git_status', {
    description: 'Mostra o status atual do repositório Git (arquivos modificados, staged, etc).',
    parameters: z.object({}),
    handler: async () => {
        const r = await safeGit('git status --short && echo "---" && git log --oneline -5');
        return { output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_diff — mostra as diferenças dos arquivos modificados.
 */
const gitDiffTool = defineTool('git_diff', {
    description: 'Mostra o diff dos arquivos modificados. Use para revisar mudanças antes de commitar.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                staged: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe('Se true, mostra apenas as mudanças já staged (git diff --staged)'),
                path: z.string().optional().describe('Caminho específico para ver diff'),
            })
        )
    ),
    handler: async (/** @type {{ staged?: boolean; path?: string }} */ { staged, path: filePath }) => {
        const flag = staged ? '--staged' : '';
        const target = filePath ?? '';
        const r = await safeGit(`git diff ${flag} ${target} | head -200`);
        return { output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_commit — realiza um commit com a mensagem informada. Staged apenas os arquivos especificados (ou todos com
 * --all).
 */
const gitCommitTool = defineTool('git_commit', {
    description: 'Adiciona arquivos e realiza um commit Git. Por segurança, requer confirmação prévia via ask_user.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                message: z.string().describe('Mensagem do commit (formato: "tipo: descrição")'),
                paths: z
                    .array(z.string())
                    .optional()
                    .describe('Arquivos a adicionar (omitir = add somente arquivos já tracked modificados)'),
                all: z.boolean().optional().default(false).describe('Se true, executa git add -A (adiciona tudo)'),
            })
        )
    ),
    handler: async (/** @type {{ message: string; paths?: string[]; all?: boolean }} */ { message, paths, all }) => {
        if (all) {
            await safeGit('git add -A');
        } else if (paths && paths.length > 0) {
            const escaped = paths.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(' ');
            await safeGit(`git add ${escaped}`);
        }
        // GAP-Q09 fix: verificar se há algo staged antes de commitar
        const staged = await safeGit('git diff --cached --name-only');
        if (staged.exitCode !== 0 || !staged.stdout.trim()) {
            return {
                success: false,
                output: '',
                error: 'Nenhum arquivo staged. Use `paths` ou `all:true` para adicionar arquivos antes de commitar.',
            };
        }
        log('INFO', `[copilot/git_commit] Commitando: ${message}`);
        const r = await safeGit(`git commit -m "${message.replace(/"/g, '\\"')}"`);
        return {
            success: r.exitCode === 0,
            output: r.stdout,
            error: r.error,
        };
    },
});

/**
 * Tool: git_changed_files — lista arquivos alterados vs HEAD.
 */
const gitChangedFilesTool = defineTool('git_changed_files', {
    description: 'Lista arquivos modificados em relação ao último commit.',
    parameters: z.object({}),
    handler: async () => {
        const r = await safeGit('git diff --name-status HEAD');
        return { output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_push — faz push do branch atual para o origin.
 */
const gitPushTool = defineTool('git_push', {
    description: 'Faz push do branch atual para o origin. Não suporta force-push por segurança.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                remote: z.string().optional().default('origin').describe('Remote de destino (padrão: origin)'),
                setUpstream: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe('Se true, define branch upstream (--set-upstream)'),
            })
        )
    ),
    handler: async (/** @type {{ remote?: string; setUpstream?: boolean }} */ { remote, setUpstream }) => {
        const upstream = setUpstream ? '--set-upstream' : '';
        const r = await safeGit(`git push ${upstream} "${(remote ?? 'origin').replace(/"/g, '')}"`, 30000);
        log('INFO', `[copilot/git_push] remote=${remote ?? 'origin'} exitCode=${r.exitCode}`);
        return { success: r.exitCode === 0, output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_create_branch — cria e faz checkout de um novo branch.
 */
const gitCreateBranchTool = defineTool('git_create_branch', {
    description: 'Cria um novo branch Git e faz checkout. Opcional: a partir de um commit/branch base.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                name: z.string().describe('Nome do branch (ex: "feat/nova-feature")'),
                base: z.string().optional().describe('Commit ou branch base (omitir = usa HEAD atual)'),
                checkout: z.boolean().optional().default(true).describe('Se false, apenas cria sem fazer checkout'),
            })
        )
    ),
    handler: async (/** @type {{ name: string; base?: string; checkout?: boolean }} */ { name, base, checkout }) => {
        // Sanitize branch name — only allow safe characters
        if (!/^[a-zA-Z0-9/_.-]+$/.test(name)) {
            return { success: false, error: 'Nome de branch inválido. Use apenas letras, números, /, _, -, .' };
        }
        const basePart = base && /^[a-zA-Z0-9/_.-]+$/.test(base) ? ` "${base}"` : '';
        const cmd = (checkout ?? true) ? `git checkout -b "${name}"${basePart}` : `git branch "${name}"${basePart}`;
        log('INFO', `[copilot/git_create_branch] ${cmd}`);
        const r = await safeGit(cmd);
        return { success: r.exitCode === 0, output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_log — retorna o log de commits recentes.
 */
const gitLogTool = defineTool('git_log', {
    description: 'Retorna o log de commits recentes com hash, autor, data e mensagem.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                n: z.number().int().min(1).max(50).optional().default(10).describe('Número de commits a retornar'),
                oneline: z.boolean().optional().default(true).describe('Se true, formato compacto (--oneline)'),
            })
        )
    ),
    handler: async (/** @type {{ n?: number; oneline?: boolean }} */ { n, oneline }) => {
        const format = (oneline ?? true) ? '--oneline' : '--pretty=format:"%h %an %ar %s"';
        const r = await safeGit(`git log ${format} -${n ?? 10}`);
        return { output: r.stdout, error: r.error };
    },
});

/**
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const gitTools = [
    withSkipPermission(gitStatusTool),
    withSkipPermission(gitDiffTool),
    gitCommitTool,
    withSkipPermission(gitChangedFilesTool),
    gitPushTool,
    gitCreateBranchTool,
    withSkipPermission(gitLogTool),
];
