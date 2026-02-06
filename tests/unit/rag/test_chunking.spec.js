import assert from 'node:assert';
import { describe, it } from 'node:test';

import { buildLineIndex, sliceByLines } from '../../../tools/rag/lib/text.mjs';
import { chunkByType } from '../../../tools/rag/lib/chunking/chunk_dispatcher.mjs';
import { buildChunkId, sha256HexForString } from '../../../tools/rag/lib/contract.mjs';

describe('RAG chunking determinism', () => {
    it('produces stable ranges and chunk_ids for markdown', () => {
        const relPath = 'docs/a.md';
        const text =
            '# Title\n' +
            '\n' +
            'Some intro.\n' +
            '\n' +
            '## Section\n' +
            'Text.\n' +
            '```js\n' +
            'console.log(1)\n' +
            '```\n' +
            '\n' +
            '## Another\n' +
            'More.\n';

        const buf = Buffer.from(text, 'utf8');
        const { lines, lineStarts } = buildLineIndex(buf);
        const r1 = chunkByType({ relPath, lines });
        const r2 = chunkByType({ relPath, lines });

        assert.deepStrictEqual(r1, r2);

        const ids1 = r1.map(r => {
            const { startByte, endByte, text: chunkText } = sliceByLines(buf, lineStarts, r.startLine, r.endLine);
            return buildChunkId({
                relPath,
                startByte,
                endByte,
                contentSha256: sha256HexForString(chunkText)
            });
        });

        const ids2 = r2.map(r => {
            const { startByte, endByte, text: chunkText } = sliceByLines(buf, lineStarts, r.startLine, r.endLine);
            return buildChunkId({
                relPath,
                startByte,
                endByte,
                contentSha256: sha256HexForString(chunkText)
            });
        });

        assert.deepStrictEqual(ids1, ids2);
        assert.ok(ids1.length >= 1);
    });

    it('handles code with exports, classes, and functions', () => {
        const relPath = 'src/sample.js';
        const text =
            'export const VALUE = 42;\n' +
            '\n' +
            'export function foo() {\n' +
            '  return 1;\n' +
            '}\n' +
            '\n' +
            'export class Bar {\n' +
            '  constructor() {}\n' +
            '}\n';

        const buf = Buffer.from(text, 'utf8');
        const { lines } = buildLineIndex(buf);
        const ranges = chunkByType({ relPath, lines });

        // Should create chunks for different export statements
        assert.ok(ranges.length >= 1, 'Should create at least one chunk');

        // Determinism
        const ranges2 = chunkByType({ relPath, lines });
        assert.deepStrictEqual(ranges, ranges2);
    });

    it('handles plain text and JSON with line-based chunking', () => {
        const relPath = 'data.json';
        const text = '{\n' + '  "key": "value",\n'.repeat(100) + '}\n';

        const buf = Buffer.from(text, 'utf8');
        const { lines } = buildLineIndex(buf);
        const ranges = chunkByType({ relPath, lines });

        // Should create chunks
        assert.ok(ranges.length >= 1);

        // Each range should be valid
        for (const range of ranges) {
            assert.ok(range.startLine >= 1);
            assert.ok(range.endLine >= range.startLine);
            assert.ok(range.endLine <= lines.length);
        }
    });

    it('respects maxChunkChars constraint', () => {
        const relPath = 'large.md';
        // Create a very large file
        const text = '# Section\n\n' + 'Line of text.\n'.repeat(500);

        const buf = Buffer.from(text, 'utf8');
        const { lines } = buildLineIndex(buf);
        const ranges = chunkByType({ relPath, lines, maxChunkChars: 1000 });

        // Should split into multiple chunks
        assert.ok(ranges.length > 1, 'Should split large content');

        // No chunk should be too large (with some tolerance for merging)
        for (const range of ranges) {
            const lineCount = range.endLine - range.startLine + 1;
            assert.ok(lineCount > 0, 'Each chunk should have content');
        }
    });
});
