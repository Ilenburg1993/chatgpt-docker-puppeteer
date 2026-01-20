/* ==========================================================================
   src/infra/fs/atomic_write.js
   Audit Level: 100 — Industrial Hardening
   Responsabilidade: Escrita atômica para prevenção de corrupção de dados.
========================================================================== */

const fs = require('fs').promises;
const fss = require('fs');
const crypto = require('crypto');
const { sleep } = require('./fs_utils');

async function atomicWrite(filepath, content) {
    const uuid = crypto.randomBytes(4).toString('hex');
    const tmpPath = `${filepath}.tmp.${process.pid}.${uuid}`;
    
    try {
        // [FIX 1.2] Escrita assíncrona para não bloquear o Event Loop
        await fs.writeFile(tmpPath, content, 'utf-8');

        let attempts = 0;
        while (attempts < 10) {
            try {
                await fs.rename(tmpPath, filepath);
                return true;
            } catch (err) {
                // [FIX 1.4] Suporte a Docker/Volumes (Cross-device link error)
                if (err.code === 'EXDEV') {
                    await fs.copyFile(tmpPath, filepath);
                    await fs.unlink(tmpPath);
                    return true;
                }
                if (err.code === 'EPERM' || err.code === 'EBUSY') {
                    attempts++;
                    await sleep(100 * attempts);
                    continue;
                }
                throw err;
            }
        }
    } catch (err) {
        if (fss.existsSync(tmpPath)) await fs.unlink(tmpPath).catch(() => {});
        throw err;
    }
}

module.exports = { atomicWrite };