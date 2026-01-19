FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\core\context\transformers\identity.js
PASTA_BASE: core
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/core/context/transformers/identity.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Retorno do conteúdo original sem modificações.
========================================================================== */

module.exports = (content) => (content || "").trim();