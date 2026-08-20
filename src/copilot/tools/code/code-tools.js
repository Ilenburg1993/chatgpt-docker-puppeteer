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
import { buildToolFailureResult, buildToolSuccessResult, normalizeToolFailure } from '../infra/tool-operation-result.js';
import * as qualityGateOutput from './quality-gate-output.js';
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
 * @typedef {{ success: boolean; output: string; error?: string; exitCode?: number; command?: string; dryRun?: boolean; durationMs?: number; blockedReason?: string; suggestedNextAction?: string }} CodeToolResult
 *
 * @typedef {'lint' | 'typecheck' | 'unit' | 'integration' | 'arch' | 'mcp-fast' | 'mcp-full' | 'index-status'} QualityGateName
 *
 * @typedef {{ script: string; timeoutMs: number; description: string; artifacts?: string[] }} QualityGatePlan
 */

/** @type {Record<QualityGateName, QualityGatePlan>} */
const QUALITY_GATE_PLANS = Object.freeze({
    lint: {
        script: 'lint:copilot',
        timeoutMs: 120_000,
        description: 'ESLint canônico de src/copilot e tests/unit/copilot sem --fix.',
    },
    typecheck: {
        script: 'typecheck:strict:src.copilot',
        timeoutMs: 180_000,
        description: 'TypeScript strict do escopo src/copilot.',
    },
    unit: {
        script: 'test:copilot:unit',
        timeoutMs: 600_000,
        description: 'Suíte unitária Copilot completa.',
        artifacts: ['artifacts/test-runs/copilot'],
    },
    integration: {
        script: 'test:copilot:integration',
        timeoutMs: 600_000,
        description: 'Suíte de integração Copilot.',
        artifacts: ['artifacts/test-runs/copilot'],
    },
    arch: {
        script: 'analyze:arch:global:strict',
        timeoutMs: 180_000,
        description: 'Contrato global de arquitetura Copilot em modo strict.',
    },
    'mcp-fast': {
        script: 'mcp:stateful:validate:fast',
        timeoutMs: 300_000,
        description: 'Validação MCP stateful rápida.',
    },
    'mcp-full': {
        script: 'mcp:stateful:validate:full',
        timeoutMs: 900_000,
        description: 'Validação MCP stateful completa.',
    },
    'index-status': {
        script: 'copilot:index:status',
        timeoutMs: 60_000,
        description: 'Status do índice de I/O Copilot.',
    },
});

/**
 * @param {string} target
 * @returns {string[]}
 */
function buildBaseEslintArgs(target) {
    return [
        ESLINT_BIN,
        '--max-warnings=0',
        '--cache',
        '--cache-location',
        '/home/node/.cache/eslint/.eslintcache',
        target,
    ];
}

/**
 * @param {string[]} argv
 * @returns {string}
 */
function formatCommand(argv) {
    return argv.map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ');
}

/**
 * Executa um comando de shell via execFile de forma assíncrona (não bloqueia event loop).
 *
 * @param {string[]} argv — argv[0] é o executável, resto são args
 * @param {number} [timeoutMs]
 * @returns {Promise<{ stdout: string; exitCode: number; durationMs: number; timedOut?: boolean; error?: string }>}
 */
async function safeExec(argv, timeoutMs = 60_000) {
    const [cmd, ...args] = argv;
    const startedAt = Date.now();
    const budget = resolveProcessExecutionBudget({ timeoutMs });
    log('DEBUG', `[copilot/code-tools] timeout=${budget.timeoutMs}ms argv=${argv.join(' ')}`);
    try {
        const { stdout } = await execFileAsync(cmd ?? 'echo', args, {
            cwd: ROOT,
            encoding: 'utf8',
            ...(budget.timeoutMs === null ? {} : { timeout: budget.timeoutMs }),
            maxBuffer: budget.maxBufferBytes,
        });
        return { stdout, exitCode: 0, durationMs: Date.now() - startedAt };
    } catch (e) {
        const ex = toExecError(e);
        const raw = e && typeof e === 'object' ? /** @type {Record<string, unknown>} */ (e) : {};
        const timedOut = raw['killed'] === true || /timeout|timed out/iu.test(ex.message);
        return {
            stdout: ex.stdout ?? '',
            exitCode: typeof ex.code === 'number' ? ex.code : (ex.status ?? 1),
            durationMs: Date.now() - startedAt,
            ...(timedOut ? { timedOut } : {}),
            error: ex.stderr ?? ex.message ?? '',
        };
    }
}

/**
 * Tool: lint_check — executa ESLint no projeto sem aplicar correções.
 */
const lintCheckTool = buildTool({
    name: 'lint_check',
    description:
        'Executa ESLint em modo somente leitura com cache no projeto para detectar erros de estilo/qualidade. Retorna erros encontrados sem aplicar correções.',
    parameters: z.object({
        path: z.string().optional()['describe']('Caminho específico para lintar (ex: src/copilot)'),
    }),
    handler: async (/** @type {{ fix?: boolean; path?: string }} */ { fix, path: filePath }) => {
        if (fix !== undefined) {
            return normalizeToolFailure(
                'lint_check é estritamente read-only e não aceita o parâmetro fix. Use lint_fix para correções com dryRun/aprovação.',
                {
                    category: 'validation',
                    blockedReason: 'mutating_parameter_on_readonly_tool',
                    suggestedNextAction:
                        'Chame lint_fix com dryRun=true para pré-visualizar correções ou dryRun=false após aprovação explícita.',
                },
            );
        }
        const target = filePath ?? '.';
        log('INFO', `[copilot/lint_check] Executando lint read-only em '${target}'`);
        const eslintArgs = buildBaseEslintArgs(target);
        const result = await safeExec(eslintArgs, 90_000);
        return buildCodeProcessResult('lint_check', result, { command: formatCommand(eslintArgs) });
    },
});

/**
 * Tool: lint_fix — executa ESLint em modo de correção explícito e mutável.
 */
const lintFixTool = buildTool({
    name: 'lint_fix',
    description:
        'Executa ESLint para pré-visualizar ou aplicar correções automáticas. Operação mutável quando dryRun=false.',
    parameters: z.object({
        path: z.string().optional()['describe']('Caminho específico para lintar/corrigir (ex: src/copilot)'),
        dryRun: z
            .boolean()
            .optional()
            .default(true)['describe']('Se true, usa --fix-dry-run e não escreve arquivos. Default: true.'),
    }),
    handler: async (/** @type {{ dryRun?: boolean; path?: string }} */ { dryRun = true, path: filePath }) => {
        const target = filePath ?? '.';
        const eslintArgs = buildBaseEslintArgs(target);
        eslintArgs.splice(eslintArgs.length - 1, 0, dryRun ? '--fix-dry-run' : '--fix');
        log('INFO', `[copilot/lint_fix] Executando lint fix em '${target}' dryRun=${dryRun}`);
        const result = await safeExec(eslintArgs, 90_000);
        return buildCodeProcessResult('lint_fix', result, { command: formatCommand(eslintArgs), dryRun });
    },
});

/**
 * @param {string} toolName
 * @param {{ stdout: string; exitCode: number; durationMs: number; error?: string }} result
 * @param {Record<string, unknown>} [metadata]
 */
function buildCodeProcessResult(toolName, result, metadata = {}) {
    const payload = {
        output: result.stdout,
        error: result.error,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        ...metadata,
    };
    if (result.exitCode === 0) {
        return buildToolSuccessResult(payload, {
            terminalSummary: `${toolName} passou.`,
            durationMs: result.durationMs,
        });
    }
    return {
        ...buildToolFailureResult({
            error: result.error || `${toolName} falhou com exitCode=${result.exitCode}.`,
            category: 'process',
            retryable: false,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            terminalSummary: `${toolName} falhou com exitCode=${result.exitCode}.`,
        }),
        output: result.stdout,
        ...metadata,
    };
}

/**
 * @param {QualityGateName} gate
 * @param {string} scope
 * @param {QualityGatePlan} plan
 * @param {{ stdout: string; exitCode: number; durationMs: number; timedOut?: boolean; error?: string }} result
 */
function buildQualityGateResult(gate, scope, plan, result) {
    return qualityGateOutput.buildQualityGateResultEnvelope({
        gate,
        scope,
        script: plan.script,
        command: formatCommand(['npm', 'run', plan.script]),
        description: plan.description,
        ...(plan.artifacts ? { artifacts: plan.artifacts } : {}),
        stdout: result.stdout,
        ...(result.error ? { error: result.error } : {}),
        exitCode: result.exitCode,
        ...(result.timedOut ? { timedOut: result.timedOut } : {}),
        durationMs: result.durationMs,
    });
}

/**
 * Tool: quality_gate — executa quality gates allowlisted com saída JSON estável.
 */
const qualityGateTool = buildTool({
    name: 'quality_gate',
    description:
        'Executa um quality gate allowlisted do Copilot sem aceitar comandos arbitrários. Retorna JSON estável com ok, gate, script, duração, exitCode, checks e artifacts.',
    parameters: z.object({
        gate: z
            .enum(['lint', 'typecheck', 'unit', 'integration', 'arch', 'mcp-fast', 'mcp-full', 'index-status'])['describe']('Quality gate allowlisted a executar.'),
        scope: z
            .enum(['src/copilot', 'mcp', 'all'])
            .optional()
            .default('src/copilot')['describe']('Escopo lógico/informativo do gate. Não altera o comando allowlisted.'),
    }),
    handler: async (/** @type {{ gate?: QualityGateName; scope?: string }} */ { gate, scope = 'src/copilot' }) => {
        const plan = gate ? QUALITY_GATE_PLANS[gate] : undefined;
        if (!gate || !plan) {
            return {
                success: false,
                ok: false,
                gate: gate ?? null,
                scope,
                output: '',
                error: 'quality_gate recebeu gate não allowlisted.',
                blockedReason: 'quality_gate_not_allowlisted',
                suggestedNextAction: `Use um destes gates: ${Object.keys(QUALITY_GATE_PLANS).join(', ')}.`,
                checks: [],
                failingFiles: [],
                artifacts: [],
            };
        }
        log('INFO', `[copilot/quality_gate] Executando npm run ${plan.script} gate=${gate} scope=${scope}`);
        const result = await safeExec(['npm', 'run', plan.script], plan.timeoutMs);
        return buildQualityGateResult(gate, scope, plan, result);
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
            .default('fast')['describe']('Suíte de testes a executar'),
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
        return buildCodeProcessResult('run_tests', npmResult, { script });
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
        return buildCodeProcessResult('typecheck', result, { script: 'typecheck:strict:src.copilot' });
    },
});

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const codeReadTools = [
    withSkipPermission(lintCheckTool),
    withSkipPermission(qualityGateTool),
    withSkipPermission(runTestsTool),
    withSkipPermission(typecheckTool),
];

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const codeWriteTools = [lintFixTool];

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const codeTools = [...codeReadTools, ...codeWriteTools];
