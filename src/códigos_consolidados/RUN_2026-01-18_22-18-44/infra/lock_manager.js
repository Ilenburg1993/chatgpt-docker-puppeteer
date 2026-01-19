FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\infra\locks\lock_manager.js
PASTA_BASE: infra
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/infra/locks/lock_manager.js
   Audit Level: 700 — Sovereign Lock Manager (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Exclusão mútua baseada em filesystem para controle de 
                     concorrência entre instâncias do Maestro.
   Sincronizado com: paths.js V700, process_guard.js V100, fs_core.js V700.
========================================================================== */

const fs = require('fs').promises;
const path = require('path');

// [V700] Importações de infraestrutura base para evitar dependências circulares
const PATHS = require('../fs/paths');
const { safeReadJSON } = require('../fs/fs_core');
const { isProcessAlive } = require('./process_guard');

const RUN_LOCK_PREFIX = 'RUNNING_';
const MAX_ORPHAN_RECOVERY_ATTEMPTS = 3;

/* ========================================================================== *
 * UTILITÁRIOS INTERNOS
 * ========================================================================== */

/**
 * Gera o caminho absoluto para o arquivo de trava de um alvo.
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
 * @param {string} taskId - ID da tarefa que solicita o lock.
 * @param {string} target - Nome do alvo (ex: 'chatgpt').
 * @param {number} attempt - Contador de tentativas internas para recuperação.
 * @returns {Promise<boolean>} True se o lock foi adquirido, False se estiver ocupado.
 */
async function acquireLock(taskId, target = 'global', attempt = 0) {
    const lockFile = getLockPath(target);
    const lockData = {
        taskId,
        pid: process.pid,
        ts: new Date().toISOString()
    };

    try {
        // [V700] Tenta criar o arquivo de forma atômica e exclusiva.
        // A flag 'wx' falha se o arquivo já existir.
        await fs.writeFile(lockFile, JSON.stringify(lockData), { flag: 'wx' });
        return true;

    } catch (err) {
        // Se o erro não for 'EEXIST', algo grave ocorreu no I/O
        if (err.code !== 'EEXIST') return false;

        // Análise de ocupação: Quem detém o lock?
        const currentLock = await safeReadJSON(lockFile);

        // Caso A: Lock inexistente ou ilegível (Race condition na deleção)
        if (!currentLock) {
            if (attempt >= MAX_ORPHAN_RECOVERY_ATTEMPTS) return false;
            return acquireLock(taskId, target, attempt + 1);
        }

        // Caso B: Lock Órfão (O processo dono morreu sem limpar a trava)
        if (!isProcessAlive(currentLock.pid)) {
            if (attempt >= MAX_ORPHAN_RECOVERY_ATTEMPTS) return false;

            try {
                // [ANTI-RACE] Revalida se o lock ainda pertence ao mesmo PID morto
                const recheck = await safeReadJSON(lockFile);
                if (recheck && recheck.pid === currentLock.pid) {
                    await fs.unlink(lockFile).catch(() => {});
                }
                // Tenta adquirir novamente após a limpeza do órfão
                return acquireLock(taskId, target, attempt + 1);
            } catch (_) {
                return false;
            }
        }

        // Caso C: Lock válido pertencente a um processo ativo
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
 */
async function releaseLock(target = 'global', taskId = null) {
    const lockFile = getLockPath(target);

    const currentLock = await safeReadJSON(lockFile);
    if (!currentLock) return;

    try {
        // Só remove se for o dono (taskId bate) ou se for uma ordem mestre (taskId null)
        if (!taskId || currentLock.taskId === taskId) {
            await fs.unlink(lockFile).catch(() => {});
        }
    } catch (_) {
        // Falha na deleção de lock inexistente é ignorada (Best-effort)
    }
}

module.exports = { acquireLock, releaseLock };