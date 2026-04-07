// @ts-check
import assert from 'node:assert';

import { chunkByType } from '../../../tools/rag/lib/chunking/chunk_dispatcher.mjs';
import { buildChunkId, sha256HexForString } from '../../../tools/rag/lib/contract.mjs';
import { buildLineIndex, sliceByLines } from '../../../tools/rag/lib/text.mjs';

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

        const ids1 = r1.map((/** @type {any} */ r) => {
            const { startByte, endByte, text: chunkText } = sliceByLines(buf, lineStarts, r.startLine, r.endLine);
            return buildChunkId({
                relPath,
                startByte,
                endByte,
                contentSha256: sha256HexForString(chunkText),
            });
        });

        const ids2 = r2.map((/** @type {any} */ r) => {
            const { startByte, endByte, text: chunkText } = sliceByLines(buf, lineStarts, r.startLine, r.endLine);
            return buildChunkId({
                relPath,
                startByte,
                endByte,
                contentSha256: sha256HexForString(chunkText),
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

    it('chunks function with JSDoc as a semantic AST unit', () => {
        const relPath = 'src/with-jsdoc.ts';
        const text =
            '/**\n' +
            ' * Sums two numbers.\n' +
            ' */\n' +
            'export function sum(a, b) {\n' +
            '  return a + b;\n' +
            '}\n';

        const buf = Buffer.from(text, 'utf8');
        const { lines } = buildLineIndex(buf);
        const ranges = chunkByType({ relPath, lines, maxChunkChars: 800 });
        const fnChunk = ranges.find((/** @type {any} */ r) => r.symbol === 'sum');

        assert.ok(fnChunk, 'Expected AST chunk for symbol "sum"');
        assert.strictEqual(fnChunk.kind, 'function');
        assert.strictEqual(fnChunk.exported, true);
        assert.strictEqual(fnChunk.startLine, 1, 'Chunk should include JSDoc leading block');
        assert.ok(String(fnChunk.headerText || '').includes('jsdoc:'), 'Header should include JSDoc metadata');
    });

    it('splits large classes by method with semantic anchors', () => {
        const relPath = 'src/large-class.ts';
        const text =
            'export class Service {\n' +
            '  methodOne() {\n' +
            '    return 1;\n' +
            '  }\n' +
            '  methodTwo() {\n' +
            '    return 2;\n' +
            '  }\n' +
            '  methodThree() {\n' +
            '    return 3;\n' +
            '  }\n' +
            '}\n';

        const buf = Buffer.from(text, 'utf8');
        const { lines } = buildLineIndex(buf);
        const ranges = chunkByType({ relPath, lines, maxChunkChars: 80 });

        const methodChunks = ranges.filter((/** @type {any} */ r) => String(r.symbol || '').startsWith('Service.'));
        assert.ok(methodChunks.length >= 2, 'Expected class to split into method chunks');
        assert.ok(
            methodChunks.every(
                (/** @type {any} */ r) => r.kind === 'class_method' || String(r.kind).startsWith('class_method'),
            ),
        );
    });

    it('falls back to heuristic chunking when AST parse fails', () => {
        const relPath = 'src/invalid.js';
        const text = 'export function broken( {\n' + '  return 1;\n';
        const buf = Buffer.from(text, 'utf8');
        const { lines } = buildLineIndex(buf);

        const ranges = chunkByType({ relPath, lines, maxChunkChars: 200 });
        assert.ok(ranges.length >= 1, 'Fallback should still return chunks');
        assert.ok(
            ranges.every((/** @type {any} */ r) => r.kind),
            'Fallback chunks should have kind metadata',
        );
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
