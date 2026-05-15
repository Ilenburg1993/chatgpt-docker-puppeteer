// @ts-check
import { COPILOT_PACKAGE_ROOT, WORKSPACE_ROOT } from '#copilot/boot';
import { toExecError } from '#copilot/core';
import { resolveProcessExecutionBudget } from '#copilot/infra/public/policy';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';
/**
 * src/copilot/tools/code/code-tools.js
 *
 * Custom Tools para verificação de qualidade de código. Permite ao agente executar lint, typecheck e testes sem sair do
 * loop de sessão.
 *
 * @module copilot/tools/code/code-tools
 * @see EventBus
 * @see module:copilot/tools/tool-factory
 */

const ROOT = WORKSPACE_ROOT;
// BUG-MED-08 (fix): caminho absoluto para ESLint — evita falhas em ambientes
// onde o cwd não coincide com o ROOT do projeto
const _resolvedEslint = resolve(COPILOT_PACKAGE_ROOT, 'node_modules', '.bin', 'eslint');
// BUG-P2-18: fallback para `which eslint` se o caminho resolvido não existir
const ESLINT_BIN = existsSync(_resolvedEslint)
    ? _resolvedEslint
    : (() => {
          try {
              return execFileSync('which', ['eslint'], { encoding: 'utf8' }).trim();
          } catch {
              return _resolvedEslint;
          }
      })();
const execFileAsync = promisify(execFile);

/**
 * Executa um comando de shell via execFile de forma assíncrona (não bloqueia event loop).
 *
 * @param {string[]} argv — argv[0] é o executável, resto são args
 * @param {number} [timeoutMs]
 * @returns {Promise<{ stdout: string; exitCode: number; error?: string }>}
 */
async function safeExec(argv, timeoutMs = 60_000) {
    const [cmd, ...args] = argv;
    const budget = resolveProcessExecutionBudget({ timeoutMs });
    log('DEBUG', `[copilot/code-tools] timeout=${budget.timeoutMs}ms argv=${argv.join(' ')}`);
    try {
        const { stdout } = await execFileAsync(cmd ?? 'echo', args, {
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
            exitCode: typeof ex.code === 'number' ? ex.code : (ex.status ?? 1),
            error: ex.stderr ?? ex.message ?? '',
        };
    }
}

/**
 * Tool: lint_check — executa ESLint no projeto.
 */
const lintCheckTool = buildTool({
    name: 'lint_check',
    description:
        'Executa ESLint com cache no projeto para detectar erros de estilo/qualidade. Retorna erros encontrados.',
    parameters: z.object({
        fix: z.boolean().optional().default(false).describe('Se true, aplica correções automáticas (--fix)'),
        path: z.string().optional().describe('Caminho específico para lintar (ex: src/copilot)'),
    }),
    handler: async (/** @type {{ fix?: boolean; path?: string }} */ { fix, path: filePath }) => {
        const target = filePath ?? '.';
        log('INFO', `[copilot/lint_check] Executando lint em '${target}'${fix ? ' com --fix' : ''}`);
        const eslintArgs = [
            ESLINT_BIN,
            '--max-warnings=0',
            '--cache',
            '--cache-location',
            '/home/node/.cache/eslint/.eslintcache',
        ];
        if (fix) eslintArgs.push('--fix');
        eslintArgs.push(target);
        const result = await safeExec(eslintArgs, 90_000);
        return {
            success: result.exitCode === 0,
            output: result.stdout,
            error: result.error,
        };
    },
});

/**
 * Tool: run_tests — executa a suíte de testes rápidos.
 */
const runTestsTool = buildTool({
    name: 'run_tests',
    description: 'Executa as suítes Vitest canônicas do Copilot com cache. Retorna resultado.',
    parameters: z.object({
        suite: z
            .enum(['fast', 'unit', 'integration', 'all'])
            .optional()
            .default('fast')
            .describe('Suíte de testes a executar'),
    }),
    handler: async (/** @type {{ suite?: string }} */ { suite }) => {
        /** @type {Record<string, string>} */
        const scriptMap = {
            integration: 'test:copilot:integration',
            all: 'test:copilot',
            unit: 'test:copilot:unit',
            fast: 'test:copilot:unit',
        };
        const script = scriptMap[suite ?? 'fast'] ?? 'test:copilot:unit';
        log('INFO', `[copilot/run_tests] Executando npm run ${script}`);
        const npmResult = await safeExec(['npm', 'run', script], 120_000);
        return {
            success: npmResult.exitCode === 0,
            output: npmResult.stdout,
            error: npmResult.error,
        };
    },
});

/**
 * Tool: typecheck — executa verificação de tipos TypeScript.
 */
const typecheckTool = buildTool({
    name: 'typecheck',
    description: 'Executa verificação TypeScript strict do escopo src/copilot. Retorna erros de tipo encontrados.',
    parameters: z.object({}),
    handler: async () => {
        log('INFO', '[copilot/typecheck] Executando typecheck:strict:src.copilot');
        const result = await safeExec(['npm', 'run', 'typecheck:strict:src.copilot'], 120_000);
        return {
            success: result.exitCode === 0,
            output: result.stdout,
            error: result.error,
        };
    },
});

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const codeTools = [
    withSkipPermission(lintCheckTool),
    withSkipPermission(runTestsTool),
    withSkipPermission(typecheckTool),
];
