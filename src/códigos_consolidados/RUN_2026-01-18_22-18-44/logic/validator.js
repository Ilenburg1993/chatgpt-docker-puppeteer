FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\logic\validator.js
PASTA_BASE: logic
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/logic/validator.js (SHIM)
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Redirecionar chamadas para o novo sistema de validação.
========================================================================== */

const core = require('./validation/validation_core');

module.exports = {
    /**
     * Ponto de entrada único e compatível com versões anteriores.
     */
    validateTaskResult: core.validateTaskResult
};