// @ts-check

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, vi } from 'vitest';

describe('terminal transcript archive', () => {
    const originalArchiveDir = process.env['TERMINAL_TRANSCRIPT_ARCHIVE_DIR'];
    /** @type {string[]} */
    const cleanupDirs = [];

    afterEach(() => {
        if (originalArchiveDir === undefined) delete process.env['TERMINAL_TRANSCRIPT_ARCHIVE_DIR'];
        else process.env['TERMINAL_TRANSCRIPT_ARCHIVE_DIR'] = originalArchiveDir;
        for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
        vi.resetModules();
    });

    it('enfileira sem IO síncrono e persiste JSONL no flush explícito', async () => {
        const archiveDir = mkdtempSync(join(tmpdir(), 'copilot-transcript-archive-'));
        cleanupDirs.push(archiveDir);
        process.env['TERMINAL_TRANSCRIPT_ARCHIVE_DIR'] = archiveDir;
        const archive = await import('../../../../src/copilot/terminal/state/transcript-archive.js');

        const accepted = archive.appendTerminalTranscriptArchive(
            /** @type {import('../../../../src/copilot/terminal/state/transcript-state.js').TerminalTranscriptTurn} */ ({
                id: 'turn-1',
                role: 'assistant',
                rawRole: 'llm_b',
                content: 'persist me',
                byteLength: 10,
                source: 'test',
                timestamp: 1,
                archived: false,
                metadata: null,
            }),
        );

        assert.equal(accepted.archived, true);
        assert.equal(archive.readTerminalTranscriptArchiveState().queueDepth, 1);

        await archive.flushTerminalTranscriptArchive();

        assert.equal(archive.readTerminalTranscriptArchiveState().queueDepth, 0);
        const persisted = readFileSync(/** @type {string} */ (accepted.path), 'utf8').trim();
        assert.deepEqual(JSON.parse(persisted), {
            id: 'turn-1',
            role: 'assistant',
            rawRole: 'llm_b',
            content: 'persist me',
            byteLength: 10,
            source: 'test',
            timestamp: 1,
            archived: true,
            metadata: null,
        });
    });
});
