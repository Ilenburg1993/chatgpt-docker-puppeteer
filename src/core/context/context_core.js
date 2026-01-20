/* ==========================================================================
   src/core/context/context_core.js
   Audit Level: 100 — Industrial Hardening (Unified Facade)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Ponto de entrada único para o motor de contexto.
                     Expõe a funcionalidade de resolução para o sistema.
   Sincronizado com: context_engine.js (V1.0).
========================================================================== */

const engine = require('./engine/context_engine');

module.exports = {
    /**
     * resolveContext: Resolve referências {{REF:...}} de forma recursiva.
     * Mantém a assinatura compatível com o contrato original.
     */
    resolveContext: engine.resolveContext
};