FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\core\context\limits\guardrails.js
PASTA_BASE: core
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/core/context/limits/guardrails.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Controle de profundidade de resolução.
========================================================================== */

const MAX_RECURSION_DEPTH = 3;

/**
 * Valida se a profundidade atual é segura.
 * @param {number} depth - Nível atual de recursão.
 */
function assertSafetyDepth(depth) {
    if (depth > MAX_RECURSION_DEPTH) {
        throw new Error(`RECURSION_LIMIT_EXCEEDED: Profundidade ${depth} excede o limite de segurança.`);
    }
    return true;
}

module.exports = { assertSafetyDepth, MAX_RECURSION_DEPTH };