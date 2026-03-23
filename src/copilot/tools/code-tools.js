// @ts-check
/**
 * src/copilot/tools/code-tools.js
 *
 * Custom Tools para verificação de qualidade de código. Permite ao agente executar lint, typecheck e testes sem sair do
 * loop de sessão.
 *
 * @module copilot/tools/code-tools
 */

import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import { execSync } from 'node:child_process';
import { z } from 'zod';

const ROOT = new URL('../../..', import.meta.url).pathname;

/**
 * Executa um comando com timeout e captura stdout+stderr.
 *
 * @param {string} cmd
 * @param {number} [timeoutMs]
 * @returns {{ stdout: string; exitCode: number; error?: string }}
 */
function safeExec(cmd, timeoutMs = 60000) {
    try {
        const stdout = execSync(cmd, {
            cwd: ROOT,
            encoding: 'utf8',
            timeout: timeoutMs,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { stdout: stdout.slice(0, 4000), exitCode: 0 };
    } catch (/** @type {any} */ e) {
        return {
            stdout: (e.stdout ?? '').slice(0, 2000),
            exitCode: e.status ?? 1,
            error: (e.stderr ?? e.message ?? '').slice(0, 2000),
        };
    }
}

/**
 * Tool: lint_check — executa ESLint no projeto.
 */
const lintCheckTool = defineTool('lint_check', {
    description: 'Executa ESLint no projeto para detectar erros de estilo/qualidade. Retorna erros encontrados.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (/** @type {unknown} */ (z.object({
        fix: z.boolean().optional().default(false).describe('Se true, aplica correções automáticas (--fix)'),
        path: z.string().optional().describe('Caminho específico para lintar (ex: src/copilot)'),
    }))),
    handler: async (/** @type {{ fix?: boolean; path?: string }} */ { fix, path: filePath }) => {
        const fixFlag = fix ? '--fix' : '';
        const target = filePath ?? '.';
        log('INFO', `[copilot/lint_check] Executando lint em '${target}'${fix ? ' com --fix' : ''}`);
        const result = safeExec(`npm run lint ${fixFlag} -- ${target} 2>&1 | head -100`, 90000);
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
const runTestsTool = defineTool('run_tests', {
    description: 'Executa os testes unitários rápidos (test:fast). Retorna resultado.',
    parameters: z.object({
        suite: z
            .enum(['fast', 'unit', 'integration', 'all'])
            .optional()
            .default('fast')
            .describe('Suíte de testes a executar'),
    }),
    handler: async (/** @type {{ suite?: string }} */ { suite }) => {
        const script = suite === 'integration' ? 'test:integration' : suite === 'all' ? 'test:all' : 'test:fast';
        log('INFO', `[copilot/run_tests] Executando npm run ${script}`);
        const result = safeExec(`npm run ${script} 2>&1 | tail -40`, 120000);
        return {
            success: result.exitCode === 0,
            output: result.stdout,
            error: result.error,
        };
    },
});

/**
 * Tool: typecheck — executa verificação de tipos TypeScript.
 */
const typecheckTool = defineTool('typecheck', {
    description: 'Executa verificação de tipos TypeScript (typecheck:node). Retorna erros de tipo encontrados.',
    parameters: z.object({}),
    handler: async () => {
        log('INFO', '[copilot/typecheck] Executando typecheck:node');
        const result = safeExec('npm run typecheck:node 2>&1 | head -80', 120000);
        return {
            success: result.exitCode === 0,
            output: result.stdout,
            error: result.error,
        };
    },
});

/**
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const codeTools = [lintCheckTool, runTestsTool, typecheckTool];
