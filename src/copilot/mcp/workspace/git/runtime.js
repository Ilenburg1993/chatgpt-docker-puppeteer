// @ts-check
/**
 * Fixed Git execution primitive for the MCP workspace.
 *
 * This is application infrastructure for Git-backed workspace operations, not a wire-tool helper. Callers receive
 * process evidence as data and decide how to project failures into their own contract.
 *
 * @module copilot/mcp/workspace/git/runtime
 */

import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * @param {string[]} args
 * @param {{ timeoutMs?: number; maxBufferBytes?: number; cwd?: string }} [opts]
 * @returns {Promise<{ success: boolean; stdout: string; stderr: string; error?: string; exitCode: number | null }>}
 */
export async function execWorkspaceGit(args, opts = {}) {
    try {
        const { stdout, stderr } = await execFileAsync('git', args, {
            cwd: opts.cwd ?? MCP_WORKSPACE_ROOT,
            encoding: 'utf8',
            timeout: opts.timeoutMs ?? 15_000,
            maxBuffer: opts.maxBufferBytes ?? 2 * 1024 * 1024,
        });
        return { success: true, stdout, stderr, exitCode: 0 };
    } catch (error) {
        const err = /** @type {NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }} */ (error);
        return {
            success: false,
            stdout: typeof err.stdout === 'string' ? err.stdout : '',
            stderr: typeof err.stderr === 'string' ? err.stderr : '',
            error: err.stderr || err.message,
            exitCode: typeof err.code === 'number' ? err.code : null,
        };
    }
}
