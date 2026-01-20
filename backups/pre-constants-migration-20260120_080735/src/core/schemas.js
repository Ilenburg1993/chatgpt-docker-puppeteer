/* ==========================================================================
   src/core/schemas.js (SHIM)
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Redirecionar chamadas para a nova arquitetura modular.
   Nota: Mantém a compatibilidade com todos os 'requires' existentes no projeto.
========================================================================== */

const schemaCore = require('./schemas/schema_core');

/**
 * @module schemas
 * @description Facade de compatibilidade para schemas Zod.
 * Re-exporta schemas de validação para tasks, DNA e configurações.
 *
 * @property {import('zod').ZodSchema} TaskSchema - Schema de validação para tarefas
 * @property {import('zod').ZodSchema} DnaSchema - Schema de validação para regras DNA
 * @property {Function} parseTask - Parser seguro de tasks com validação Zod
 * @property {Object} core - Acesso direto ao módulo schema_core
 *
 * @example
 * const { parseTask } = require('./core/schemas');
 * const task = parseTask(rawTaskData);
 */
module.exports = {
    // Re-exporta as propriedades principais para manter a assinatura original
    TaskSchema: schemaCore.TaskSchema,
    DnaSchema: schemaCore.DnaSchema,
    parseTask: schemaCore.parseTask,

    // Expõe o acesso ao núcleo completo para novos módulos
    core: schemaCore
};
