// @ts-check
/** Bounded transactionally-consistent startup replay over the invalidation journal. */

import { runRequiredSqliteTransaction } from '#copilot/infra/internal/database/transaction/required';
import {
    CROSS_PROCESS_INVALIDATION_TABLE,
    ensureJournalSchema,
    normalizeNonNegativeInteger,
    readSequence,
    readSequenceValue,
} from '../cross-process/index.js';

/** @typedef {{ sequence:number; processInstance:string; filePath:string; recursive:number; source:string; createdAtMs:number }} CrossProcessInvalidationRow */
const DEFAULT_REPLAY_ROWS = 256;

/**
 * Read a bounded, transactionally consistent journal window for startup replay.
 *
 * This does not mutate the runtime consumer cursor. It is a checkpoint/recovery primitive only: callers must still
 * combine the result with Git/filesystem evidence and fail closed when `gapDetected` or `truncated` is true.
 *
 * @param {{
 *     afterSequence?: number;
 *     maxRows?: number;
 *     db: import('#copilot/infra/internal/database/port').SqliteDatabasePort;
 * }} options
 */
export function readCrossProcessInvalidationReplay(options) {
    if (!options?.db) throw new TypeError('readCrossProcessInvalidationReplay requires an explicit SQLite database.');
    const afterSequence = normalizeNonNegativeInteger(options.afterSequence, 0);
    const maxRows = Math.min(10_000, Math.max(1, normalizeNonNegativeInteger(options.maxRows, DEFAULT_REPLAY_ROWS)));
    try {
        const db = options.db;
        ensureJournalSchema(db);
        const readSnapshot = () =>
            runRequiredSqliteTransaction(db, () => {
                const bounds = /** @type {{ earliestSequence?: unknown; latestRowSequence?: unknown }} */ (
                    db
                        .prepare(
                            `
                        SELECT
                            COALESCE(MIN(sequence), 0) AS earliestSequence,
                            COALESCE(MAX(sequence), 0) AS latestRowSequence
                        FROM ${CROSS_PROCESS_INVALIDATION_TABLE}
                    `,
                        )
                        .get()
                );
                const issued = /** @type {{ sequence?: unknown } | undefined} */ (
                    db
                        .prepare('SELECT seq AS sequence FROM sqlite_sequence WHERE name = ?')
                        .get(CROSS_PROCESS_INVALIDATION_TABLE)
                );
                const earliestSequence = readSequenceValue(bounds.earliestSequence);
                const highWatermark = Math.max(readSequenceValue(bounds.latestRowSequence), readSequence(issued));
                const rows = /** @type {CrossProcessInvalidationRow[]} */ (
                    db
                        .prepare(
                            `
                        SELECT
                            sequence,
                            process_instance AS processInstance,
                            file_path AS filePath,
                            recursive,
                            source,
                            created_at_ms AS createdAtMs
                        FROM ${CROSS_PROCESS_INVALIDATION_TABLE}
                        WHERE sequence > ? AND sequence <= ?
                        ORDER BY sequence ASC
                        LIMIT ?
                    `,
                        )
                        .all(afterSequence, highWatermark, maxRows + 1)
                );
                const truncated = rows.length > maxRows;
                const boundedRows = truncated ? rows.slice(0, maxRows) : rows;
                let gapDetected = false;
                let expectedSequence = afterSequence + 1;
                if (afterSequence > highWatermark) gapDetected = true;
                for (const row of boundedRows) {
                    const sequence = Number(row.sequence);
                    if (sequence !== expectedSequence) gapDetected = true;
                    expectedSequence = sequence + 1;
                }
                if (highWatermark > afterSequence && boundedRows.length === 0) gapDetected = true;
                if (
                    !truncated &&
                    boundedRows.length > 0 &&
                    Number(boundedRows.at(-1)?.sequence ?? 0) !== highWatermark
                ) {
                    gapDetected = true;
                }
                return {
                    available: true,
                    afterSequence,
                    earliestSequence,
                    highWatermark,
                    rows: boundedRows,
                    rowCount: boundedRows.length,
                    gapDetected,
                    truncated,
                    error: null,
                };
            });
        return readSnapshot();
    } catch (error) {
        return {
            available: false,
            afterSequence,
            earliestSequence: 0,
            highWatermark: afterSequence,
            rows: /** @type {CrossProcessInvalidationRow[]} */ ([]),
            rowCount: 0,
            gapDetected: true,
            truncated: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
