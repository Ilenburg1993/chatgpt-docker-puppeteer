/* ==========================================================================
   src/core/context/parsing/ref_parser.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Extração estruturada de intenções {{REF:...}}.
========================================================================== */

/**
 * Varre o texto em busca de referências e retorna uma lista de objetos de intenção.
 * Padrão suportado: {{REF:CRITERIA|TRANSFORM}} ou {{REF:CRITERIA}}
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
