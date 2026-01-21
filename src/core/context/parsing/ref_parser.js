/* ==========================================================================
   src/core/context/parsing/ref_parser.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Extração estruturada de intenções {{REF:...}}.
========================================================================== */

/**
 * Varre o texto em busca de referências {{REF:...}} e retorna uma lista de objetos de intenção.
 * Padrão suportado: {{REF:CRITERIA|TRANSFORM}} ou {{REF:CRITERIA}}
 *
 * @function parseReferences
 * @param {string} text - Texto original contendo tags {{REF:...}}
 * @returns {Array<{fullMatch: string, criteria: string, transform: string}>} Lista de referências extraídas
 *
 * @example
 * // Referência simples
 * parseReferences('Use {{REF:task-123}}');
 * // => [{ fullMatch: '{{REF:task-123}}', criteria: 'task-123', transform: 'RAW' }]
 *
 * @example
 * // Com transformação
 * parseReferences('Veja {{REF:LAST|SUMMARY}}');
 * // => [{ fullMatch: '{{REF:LAST|SUMMARY}}', criteria: 'LAST', transform: 'SUMMARY' }]
 *
 * @example
 * // Múltiplas referências
 * parseReferences('{{REF:task-1}} e {{REF:task-2|JSON}}');
 * // => [
 * //   { fullMatch: '{{REF:task-1}}', criteria: 'task-1', transform: 'RAW' },
 * //   { fullMatch: '{{REF:task-2|JSON}}', criteria: 'task-2', transform: 'JSON' }
 * // ]
 *
 * @description
 * **Critérios suportados**:
 * - `task-123` - ID exato da tarefa
 * - `LAST` - Último resultado da tarefa atual
 * - `TAG:name` - Busca por tag específica
 *
 * **Transformações suportadas** (|TRANSFORM):
 * - `RAW` - Conteúdo completo sem modificação (padrão)
 * - `SUMMARY` - Resumo truncado (até 2000 chars)
 * - `JSON` - Extrai apenas blocos JSON válidos
 * - `CODE` - Extrai apenas blocos de código
 * - `STATUS` - Metadados de status da tarefa
 * - `ERROR` - Metadados de erro (se houver)
 * - `METRICS` - Métricas de execução
 */
function parseReferences(text) {
    if (!text || typeof text !== 'string' || !text.includes('{{REF:')) {
        return [];
    }

    // Regex robusta para capturar critérios e transformadores opcionais
    const regex = /\{\{REF:([a-zA-Z0-9._\-:]+)(?:\|([a-zA-Z0-9]+))?\}\}/g;

    return Array.from(text.matchAll(regex)).map(match => ({
        fullMatch: match[0], // A tag completa para substituição
        criteria: match[1], // ID, LAST ou TAG:name
        transform: (match[2] || 'RAW').toUpperCase() // Transformador (Default: RAW)
    }));
}

module.exports = { parseReferences };
