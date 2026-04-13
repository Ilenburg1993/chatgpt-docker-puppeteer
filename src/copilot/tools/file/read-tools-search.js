// @ts-check
/**
 * src/copilot/tools/file/read-tools-search.js
 *
 * Tools de busca: search_in_files, diff_files.
 *
 * @module copilot/tools/file/read-tools-search
 * @see EventBus
 */

import { log } from '#copilot/observability';
import { z } from 'zod';
import { buildTool } from '../tool-factory.js';
import { MAX_SEARCH_OUTPUT, WORKSPACE_ROOT, execFileAsync, isRgAvailable, validatePath } from './shared.js';

const RG_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Tool: search_in_files
// ---------------------------------------------------------------------------

/**
 * Tool: search_in_files — busca texto/regex em arquivos do workspace.
 */
const searchInFilesTool = buildTool({
    name: 'search_in_files',
    description:
        'Busca texto ou regex em arquivos do workspace usando ripgrep (rg). ' +
        'Retorna correspondências com número de linha e contexto.',
    parameters: z.object({
        pattern: z.string().describe('Padrão de busca (texto literal ou regex)'),
        path: z.string().optional().default('.').describe('Diretório ou arquivo onde buscar (relativo ao workspace)'),
        isRegex: z.boolean().optional().default(false).describe('Se true, trata pattern como expressão regular'),
        caseSensitive: z.boolean().optional().default(false).describe('Busca sensível a maiúsculas'),
        includePattern: z.string().optional().describe('Filtro de arquivos a incluir (ex: *.js, *.ts)'),
        excludePattern: z.string().optional().describe('Filtro de arquivos a excluir (ex: node_modules, dist)'),
        contextLines: z
            .number()
            .int()
            .min(0)
            .max(10)
            .optional()
            .default(2)
            .describe('Linhas de contexto ao redor de cada match (0-10)'),
        maxResults: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .default(50)
            .describe('Número máximo de resultados (1-500)'),
    }),
    handler: async ({
        pattern,
        path: searchPath,
        isRegex,
        caseSensitive,
        includePattern,
        excludePattern,
        contextLines,
        maxResults,
    }) => {
        const { ok, reason, resolved } = await validatePath(searchPath ?? '.', { mode: 'read' });
        if (!ok) return { success: false, error: reason };

        // SEC-P2-02: limitar comprimento do pattern para evitar ReDoS
        if (pattern.length > 500) {
            return { success: false, error: 'Pattern muito longo (máximo 500 caracteres).' };
        }

        log('INFO', `[copilot/search_in_files] pattern="${pattern}" in ${resolved}`);

        const rgArgs = [
            '--color=never',
            '--no-heading',
            ...(isRegex ? [] : ['--fixed-strings']),
            ...(caseSensitive ? [] : ['--ignore-case']),
            `--context=${contextLines ?? 2}`,
            `--max-count=${maxResults ?? 50}`,
            ...(includePattern ? [`--glob=${includePattern}`] : []),
            ...(excludePattern ? [`--glob=!${excludePattern}`] : []),
            '--glob=!node_modules',
            '--glob=!.git',
            '--glob=!dist',
            '-e',
            pattern,
            resolved,
        ];

        try {
            if (!(await isRgAvailable())) {
                return { success: false, error: 'ripgrep (rg) não está disponível neste ambiente.' };
            }
            const { stdout, stderr: _stderr } = await execFileAsync('rg', rgArgs, {
                cwd: WORKSPACE_ROOT,
                timeout: RG_TIMEOUT_MS,
                maxBuffer: MAX_SEARCH_OUTPUT * 4,
            });
            const SENSITIVE_LINE_RE = /-----BEGIN [A-Z ]+-----|ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
            const filteredOutput = stdout
                .split('\n')
                .filter((line) => !SENSITIVE_LINE_RE.test(line))
                .join('\n')
                .slice(0, MAX_SEARCH_OUTPUT);
            return {
                success: true,
                pattern,
                searchPath: resolved,
                output: filteredOutput,
                truncated: stdout.length >= MAX_SEARCH_OUTPUT,
            };
        } catch (/** @type {any} */ err) {
            if ((err.code === 1 || err.status === 1) && !err.stderr) {
                return { success: true, pattern, searchPath: resolved, output: '', matchCount: 0 };
            }
            return { success: false, error: err.stderr ?? err.message };
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: diff_files
// ---------------------------------------------------------------------------

/**
 * Tool: diff_files — exibe diferença unificada entre dois arquivos.
 */
const diffFilesTool = buildTool({
    name: 'diff_files',
    description:
        'Exibe a diferença unificada (unified diff) entre dois arquivos do workspace. ' +
        'Útil para comparar versões ou verificar mudanças antes de aplicar patches.',
    parameters: z.object({
        path_a: z.string().describe('Caminho do primeiro arquivo (linha base / original)'),
        path_b: z.string().describe('Caminho do segundo arquivo (linha modificada / nova versão)'),
        context_lines: z
            .number()
            .int()
            .min(0)
            .max(20)
            .optional()
            .default(3)
            .describe('Número de linhas de contexto exibidas ao redor de cada mudança (padrão: 3)'),
    }),
    handler: async ({ path_a, path_b, context_lines }) => {
        const va = await validatePath(path_a, { mode: 'read' });
        if (!va.ok) return { success: false, error: `path_a: ${va.reason}` };
        const vb = await validatePath(path_b, { mode: 'read' });
        if (!vb.ok) return { success: false, error: `path_b: ${vb.reason}` };

        try {
            const { stdout } = await execFileAsync('diff', [`-U${context_lines ?? 3}`, va.resolved, vb.resolved]).catch(
                (err) => {
                    if (err.code === 1) return { stdout: err.stdout ?? '', stderr: '' };
                    throw err;
                },
            );
            const MAX_DIFF_BYTES = 64_000;
            const diff =
                stdout.length > MAX_DIFF_BYTES ? stdout.slice(0, MAX_DIFF_BYTES) + '\n[... diff truncado ...]' : stdout;
            return {
                success: true,
                path_a: va.resolved,
                path_b: vb.resolved,
                diff,
                identical: diff.trim() === '',
            };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { diffFilesTool, searchInFilesTool };
