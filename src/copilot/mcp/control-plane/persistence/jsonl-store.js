// @ts-check
/**
 * Bound JSONL persistence for MCP control-plane histories.
 *
 * The caller owns grant minting. This helper receives an already-authorized ConfiguredFsIo plus one eagerly-resolved
 * file path, so it cannot mint filesystem authority or redirect operations per call. Append + retention execute under
 * one reentrant configured resource lock to avoid losing concurrent appends during trim rewrites.
 *
 * @module copilot/mcp/control-plane/persistence/jsonl-store
 */

import { parseJsonlTextRecords, trimJsonlTextEntries } from '#copilot/infra/public/persistence/jsonl';
import path from 'node:path';

/** @typedef {ReturnType<typeof import('#copilot/infra/public/composition/filesystem/configured').createConfiguredFsIo>} ConfiguredFsIo */
/** @typedef {'file-and-directory'|'file'|'none'} Durability */

/**
 * @param {{
 *   filePath:string;
 *   io:ConfiguredFsIo;
 *   maxReadBytes:number;
 *   mode?:number;
 *   durability?:Durability;
 * }} options
 */
export function createBoundConfiguredJsonlStore(options) {
    const filePath = path.resolve(String(options.filePath));
    const io = options.io;
    const maxReadBytes = positiveInteger(options.maxReadBytes, 'maxReadBytes');
    const mode = options.mode ?? 0o600;
    const durability = options.durability ?? 'file-and-directory';

    /**
     * @param {unknown} record
     * @param {{maxEntries:number}} retention
     */
    async function appendRecord(record, retention) {
        const maxEntries = positiveInteger(retention.maxEntries, 'maxEntries');
        const line = `${JSON.stringify(record)}\n`;
        return io.withPathLock(
            filePath,
            'append',
            async () => {
                await io.appendText(filePath, line, { mode, durability });
                const snapshot = await io.readTextFresh(filePath);
                const retentionPlan = trimJsonlTextEntries(snapshot.content, maxEntries);
                if (!retentionPlan.trimmed) {
                    return { retainedEntries: retentionPlan.retainedEntries, trimmed: false };
                }
                await io.writeFileAtomic(filePath, retentionPlan.content, { mode, durability });
                return { retainedEntries: retentionPlan.retainedEntries, trimmed: true };
            },
            { riskClass: 'low' },
        );
    }

    /**
     * @param {{maxLines:number;maxBytes?:number}} request
     */
    async function readTail(request) {
        const maxLines = positiveInteger(request.maxLines, 'maxLines');
        const requestedBytes =
            request.maxBytes === undefined ? maxReadBytes : positiveInteger(request.maxBytes, 'maxBytes');
        const boundedBytes = Math.min(requestedBytes, maxReadBytes);
        const snapshot = await io.readBytesRangeFresh(filePath, {
            maxBytes: boundedBytes,
            fromEnd: true,
            rejectSymlink: true,
        });
        let text = snapshot.content.toString('utf8');
        if (snapshot.truncatedBefore) {
            const firstNewline = text.indexOf('\n');
            text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
        }
        const parsed = parseJsonlTextRecords(text);
        return {
            records: [...parsed.records].slice(-maxLines),
            invalidLines: parsed.invalidLines,
            truncatedByByteLimit: snapshot.truncatedBefore,
            fileBytes: snapshot.sizeBytes,
            bytesRead: snapshot.bytesRead,
        };
    }

    return Object.freeze({
        filePath,
        appendRecord,
        readTail,
    });
}

/** @param {unknown} value @param {string} name */
function positiveInteger(value, name) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new TypeError(`${name} must be a positive integer.`);
    return parsed;
}
