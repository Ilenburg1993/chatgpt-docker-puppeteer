// @ts-check
/** Physical CR/LF/CRLF byte scanner shared by streaming reads and progressive indexes. */

/**
 * Scan physical line starts in one byte buffer while preserving CRLF/bare-CR semantics across chunk boundaries.
 * `onLineStart` may stop scanning as soon as a requested line boundary is known, allowing the progressive index to
 * retain its bounded-read behavior without maintaining a second delimiter scanner.
 *
 * @param {Buffer} buf
 * @param {number} chunkFileStart
 * @param {number | null} pendingCrOffset
 * @param {(lineStart: number) => boolean | void} onLineStart
 * @returns {{ pendingCrOffset: number | null; consumedBytes: number; stopped: boolean }}
 */
export function scanPhysicalLineStartsFromBuffer(buf, chunkFileStart, pendingCrOffset, onLineStart) {
    let searchIndex = 0;
    let pendingCr = pendingCrOffset;
    /** @param {number} lineStart @param {number} consumedBytes */
    const emit = (lineStart, consumedBytes) => ({
        stopped: onLineStart(lineStart) === true,
        consumedBytes,
    });

    if (pendingCr !== null && buf.byteLength > 0) {
        if (buf[0] === 0x0a) {
            const emitted = emit(chunkFileStart + 1, 1);
            pendingCr = null;
            searchIndex = 1;
            if (emitted.stopped) return { pendingCrOffset: null, consumedBytes: emitted.consumedBytes, stopped: true };
        } else {
            const emitted = emit(pendingCr + 1, 0);
            pendingCr = null;
            if (emitted.stopped) return { pendingCrOffset: null, consumedBytes: emitted.consumedBytes, stopped: true };
        }
    }
    if (searchIndex >= buf.byteLength) {
        return { pendingCrOffset: pendingCr, consumedBytes: searchIndex, stopped: false };
    }

    if (buf.indexOf(0x0d, searchIndex) === -1) {
        let lfIndex = buf.indexOf(0x0a, searchIndex);
        while (lfIndex !== -1) {
            searchIndex = lfIndex + 1;
            const emitted = emit(chunkFileStart + searchIndex, searchIndex);
            if (emitted.stopped) return { pendingCrOffset: null, consumedBytes: emitted.consumedBytes, stopped: true };
            lfIndex = buf.indexOf(0x0a, searchIndex);
        }
        return { pendingCrOffset: null, consumedBytes: buf.byteLength, stopped: false };
    }

    while (searchIndex < buf.byteLength) {
        const crIndex = buf.indexOf(0x0d, searchIndex);
        const lfIndex = buf.indexOf(0x0a, searchIndex);
        if (crIndex === -1 && lfIndex === -1) {
            return { pendingCrOffset: null, consumedBytes: buf.byteLength, stopped: false };
        }
        if (lfIndex !== -1 && (crIndex === -1 || lfIndex < crIndex)) {
            searchIndex = lfIndex + 1;
            const emitted = emit(chunkFileStart + searchIndex, searchIndex);
            if (emitted.stopped) return { pendingCrOffset: null, consumedBytes: emitted.consumedBytes, stopped: true };
            continue;
        }
        if (crIndex + 1 >= buf.byteLength) {
            return {
                pendingCrOffset: chunkFileStart + crIndex,
                consumedBytes: buf.byteLength,
                stopped: false,
            };
        }
        searchIndex = buf[crIndex + 1] === 0x0a ? crIndex + 2 : crIndex + 1;
        const emitted = emit(chunkFileStart + searchIndex, searchIndex);
        if (emitted.stopped) return { pendingCrOffset: null, consumedBytes: emitted.consumedBytes, stopped: true };
    }
    return { pendingCrOffset: null, consumedBytes: buf.byteLength, stopped: false };
}

/**
 * Extend byte-line starts from bytes that were already read for another purpose. This adapter deliberately delegates to
 * the same delimiter scanner used by the progressive index builder.
 *
 * @param {Buffer} buf
 * @param {number} chunkFileStart
 * @param {number[]} lineStarts
 * @param {number | null} pendingCrOffset
 * @returns {number | null}
 */
export function appendPhysicalLineStartsFromBuffer(buf, chunkFileStart, lineStarts, pendingCrOffset) {
    return scanPhysicalLineStartsFromBuffer(buf, chunkFileStart, pendingCrOffset, (lineStart) => {
        lineStarts.push(lineStart);
    }).pendingCrOffset;
}
