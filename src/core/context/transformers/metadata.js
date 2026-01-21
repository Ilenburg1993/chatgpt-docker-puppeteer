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
