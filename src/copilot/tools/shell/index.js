// @ts-check
/**
 * src/copilot/tools/shell/index.js
 *
 * Custom Tools de execução de comandos shell para o agente LLM-B. Permite executar comandos, scripts npm e arquivos
 * Node.js — com restrições de segurança embutidas.
 *
 * Restrições:
 *
 * - skipPermission: false em todas as tools (requerem aprovação explícita)
 * - Cwd restrito a /workspaces/ (sem saída para /etc, /usr, /root, etc.)
 * - Blocklist de comandos perigosos (rm -rf, dd, mkfs, etc.)
 * - Timeouts e volume de output são informativos; não bloqueiam a operação da LLM-B
 * - Nunca executar como root (verificação em runtime)
 * - Variáveis de ambiente sensíveis removidas do sub-processo
 *
 * @module copilot/tools/shell-tools
 * @see EventBus
 */

import { defaultAuditLog } from '#copilot/audit';
import { createTool } from '#copilot/sdk';
import { realpathSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { log } from '../logger.js';
import { recordToolCall } from '../metrics-proxy.js';
import { ADVISORY_TIMEOUT_MS, runPipeline, runProcess, tokenizeShell } from './executor.js';
import {
    ALLOWED_EXECUTABLES,
    ALLOWED_NPM_SCRIPTS,
    WORKSPACE_ROOT,
    checkCommandBlocklist,
    hasShellMetaOutsideQuotes,
    validateCwd,
} from './sandbox.js';

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
const execCommandTool = createTool({
    name: 'exec_command',
    description:
        'Executa um comando shell no workspace. O comando é executado via /bin/sh com sandbox de segurança: ' +
        'cwd restrito ao workspace e blocklist de comandos perigosos. Timeout/output são informativos e não bloqueiam. ' +
        'Use para diagnósticos, verificações de estado, e comandos de desenvolvimento. ' +
        'Exemplos: "ls -la src/", "node --version", "git status", "cat config.json".',
    parameters: sdkParam(
        z.object({
            command: z.string().min(1).describe('Comando shell a executar (ex: "git status", "ls src/")'),
            cwd: z
                .string()
                .optional()
                .describe(
                    'Diretório de trabalho (relativo ao workspace ou absoluto dentro de /workspaces/). Default: raiz do workspace.',
                ),
            timeoutSeconds: z
                .number()
                .int()
                .min(1)
                .optional()
                .describe('Timeout informativo em segundos. Default histórico: 30.'),
        }),
    ),
    handler: async (
        /** @type {{ command: string; cwd?: string; timeoutSeconds?: number }} */ { command, cwd, timeoutSeconds = 30 },
    ) => {
        const blockCheck = checkCommandBlocklist(command);
        if (!blockCheck.ok) {
            log('WARN', `[ShellTools] exec_command bloqueado: ${blockCheck.reason}`);
            return { success: false, error: blockCheck.reason ?? 'Comando bloqueado' };
        }

        const cwdCheck = validateCwd(cwd);
        if (!cwdCheck.ok) {
            log('WARN', `[ShellTools] exec_command cwd inválido: ${cwdCheck.reason}`);
            return { success: false, error: cwdCheck.reason ?? 'CWD inválido' };
        }

        const advisoryTimeoutMs = timeoutSeconds * 1000;
        log(
            'INFO',
            `[ShellTools] exec_command: ${command} (cwd=${cwdCheck.resolved}, advisoryTimeout=${advisoryTimeoutMs}ms)`,
        );

        // UPG-01: detectar pipeline simples (cmd1 | cmd2) e executar via spawn explícito sem shell.
        // Apenas pipes simples (sem subshell, sem redireção, sem ;/&) são permitidos.
        // Cada segmento é validado individualmente pela blocklist antes de executar.
        const pipeSegments = command.split('|').map((/** @type {string} */ s) => s.trim());
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
            const stages = pipeSegments.map((/** @type {string} */ seg) => {
                const parts = tokenizeShell(seg.trim());
                const [file, ...args] = parts;
                return { file: file ?? '', args };
            });
            const result = await runPipeline(stages, { cwd: cwdCheck.resolved, timeoutMs: null });
            return {
                success: result.exitCode === 0,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                durationMs: result.durationMs,
                advisoryTimeoutMs,
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

        const _auditId = `exec-${Date.now()}`;
        defaultAuditLog.recordToolStart({
            toolCallId: _auditId,
            toolName: 'shell.exec_command',
            args: { command: executable, cwd: cwdCheck.resolved },
        });
        const result = await runProcess(executable, execArgs, {
            cwd: cwdCheck.resolved,
            timeoutMs: null,
        });

        // F6.4: registrar execução no audit de tools para observabilidade
        recordToolCall('shell.exec_command', result.durationMs, result.exitCode === 0);
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
const runNpmScriptTool = createTool({
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
                .describe('Nome do script npm a executar (ex: "lint", "test:unit", "typecheck:node")'),
            timeoutSeconds: z
                .number()
                .int()
                .min(1)
                .optional()
                .describe('Timeout informativo em segundos. Default histórico: 60.'),
        }),
    ),
    handler: async (/** @type {{ script: string; timeoutSeconds?: number }} */ { script, timeoutSeconds = 60 }) => {
        if (!ALLOWED_NPM_SCRIPTS.has(script)) {
            const allowed = [...ALLOWED_NPM_SCRIPTS].join(', ');
            log('WARN', `[ShellTools] run_npm_script bloqueado: script "${script}" não está na whitelist`);
            return {
                success: false,
                error: `Script "${script}" não é permitido. Scripts disponíveis: ${allowed}`,
            };
        }

        const advisoryTimeoutMs = timeoutSeconds * 1000;
        log('INFO', `[ShellTools] run_npm_script: npm run ${script} (advisoryTimeout=${advisoryTimeoutMs}ms)`);

        const _npmAuditId = `npm-${Date.now()}`;
        defaultAuditLog.recordToolStart({
            toolCallId: _npmAuditId,
            toolName: 'shell.run_npm_script',
            args: { script },
        });
        const result = await runProcess('npm', ['run', script], {
            cwd: WORKSPACE_ROOT,
            timeoutMs: null,
        });

        // F6.4: audit log de execução npm
        recordToolCall('shell.run_npm_script', result.durationMs, result.exitCode === 0);
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
const runNodeFileTool = createTool({
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
                .describe('Caminho do arquivo .js ou .mjs (relativo ao workspace ou absoluto dentro de /workspaces/)'),
            args: z.array(z.string()).optional().describe('Argumentos adicionais passados ao script (process.argv)'),
            timeoutSeconds: z
                .number()
                .int()
                .min(1)
                .optional()
                .describe('Timeout informativo em segundos. Default histórico: 30.'),
        }),
    ),
    handler: async (
        /** @type {{ filePath: string; args?: string[]; timeoutSeconds?: number }} */ {
            filePath,
            args = [],
            timeoutSeconds = 30,
        },
    ) => {
        // Valida extensão
        if (!/\.(js|mjs|cjs)$/.test(filePath)) {
            return { success: false, error: 'Apenas arquivos .js, .mjs e .cjs são permitidos.' };
        }

        // Valida caminho — SEC-TOOLS-001: resolve symlinks para bloquear traversal via link simbólico
        const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);
        let realResolved;
        try {
            realResolved = realpathSync(resolved);
        } catch {
            realResolved = resolved; // arquivo não existe ainda
        }
        const rootReal = (() => {
            try {
                return realpathSync(WORKSPACE_ROOT);
            } catch {
                return WORKSPACE_ROOT;
            }
        })();
        if (!realResolved.startsWith(rootReal + path.sep) && realResolved !== rootReal) {
            return { success: false, error: `Acesso negado: arquivo fora do workspace (${resolved})` };
        }

        const advisoryTimeoutMs = timeoutSeconds * 1000;
        log('INFO', `[ShellTools] run_node_file: node ${resolved} (advisoryTimeout=${advisoryTimeoutMs}ms)`);

        const _nodeAuditId = `node-${Date.now()}`;
        defaultAuditLog.recordToolStart({
            toolCallId: _nodeAuditId,
            toolName: 'shell.run_node_file',
            args: { filePath: resolved, args },
        });
        const result = await runProcess('node', [resolved, ...args], {
            cwd: WORKSPACE_ROOT,
            timeoutMs: null,
        });

        // F6.4: audit log de execução node
        recordToolCall('shell.run_node_file', result.durationMs, result.exitCode === 0);
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
            filePath: resolved,
            advisoryTimeoutMs,
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
