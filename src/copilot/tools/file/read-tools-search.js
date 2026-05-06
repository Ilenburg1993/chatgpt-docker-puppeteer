// @ts-check
/**
 * src/copilot/tools/file/read-tools-search.js
 *
 * Tools de busca: search_in_files, diff_files.
 *
 * @module copilot/tools/file/read-tools-search
 * @see EventBus
 */

import { z } from 'zod';
import { toError, toExecError } from '../../core/error-handlers.js';
import { buildIoMeta, withIoMeta } from '../../core/io-contracts.js';
import { diffText } from '../../infra/io-engine.js';
import { publishIoOperation } from '../../infra/io-observability.js';
import { log } from '../logger.js';
import { buildTool } from '../tool-factory.js';
import { WORKSPACE_ROOT, execFileAsync, isRgAvailable, validatePath } from './shared.js';

const RG_TIMEOUT_MS = undefined;

/**
 * @param {string} stdout
 */
function sanitizeSearchOutput(stdout) {
    const SENSITIVE_LINE_RE = /-----BEGIN [A-Z ]+-----|ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
    return stdout
        .split('\n')
        .filter((line) => !SENSITIVE_LINE_RE.test(line))
        .join('\n');
}

/**
 * @param {{
 *     pattern: string;
 *     resolved: string;
 *     isRegex?: boolean;
 *     caseSensitive?: boolean;
 *     includePattern?: string;
 *     excludePattern?: string;
 *     contextLines?: number;
 * }} opts
 */
function buildGrepArgs(opts) {
    const args = [
        '-R',
        '-n',
        ...(opts.isRegex ? ['-E'] : ['-F']),
        ...(opts.caseSensitive ? [] : ['-i']),
        ...(opts.contextLines ? ['-C', String(opts.contextLines)] : []),
        '--exclude-dir=.git',
        '--exclude-dir=node_modules',
        '--exclude-dir=dist',
        ...(opts.includePattern ? [`--include=${opts.includePattern}`] : []),
        ...(opts.excludePattern ? [`--exclude=${opts.excludePattern}`] : []),
        opts.pattern,
        opts.resolved,
    ];
    return args;
}

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
            .optional()
            .default(2)
            .describe('Linhas de contexto ao redor de cada match.'),
        maxResults: z.number().int().min(1).optional().describe('Número máximo sugerido de resultados.'),
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

        log('INFO', `[copilot/search_in_files] pattern="${pattern}" in ${resolved}`);

        const rgArgs = [
            '--color=never',
            '--no-heading',
            ...(isRegex ? [] : ['--fixed-strings']),
            ...(caseSensitive ? [] : ['--ignore-case']),
            `--context=${contextLines ?? 2}`,
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
            if (await isRgAvailable()) {
                const { stdout, stderr: _stderr } = await execFileAsync('rg', rgArgs, {
                    cwd: WORKSPACE_ROOT,
                    timeout: RG_TIMEOUT_MS,
                    maxBuffer: 1024 * 1024 * 1024,
                });
                const filteredOutput = sanitizeSearchOutput(stdout);
                const io = buildIoMeta({
                    operation: 'search',
                    target: resolved,
                    bytesRead: Buffer.byteLength(filteredOutput, 'utf8'),
                    engine: 'rg',
                    truncated: false,
                    advisoryLimits: {
                        requestedMaxResults: maxResults ?? null,
                        limitMode: 'informative',
                        patternLength: pattern.length,
                    },
                });
                publishIoOperation(io, { success: true });
                return withIoMeta(
                    {
                        success: true,
                        pattern,
                        searchPath: resolved,
                        output: filteredOutput,
                        truncated: false,
                        engine: 'rg',
                        matchCount: filteredOutput.split('\n').filter(Boolean).length,
                    },
                    io,
                );
            }

            // Fallback para ambientes sem ripgrep.
            const grepArgs = buildGrepArgs({
                pattern,
                resolved,
                isRegex,
                caseSensitive,
                includePattern,
                excludePattern,
                contextLines,
            });
            const { stdout } = await execFileAsync('grep', grepArgs, {
                cwd: WORKSPACE_ROOT,
                timeout: RG_TIMEOUT_MS,
                maxBuffer: 1024 * 1024 * 1024,
            });
            const filteredOutput = sanitizeSearchOutput(stdout);
            const io = buildIoMeta({
                operation: 'search',
                target: resolved,
                bytesRead: Buffer.byteLength(filteredOutput, 'utf8'),
                engine: 'grep',
                truncated: false,
                advisoryLimits: {
                    requestedMaxResults: maxResults ?? null,
                    limitMode: 'informative',
                    patternLength: pattern.length,
                },
            });
            publishIoOperation(io, { success: true });
            return withIoMeta(
                {
                    success: true,
                    pattern,
                    searchPath: resolved,
                    output: filteredOutput,
                    truncated: false,
                    engine: 'grep',
                    matchCount: filteredOutput.split('\n').filter(Boolean).length,
                },
                io,
            );
        } catch (err) {
            const ex = toExecError(err);
            if ((ex.code === 1 || ex.status === 1) && !ex.stderr) {
                const io = buildIoMeta({
                    operation: 'search',
                    target: resolved,
                    bytesRead: 0,
                    engine: 'rg|grep',
                    advisoryLimits: {
                        requestedMaxResults: maxResults ?? null,
                        limitMode: 'informative',
                        patternLength: pattern.length,
                    },
                });
                publishIoOperation(io, { success: true });
                return withIoMeta({ success: true, pattern, searchPath: resolved, output: '', matchCount: 0 }, io);
            }
            if ((ex.code === 'ENOENT' || ex.message.includes('ENOENT')) && !(await isRgAvailable())) {
                return {
                    success: false,
                    error: 'Nem ripgrep (rg) nem grep estão disponíveis neste ambiente para search_in_files.',
                };
            }
            return { success: false, error: ex.stderr ?? ex.message };
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
            .optional()
            .default(3)
            .describe('Número de linhas de contexto exibidas ao redor de cada mudança (padrão histórico: 3)'),
    }),
    handler: async ({ path_a, path_b, context_lines }) => {
        const va = await validatePath(path_a, { mode: 'read' });
        if (!va.ok) return { success: false, error: `path_a: ${va.reason}` };
        const vb = await validatePath(path_b, { mode: 'read' });
        if (!vb.ok) return { success: false, error: `path_b: ${vb.reason}` };

        try {
            const diff = await diffText(va.resolved, vb.resolved, { contextLines: context_lines ?? 3 });
            return withIoMeta(
                {
                    success: true,
                    path_a: va.resolved,
                    path_b: vb.resolved,
                    diff: diff.diff,
                    identical: diff.identical,
                    engine: diff.io.engine,
                },
                diff.io,
            );
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { diffFilesTool, searchInFilesTool };
