// @ts-check

import {
    classifyJsonlTrailingCandidate,
    parseJsonlTailChunks,
    parseJsonlTextRecords,
    resolveJsonlRepairPolicy,
    trimJsonlTextEntries,
} from '#copilot/infra/internal/persistence/jsonl';
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';

describe('JSONL pure kernel', () => {
    it('plans retention without filesystem authority and preserves the newest bounded records', () => {
        const plan = trimJsonlTextEntries('{"id":1}\n\n{"id":2}\r\n{"id":3}\n', 2);
        expect(plan).toEqual({
            content: '{"id":2}\n{"id":3}\n',
            originalEntries: 3,
            retainedEntries: 2,
            trimmed: true,
        });
        expect(Object.isFrozen(plan)).toBe(true);

        expect(trimJsonlTextEntries('{"id":1}\n', 2)).toEqual({
            content: '{"id":1}\n',
            originalEntries: 1,
            retainedEntries: 1,
            trimmed: false,
        });
    });

    it('parses complete JSONL text while accounting for invalid non-empty records', () => {
        const parsed = parseJsonlTextRecords('{"id":1}\ninvalid\n\n{"id":2}\n');
        expect(parsed.records).toEqual([{ id: 1 }, { id: 2 }]);
        expect(parsed.invalidLines).toBe(1);
        expect(Object.isFrozen(parsed.records)).toBe(true);
    });

    it('discards a byte-window leading partial and marks only an unterminated invalid newest record as trailing partial', () => {
        const parsed = parseJsonlTailChunks([Buffer.from('partial-prefix\n{"id":2}\n{"broken":', 'utf8')], {
            maxLines: 10,
            truncatedBefore: true,
            hasTrailingNewline: false,
        });
        expect(parsed.records).toEqual([{ id: 2 }]);
        expect(parsed.invalidLines).toBe(1);
        expect(parsed.trailingPartialIgnored).toBe(true);
    });

    it('preserves chronological parsing when one record spans multiple reverse-read chunks', () => {
        const parsed = parseJsonlTailChunks(
            [Buffer.from('{"id":1,"name":"al', 'utf8'), Buffer.from('pha"}\n{"id":2}\n', 'utf8')],
            { maxLines: 10, truncatedBefore: false, hasTrailingNewline: true },
        );
        expect(parsed).toMatchObject({ records: [{ id: 1, name: 'alpha' }, { id: 2 }], invalidLines: 0 });
    });

    it('classifies bounded trailing repair without mutation authority', () => {
        const policy = resolveJsonlRepairPolicy({ maxTrailingRecordBytes: 1_024, maxRepairScanBytes: 8_192 });
        expect(policy).toEqual({ maxTrailingRecordBytes: 1_024, maxRepairScanBytes: 8_192 });

        const validLargeAfterNewline = Buffer.from(JSON.stringify({ payload: 'x'.repeat(4_096) }), 'utf8');
        expect(
            classifyJsonlTrailingCandidate({
                recordStart: 10,
                size: 10 + validLargeAfterNewline.byteLength,
                maxTrailingRecordBytes: 1_024,
                recordBuffer: validLargeAfterNewline,
            }),
        ).toEqual({ reason: 'valid-trailing-record', finalBytes: 10 + validLargeAfterNewline.byteLength });

        const invalid = Buffer.from('{"broken":', 'utf8');
        expect(
            classifyJsonlTrailingCandidate({
                recordStart: 12,
                size: 12 + invalid.byteLength,
                maxTrailingRecordBytes: 1_024,
                recordBuffer: invalid,
            }),
        ).toEqual({ reason: 'invalid-trailing-partial', finalBytes: 12 });

        expect(
            classifyJsonlTrailingCandidate({
                recordStart: 0,
                size: 4_096,
                maxTrailingRecordBytes: 1_024,
                recordBuffer: null,
            }),
        ).toEqual({ reason: 'trailing-record-too-large', finalBytes: 4_096 });
    });
});
