// @ts-check
import { BootstrapStateSchema } from './bootstrap_state_schema.js';
import { DnaSchema, SelectorProtocolSchema } from './dna_schema.js';
import * as migrator from './migrator_v4_to_v5.js';
import * as shared from './shared_types.js';
import { healTask } from './task_healer.js';
import { TaskSchema } from './task_schema.js';
import { TaskSchemaV5 } from './task_schema_v5.js';
import { asRecord } from '#types/guards';

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
 * @returns {any} Tarefa validada e migrada para V5.
 * @throws {Error} Se a validação falhar após tentativas de migração.
 */
export const parseTask = raw => {
    const r = asRecord(raw);
    const rMeta = asRecord(r.meta);
    const rSpec = asRecord(r.spec);
    // V5-safe: never "heal" a declared V5 task back into V4.
    if (rMeta.version === '5.0') {
        return TaskSchemaV5.parse(r);
    }

    // Best-effort: if the structure looks like V5 but version is missing, try
    // to validate as V5 before falling back to legacy healer+migrator.
    const looksLikeV5 = Boolean(r.execution || r.mission || rSpec.execution);
    if (looksLikeV5 && r && typeof r === 'object') {
        try {
            const patched = {
                ...r,
                meta: {
                    ...rMeta,
                    version: '5.0',
                },
            };
            return TaskSchemaV5.parse(patched);
        } catch (/** @type {any} */ _) {
            // fallback below
        }
    }

    const healed = healTask(r);
    // Auto-migração transparente V4 → V5
    return migrator.autoMigrateTask(healed);
};

/**
 * Barrel canônico de schemas/artefatos de migração usados pelo núcleo.
 */
export { BootstrapStateSchema, DnaSchema, migrator, SelectorProtocolSchema, TaskSchema, TaskSchemaV5 };
