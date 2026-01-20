/* ==========================================================================
   src/core/schemas.js (SHIM)
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Redirecionar chamadas para a nova arquitetura modular.
   Nota: Mantém a compatibilidade com todos os 'requires' existentes no projeto.
========================================================================== */

const schemaCore = require('./schemas/schema_core');

module.exports = {
    // Re-exporta as propriedades principais para manter a assinatura original
    TaskSchema: schemaCore.TaskSchema,
    DnaSchema: schemaCore.DnaSchema,
    parseTask: schemaCore.parseTask,
    
    // Expõe o acesso ao núcleo completo para novos módulos
    core: schemaCore
};