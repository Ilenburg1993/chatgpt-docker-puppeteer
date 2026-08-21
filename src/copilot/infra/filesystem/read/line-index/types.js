// @ts-check
/** JSDoc-only contracts for the progressive byte-line index. */

/**
 * @typedef {{
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     ctimeMs: number;
 *     dev: number;
 *     ino: number;
 *     snapshotVersion: string;
 *     lineStarts: number[];
 *     totalLines: number | null;
 *     complete: boolean;
 *     scannedBytes: number;
 *     builtAtMs: number;
 * }} ByteLineIndexEntry
 *
 * @typedef {{
 *     entry: ByteLineIndexEntry;
 *     indexBytesRead: number;
 *     cacheState: 'hit' | 'build' | 'extend';
 *     capturedRange?: Buffer;
 *     capturedStartByte?: number;
 *     capturedEndByte?: number;
 * }} ByteLineIndexLookup
 */
export {};
