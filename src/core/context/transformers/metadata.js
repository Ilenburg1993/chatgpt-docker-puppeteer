/* ==========================================================================
   src/core/context/transformers/metadata.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Extrair informações de estado e métricas do objeto Task.
========================================================================== */

/**
 * Metadata Types: Tipos de metadados extraíveis de uma Task
 * Escopo: Local ao módulo metadata transformer
 */
const METADATA_TYPES = {
    STATUS: 'STATUS',
    METRICS: 'METRICS',
    ERROR: 'ERROR'
};

/**
 * Extrai propriedades específicas do estado da tarefa.
 * Usado por transformadores {{REF:LAST|STATUS}}, {{REF:LAST|METRICS}}, {{REF:LAST|ERROR}}.
 *
 * @function extractTaskMetadata
 * @param {object} task - Objeto Task completo com propriedade `state`
 * @param {string} transformType - Tipo de metadado a extrair (STATUS, METRICS, ERROR)
 * @returns {string} Metadado extraído ou valor padrão (UNKNOWN, NONE, {})
 *
 * @example
 * // Extrair status da tarefa
 * extractTaskMetadata(task, 'STATUS'); // => 'RUNNING' ou 'DONE'
 *
 * @example
 * // Extrair métricas em JSON formatado
 * extractTaskMetadata(task, 'METRICS');
 * // => '{ "startTime": 1234567890, "duration": 4500 }'
 *
 * @example
 * // Extrair última mensagem de erro
 * extractTaskMetadata(task, 'ERROR');
 * // => 'Target closed' ou 'NONE' se sem erro
 *
 * @example
 * // Tarefa sem state retorna valor padrão
 * extractTaskMetadata(null, 'STATUS'); // => 'UNKNOWN'
 *
 * @description
 * **Tipos de metadados suportados**:
 * - `STATUS`: `task.state.status` (PENDING, RUNNING, DONE, FAILED)
 * - `METRICS`: `task.state.metrics` (JSON stringified com indentação)
 * - `ERROR`: `task.state.last_error` (mensagem de erro ou 'NONE')
 *
 * **Casos de uso**:
 * - Transformador `{{REF:LAST|STATUS}}` para condicional
 * - Transformador `{{REF:LAST|METRICS}}` para auditoria
 * - Transformador `{{REF:LAST|ERROR}}` para retry logic
 */
function extractTaskMetadata(task, transformType) {
    if (!task || !task.state) {
        return 'UNKNOWN';
    }

    switch (transformType.toUpperCase()) {
        case METADATA_TYPES.STATUS:
            return task.state.status || 'UNKNOWN';
        case METADATA_TYPES.METRICS:
            return JSON.stringify(task.state.metrics || {}, null, 2);
        case METADATA_TYPES.ERROR:
            return task.state.last_error || 'NONE';
        default:
            return 'UNKNOWN_METADATA_REQUEST';
    }
}

module.exports = { extractTaskMetadata };
