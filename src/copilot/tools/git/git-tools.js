// @ts-check
import { WORKSPACE_ROOT } from '#copilot/boot';
import { toExecError } from '#copilot/core';
import { resolveProcessExecutionBudget } from '#copilot/infra/public/policy';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';
/**
 * src/copilot/tools/git/git-tools.js
 *
 * Custom Tools para operações Git. Permite ao agente verificar estado do repositório, visualizar diffs e realizar
 * commits.
 *
 * @module copilot/tools/git/git-tools
 * @see EventBus
 */

const execAsync = promisify(execFile);

const ROOT = WORKSPACE_ROOT;
const ADVISORY_GIT_CMD_TIMEOUT_MS = 15_000;
const ADVISORY_GIT_PUSH_TIMEOUT_MS = 30_000;

/**
 * F3.8 (LEVE-11): executa `git` com args separados (sem interpolação shell) — seguro para valores fornecidos pelo
 * usuário (ex: mensagem de commit, paths).
 *
 * @param {string[]} args - Argumentos para `git` (ex: ['commit', '-m', message])
 * @param {number} [timeoutMs]
 * @returns {Promise<{ stdout: string; exitCode: number; error?: string }>}
 */
async function safeGitArgs(args, timeoutMs = ADVISORY_GIT_CMD_TIMEOUT_MS) {
    const budget = resolveProcessExecutionBudget({ timeoutMs });
    log('DEBUG', `[copilot/git] timeout=${budget.timeoutMs}ms git ${args.join(' ')}`);
    try {
        const { stdout } = await execAsync('git', args, {
            cwd: ROOT,
            encoding: 'utf8',
            ...(budget.timeoutMs === null ? {} : { timeout: budget.timeoutMs }),
            maxBuffer: budget.maxBufferBytes,
        });
        return { stdout, exitCode: 0 };
    } catch (e) {
        const ex = toExecError(e);
        return {
            stdout: ex.stdout ?? '',
            exitCode: typeof ex.code === 'number' ? ex.code : 1,
            error: ex.stderr ?? ex.message ?? '',
        };
    }
}

/**
 * Tool: git_status — mostra o status do repositório.
 */
const gitStatusTool = buildTool({
    name: 'git_status',
    description: 'Mostra o status atual do repositório Git (arquivos modificados, staged, etc).',
    parameters: z.object({}),
    handler: async () => {
        const statusResult = await safeGitArgs(['status', '--short']);
        const logResult = await safeGitArgs(['log', '--oneline', '-5']);
        const combined = [statusResult.stdout, '---', logResult.stdout].filter(Boolean).join('\n');
        return { output: combined, error: statusResult.error || logResult.error };
    },
});

/**
 * Tool: git_diff — mostra as diferenças dos arquivos modificados.
 */
const gitDiffTool = buildTool({
    name: 'git_diff',
    description: 'Mostra o diff dos arquivos modificados. Use para revisar mudanças antes de commitar.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                staged: z
                    .boolean()
                    .optional()
                    .default(false)['describe']('Se true, mostra apenas as mudanças já staged (git diff --staged)'),
                path: z.string().optional()['describe']('Caminho específico para ver diff'),
            })
        )
    ),
    handler: async (/** @type {{ staged?: boolean; path?: string }} */ { staged, path: filePath }) => {
        const args = ['diff'];
        if (staged) args.push('--staged');
        if (filePath) args.push('--', filePath);
        const r = await safeGitArgs(args);
        return { output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_commit — realiza um commit com a mensagem informada. Staged apenas os arquivos especificados (ou todos com
 * --all).
 */
const gitCommitTool = buildTool({
    name: 'git_commit',
    description: 'Adiciona arquivos e realiza um commit Git com mensagem informada.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                message: z.string()['describe']('Mensagem do commit (formato: "tipo: descrição")'),
                paths: z
                    .array(z.string())
                    .optional()['describe']('Arquivos a adicionar (omitir = add somente arquivos já tracked modificados)'),
                all: z.boolean().optional().default(false)['describe']('Se true, executa git add -A (adiciona tudo)'),
            })
        )
    ),
    handler: async (/** @type {{ message: string; paths?: string[]; all?: boolean }} */ { message, paths, all }) => {
        if (all) {
            await safeGitArgs(['add', '-A']);
        } else if (paths && paths.length > 0) {
            // F3.8: paths como args separados — sem interpolação shell
            await safeGitArgs(['add', '--', ...paths]);
        }
        // GAP-Q09 fix: verificar se há algo staged antes de commitar
        const staged = await safeGitArgs(['diff', '--cached', '--name-only']);
        if (staged.exitCode !== 0 || !staged.stdout.trim()) {
            return {
                success: false,
                output: '',
                error: 'Nenhum arquivo staged. Use `paths` ou `all:true` para adicionar arquivos antes de commitar.',
            };
        }
        log('INFO', `[copilot/git_commit] Commitando: ${message}`);
        // F3.8: mensagem como arg separado — elimina risco de injeção shell via conteúdo da mensagem
        const r = await safeGitArgs(['commit', '-m', message]);
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
const gitChangedFilesTool = buildTool({
    name: 'git_changed_files',
    description: 'Lista arquivos modificados em relação ao último commit.',
    parameters: z.object({}),
    handler: async () => {
        const r = await safeGitArgs(['diff', '--name-status', 'HEAD']);
        return { output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_push — faz push do branch atual para o origin.
 */
const gitPushTool = buildTool({
    name: 'git_push',
    description: 'Faz push do branch atual para o origin. Não suporta force-push por segurança.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                remote: z.string().optional().default('origin')['describe']('Remote de destino (padrão: origin)'),
                setUpstream: z
                    .boolean()
                    .optional()
                    .default(false)['describe']('Se true, define branch upstream (--set-upstream)'),
            })
        )
    ),
    handler: async (/** @type {{ remote?: string; setUpstream?: boolean }} */ { remote, setUpstream }) => {
        const safeRemote = (remote ?? 'origin').replace(/[^a-zA-Z0-9/_.-]/g, '');
        const args = ['push'];
        if (setUpstream) args.push('--set-upstream');
        args.push(safeRemote);
        const r = await safeGitArgs(args, ADVISORY_GIT_PUSH_TIMEOUT_MS);
        log('INFO', `[copilot/git_push] remote=${safeRemote} exitCode=${r.exitCode}`);
        return { success: r.exitCode === 0, output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_create_branch — cria e faz checkout de um novo branch.
 */
const gitCreateBranchTool = buildTool({
    name: 'git_create_branch',
    description: 'Cria um novo branch Git e faz checkout. Opcional: a partir de um commit/branch base.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                name: z.string()['describe']('Nome do branch (ex: "feat/nova-feature")'),
                base: z.string().optional()['describe']('Commit ou branch base (omitir = usa HEAD atual)'),
                checkout: z.boolean().optional().default(true)['describe']('Se false, apenas cria sem fazer checkout'),
            })
        )
    ),
    handler: async (/** @type {{ name: string; base?: string; checkout?: boolean }} */ { name, base, checkout }) => {
        // Sanitize branch name — only allow safe characters
        if (!/^[a-zA-Z0-9/_.-]+$/.test(name)) {
            return { success: false, error: 'Nome de branch inválido. Use apenas letras, números, /, _, -, .' };
        }
        const args = (checkout ?? true) ? ['checkout', '-b', name] : ['branch', name];
        if (base) {
            if (!/^[a-zA-Z0-9/_.-]+$/.test(base)) {
                return { success: false, error: 'Base inválida. Use apenas letras, números, /, _, -, .' };
            }
            args.push(base);
        }
        log('INFO', `[copilot/git_create_branch] git ${args.join(' ')}`);
        const r = await safeGitArgs(args);
        return { success: r.exitCode === 0, output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_log — retorna o log de commits recentes.
 */
const gitLogTool = buildTool({
    name: 'git_log',
    description: 'Retorna o log de commits recentes com hash, autor, data e mensagem.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                n: z.number().int().min(1).optional().default(10)['describe']('Número sugerido de commits a retornar'),
                oneline: z.boolean().optional().default(true)['describe']('Se true, formato compacto (--oneline)'),
            })
        )
    ),
    handler: async (/** @type {{ n?: number; oneline?: boolean }} */ { n, oneline }) => {
        const args = ['log'];
        if (oneline ?? true) {
            args.push('--oneline');
        } else {
            args.push('--pretty=format:%h %an %ar %s');
        }
        args.push(`-${n ?? 10}`);
        const r = await safeGitArgs(args);
        return { output: r.stdout, error: r.error };
    },
});

/**
 * Tool: git_current_branch — retorna o nome do branch atual.
 */
const gitCurrentBranchTool = buildTool({
    name: 'git_current_branch',
    description:
        'Retorna o nome do branch Git atual. Útil para confirmar em qual branch está antes de commitar ou pushar.',
    parameters: z.object({}),
    handler: async () => {
        const r = await safeGitArgs(['rev-parse', '--abbrev-ref', 'HEAD']);
        return { branch: r.stdout.trim(), error: r.error };
    },
});

/**
 * Tool: git_is_dirty — verifica se há arquivos modificados não commitados.
 */
const gitIsDirtyTool = buildTool({
    name: 'git_is_dirty',
    description:
        'Verifica se o repositório tem mudanças não commitadas (working tree sujo). Retorna isDirty=true se há arquivos modificados, staged ou untracked.',
    parameters: z.object({}),
    handler: async () => {
        const r = await safeGitArgs(['status', '--porcelain']);
        const isDirty = r.stdout.trim().length > 0;
        const lines = r.stdout.trim() ? r.stdout.trim().split('\n') : [];
        return {
            isDirty,
            changedFiles: lines.length,
            summary: isDirty ? `${lines.length} arquivo(s) modificado(s)` : 'working tree limpa',
            error: r.error,
        };
    },
});

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const gitTools = [
    withSkipPermission(gitStatusTool),
    withSkipPermission(gitDiffTool),
    gitCommitTool,
    withSkipPermission(gitChangedFilesTool),
    gitPushTool,
    gitCreateBranchTool,
    withSkipPermission(gitLogTool),
    withSkipPermission(gitCurrentBranchTool),
    withSkipPermission(gitIsDirtyTool),
];
