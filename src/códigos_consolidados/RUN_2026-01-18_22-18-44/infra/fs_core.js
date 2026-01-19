FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\infra\fs\fs_core.js
PASTA_BASE: infra
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/infra/fs/fs_core.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Ponto de entrada unificado para operações de arquivo.
========================================================================== */

const utils = require('./fs_utils');
const { atomicWrite } = require('./atomic_write');
const { safeReadJSON } = require('./safe_read');

// Garante que as pastas básicas existam no momento que o módulo é carregado
utils.ensureInfrastructure();

module.exports = {
    ...utils,
    atomicWrite,
    safeReadJSON
};