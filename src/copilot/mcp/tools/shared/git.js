// @ts-check
/**
 * Shared Git helpers for MCP tools.
 *
 * @module copilot/mcp/tools/shared/git
 */

import { getMcpWorkspaceRoot } from '#copilot/mcp/control-plane';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * @param {string[]} args
 * @param {{ timeoutMs?: number; maxBufferBytes?: number }} [opts]
 * @returns {Promise<{ success: boolean; stdout: string; stderr: string; error?: string; exitCode: number | null }>}
 */
export async function execGit(args, opts = {}) {
    try {
        const { stdout, stderr } = await execFileAsync('git', args, {
            cwd: getMcpWorkspaceRoot(),
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

