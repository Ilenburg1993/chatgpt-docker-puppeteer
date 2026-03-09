// @ts-check - Type checking rigoroso habilitado (arquivo core)
import fss, { promises as fs } from 'node:fs';
import path from 'node:path';
import { CORRUPT, MAX_JSON_SIZE, sleep } from './fs_utils.js';

/**
 * Lê um JSON do disco com proteção contra corrupção e travamentos de arquivo. Utiliza loop iterativo em vez de recursão
 * para prevenir Stack Overflow.
 *
 * @param {any} filepath
 * @returns {Promise<unknown>}
 */
async function safeReadJSON(filepath) {
    if (!fss.existsSync(filepath)) {
        return null;
    }

    let attempts = 0;
    while (attempts < 5) {
        try {
            const stats = await fs.stat(filepath);
            if (stats.size > MAX_JSON_SIZE) {
                throw new Error('FILE_TOO_LARGE');
            }

            const content = await fs.readFile(filepath, 'utf-8');
            if (!content.trim()) {
                throw new Error('EMPTY_FILE');
            }

            return JSON.parse(content);
        } catch (/** @type {any} */ readErr) {
            // Tratamento de concorrência (Arquivo sendo escrito ou indexado pelo SO)
            const re = /** @type {any} */ (readErr);
            if (re.code === 'EBUSY' || re.code === 'EPERM') {
                attempts++;
                await sleep(200 * attempts);
                continue; // Tenta novamente no próximo ciclo do loop
            }

            // Tratamento de integridade (JSON malformado, gigante, ou vazio)
            const fileName = path.basename(filepath);
            const errorType = re.message || 'UNKNOWN';
            const isJSONError = re instanceof SyntaxError || errorType.includes('JSON');
            const isIntegrityError = errorType === 'FILE_TOO_LARGE' || errorType === 'EMPTY_FILE';

            // Log detalhado do erro
            if (isJSONError) {
                console.error(`[FS] JSON corrupted: ${fileName} - ${errorType} (quarantining)`);
            } else if (isIntegrityError) {
                console.warn(`[FS] File integrity issue: ${fileName} - ${errorType} (quarantining)`);
            } else {
                console.error(`[FS] Read error: ${fileName} - ${errorType} (quarantining)`);
            }

            // Quarentena: move para pasta CORRUPT com timestamp
            const badFile = path.join(CORRUPT, `${fileName}.${Date.now()}.bad`);

            try {
                await fs.rename(filepath, badFile);
                console.error(`[FS] ✅ Quarantine successful: ${fileName} → ${path.basename(badFile)}`);
            } catch (/** @type {any} */ renameErr) {
                console.error(
                    `[FS] ❌ Quarantine failed: ${/** @type {any} */ (renameErr).message} - attempting deletion`,
                );
                // Fallback: Se não puder mover, tenta deletar para não travar o sistema
                try {
                    await fs.unlink(filepath);
                    console.error(`[FS] ✅ Deleted corrupted file: ${fileName}`);
                } catch (/** @type {any} */ unlinkErr) {
                    console.error(
                        `[FS] ❌ Cannot delete corrupted file: ${fileName} - ${/** @type {any} */ (unlinkErr).message}`,
                    );
                }
            }
            return null;
        }
    }
    return null;
}

export { safeReadJSON };
