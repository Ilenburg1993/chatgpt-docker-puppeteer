// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as i18n from '#core/i18n';
import { log } from '#core/logger';
import { runSinglePassValidation } from './scan_engine.js';

/**
 * @typedef {object} ValidateTaskResultTaskPayload
 * @property {string} [language] - Idioma da tarefa.
 */
/**
 * @typedef {object} ValidateTaskResultTaskSpec
 * @property {ValidateTaskResultTaskPayload} [payload] - Payload da tarefa.
 */
/**
 * @typedef {object} ValidateTaskResultTaskMeta
 * @property {string} [id] - ID da tarefa.
 */
/**
 * @typedef {object} ValidateTaskResultTask
 * @property {ValidateTaskResultTaskMeta} [meta] - Metadados da tarefa.
 * @property {ValidateTaskResultTaskSpec} [spec] - Especificações da tarefa.
 */
/**
 * Realiza a auditoria completa de qualidade de um resultado em disco.
 *
 * @param {ValidateTaskResultTask} task - Objeto da tarefa (Schema V4).
 * @param {string} filePath - Caminho absoluto para o arquivo de resposta.
 * @param {AbortSignal} [signal] - Sinal soberano para interrupção imediata.
 * @returns {Promise<any>} { ok: boolean, reason: string|null }
 */
async function validateTaskResult(task, filePath, signal = undefined) {
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
        const result = /** @type {{ ok: boolean; reason: string | null }} */ (
            await runSinglePassValidation(task, filePath, systemErrorTerms, signal)
        );

        // 5. TELEMETRIA DE RESULTADO
        if (result.ok) {
            log('INFO', `[VALIDATOR] Resultado aprovado para tarefa: ${taskId}`);
        } else {
            // Diferencia log de cancelamento (operacional) de log de rejeição (qualidade)
            const isCancel = result.reason?.includes('CANCELLED') || result.reason?.includes('ABORTED');
            log(isCancel ? 'INFO' : 'WARN', `[VALIDATOR] Resultado: ${result.reason}`, taskId);
        }

        return result;
    } catch (/** @type {any} */ valErr) {
        const caught = /** @type {any} */ (valErr);
        // 6. TRATAMENTO DE INTERRUPÇÃO SILENCIOSA
        if (caught.message === 'VALIDATION_ABORTED' || caught.name === 'AbortError') {
            return { ok: false, reason: 'VALIDATION_CANCELLED: Operação interrompida pelo sinal de aborto.' };
        }

        // 7. TRATAMENTO DE FALHA CATASTRÓFICA
        log('ERROR', `[VALIDATOR] Colapso na orquestração: ${caught.message}`, taskId);
        return {
            ok: false,
            reason: `VALIDATOR_INTERNAL_ERROR: ${caught.message}`,
        };
    }
}

export { validateTaskResult };
