// @ts-check
/**
 * src/copilot/tools/file/symbol-search-tool.js
 *
 * Tool workspace_symbol_search — busca símbolos (funções, classes, exports, tipos) no workspace usando ripgrep com
 * padrões de declaração específicos por linguagem. Equivalente funcional ao "Go to Symbol in Workspace" do VS Code,
 * utilizando o mesmo motor (ripgrep) que o editor usa internamente para busca de arquivos.
 *
 * @module copilot/tools/file/symbol-search-tool
 * @see EventBus
 */

import { z } from 'zod';
import { toError, toExecError } from '../../core/error-handlers.js';
import { log } from '../logger.js';
import { buildTool } from '../tool-factory.js';
import { MAX_SEARCH_OUTPUT, WORKSPACE_ROOT, execFileAsync, isRgAvailable, validatePath } from './shared.js';

const RG_TIMEOUT_MS = 30_000;

/**
 * Tipos de símbolo suportados e seus padrões ripgrep por linguagem.
 *
 * @typedef {'function' | 'class' | 'variable' | 'export' | 'type' | 'all'} SymbolKind
 */

/**
 * Faz escape de caracteres especiais de regex no nome do símbolo.
 *
 * @param {string} name
 * @returns {string}
 */
function escapeRegex(name) {
    return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Constrói padrão ripgrep (--regexp) para o símbolo e kind solicitados. Suporta JS/TS/Python/Rust/Go com padrões
 * específicos por linguagem.
 *
 * @param {string} symbolName - Nome ou prefixo do símbolo a buscar
 * @param {SymbolKind} kind - Tipo de símbolo
 * @returns {string} Padrão regex para ripgrep
 */
function buildSymbolPattern(symbolName, kind) {
    const n = escapeRegex(symbolName);

    /** @type {Record<SymbolKind, string>} */
    const patterns = {
        /** Funções nomeadas JS/TS/Python/Rust/Go */
        function: [
            `(?:async\\s+)?function\\s+${n}\\b`, // function foo(
            `${n}\\s*[:=]\\s*(?:async\\s+)?(?:\\([^)]*\\)|\\w+)\\s*=>`, // foo = (...) =>
            `${n}\\s*[:=]\\s*(?:async\\s+)?function`, // foo = function
            `def\\s+${n}\\b`, // Python def
            `fn\\s+${n}\\b`, // Rust fn
            `func\\s+${n}\\b`, // Go func
        ].join('|'),

        /** Declarações de classe */
        class: [`class\\s+${n}\\b`, `${n}\\s*=\\s*class\\b`].join('|'),

        /** Variáveis e constantes */
        variable: [
            `(?:const|let|var)\\s+${n}\\b`,
            `${n}\\s*:?=\\s*(?!>)`, // Python/Go assignment (heurística)
        ].join('|'),

        /** Exports explícitos (ES modules) */
        export: [
            `export\\s+(?:default\\s+)?(?:(?:async\\s+)?function|class|const|let|var|type|interface)\\s+${n}\\b`,
            `export\\s*\\{[^}]*\\b${n}\\b`,
            `module\\.exports[\\[.].*\\b${n}\\b`, // CommonJS
        ].join('|'),

        /** Tipos TypeScript / JSDoc / Python type alias */
        type: [
            `(?:interface|type)\\s+${n}\\b`,
            `@typedef\\s+\\{[^}]+\\}\\s+${n}\\b`,
            `${n}\\s*=\\s*(?:TypeVar|NewType)\\(`, // Python
        ].join('|'),

        /** "all" — qualquer declaração de qualquer kind */
        all: [
            `(?:(?:async\\s+)?function|class|(?:const|let|var)|interface|type|def\\s|fn\\s|func\\s)\\s*${n}\\b`,
            `${n}\\s*[:=]\\s*(?:async\\s+)?(?:\\([^)]*\\)|\\w+)\\s*=>`,
        ].join('|'),
    };

    return patterns[kind] ?? patterns.all;
}

/**
 * Mapeia kind para extensões de arquivo relevantes (glob ripgrep).
 *
 * @param {SymbolKind} kind
 * @returns {string[]} Globs a incluir
 */
function kindToGlobs(kind) {
    if (kind === 'type') return ['*.ts', '*.tsx', '*.d.ts'];
    // Para outros kinds, todos os tipos comuns de source
    return ['*.js', '*.mjs', '*.cjs', '*.ts', '*.tsx', '*.py', '*.rs', '*.go'];
}

// ---------------------------------------------------------------------------
// Tool: workspace_symbol_search
// ---------------------------------------------------------------------------

/**
 * Tool: workspace_symbol_search — busca símbolos no workspace via ripgrep. Equivalente funcional ao "Go to Symbol in
 * Workspace" do VS Code.
 */
export const workspaceSymbolSearchTool = buildTool({
    name: 'workspace_symbol_search',
    description:
        'Busca símbolos (funções, classes, exports, variáveis, tipos) no workspace usando ripgrep. ' +
        'Equivalente ao "Go to Symbol in Workspace" do VS Code — retorna arquivo, linha e trecho da declaração. ' +
        'Use para localizar onde um símbolo é definido sem precisar saber em qual arquivo está.',
    parameters: z.object({
        name: z
            .string()
            .min(1)
            .max(200)
            .describe('Nome ou prefixo/substring do símbolo a buscar (ex: "validatePath", "MyClass")'),
        kind: z
            .enum(['function', 'class', 'variable', 'export', 'type', 'all'])
            .optional()
            .default('all')
            .describe(
                'Tipo de símbolo: function, class, variable, export, type ou all (qualquer declaração). Default: all',
            ),
        path: z
            .string()
            .optional()
            .default('.')
            .describe('Diretório onde buscar (relativo ao workspace). Default: raiz do workspace'),
        includePattern: z
            .string()
            .optional()
            .describe('Glob de arquivos a incluir (ex: "*.ts", "src/**/*.js"). Sobrescreve padrão automático por kind'),
        caseSensitive: z.boolean().optional().default(false).describe('Busca sensível a maiúsculas. Default: false'),
        maxResults: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .default(30)
            .describe('Número máximo de declarações a retornar (1-200). Default: 30'),
    }),
    handler: async ({ name: symbolName, kind, path: searchPath, includePattern, caseSensitive, maxResults }) => {
        // Validação de path
        const { ok, reason, resolved } = await validatePath(searchPath ?? '.', { mode: 'read' });
        if (!ok) return { success: false, error: reason };

        const resolvedKind = /** @type {SymbolKind} */ (kind ?? 'all');
        const pattern = buildSymbolPattern(symbolName, resolvedKind);

        log('INFO', `[copilot/workspace_symbol_search] symbol="${symbolName}" kind=${resolvedKind} in ${resolved}`);

        // Globs de arquivo — customizado ou gerado automaticamente por kind
        const globs = includePattern ? [includePattern] : kindToGlobs(resolvedKind);

        const rgArgs = [
            '--color=never',
            '--no-heading',
            '--line-number',
            '--with-filename',
            '-e',
            pattern,
            ...(caseSensitive ? [] : ['--ignore-case']),
            `--max-count=${maxResults ?? 30}`,
            ...globs.flatMap((g) => ['--glob', g]),
            '--glob=!node_modules',
            '--glob=!.git',
            '--glob=!dist',
            '--glob=!coverage',
            '--glob=!*.min.js',
            resolved,
        ];

        try {
            if (!(await isRgAvailable())) {
                return {
                    success: false,
                    error: 'ripgrep (rg) não está disponível neste ambiente. workspace_symbol_search requer rg.',
                };
            }

            const { stdout } = await execFileAsync('rg', rgArgs, {
                cwd: WORKSPACE_ROOT,
                timeout: RG_TIMEOUT_MS,
                maxBuffer: MAX_SEARCH_OUTPUT * 4,
            });

            const output = stdout.slice(0, MAX_SEARCH_OUTPUT);
            const lines = output.split('\n').filter(Boolean);

            return {
                success: true,
                symbol: symbolName,
                kind: resolvedKind,
                searchPath: resolved,
                matchCount: lines.length,
                output,
                truncated: stdout.length >= MAX_SEARCH_OUTPUT,
            };
        } catch (err) {
            const ex = toExecError(err);
            // exit code 1 + sem stderr = "nenhum resultado encontrado" — comportamento normal do rg
            if ((ex.code === 1 || ex.status === 1) && !ex.stderr) {
                return {
                    success: true,
                    symbol: symbolName,
                    kind: resolvedKind,
                    searchPath: resolved,
                    matchCount: 0,
                    output: '',
                    message: `Nenhuma declaração de "${symbolName}" (${resolvedKind}) encontrada em ${resolved}`,
                };
            }
            return { success: false, error: toError(err).message };
        }
    },
});

export const symbolSearchTools = [workspaceSymbolSearchTool];
