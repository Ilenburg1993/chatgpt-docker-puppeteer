// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { BootstrapStateSchema } from './bootstrap_state_schema.js';
import { DnaSchema, SelectorProtocolSchema } from './dna_schema.js';
import * as migrator from './migrator_v4_to_v5.js';
import * as shared from './shared_types.js';
import { healTask } from './task_healer.js';
import { TaskSchema } from './task_schema.js';
import { TaskSchemaV5 } from './task_schema_v5.js';

/**
 * Objeto com tipos/schemas compartilhados para validação.
 */
export const types = {
    ID: shared.ID_SCHEMA,
    Timestamp: shared.TIMESTAMP_SCHEMA,
    Status: shared.STATUS_SCHEMA,
    Source: shared.SOURCE_SCHEMA,
    Priority: shared.PRIORITY_SCHEMA,
};

/**
 * Parseia e valida uma tarefa raw, aplicando migração automática V4 → V5 se necessário.
 * Side-effects: Validação rigorosa, migração transparente de versões antigas.
 * @param {Record<string, unknown>} raw - Dados raw da tarefa.
 * @returns {Record<string, unknown>} Tarefa validada e migrada para V5.
 * @throws {Error} Se a validação falhar após tentativas de migração.
 */
export const parseTask = raw => {
    /** @type {any} */
    const r = raw;
    // V5-safe: never "heal" a declared V5 task back into V4.
    if (r?.meta?.version === '5.0') {
        return TaskSchemaV5.parse(r);
    }

    // Best-effort: if the structure looks like V5 but version is missing, try
    // to validate as V5 before falling back to legacy healer+migrator.
    const looksLikeV5 = Boolean(r?.execution || r?.mission || r?.spec?.execution);
    if (looksLikeV5 && r && typeof r === 'object') {
        try {
            const patched = {
                ...r,
                meta: {
                    ...(r.meta || {}),
                    version: '5.0',
                },
            };
            return TaskSchemaV5.parse(patched);
        } catch (_) {
            // fallback below
        }
    }

    const healed = healTask(r);
    // Auto-migração transparente V4 → V5
    return migrator.autoMigrateTask(healed);
};;

export { BootstrapStateSchema, DnaSchema, migrator, SelectorProtocolSchema, TaskSchema, TaskSchemaV5 };
