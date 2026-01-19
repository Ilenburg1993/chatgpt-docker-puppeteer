FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\core\memory.js
PASTA_BASE: core
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/core/memory.js (SHIM)
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Redirecionar chamadas legadas para o novo Context Engine.
   Nota: Este arquivo será mantido até que todos os 'requires' sejam 
         atualizados para './context/context_core'.
========================================================================== */

const contextCore = require('./context/context_core');

module.exports = {
    // Redireciona a chamada para a nova arquitetura modular
    resolveContext: contextCore.resolveContext
};