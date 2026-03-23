// @ts-check
/**
 * src/copilot/tools/git-tools.js
 *
 * Custom Tools para operações Git. Permite ao agente verificar estado do repositório, visualizar diffs e realizar
 * commits.
 *
 * @module copilot/tools/git-tools
 */

import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import { execSync } from 'node:child_process';
import { z } from 'zod';

const ROOT = new URL('../../..', import.meta.url).pathname;

/**
 * @param {string} cmd
 * @param {number} [timeoutMs]
 * @returns {{ stdout: string; exitCode: number; error?: string }}
 */
function safeGit(cmd, timeoutMs = 15000) {
    try {
        const stdout = execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs });
        return { stdout: stdout.slice(0, 4000), exitCode: 0 };
    } catch (/** @type {any} */ e) {
        return {
            stdout: (e.stdout ?? '').slice(0, 2000),
            exitCode: e.status ?? 1,
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
        const r = safeGit('git status --short && echo "---" && git log --oneline -5');
        return { output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_diff — mostra as diferenças dos arquivos modificados.
 */
const gitDiffTool = defineTool('git_diff', {
    description: 'Mostra o diff dos arquivos modificados. Use para revisar mudanças antes de commitar.',
    parameters: z.object({
        staged: z
            .boolean()
            .optional()
            .default(false)
            .describe('Se true, mostra apenas as mudanças já staged (git diff --staged)'),
        path: z.string().optional().describe('Caminho específico para ver diff'),
    }),
    handler: async (/** @type {{ staged?: boolean; path?: string }} */ { staged, path: filePath }) => {
        const flag = staged ? '--staged' : '';
        const target = filePath ?? '';
        const r = safeGit(`git diff ${flag} ${target} | head -200`);
        return { output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_commit — realiza um commit com a mensagem informada. Staged apenas os arquivos especificados (ou todos com
 * --all).
 */
const gitCommitTool = defineTool('git_commit', {
    description: 'Adiciona arquivos e realiza um commit Git. Por segurança, requer confirmação prévia via ask_user.',
    parameters: z.object({
        message: z.string().describe('Mensagem do commit (formato: "tipo: descrição")'),
        paths: z
            .array(z.string())
            .optional()
            .describe('Arquivos a adicionar (omitir = add somente arquivos já tracked modificados)'),
        all: z.boolean().optional().default(false).describe('Se true, executa git add -A (adiciona tudo)'),
    }),
    handler: async (/** @type {{ message: string; paths?: string[]; all?: boolean }} */ { message, paths, all }) => {
        if (all) {
            safeGit('git add -A');
        } else if (paths && paths.length > 0) {
            const escaped = paths.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(' ');
            safeGit(`git add ${escaped}`);
        }
        log('INFO', `[copilot/git_commit] Commitando: ${message}`);
        const r = safeGit(`git commit -m "${message.replace(/"/g, '\\"')}"`);
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
        const r = safeGit('git diff --name-status HEAD');
        return { output: r.stdout, error: r.error };
    },
});

/**
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const gitTools = [gitStatusTool, gitDiffTool, gitCommitTool, gitChangedFilesTool];
