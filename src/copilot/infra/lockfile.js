// @ts-check
/**
 * src/copilot/infra/lockfile.js — Lockfile manager para exclusão mútua entre processos.
 *
 * Usa lockfiles baseados em PID para evitar execuções concorrentes do mesmo recurso.
 *
 * @module copilot/infra/lockfile
 */

import { existsSync, unlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Tenta adquirir um lockfile. Retorna `true` se adquirido, `false` se já existe um lock válido.
 *
 * O lockfile contém o PID do processo que o criou. Se o processo dono não estiver mais rodando
 * (stale lock), o lock é removido e re-adquirido automaticamente.
 *
 * @param {string} lockPath - Caminho absoluto do lockfile.
 * @returns {Promise<boolean>}
 */
export async function acquireLock(lockPath) {
    if (existsSync(lockPath)) {
        try {
            const raw = await readFile(lockPath, 'utf-8');
            const pid = parseInt(raw.trim(), 10);
            if (!isNaN(pid) && isProcessAlive(pid)) {
                return false; // lock válido de outro processo
            }
            // stale lock — processo morreu
            unlinkSync(lockPath);
        } catch {
            // arquivo corrompido — remove
            try { unlinkSync(lockPath); } catch { /* ignore */ }
        }
    }

    const dir = dirname(lockPath);
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
    }

    await writeFile(lockPath, String(process.pid), 'utf-8');
    return true;
}

/**
 * Libera um lockfile previamente adquirido.
 *
 * @param {string} lockPath - Caminho absoluto do lockfile.
 * @returns {void}
 */
export function releaseLock(lockPath) {
    try {
        if (existsSync(lockPath)) {
            unlinkSync(lockPath);
        }
    } catch {
        // best-effort
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
