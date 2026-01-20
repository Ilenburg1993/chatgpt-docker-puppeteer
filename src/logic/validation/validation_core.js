/* ==========================================================================
   src/logic/validation/validation_core.js
   Audit Level: 100 — Industrial Hardening (Quality Orchestrator - Platinum)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Fachada principal para auditoria de resultados.
                     Integra motor de varredura com inteligência linguística.
   Sincronizado com: scan_engine.js (V1.1), i18n.js (V32), index.js (V190).
========================================================================== */

const i18n = require('../../core/i18n');
const { runSinglePassValidation } = require('./scan_engine');
const { log } = require('../../core/logger');

/**
 * Realiza a auditoria completa de qualidade de um resultado em disco.
 *
 * @param {object} task - Objeto da tarefa (Schema V4).
 * @param {string} filePath - Caminho absoluto para o arquivo de resposta.
 * @param {AbortSignal} [signal] - Sinal soberano para interrupção imediata.
 * @returns {Promise<object>} { ok: boolean, reason: string|null }
 */
async function validateTaskResult(task, filePath, signal = null) {
    const taskId = task?.meta?.id || 'unknown';

    try {
        // 1. CHECK DE ABORTO PRECOCE
        // Impede o início da validação se a tarefa já foi cancelada pelo Maestro.
        if (signal?.aborted) {
            throw new Error('VALIDATION_ABORTED');
        }

        log('DEBUG', `[VALIDATOR] Iniciando auditoria de qualidade para tarefa: ${taskId}`);

        // 2. DETERMINAÇÃO DE CONTEXTO LINGUÍSTICO
        // [RESTAURADO] Prioriza o idioma definido na tarefa para precisão semântica.
        const lang = task?.spec?.payload?.language || 'pt';

        // 3. AQUISIÇÃO DE INTELIGÊNCIA SEMÂNTICA
        // Recupera termos de erro dinâmicos (ex: "violação", "limite atingido") via i18n.
        const systemErrorTerms = await i18n.getTerms('error_indicators', lang);

        // 4. EXECUÇÃO DO MOTOR DE VARREDURA (SINGLE-PASS)
        // Delega a leitura eficiente e aplicação de regras ao scan_engine.
        const result = await runSinglePassValidation(task, filePath, systemErrorTerms, signal);

        // 5. TELEMETRIA DE RESULTADO
        if (result.ok) {
            log('INFO', `[VALIDATOR] Resultado aprovado para tarefa: ${taskId}`);
        } else {
            // Diferencia log de cancelamento (operacional) de log de rejeição (qualidade)
            const isCancel = result.reason?.includes('CANCELLED') || result.reason?.includes('ABORTED');
            log(isCancel ? 'INFO' : 'WARN', `[VALIDATOR] Resultado: ${result.reason}`, taskId);
        }

        return result;
    } catch (valErr) {
        // 6. TRATAMENTO DE INTERRUPÇÃO SILENCIOSA
        if (valErr.message === 'VALIDATION_ABORTED' || valErr.name === 'AbortError') {
            return { ok: false, reason: 'VALIDATION_CANCELLED: Operação interrompida pelo sinal de aborto.' };
        }

        // 7. TRATAMENTO DE FALHA CATASTRÓFICA
        log('ERROR', `[VALIDATOR] Colapso na orquestração: ${valErr.message}`, taskId);
        return {
            ok: false,
            reason: `VALIDATOR_INTERNAL_ERROR: ${valErr.message}`
        };
    }
}

module.exports = { validateTaskResult };
