/* ==========================================================================
   src/orchestrator/index.js
   Audit Level: 100 — Orchestrator Module Exports
   Status: PRODUCTION READY
   Responsabilidade: Ponto de entrada único para o módulo Orchestrator.
========================================================================== */

const { OrchestratorEngine } = require('./orchestrator_engine');
const { ValidationService } = require('./validation/validation_service');

module.exports = {
    OrchestratorEngine,
    ValidationService
};
