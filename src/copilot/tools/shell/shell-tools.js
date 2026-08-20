// @ts-check
import { defaultAuditLog } from '#copilot/audit';
import { getShellTimeoutPolicy } from '#copilot/config';
import { evaluateIoPathPolicyAsync } from '#copilot/core';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool } from '../infra/tool-factory.js';
import { ADVISORY_TIMEOUT_MS, runPipeline, runProcess, splitPipelineSegments, tokenizeShell } from './executor.js';
/**
 * src/copilot/tools/shell/shell-tools.js
 *
 * Custom Tools de execução de comandos shell para o agente LLM-B. Permite executar comandos, scripts npm e arquivos
 * Node.js — com restrições de segurança embutidas.
 *
 * Restrições:
 *
 * - Em `selective`, a sessão SDK pode pedir aprovação explícita. Em `approve_all`/`audit_only`, o bootstrap aplica
 *   `skipPermission=true` às tools entregues ao SDK para evitar prompts/janelas redundantes, mantendo auditoria.
 * - Cwd restrito a /workspaces/ (sem saída para /etc, /usr, /root, etc.)
 * - Blocklist de comandos perigosos (rm -rf, dd, mkfs, etc.)
 * - Timeouts e volume de output são informativos; não bloqueiam a operação da LLM-B
 * - Nunca executar como root (verificação em runtime)
 * - Variáveis de ambiente sensíveis removidas do sub-processo
 *
 * @module copilot/tools/shell/shell-tools
 * @see EventBus
 */

import * as path from 'node:path';
import {
    ALLOWED_EXECUTABLES,
    ALLOWED_NPM_SCRIPTS,
    WORKSPACE_ROOT,
    checkCommandBlocklist,
    hasShellMetaOutsideQuotes,
    validateCwd,
} from './sandbox.js';

/**
 * @param {string[]} tokens
 * @returns {boolean}
 */
function hasSubshellLikeToken(tokens) {
    return tokens.some((token) => token.includes('$(') || token.includes('`'));
}

/**
 * Resolve o timeout de execução considerando policy runtime e override por chamada.
 *
 * @param {number | undefined} timeoutSeconds
 * @param {boolean | undefined} enforceTimeout
 * @param {number} fallbackSeconds
 * @returns {{ advisoryTimeoutMs: number; timeoutMs: number | null; timeoutEnforced: boolean }}
 */
function resolveTimeoutConfig(timeoutSeconds, enforceTimeout, fallbackSeconds) {
    const policy = getShellTimeoutPolicy();
    const effectiveSeconds =
        typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
            ? Math.floor(timeoutSeconds)
            : fallbackSeconds > 0
              ? fallbackSeconds
              : policy.defaultSeconds;
    const timeoutEnforced = typeof enforceTimeout === 'boolean' ? enforceTimeout : policy.enforced;
    const advisoryTimeoutMs = effectiveSeconds * 1000;
    return {
        advisoryTimeoutMs,
        timeoutMs: timeoutEnforced ? advisoryTimeoutMs : null,
        timeoutEnforced,
    };
}

/**
 * Resolve caminho real usando a mesma policy canônica aplicada pelas demais capabilities do workspace.
 *
 * @param {string} resolved
 * @returns {Promise<{ ok: true; resolved: string } | { ok: false; reason: string }>}
 */
async function resolveWorkspaceRealPathSafe(resolved) {
    const policy = await evaluateIoPathPolicyAsync(resolved, { workspaceRoot: WORKSPACE_ROOT, mode: 'read' });
    return policy.ok
        ? { ok: true, resolved: policy.realPath }
        : { ok: false, reason: `Acesso negado: ${policy.reason} (${resolved})` };
}

/**
 * Cast auxiliar que resolve inferência de tipo do SDK `defineTool<T>`.
 *
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @returns {import('#copilot/sdk/types').ZodSchema<any>}
 */
const sdkParam = (schema) =>
    /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (/** @type {unknown} */ (schema));

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: exec_command
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool: exec_command — executa um comando shell arbitrário (sandboxado).
 */
const execCommandTool = buildTool({
    name: 'exec_command',
    description:
        'Executa um comando shell no workspace. O comando é executado via /bin/sh com sandbox de segurança: ' +
        'cwd restrito ao workspace e blocklist de comandos perigosos. Timeout/output são informativos e não bloqueiam. ' +
        'Use para diagnósticos, verificações de estado, e comandos de desenvolvimento. ' +
        'Exemplos: "ls -la src/", "node --version", "git status", "cat config.json".',
    parameters: sdkParam(
        z.object({
            command: z.string().min(1)['describe']('Comando shell a executar (ex: "git status", "ls src/")'),
            cwd: z
                .string()
                .optional()
                ['describe'](
                    'Diretório de trabalho (relativo ao workspace ou absoluto dentro de /workspaces/). Default: raiz do workspace.',
                ),
            timeoutSeconds: z
                .number()
                .int()
                .min(1)
                .optional()
                ['describe']('Timeout informativo em segundos. Default histórico: 30.'),
            enforceTimeout: z
                .boolean()
                .optional()
                ['describe']('Se true, aplica timeout hard nesta execução. Se omitido, usa política runtime.'),
        }),
    ),
    handler: async (
        /** @type {{ command: string; cwd?: string; timeoutSeconds?: number; enforceTimeout?: boolean }} */ {
            command,
            cwd,
            timeoutSeconds,
            enforceTimeout,
        },
    ) => {
        const blockCheck = checkCommandBlocklist(command);
        if (!blockCheck.ok) {
            log('WARN', `[ShellTools] exec_command bloqueado: ${blockCheck.reason}`);
            return { success: false, error: blockCheck.reason ?? 'Comando bloqueado' };
        }

        const cwdCheck = await validateCwd(cwd);
        if (!cwdCheck.ok) {
            log('WARN', `[ShellTools] exec_command cwd inválido: ${cwdCheck.reason}`);
            return { success: false, error: cwdCheck.reason ?? 'CWD inválido' };
        }

        const timeoutConfig = resolveTimeoutConfig(timeoutSeconds, enforceTimeout, 30);
        const advisoryTimeoutMs = timeoutConfig.advisoryTimeoutMs;
        log(
            'INFO',
            `[ShellTools] exec_command: ${command} (cwd=${cwdCheck.resolved}, advisoryTimeout=${advisoryTimeoutMs}ms, enforced=${timeoutConfig.timeoutEnforced})`,
        );

        // UPG-01: detectar pipeline simples (cmd1 | cmd2) e executar via spawn explícito sem shell.
        // Apenas pipes simples (sem subshell, sem redireção, sem ;/&) são permitidos.
        // Cada segmento é validado individualmente pela blocklist antes de executar.
        const pipeSegments = splitPipelineSegments(command);
        if (pipeSegments.length > 1) {
            // Validar cada segmento individualmente
            for (const seg of pipeSegments) {
                const segCheck = checkCommandBlocklist(seg.trim());
                if (!segCheck.ok) {
                    log('WARN', `[ShellTools] exec_command pipe bloqueado (segmento: "${seg}"): ${segCheck.reason}`);
                    return { success: false, error: segCheck.reason ?? 'Segmento bloqueado na pipeline' };
                }
                if (hasShellMetaOutsideQuotes(seg)) {
                    return { success: false, error: `Constructs shell complexos no segmento: "${seg}"` };
                }
            }
            for (const seg of pipeSegments) {
                const parts = tokenizeShell(seg.trim());
                if (hasSubshellLikeToken(parts)) {
                    return {
                        success: false,
                        error: `Sintaxe de substituição de comando detectada no segmento "${seg}".`,
                    };
                }
            }

            const stages = pipeSegments.map((/** @type {string} */ seg) => {
                const parts = tokenizeShell(seg.trim());
                const [file, ...args] = parts;
                return { file: file ?? '', args };
            });
            const result = await runPipeline(stages, { cwd: cwdCheck.resolved, timeoutMs: timeoutConfig.timeoutMs });
            return {
                success: result.exitCode === 0,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                durationMs: result.durationMs,
                advisoryTimeoutMs,
                timeoutEnforced: timeoutConfig.timeoutEnforced,
                advisoryPipelineStages: pipeSegments.length,
            };
        }

        // BUG-07/SEC-01 (fix): usar tokenizador contextual em vez de regex simples para
        // detectar metacaracteres shell fora de aspas — evita falsos positivos em argumentos
        // legítimos como caminhos com $ ou aspas em argumentos de git log.
        if (hasShellMetaOutsideQuotes(command)) {
            return {
                success: false,
                error: 'Constructs shell complexos (|, ;, &, <, >, subshell $()) não são permitidos.',
            };
        }
        // BUG-H01 (fix): tokenizar respeitando aspas simples e duplas, em vez de split(/\s+/)
        const parts = tokenizeShell(command.trim());
        if (hasSubshellLikeToken(parts)) {
            return {
                success: false,
                error: 'Sintaxe de substituição de comando ($(...) ou crases) não é suportada por política de shell.',
            };
        }
        const [executable, ...execArgs] = parts;
        if (!executable) {
            return { success: false, error: 'Comando vazio.' };
        }

        // F15.1: verificar allowlist de executáveis (quando COPILOT_ALLOWED_EXECUTABLES definido)
        if (ALLOWED_EXECUTABLES && !ALLOWED_EXECUTABLES.has(executable.toLowerCase())) {
            log(
                'WARN',
                `[ShellTools] exec_command bloqueado por allowlist: "${executable}" não está em COPILOT_ALLOWED_EXECUTABLES`,
            );
            return {
                success: false,
                error: `Executável "${executable}" não está na lista de permitidos (COPILOT_ALLOWED_EXECUTABLES).`,
            };
        }

        const _auditId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        defaultAuditLog.recordToolStart({
            toolCallId: _auditId,
            toolName: 'shell.exec_command',
            args: { command: executable, cwd: cwdCheck.resolved },
        });
        const result = await runProcess(executable, execArgs, {
            cwd: cwdCheck.resolved,
            timeoutMs: timeoutConfig.timeoutMs,
        });

        // F14.5: audit JSONL para rastreabilidade de shell execution
        defaultAuditLog.recordToolComplete({
            toolCallId: _auditId,
            success: result.exitCode === 0,
            resultContent: `exit ${result.exitCode}`,
        });

        return {
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
            advisoryTimeoutMs,
            timeoutEnforced: timeoutConfig.timeoutEnforced,
            advisoryHistoricalTimeoutMs: ADVISORY_TIMEOUT_MS,
        };
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: run_npm_script
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool: run_npm_script — executa um script npm definido em package.json.
 */
const runNpmScriptTool = buildTool({
    name: 'run_npm_script',
    description:
        'Executa um script npm (npm run <script>) no workspace. ' +
        'Scripts permitidos: lint, lint:fix, format, format:check, test:unit, test:fast, test:integration, ' +
        'test:all, typecheck:node, typecheck:full, audit:quick, analyze:deps, diagnose, health:core, health:full, ' +
        'queue:status, queue:flow, queue:clean. ' +
        'Use para verificar qualidade do código, rodar testes, e diagnósticos sem risco de efeitos colaterais.',
    parameters: sdkParam(
        z.object({
            script: z
                .string()
                .min(1)
                ['describe']('Nome do script npm a executar (ex: "lint", "test:unit", "typecheck:node")'),
            timeoutSeconds: z
                .number()
                .int()
                .min(1)
                .optional()
                ['describe']('Timeout informativo em segundos. Default histórico: 60.'),
            enforceTimeout: z
                .boolean()
                .optional()
                ['describe']('Se true, aplica timeout hard nesta execução. Se omitido, usa política runtime.'),
        }),
    ),
    handler: async (
        /** @type {{ script: string; timeoutSeconds?: number; enforceTimeout?: boolean }} */ {
            script,
            timeoutSeconds,
            enforceTimeout,
        },
    ) => {
        if (!ALLOWED_NPM_SCRIPTS.has(script)) {
            const allowed = [...ALLOWED_NPM_SCRIPTS].join(', ');
            log('WARN', `[ShellTools] run_npm_script bloqueado: script "${script}" não está na whitelist`);
            return {
                success: false,
                error: `Script "${script}" não é permitido. Scripts disponíveis: ${allowed}`,
            };
        }

        const timeoutConfig = resolveTimeoutConfig(timeoutSeconds, enforceTimeout, 60);
        const advisoryTimeoutMs = timeoutConfig.advisoryTimeoutMs;
        log(
            'INFO',
            `[ShellTools] run_npm_script: npm run ${script} (advisoryTimeout=${advisoryTimeoutMs}ms, enforced=${timeoutConfig.timeoutEnforced})`,
        );

        const _npmAuditId = `npm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        defaultAuditLog.recordToolStart({
            toolCallId: _npmAuditId,
            toolName: 'shell.run_npm_script',
            args: { script },
        });
        const result = await runProcess('npm', ['run', script], {
            cwd: WORKSPACE_ROOT,
            timeoutMs: timeoutConfig.timeoutMs,
        });

        // F14.5: audit JSONL para rastreabilidade
        defaultAuditLog.recordToolComplete({
            toolCallId: _npmAuditId,
            success: result.exitCode === 0,
            resultContent: `exit ${result.exitCode}`,
        });

        return {
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
            script,
            advisoryTimeoutMs,
            timeoutEnforced: timeoutConfig.timeoutEnforced,
            advisoryHistoricalTimeoutMs: ADVISORY_TIMEOUT_MS,
        };
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: run_node_file
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool: run_node_file — executa um arquivo JavaScript com Node.js.
 */
const runNodeFileTool = buildTool({
    name: 'run_node_file',
    description:
        'Executa um arquivo JavaScript com Node.js no workspace. ' +
        'O arquivo deve estar dentro do workspace (/workspaces/). ' +
        'Use para rodar scripts utilitários, diagnósticos customizados, ou arquivos de teste isolados.',
    parameters: sdkParam(
        z.object({
            filePath: z
                .string()
                .min(1)
                ['describe'](
                    'Caminho do arquivo .js ou .mjs (relativo ao workspace ou absoluto dentro de /workspaces/)',
                ),
            args: z.array(z.string()).optional()['describe']('Argumentos adicionais passados ao script (process.argv)'),
            timeoutSeconds: z
                .number()
                .int()
                .min(1)
                .optional()
                ['describe']('Timeout informativo em segundos. Default histórico: 30.'),
            enforceTimeout: z
                .boolean()
                .optional()
                ['describe']('Se true, aplica timeout hard nesta execução. Se omitido, usa política runtime.'),
        }),
    ),
    handler: async (
        /** @type {{ filePath: string; args?: string[]; timeoutSeconds?: number; enforceTimeout?: boolean }} */ {
            filePath,
            args = [],
            timeoutSeconds,
            enforceTimeout,
        },
    ) => {
        // Valida extensão
        if (!/\.(js|mjs|cjs)$/.test(filePath)) {
            return { success: false, error: 'Apenas arquivos .js, .mjs e .cjs são permitidos.' };
        }

        // Valida caminho — SEC-TOOLS-001: resolve symlinks para bloquear traversal via link simbólico
        const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);
        const pathCheck = await resolveWorkspaceRealPathSafe(resolved);
        if (!pathCheck.ok) {
            return { success: false, error: pathCheck.reason };
        }

        const safeResolved = pathCheck.resolved;

        const timeoutConfig = resolveTimeoutConfig(timeoutSeconds, enforceTimeout, 30);
        const advisoryTimeoutMs = timeoutConfig.advisoryTimeoutMs;
        log(
            'INFO',
            `[ShellTools] run_node_file: node ${safeResolved} (advisoryTimeout=${advisoryTimeoutMs}ms, enforced=${timeoutConfig.timeoutEnforced})`,
        );

        const _nodeAuditId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        defaultAuditLog.recordToolStart({
            toolCallId: _nodeAuditId,
            toolName: 'shell.run_node_file',
            args: { filePath: safeResolved, args },
        });
        const result = await runProcess('node', [safeResolved, ...args], {
            cwd: WORKSPACE_ROOT,
            timeoutMs: timeoutConfig.timeoutMs,
        });

        // F14.5: audit JSONL para rastreabilidade
        defaultAuditLog.recordToolComplete({
            toolCallId: _nodeAuditId,
            success: result.exitCode === 0,
            resultContent: `exit ${result.exitCode}`,
        });

        return {
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
            filePath: safeResolved,
            advisoryTimeoutMs,
            timeoutEnforced: timeoutConfig.timeoutEnforced,
            advisoryHistoricalTimeoutMs: ADVISORY_TIMEOUT_MS,
        };
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Todas as shell tools (3 tools de execução).
 *
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const shellTools = [execCommandTool, runNpmScriptTool, runNodeFileTool];

export { execCommandTool, runNodeFileTool, runNpmScriptTool };
