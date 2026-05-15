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

import { getShellOutputPolicy } from '#copilot/config';
import { toExecError } from '#copilot/core';
import { resolveProcessExecutionBudget } from '#copilot/infra/public/policy';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { safeEnv } from './sandbox.js';

const execFileAsync = promisify(execFile);

/** Valor histórico mantido apenas como telemetria/advisory. Não bloqueia nem trunca output. */
export const ADVISORY_OUTPUT_BYTES = 10_000;

/** Valor histórico mantido apenas como telemetria/advisory. Não encerra processos. */
export const ADVISORY_TIMEOUT_MS = 120_000;

/** Limite de captura em memória por stream (stdout/stderr) para evitar crescimento ilimitado. */
export const CAPTURE_MAX_BYTES = 2 * 1024 * 1024;

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
    let escaped = false;

    for (let i = 0; i < command.length; i++) {
        const ch = command[i];

        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }

        if (ch === '\\' && !inSingle) {
            escaped = true;
            continue;
        }

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
 * Divide pipeline `cmd1 | cmd2 | ...` respeitando aspas e escape.
 *
 * @param {string} command
 * @returns {string[]}
 */
export function splitPipelineSegments(command) {
    /** @type {string[]} */
    const segments = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < command.length; i++) {
        const ch = command[i];

        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }

        if (ch === '\\' && !inSingle) {
            escaped = true;
            current += ch;
            continue;
        }

        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            current += ch;
            continue;
        }

        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            current += ch;
            continue;
        }

        if (ch === '|' && !inSingle && !inDouble) {
            const trimmed = current.trim();
            if (trimmed.length > 0) segments.push(trimmed);
            current = '';
            continue;
        }

        current += ch;
    }

    const trimmed = current.trim();
    if (trimmed.length > 0) segments.push(trimmed);
    return segments;
}

/**
 * Acumula dados de stream com limite em bytes.
 *
 * @param {string} current
 * @param {Buffer | string} chunk
 * @param {number} maxBytes
 * @returns {string}
 */
function appendCaptured(current, chunk, maxBytes) {
    if (current.length >= maxBytes) {
        return current;
    }
    const text = String(chunk);
    const next = current + text;
    if (next.length <= maxBytes) {
        return next;
    }
    return next.slice(0, maxBytes);
}

/**
 * Preserva output integral. O nome é mantido por compatibilidade com chamadas existentes.
 *
 * @param {string} text
 * @returns {string}
 */
export function truncateOutput(text) {
    const policy = getShellOutputPolicy();
    if (!policy.enforced || text.length <= policy.maxBytes) {
        return text;
    }
    return `${text.slice(0, policy.maxBytes)}\n[output truncated: ${text.length - policy.maxBytes} chars omitted]`;
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
    const budget = resolveProcessExecutionBudget(timeoutMs === undefined ? {} : { timeoutMs });
    try {
        const { stdout, stderr } = await execFileAsync(file, args, {
            cwd,
            ...(budget.timeoutMs === null ? {} : { timeout: budget.timeoutMs }),
            maxBuffer: budget.maxBufferBytes,
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
        let finished = false;

        /** @param {'SIGTERM' | 'SIGKILL'} signal */
        const stopAll = (signal) => {
            for (const p of procs) {
                p.stdout?.destroy();
                p.stderr?.destroy();
                p.stdin?.destroy();
                if (p.exitCode === null && !p.killed) {
                    p.kill(signal);
                }
            }
        };

        /** @param {{ exitCode: number; stdout: string; stderr: string; durationMs: number }} result */
        const finalize = (result) => {
            if (finished) return;
            finished = true;
            resolve(result);
        };

        /** @type {import('node:child_process').ChildProcess[]} */
        const procs = stages.map((s, i) =>
            spawn(s.file, s.args, {
                cwd,
                env: safeEnv(),
                // FIX P0-3: processos intermediários usam 'ignore' para stderr — evita deadlock por
                // buffer cheio de pipe não consumido (kernel pipe buffer ~64KB). Último processo
                // mantém 'pipe' para captura normal.
                stdio: ['pipe', 'pipe', i === stages.length - 1 ? 'pipe' : 'ignore'],
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
            stdout = appendCaptured(stdout, d, CAPTURE_MAX_BYTES);
        });
        lastProc.stderr?.on('data', (d) => {
            stderr = appendCaptured(stderr, d, CAPTURE_MAX_BYTES);
        });

        for (const proc of procs) {
            proc.on('error', (error) => {
                stopAll('SIGTERM');
                finalize({
                    exitCode: 1,
                    stdout: truncateOutput(stdout),
                    stderr: truncateOutput(`${stderr}\n${error.message}`.trim()),
                    durationMs: Date.now() - start,
                });
            });
        }

        const timer =
            typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
                ? setTimeout(() => {
                      stopAll('SIGTERM');
                      setTimeout(() => {
                          stopAll('SIGKILL');
                      }, 750).unref();
                      finalize({
                          exitCode: 124,
                          stdout: truncateOutput(stdout),
                          stderr: truncateOutput(`${stderr}\nTimeout`.trim()),
                          durationMs: Date.now() - start,
                      });
                  }, timeoutMs)
                : null;

        lastProc.on('close', (code) => {
            if (timer) clearTimeout(timer);
            finalize({
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
