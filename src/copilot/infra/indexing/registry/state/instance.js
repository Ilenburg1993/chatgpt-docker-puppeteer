// @ts-check
/** Lazy process-local index instance backed by the injected infra SQLite provider. */

import { getInfraSqliteDatabase } from '#copilot/infra/internal/database';
import { createIoIndexSqlite } from '../sqlite/index.js';

/** @type {ReturnType<typeof createIoIndexSqlite> | null} */
let ioIndex = null;

export function isIoIndexDisabled() {
    return String(process.env['IO_INDEX_ENABLED'] ?? '1').trim() === '0';
}

export function getIoIndexInstance() {
    if (isIoIndexDisabled()) return null;
    if (ioIndex) return ioIndex;
    try {
        ioIndex = createIoIndexSqlite({ db: getInfraSqliteDatabase() });
        return ioIndex;
    } catch {
        return null;
    }
}

export function resetIoIndexInstanceForTest() {
    ioIndex = null;
}
