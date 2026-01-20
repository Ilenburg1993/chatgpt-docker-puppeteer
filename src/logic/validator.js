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