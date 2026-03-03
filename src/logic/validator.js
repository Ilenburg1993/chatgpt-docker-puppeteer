// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as core from './validation/validation_core.js';

/**
 * Valida resultado de tarefa.
 *
 * **Side-effects:** Delegação para validation_core.
 * **Semântica:** Re-export da função de validação core.
 * **Unidades:** Mesmas do validation_core.
 *
 * @param {object} result - Resultado a ser validado
 * @returns {boolean} True se válido
 */
export const validateTaskResult = core.validateTaskResult;
