// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as schemaCore from './schemas/schema_core.js';

export const TaskSchema = schemaCore.TaskSchema;
export const DnaSchema = schemaCore.DnaSchema;
export const parseTask = schemaCore.parseTask;
export { schemaCore as core };
