/* ==========================================================================
   src/core/context/transformers/identity.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Retorno do conteúdo original sem modificações.
========================================================================== */

module.exports = (content) => (content || '').trim();