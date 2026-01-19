FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\core\context\extractors\code_logic.js
PASTA_BASE: core
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/core/context/extractors/code_logic.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Extração de blocos delimitados por triple backticks.
========================================================================== */

/**
 * Extrai todos os blocos de código de uma resposta.
 * @param {string} content - Texto bruto.
 * @returns {string} Blocos concatenados.
 */
function extractCodeBlocks(content) {
    if (!content) return "[Nenhum código detectado]";
    
    const regex = /```[\s\S]*?```/g;
    const matches = content.match(regex);
    
    if (!matches || matches.length === 0) return "[Nenhum bloco de código detectado]";
    
    return matches.join('\n\n').trim();
}

module.exports = { extractCodeBlocks };