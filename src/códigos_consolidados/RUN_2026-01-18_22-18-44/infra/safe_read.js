FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\infra\fs\safe_read.js
PASTA_BASE: infra
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/infra/fs/safe_read.js
   Audit Level: 100 — Industrial Hardening (Iterative Resilience)
   Status: CONSOLIDATED (Protocol 11)
========================================================================== */

const fs = require('fs').promises;
const fss = require('fs');
const path = require('path');
const { CORRUPT_DIR, MAX_JSON_SIZE, sleep } = require('./fs_utils');

/**
 * Lê um JSON do disco com proteção contra corrupção e travamentos de arquivo.
 * Utiliza loop iterativo em vez de recursão para prevenir Stack Overflow.
 */
async function safeReadJSON(filepath) {
    if (!fss.existsSync(filepath)) return null;

    let attempts = 0;
    while (attempts < 5) {
        try {
            const stats = await fs.stat(filepath);
            if (stats.size > MAX_JSON_SIZE) throw new Error('FILE_TOO_LARGE');

            const content = await fs.readFile(filepath, 'utf-8');
            if (!content.trim()) throw new Error('EMPTY_FILE');
            
            return JSON.parse(content);

        } catch (readErr) {
            // Tratamento de concorrência (Arquivo sendo escrito ou indexado pelo SO)
            if (readErr.code === 'EBUSY' || readErr.code === 'EPERM') {
                attempts++;
                await sleep(200 * attempts);
                continue; // Tenta novamente no próximo ciclo do loop
            }

            // Tratamento de integridade (JSON malformado ou gigante)
            const fileName = path.basename(filepath);
            const badFile = path.join(CORRUPT_DIR, `${fileName}.${Date.now()}.bad`);
            
            try {
                await fs.rename(filepath, badFile);
                console.error(`[FS] Quarentena: ${fileName} isolado por erro de integridade.`);
            } catch (moveErr) {
                // Fallback: Se não puder mover, tenta deletar para não travar o sistema
                await fs.unlink(filepath).catch(() => {});
            }
            return null;
        }
    }
    return null;
}

module.exports = { safeReadJSON };