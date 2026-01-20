/* ==========================================================================
   src/core/context/transformers/metadata.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Extrair informações de estado e métricas do objeto Task.
========================================================================== */

/**
 * Extrai propriedades específicas do estado da tarefa.
 */
function extractTaskMetadata(task, transformType) {
    if (!task || !task.state) {
        return 'UNKNOWN';
    }

    switch (transformType.toUpperCase()) {
        case 'STATUS':
            return task.state.status || 'UNKNOWN';
        case 'METRICS':
            return JSON.stringify(task.state.metrics || {}, null, 2);
        case 'ERROR':
            return task.state.last_error || 'NONE';
        default:
            return 'UNKNOWN_METADATA_REQUEST';
    }
}

module.exports = { extractTaskMetadata };
