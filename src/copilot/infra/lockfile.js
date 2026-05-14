// @ts-check
/**
 * src/copilot/infra/lockfile.js — Lockfile manager para exclusão mútua entre processos.
 *
 * Usa lockfiles baseados em PID para evitar execuções concorrentes do mesmo recurso.
 *
 * @module copilot/infra/lockfile
 */

import { existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * @param {string} targetPath
 * @returns {Promise<void>}
 */
async function assertPathIsNotSymlink(targetPath) {
    try {
        const stats = await lstat(targetPath);
        if (stats.isSymbolicLink()) {
            const error = new Error(`Lock path inválido (symlink detectado): ${targetPath}`);
            /** @type {{ code?: string }} */ (error).code = 'ERR_LOCKFILE_SYMLINK';
            throw error;
        }
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT') return;
        throw error;
    }
}

/**
 * Tenta adquirir um lockfile. Retorna `true` se adquirido, `false` se já existe um lock válido.
 *
 * O lockfile contém o PID do processo que o criou. Se o processo dono não estiver mais rodando (stale lock), o lock é
 * removido e re-adquirido automaticamente.
 *
 * @param {string} lockPath - Caminho absoluto do lockfile.
 * @returns {Promise<boolean>}
 */
export async function acquireLock(lockPath) {
    const dir = dirname(lockPath);
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
    }

    await assertPathIsNotSymlink(lockPath);

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const handle = await open(lockPath, 'wx');
            try {
                await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf-8');
            } finally {
                await handle.close();
            }
            return true;
        } catch (error) {
            const code = /** @type {{ code?: unknown }} */ (error)?.code;
            if (code !== 'EEXIST') throw error;

            await assertPathIsNotSymlink(lockPath);

            try {
                const raw = await readFile(lockPath, 'utf-8');
                const pid = readLockOwnerPid(raw);
                if (pid !== null && isProcessAlive(pid)) {
                    return false;
                }
            } catch {
                // arquivo corrompido ou ilegível: tenta remover como stale
            }

            try {
                unlinkSync(lockPath);
            } catch (unlinkError) {
                const unlinkCode = /** @type {{ code?: unknown }} */ (unlinkError)?.code;
                if (unlinkCode !== 'ENOENT') return false;
            }
        }
    }

    return false;
}

/**
 * Libera um lockfile previamente adquirido.
 *
 * @param {string} lockPath - Caminho absoluto do lockfile.
 * @returns {void}
 */
export function releaseLock(lockPath) {
    try {
        if (!existsSync(lockPath)) return;
        if (lstatSync(lockPath).isSymbolicLink()) return;
        const pid = readLockOwnerPid(readFileSync(lockPath, 'utf-8'));
        if (pid === process.pid) {
            // best-effort: se lockPath virar symlink entre checks, unlink pode falhar e será ignorado
            unlinkSync(lockPath);
        }
    } catch {
        // best-effort
    }
}

/**
 * @param {string} raw
 * @returns {number | null}
 */
function readLockOwnerPid(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        const parsed = JSON.parse(trimmed);
        const pid = Number(parsed?.pid);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
        const pid = Number.parseInt(trimmed, 10);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    }
}

/**
 * Verifica se um processo com o PID dado está vivo.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
