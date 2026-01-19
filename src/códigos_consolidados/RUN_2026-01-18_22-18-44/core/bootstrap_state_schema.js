FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\core\schemas\bootstrap_state_schema.js
PASTA_BASE: core
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/core/schemas/bootstrap_state_schema.js
   Audit Level: 100 — Bootstrap State Contract
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade: Definir o contrato estrito do estado de bootstrap
                     persistido em estado.json.
========================================================================== */

const { z } = require('zod');
const { TIMESTAMP_SCHEMA } = require('./shared_types');

const BootstrapStateSchema = z.object({
    server_port: z.number().int().min(1).max(65535),
    server_pid: z.number().int().min(1),
    server_started_at: TIMESTAMP_SCHEMA,
    server_version: z.string().regex(/^V[0-9]+$/),
    protocol: z.number().int().min(1),
    mode: z.enum(['normal', 'degraded', 'maintenance'])
}).strict(); // <-- PROIBIÇÃO DE CAMPOS EXTRAS

module.exports = {
    BootstrapStateSchema
};
