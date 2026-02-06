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
    const healed = healTask(raw);
    // Auto-migração transparente V4 → V5
    return migrator.autoMigrateTask(healed);
};

export { DnaSchema, SelectorProtocolSchema, TaskSchema, TaskSchemaV5, BootstrapStateSchema, migrator };
