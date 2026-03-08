// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as schemaCore from './schemas/schema_core.js';

/**
 * Schema Zod para validação de tarefas (versão atual). Define estrutura e regras para objetos de tarefa válidos.
 */
export const TaskSchema = schemaCore.TaskSchema;

/**
 * Schema Zod para validação de DNA de missão. Define estrutura e regras para configurações de DNA.
 */
export const DnaSchema = schemaCore.DnaSchema;

/**
 * Função de parsing e migração de tarefas. Side-effects: Pode modificar objetos raw durante migração V4→V5.
 *
 * @param {Record<string, unknown>} raw - Objeto raw da tarefa.
 * @returns {any} Tarefa validada e migrada.
 * @throws {Error} Se parsing ou migração falhar.
 */
export const parseTask = schemaCore.parseTask;

/**
 * Módulo core de schemas para acesso avançado. Contém funções utilitárias e schemas internos.
 */
export { schemaCore as core };
