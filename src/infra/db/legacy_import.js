// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import * as PATHS from '#infra/fs/paths';
import { log } from '#core/logger';
import { insertTask, TASK_STAGES } from './task_repo.js';

async function _listLegacyQueueFiles() {
    try {
        const files = await fsp.readdir(PATHS.QUEUE);
        return files.filter(f => f.endsWith('.json')).map(f => path.join(PATHS.QUEUE, f));
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return [];
        }
        throw err;
    }
}

/** Função exportada: importLegacyQueueFromDisk. */
async function importLegacyQueueFromDisk({ limit = 100000 } = {}) {
    const files = await _listLegacyQueueFiles();
    if (files.length === 0) {
        return { scanned: 0, imported: 0, skipped: 0, failed: 0 };
    }

    const max = Math.max(1, Math.min(Number(limit) || 100000, 500000));
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    const toScan = files.slice(0, max);
    for (const filePath of toScan) {
        try {
            const raw = await fsp.readFile(filePath, 'utf-8');
            const task = JSON.parse(raw);

            const status = String(task?.state?.status || task?.status || 'PENDING')
                .toUpperCase()
                .trim();
            const stage = status === 'DONE' ? TASK_STAGES.ARCHIVED : TASK_STAGES.READY;

            const created = insertTask(task, { stage, status, actor: 'system', ifNotExists: true });
            if (created) {
                // ifNotExists returns existing too; assume imported when row didn't exist is not observable here.
                // We approximate by counting "not failed" as imported.
                imported++;
            } else {
                skipped++;
            }
        } catch (err) {
            failed++;
            log(
                'WARN',
                `[DB] Legacy queue import failed for ${path.basename(filePath)}: ${err?.message || String(err)}`
            );
        }
    }

    log('INFO', `[DB] Legacy queue import done: scanned=${toScan.length}, imported~=${imported}, failed=${failed}`);
    return { scanned: toScan.length, imported, skipped, failed };
}

export { importLegacyQueueFromDisk };
