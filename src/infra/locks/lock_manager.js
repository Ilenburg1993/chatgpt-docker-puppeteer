// @ts-check
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as PATHS from '../fs/paths.js';
import { safeReadJSON } from '../fs/fs_core.js';
import { isProcessAlive } from './process_guard.js';

const RUN_LOCK_PREFIX = 'RUNNING_';
const MAX_ORPHAN_RECOVERY_ATTEMPTS = 3;

/* ========================================================================== *
 * UTILITÁRIOS INTERNOS
 * ========================================================================== */

/**
 * Gera o caminho absoluto para o arquivo de trava de um alvo.
 * @param {*} target
 */
function getLockPath(target) {
    const safeTarget = (target || 'global').toLowerCase();
    return path.join(PATHS.ROOT, `${RUN_LOCK_PREFIX}${safeTarget}.lock`);
}

/* ========================================================================== *
 * AQUISIÇÃO DE LOCK (OWNER-SAFE & RACE-RESISTANT)
 * ========================================================================== */

/**
 * Tenta adquirir o lock exclusivo para um alvo específico.
 *
 * [V800] Implementa Two-Phase Commit para atomicidade total:
 * Fase 1: Criar arquivo temporário (PID-único)
 * Fase 2: Hard link para lock final (operação atômica que falha se existir)
 *
 * NOTA: fs.rename() sobrescreve arquivo existente em muitos OS.
 *       fs.link() falha com EEXIST se destino já existir (comportamento desejado).
 *
 * @param {string} taskId - ID da tarefa que solicita o lock.
 * @param {string} target - Nome do alvo (ex: 'chatgpt').
 * @param {number} attempt - Contador de tentativas internas para recuperação.
 * @returns {Promise<boolean>} True se o lock foi adquirido, False se estiver ocupado.
 */
async function acquireLock(taskId, target = 'global', attempt = 0) {
    const lockFile = getLockPath(target);
    const tempLockFile = `${lockFile}.${process.pid}.tmp`;
    const lockData = {
        taskId,
        pid: process.pid,
        ts: new Date().toISOString(),
    };

    try {
        // [FASE 1] Cria arquivo temporário com PID único (sem race)
        await fs.writeFile(tempLockFile, JSON.stringify(lockData));

        try {
            // [FASE 2] Hard link atômico: falha com EEXIST se lockFile já existir
            // Diferente de rename(), link() NÃO sobrescreve arquivo existente
            await fs.link(tempLockFile, lockFile);

            // Sucesso: remove temp file (agora temos 2 hard links para mesmo inode)
            await fs.unlink(tempLockFile).catch(() => {});
            return true;
        } catch (linkErr) {
            // Link falhou: lock já existe (outro processo venceu)
            await fs.unlink(tempLockFile).catch(() => {});

            // Se erro não for EEXIST, algo grave no I/O
            if (linkErr.code !== 'EEXIST' && linkErr.code !== 'EPERM') {
                return false;
            }

            // Prossegue para análise de ocupação
        }

        // Análise de ocupação: Quem detém o lock?
        const currentLock = await safeReadJSON(lockFile);

        // Caso A: Lock inexistente ou ilegível (Race na deleção)
        if (!currentLock) {
            if (attempt >= MAX_ORPHAN_RECOVERY_ATTEMPTS) {
                return false;
            }
            return acquireLock(taskId, target, attempt + 1);
        }

        // Caso B: Lock Órfão (Processo dono morreu)
        if (!isProcessAlive(currentLock.pid)) {
            if (attempt >= MAX_ORPHAN_RECOVERY_ATTEMPTS) {
                return false;
            }

            try {
                // P3.3: Recovery lock com UUID para prevenir race entre múltiplas instâncias
                const recoveryId = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
                const recoveryLockFile = `${lockFile}.recovery.${recoveryId}`;

                // [FASE 1] Cria recovery lock temporário
                await fs.writeFile(recoveryLockFile, JSON.stringify({ pid: process.pid, recoveryId }));

                // [FASE 2] Aguarda 100ms para dar chance de outros processos detectarem
                await new Promise(resolve => {
                    setTimeout(resolve, 100);
                });

                // [FASE 3] Verifica se somos únicos no recovery
                const lockDir = path.dirname(lockFile);
                const files = await fs.readdir(lockDir);
                const recoveryFiles = files.filter(f => f.includes('.recovery.'));

                if (recoveryFiles.length > 1) {
                    // Outro processo também detectou - aborta para evitar race
                    await fs.unlink(recoveryLockFile).catch(() => {});
                    return false;
                }

                // [FASE 4] Somos únicos - prossegue com recovery
                // [ANTI-RACE] Revalida PID antes de deletar
                const recheck = await safeReadJSON(lockFile);
                if (recheck && recheck.pid === currentLock.pid) {
                    await fs.unlink(lockFile).catch(() => {});
                }

                // Cleanup recovery lock
                await fs.unlink(recoveryLockFile).catch(() => {});

                // Tenta adquirir novamente após limpeza
                return acquireLock(taskId, target, attempt + 1);
            } catch (_) {
                return false;
            }
        }

        // Caso C: Lock válido (processo ativo)
        return false;
    } catch (_) {
        // Falha na fase 1: cleanup e abort
        await fs.unlink(tempLockFile).catch(() => {});
        return false;
    }
}

/* ========================================================================== *
 * LIBERAÇÃO DE LOCK (OWNER-AWARE)
 * ========================================================================== */

/**
 * Libera a trava de um alvo, garantindo que apenas o dono possa removê-la.
 *
 * @param {string} target - Nome do alvo.
 * @param {string|null} taskId - ID da tarefa (null para liberação administrativa).
  * @returns {Promise<void>}
 */
async function releaseLock(target = 'global', taskId = null) {
    const lockFile = getLockPath(target);

    const currentLock = await safeReadJSON(lockFile);
    if (!currentLock) {
        return;
    }

    try {
        // Só remove se for o dono (taskId bate) ou se for uma ordem mestre (taskId null)
        if (!taskId || currentLock.taskId === taskId) {
            await fs.unlink(lockFile).catch(() => {});
        }
    } catch (_) {
        // Falha na deleção de lock inexistente é ignorada (Best-effort)
    }
}

export { acquireLock, releaseLock };
