// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as shared from './shared_types.js';
import { DnaSchema, SelectorProtocolSchema } from './dna_schema.js';
import { TaskSchema } from './task_schema.js';
import { TaskSchemaV5 } from './task_schema_v5.js';
import { healTask } from './task_healer.js';
import { BootstrapStateSchema } from './bootstrap_state_schema.js';
import * as migrator from './migrator_v4_to_v5.js';

export const types = {
    ID: shared.ID_SCHEMA,
    Timestamp: shared.TIMESTAMP_SCHEMA,
    Status: shared.STATUS_SCHEMA,
    Source: shared.SOURCE_SCHEMA,
    Priority: shared.PRIORITY_SCHEMA,
};

export const parseTask = raw => {
    // V5-safe: never "heal" a declared V5 task back into V4.
    if (raw?.meta?.version === '5.0') {
        return TaskSchemaV5.parse(raw);
    }

    // Best-effort: if the structure looks like V5 but version is missing, try
    // to validate as V5 before falling back to legacy healer+migrator.
    const looksLikeV5 = Boolean(raw?.execution || raw?.mission || raw?.spec?.execution);
    if (looksLikeV5 && raw && typeof raw === 'object') {
        try {
            const patched = {
                ...raw,
                meta: {
                    ...(raw.meta || {}),
                    version: '5.0',
                },
            };
            return TaskSchemaV5.parse(patched);
        } catch (_) {
            // fallback below
        }
    }

    const healed = healTask(raw);
    // Auto-migração transparente V4 → V5
    return migrator.autoMigrateTask(healed);
};

export { DnaSchema, SelectorProtocolSchema, TaskSchema, TaskSchemaV5, BootstrapStateSchema, migrator };
