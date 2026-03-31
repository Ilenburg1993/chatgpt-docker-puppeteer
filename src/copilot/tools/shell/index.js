// @ts-check
/**
 * src/copilot/tools/shell-tools.js
 *
 * Custom Tools de execução de comandos shell para o agente LLM-B. Permite executar comandos, scripts npm e arquivos
 * Node.js — com restrições de segurança embutidas.
 *
 * Restrições:
 *
 * - skipPermission: false em todas as tools (requerem aprovação explícita)
 * - Cwd restrito a /workspaces/ (sem saída para /etc, /usr, /root, etc.)
 * - Blocklist de comandos perigosos (rm -rf, dd, mkfs, etc.)
 * - Timeout máximo configurável por chamada (default: 30s, máx: 120s)
 * - Output truncado a MAX_OUTPUT_BYTES para evitar overflow de contexto
 * - Nunca executar como root (verificação em runtime)
 * - Variáveis de ambiente sensíveis removidas do sub-processo
 *
 * @module copilot/tools/shell-tools
 */

import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import { execFile, spawn } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

/** Raiz do workspace — único diretório autorizado para execução */
const WORKSPACE_ROOT = new URL('../../../..', import.meta.url).pathname;

/** Limite máximo de bytes no output retornado */
const MAX_OUTPUT_BYTES = 10_000;

/** Timeout máximo permitido em ms (120s) */
const MAX_TIMEOUT_MS = 120_000;

/**
 * BUG-07 (fix): Detecta metacaracteres shell perigosos fora de aspas simples ou duplas. Evita falsos positivos em
 * argumentos legítimos como caminhos com `$HOME` ou formatos de git log.
 *
 * @param {string} command
 * @returns {boolean}
 */
function hasShellMetaOutsideQuotes(command) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < command.length; i++) {
        const c = command[i];
        if (c === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (c === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (!inSingle && !inDouble) {
            if ('|;&<>'.includes(/** @type {string} */ (c))) return true;
            if (c === '`') return true;
            if (c === '$' && command[i + 1] === '(') return true; // subshell $()
        }
    }
    return false;
}

/**
 * Padrões de comandos perigosos bloqueados. Verificados contra o comando completo após tokenização.
 *
 * @type {RegExp[]}
 */
const BLOCKED_COMMAND_PATTERNS = [
    /\brm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r/i, // rm -rf / rm -fr (flags combinadas)
    /\brm\s+(-\w+\s+){1,4}-[rf]/i, // BUG-MED-10 (fix): rm -r -f / rm -f -r (flags separadas)
    /\bdd\b/,
    /\bmkfs\b/,
    /\bformat\b/,
    /\bfdisk\b/,
    /\bmkswap\b/,
    /\bshred\b/,
    /\bwipe\b/,
    /\bchmod\s+777\b/,
    /\bchown\s+-R.*root/i,
    /\bsudo\b/,
    /\bsu\s/,
    /\bpasswd\b/,
    /\bcurl\b.*\|\s*(sh|bash)/i, // curl | bash pipe (code injection)
    /\bwget\b.*\|\s*(sh|bash)/i, // wget | bash pipe
    /\beval\b.*\$\(/i, // eval $(...) command injection
    />\s*\/dev\//, // write to /dev/*
    /\bkill\s+-9\s+1\b/, // kill PID 1
    /\bpkill\s+-9\b/,
    /\b(reboot|shutdown|halt|poweroff)\b/i,
    /\bcrontab\b/,
    /\bat\s+\w/, // at scheduler
    // SEC-01 (fix): bloquear comandos de enumeração de ambiente que expõem variáveis sensíveis
    /\bprintenv\b/,
    /\benv\b\s*$/, // 'env' sem args lista todas as variáveis
    /\bset\b\s*$/, // shell builtin 'set' sem args lista todas as variáveis
];

/**
 * Scripts npm permitidos (whitelist explícita). Qualquer outro script requer revisão. F6.6 (BUG-MOD-13): configurável
 * via COPILOT_NPM_SCRIPT_ALLOWLIST (lista separada por vírgula).
 *
 * @type {Set<string>}
 */
const _DEFAULT_NPM_SCRIPTS = [
    'lint',
    'lint:fix',
    'format',
    'format:check',
    'test:unit',
    'test:fast',
    'test:integration',
    'test:all',
    'typecheck:node',
    'typecheck:tools',
    'typecheck:browser',
    'typecheck:full',
    'typecheck:strict',
    'audit:quick',
    'analyze:deps',
    'diagnose',
    'health:core',
    'health:full',
    'queue:status',
    'queue:flow',
    'queue:clean',
];
const _envAllowlist = process.env['COPILOT_NPM_SCRIPT_ALLOWLIST'];
const ALLOWED_NPM_SCRIPTS = new Set(
    _envAllowlist
        ? _envAllowlist
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
        : _DEFAULT_NPM_SCRIPTS,
);

/**
 * BUG-H01 (fix): tokeniza um comando shell respeitando aspas simples e duplas. Exemplo: tokenizeShell('echo "hello
 * world"') → ['echo', 'hello world']
 *
 * @param {string} command
 * @returns {string[]}
 */
function tokenizeShell(command) {
    const tokens = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if (ch === ' ' && !inSingle && !inDouble) {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += ch;
        }
    }
    if (current.length > 0) tokens.push(current);
    return tokens;
}

/**
 * Verifica se um cwd é seguro (dentro do workspace).
 *
 * @param {string | undefined} cwd
 * @returns {{ ok: boolean; reason?: string; resolved: string }}
 */
function validateCwd(cwd) {
    const resolved = cwd ? (path.isAbsolute(cwd) ? cwd : path.resolve(WORKSPACE_ROOT, cwd)) : WORKSPACE_ROOT;
    const relative = path.relative(WORKSPACE_ROOT, resolved);
    if (relative.startsWith('..')) {
        return { ok: false, reason: `Cwd fora do workspace: ${resolved}`, resolved };
    }
    return { ok: true, resolved };
}

/**
 * Verifica se o comando contém padrões bloqueados.
 *
 * @param {string} command
 * @returns {{ ok: boolean; reason?: string }}
 */
function checkCommandBlocklist(command) {
    for (const pattern of BLOCKED_COMMAND_PATTERNS) {
        if (pattern.test(command)) {
            return { ok: false, reason: `Comando bloqueado por política de segurança: ${pattern}` };
        }
    }
    return { ok: true };
}

/**
 * Trunca string para MAX_OUTPUT_BYTES, adicionando aviso se truncado.
 *
 * @param {string} text
 * @returns {string}
 */
function truncateOutput(text) {
    if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT_BYTES) return text;
    const truncated = Buffer.from(text, 'utf8').slice(0, MAX_OUTPUT_BYTES).toString('utf8');
    return truncated + `\n\n[OUTPUT TRUNCADO — limite de ${MAX_OUTPUT_BYTES} bytes atingido]`;
}

/**
 * Ambiente seguro para sub-processos: remove variáveis sensíveis.
 *
 * SEC-VULN-04 (fix): além de lista explícita, filtra por padrão todas as variáveis cujo nome sugere credenciais (TOKEN,
 * SECRET, PASSWORD, API_KEY, CREDENTIAL, PRIVATE_KEY).
 *
 * @returns {Record<string, string>}
 */
function safeEnv() {
    const env = { ...process.env };
    // Lista explícita de variáveis sensíveis conhecidas
    const sensitiveExact = new Set([
        'GITHUB_TOKEN',
        'COPILOT_TOKEN',
        'NPM_TOKEN',
        'NPM_AUTH_TOKEN',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_SESSION_TOKEN',
        'GOOGLE_APPLICATION_CREDENTIALS',
        'AZURE_CLIENT_SECRET',
        'DATABASE_URL',
        'DATABASE_PASSWORD',
        'REDIS_URL',
        'REDIS_PASSWORD',
        'JWT_SECRET',
        'SESSION_SECRET',
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
    ]);
    // Padrão genérico: remove qualquer var cujo nome contenha tokens sensíveis
    const sensitivePattern = /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|PRIVATE_KEY/i;
    for (const key of Object.keys(env)) {
        if (sensitiveExact.has(key) || sensitivePattern.test(key)) {
            delete env[key];
        }
    }
    return /** @type {Record<string, string>} */ (env);
}

/**
 * Wrapper de execução com timeout, captura de stdout/stderr e sanitização.
 *
 * @param {string} file - Executável (ex: 'sh', 'node', 'npm')
 * @param {string[]} args - Argumentos passados ao execFile
 * @param {{ cwd: string; timeoutMs: number }} opts
 * @returns {Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>}
 */
async function runProcess(file, args, { cwd, timeoutMs }) {
    const start = Date.now();
    try {
        const { stdout, stderr } = await execFileAsync(file, args, {
            cwd,
            timeout: timeoutMs,
            maxBuffer: MAX_OUTPUT_BYTES * 4,
            env: safeEnv(),
            killSignal: 'SIGTERM',
        });
        return {
            exitCode: 0,
            stdout: truncateOutput(stdout || ''),
            stderr: truncateOutput(stderr || ''),
            durationMs: Date.now() - start,
        };
    } catch (/** @type {any} */ err) {
        return {
            exitCode: typeof err.code === 'number' ? err.code : 1,
            stdout: truncateOutput(err.stdout || ''),
            stderr: truncateOutput(err.stderr || err.message || ''),
            durationMs: Date.now() - start,
        };
    }
}

/**
 * UPG-01: Executa uma pipeline de dois processos via piping explícito de spawn (sem shell). Cada segmento é tokenizado
 * e validado individualmente antes da execução.
 *
 * @param {{ file: string; args: string[] }[]} stages - Etapas da pipeline (cmd1 | cmd2)
 * @param {{ cwd: string; timeoutMs: number }} opts
 * @returns {Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>}
 */
async function runPipeline(stages, { cwd, timeoutMs }) {
    const start = Date.now();
    return new Promise((resolve) => {
        /** @type {import('node:child_process').ChildProcess[]} */
        const procs = stages.map((s, i) =>
            spawn(s.file, s.args, {
                cwd,
                env: safeEnv(),
                stdio: i === 0 ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
            }),
        );

        // Encadear stdout[n] → stdin[n+1]
        for (let i = 0; i < procs.length - 1; i++) {
            const curr = procs[i];
            const next = procs[i + 1];
            if (curr?.stdout && next?.stdin) curr.stdout.pipe(next.stdin);
        }

        const lastProc = procs[procs.length - 1];
        if (!lastProc) {
            resolve({ exitCode: 1, stdout: '', stderr: 'Pipeline vazia', durationMs: Date.now() - start });
            return;
        }

        let stdout = '';
        let stderr = '';
        lastProc.stdout?.on('data', (d) => {
            stdout += d;
        });
        lastProc.stderr?.on('data', (d) => {
            stderr += d;
        });

        const timer = setTimeout(() => {
            for (const p of procs) p.kill('SIGTERM');
            resolve({
                exitCode: 124,
                stdout: truncateOutput(stdout),
                stderr: 'Timeout',
                durationMs: Date.now() - start,
            });
        }, timeoutMs);

        lastProc.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                exitCode: code ?? 1,
                stdout: truncateOutput(stdout),
                stderr: truncateOutput(stderr),
                durationMs: Date.now() - start,
            });
        });

        // Fechar stdin do primeiro processo
        procs[0]?.stdin?.end();
    });
}

/**
 * Cast auxiliar que resolve inferência de tipo do SDK `defineTool<T>`.
 *
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @returns {import('@github/copilot-sdk').ZodSchema<any>}
 */
const sdkParam = (schema) =>
    /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (/** @type {unknown} */ (schema));

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: exec_command
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool: exec_command — executa um comando shell arbitrário (sandboxado).
 */
const execCommandTool = defineTool('exec_command', {
    description:
        'Executa um comando shell no workspace. O comando é executado via /bin/sh com sandbox de segurança: ' +
        'cwd restrito ao workspace, blocklist de comandos perigosos, timeout máximo de 120s e output limitado. ' +
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
                .max(120)
                .optional()
                .describe('Timeout em segundos (1-120). Default: 30.'),
        }),
    ),
    handler: async ({ command, cwd, timeoutSeconds = 30 }) => {
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

        const timeoutMs = Math.min(timeoutSeconds * 1000, MAX_TIMEOUT_MS);
        log('INFO', `[ShellTools] exec_command: ${command} (cwd=${cwdCheck.resolved}, timeout=${timeoutMs}ms)`);

        // UPG-01: detectar pipeline simples (cmd1 | cmd2) e executar via spawn explícito sem shell.
        // Apenas pipes simples (sem subshell, sem redireção, sem ;/&) são permitidos.
        // Cada segmento é validado individualmente pela blocklist antes de executar.
        const pipeSegments = command.split('|').map((/** @type {string} */ s) => s.trim());
        if (pipeSegments.length > 1) {
            // Permitir no máximo 5 estágios para evitar abuso
            if (pipeSegments.length > 5) {
                return { success: false, error: 'Pipeline muito longa (máx. 5 estágios).' };
            }
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
            const result = await runPipeline(stages, { cwd: cwdCheck.resolved, timeoutMs });
            return {
                success: result.exitCode === 0,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                durationMs: result.durationMs,
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

        const result = await runProcess(executable, execArgs, {
            cwd: cwdCheck.resolved,
            timeoutMs,
        });

        return {
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
        };
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: run_npm_script
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool: run_npm_script — executa um script npm definido em package.json.
 */
const runNpmScriptTool = defineTool('run_npm_script', {
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
                .max(120)
                .optional()
                .describe('Timeout em segundos (1-120). Default: 60.'),
        }),
    ),
    handler: async ({ script, timeoutSeconds = 60 }) => {
        if (!ALLOWED_NPM_SCRIPTS.has(script)) {
            const allowed = [...ALLOWED_NPM_SCRIPTS].join(', ');
            log('WARN', `[ShellTools] run_npm_script bloqueado: script "${script}" não está na whitelist`);
            return {
                success: false,
                error: `Script "${script}" não é permitido. Scripts disponíveis: ${allowed}`,
            };
        }

        const timeoutMs = Math.min(timeoutSeconds * 1000, MAX_TIMEOUT_MS);
        log('INFO', `[ShellTools] run_npm_script: npm run ${script} (timeout=${timeoutMs}ms)`);

        const result = await runProcess('npm', ['run', script], {
            cwd: WORKSPACE_ROOT,
            timeoutMs,
        });

        return {
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
            script,
        };
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: run_node_file
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool: run_node_file — executa um arquivo JavaScript com Node.js.
 */
const runNodeFileTool = defineTool('run_node_file', {
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
                .max(120)
                .optional()
                .describe('Timeout em segundos (1-120). Default: 30.'),
        }),
    ),
    handler: async ({ filePath, args = [], timeoutSeconds = 30 }) => {
        // Valida extensão
        if (!/\.(js|mjs|cjs)$/.test(filePath)) {
            return { success: false, error: 'Apenas arquivos .js, .mjs e .cjs são permitidos.' };
        }

        // Valida caminho
        const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);
        const relative = path.relative(WORKSPACE_ROOT, resolved);
        if (relative.startsWith('..')) {
            return { success: false, error: `Acesso negado: arquivo fora do workspace (${resolved})` };
        }

        const timeoutMs = Math.min(timeoutSeconds * 1000, MAX_TIMEOUT_MS);
        log('INFO', `[ShellTools] run_node_file: node ${resolved} (timeout=${timeoutMs}ms)`);

        const result = await runProcess('node', [resolved, ...args], {
            cwd: WORKSPACE_ROOT,
            timeoutMs,
        });

        return {
            success: result.exitCode === 0,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
            filePath: resolved,
        };
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Todas as shell tools (3 tools de execução).
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const shellTools = [execCommandTool, runNpmScriptTool, runNodeFileTool];

export { execCommandTool, runNodeFileTool, runNpmScriptTool };
