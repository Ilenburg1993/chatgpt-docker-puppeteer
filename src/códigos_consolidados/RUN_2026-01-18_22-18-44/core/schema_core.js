FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\core\schemas\schema_core.js
PASTA_BASE: core
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/core/schemas/schema_core.js
   Audit Level: 100 — Industrial Hardening (Unified Genomic Facade)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Ponto de entrada único para todos os contratos de dados.
                     Unifica tipos, DNA e o motor de cura de tarefas.
========================================================================== */

const shared = require('./shared_types');
const { DnaSchema, SelectorProtocolSchema } = require('./dna_schema');
const { TaskSchema } = require('./task_schema');
const { healTask } = require('./task_healer');
const { BootstrapStateSchema } = require('./bootstrap_state_schema');

module.exports = {
    // 1. Tipos Primitivos e Utilitários
    types: {
        ID: shared.ID_SCHEMA,
        Timestamp: shared.TIMESTAMP_SCHEMA,
        Status: shared.STATUS_SCHEMA,
        Source: shared.SOURCE_SCHEMA,
        Priority: shared.PRIORITY_SCHEMA
    },

    // 2. Contratos de Percepção (DNA)
    DnaSchema,
    SelectorProtocolSchema,

    // 3. Contratos de Missão (Tasks)
    TaskSchema,

    // 4. Contratos de Bootstrap / Infra
    BootstrapStateSchema,
    
    /**
     * parseTask: O ponto de entrada oficial para novas tarefas.
     * Utiliza o motor de cura para garantir compatibilidade e integridade.
     */
    parseTask: (raw) => healTask(raw)
};