/* ==========================================================================
   src/infra/locks/process_guard.js
   Audit Level: 700 — Sovereign Process Guard (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Monitorar a existência física (liveness) de processos 
                     no Sistema Operacional.
   Uso Crítico: Validação de PIDs para quebra de locks órfãos.
========================================================================== */

/**
 * Verifica se um processo ainda existe na tabela de processos do SO.
 * 
 * @param {number} pid - O Identificador de Processo (PID) a ser checado.
 * @returns {boolean} True se o processo está ativo ou protegido; False se não existe.
 */
function isProcessAlive(pid) {
    // Validação defensiva de entrada
    if (!pid || typeof pid !== 'number' || isNaN(pid)) {
        return false;
    }
    
    try {
        /**
         * O sinal '0' é uma convenção POSIX. 
         * Ele não envia uma interrupção real ao processo, mas executa todas 
         * as checagens de erro, incluindo a verificação de existência.
         */
        process.kill(pid, 0);
        return true;
    } catch (e) {
        /**
         * EPERM: O processo existe, mas o usuário atual não tem permissão 
         * para sinalizá-lo (comum em processos de sistema ou outros usuários).
         * Consideramos como VIVO.
         * 
         * ESRCH: O processo não foi encontrado (morreu ou nunca existiu).
         * Consideramos como MORTO.
         */
        return e.code === 'EPERM';
    }
}

module.exports = { isProcessAlive };