// @ts-check
/**
 * src/copilot/tools/code-tools.js
 *
 * Custom Tools para verificação de qualidade de código. Permite ao agente executar lint, typecheck e testes sem sair do
 * loop de sessão.
 *
 * @module copilot/tools/code-tools
 * @see EventBus
 * @see module:copilot/tools/tool-factory
 */

import { log } from './logger.js';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { z } from 'zod';
import { buildTool, withSkipPermission } from './tool-factory.js';

const ROOT = new URL('../../..', import.meta.url).pathname;
// BUG-MED-08 (fix): caminho absoluto para ESLint — evita falhas em ambientes
// onde o cwd não coincide com o ROOT do projeto
const _resolvedEslint = new URL('../../../node_modules/.bin/eslint', import.meta.url).pathname;
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
    try {
        const { stdout } = await execFileAsync(cmd ?? 'echo', args, {
            cwd: ROOT,
            encoding: 'utf8',
            timeout: timeoutMs,
            maxBuffer: 4 * 1024 * 1024,
        });
        return { stdout: stdout.slice(0, 4000), exitCode: 0 };
    } catch (/** @type {any} */ e) {
        return {
            stdout: (e.stdout ?? '').slice(0, 2000),
            exitCode: typeof e.code === 'number' ? e.code : (e.status ?? 1),
            error: (e.stderr ?? e.message ?? '').slice(0, 2000),
        };
    }
}

/**
 * Tool: lint_check — executa ESLint no projeto.
 */
const lintCheckTool = buildTool({
    name: 'lint_check',
    description: 'Executa ESLint no projeto para detectar erros de estilo/qualidade. Retorna erros encontrados.',
    parameters: z.object({
        fix: z.boolean().optional().default(false).describe('Se true, aplica correções automáticas (--fix)'),
        path: z.string().optional().describe('Caminho específico para lintar (ex: src/copilot)'),
    }),
    handler: async (/** @type {{ fix?: boolean; path?: string }} */ { fix, path: filePath }) => {
        const target = filePath ?? '.';
        log('INFO', `[copilot/lint_check] Executando lint em '${target}'${fix ? ' com --fix' : ''}`);
        const eslintArgs = [ESLINT_BIN, '--max-warnings=0'];
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
    description: 'Executa os testes unitários rápidos (test:fast). Retorna resultado.',
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
            integration: 'test:integration',
            all: 'test:all',
            unit: 'test:fast',
            fast: 'test:fast',
        };
        const script = scriptMap[suite ?? 'fast'] ?? 'test:fast';
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
    description: 'Executa verificação de tipos TypeScript (typecheck:node). Retorna erros de tipo encontrados.',
    parameters: z.object({}),
    handler: async () => {
        log('INFO', '[copilot/typecheck] Executando typecheck:node');
        const result = await safeExec(['npm', 'run', 'typecheck:node'], 120_000);
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
