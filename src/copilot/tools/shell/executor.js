// @ts-check
/**
 * src/copilot/tools/shell/executor.js
 *
 * Funções de execução de processos: tokenização de comandos, captura integral de output, execução unitária e pipeline
 * (pipe) com sandboxing.
 *
 * @module copilot/tools/shell/executor
 * @see EventBus
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { toExecError } from '../../core/error-handlers.js';
import { safeEnv } from './sandbox.js';

const execFileAsync = promisify(execFile);

/** Valor histórico mantido apenas como telemetria/advisory. Não bloqueia nem trunca output. */
export const ADVISORY_OUTPUT_BYTES = 10_000;

/** Valor histórico mantido apenas como telemetria/advisory. Não encerra processos. */
export const ADVISORY_TIMEOUT_MS = 120_000;

/**
 * BUG-H01 (fix): tokeniza um comando shell respeitando aspas simples e duplas. Exemplo: tokenizeShell('echo "hello
 * world"') → ['echo', 'hello world']
 *
 * @param {string} command
 * @returns {string[]}
 */
export function tokenizeShell(command) {
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
 * Preserva output integral. O nome é mantido por compatibilidade com chamadas existentes.
 *
 * @param {string} text
 * @returns {string}
 */
export function truncateOutput(text) {
    return text;
}

/**
 * Wrapper de execução com timeout, captura de stdout/stderr e sanitização.
 *
 * @param {string} file - Executável (ex: 'sh', 'node', 'npm')
 * @param {string[]} args - Argumentos passados ao execFile
 * @param {{ cwd: string; timeoutMs?: number | null }} opts
 * @returns {Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>}
 */
export async function runProcess(file, args, { cwd, timeoutMs }) {
    const start = Date.now();
    try {
        const { stdout, stderr } = await execFileAsync(file, args, {
            cwd,
            ...(typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
                ? { timeout: timeoutMs }
                : {}),
            maxBuffer: 1024 * 1024 * 1024,
            env: safeEnv(),
            killSignal: 'SIGTERM',
        });
        return {
            exitCode: 0,
            stdout: truncateOutput(stdout || ''),
            stderr: truncateOutput(stderr || ''),
            durationMs: Date.now() - start,
        };
    } catch (err) {
        const ex = toExecError(err);
        return {
            exitCode: typeof ex.code === 'number' ? ex.code : 1,
            stdout: truncateOutput(ex.stdout || ''),
            stderr: truncateOutput(ex.stderr || ex.message || ''),
            durationMs: Date.now() - start,
        };
    }
}

/**
 * UPG-01: Executa uma pipeline de dois processos via piping explícito de spawn (sem shell). Cada segmento é tokenizado
 * e validado individualmente antes da execução.
 *
 * @param {{ file: string; args: string[] }[]} stages - Etapas da pipeline (cmd1 | cmd2)
 * @param {{ cwd: string; timeoutMs?: number | null }} opts
 * @returns {Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>}
 */
export async function runPipeline(stages, { cwd, timeoutMs }) {
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

        const timer =
            typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
                ? setTimeout(() => {
                      for (const p of procs) p.kill('SIGTERM');
                      resolve({
                          exitCode: 124,
                          stdout: truncateOutput(stdout),
                          stderr: 'Timeout',
                          durationMs: Date.now() - start,
                      });
                  }, timeoutMs)
                : null;

        lastProc.on('close', (code) => {
            if (timer) clearTimeout(timer);
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
