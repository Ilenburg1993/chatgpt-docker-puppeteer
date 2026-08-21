// @ts-check
/**
 * Archive durável do transcript local do terminal.
 *
 * O feed em memória é uma janela operacional; o archive JSONL preserva o conteúdo completo em `data/`, que é runtime
 * state ignorado pelo git. Falha de archive nunca derruba a UX do terminal.
 *
 * @module copilot/terminal/state/transcript-archive
 */

import { createJsonlFileWriter } from '#copilot/infra/public/persistence/jsonl';
import { join } from 'node:path';
import { toError } from '../../core/error-handlers.js';

const DEFAULT_TERMINAL_TRANSCRIPT_ARCHIVE_DIR = join(process.cwd(), 'data', 'copilot-terminal', 'transcripts');
const TERMINAL_TRANSCRIPT_ARCHIVE_SOFT_QUEUE = 10_000;
const TERMINAL_TRANSCRIPT_ARCHIVE_CATASTROPHIC_QUEUE = 100_000;

/** @type {string | null} */
let _terminalTranscriptArchivePath = null;
/** @type {string | null} */
let _terminalTranscriptArchiveError = null;

const terminalTranscriptArchiveWriter = createJsonlFileWriter({
    filePath: resolveTranscriptArchivePath,
    batchLines: 256,
    maxQueueLines: TERMINAL_TRANSCRIPT_ARCHIVE_CATASTROPHIC_QUEUE,
    softQueueLines: TERMINAL_TRANSCRIPT_ARCHIVE_SOFT_QUEUE,
    onError: (error) => {
        _terminalTranscriptArchiveError = toError(error).message;
    },
    onSuccess: () => {
        _terminalTranscriptArchiveError = null;
    },
});

/**
 * @returns {string}
 */
function resolveTranscriptArchivePath() {
    if (_terminalTranscriptArchivePath) return _terminalTranscriptArchivePath;
    const day = new Date().toISOString().slice(0, 10);
    const configuredDir = process.env['TERMINAL_TRANSCRIPT_ARCHIVE_DIR'];
    const archiveDir =
        typeof configuredDir === 'string' && configuredDir.trim()
            ? configuredDir
            : DEFAULT_TERMINAL_TRANSCRIPT_ARCHIVE_DIR;
    _terminalTranscriptArchivePath = join(archiveDir, `terminal-transcript-${day}.jsonl`);
    return _terminalTranscriptArchivePath;
}

/**
 * @param {import('./transcript-state.js').TerminalTranscriptTurn} entry
 * @returns {{ archived: boolean; path: string | null; error: string | null }}
 */
export function appendTerminalTranscriptArchive(entry) {
    try {
        const path = resolveTranscriptArchivePath();
        terminalTranscriptArchiveWriter.enqueueLine(JSON.stringify({ ...entry, archived: true }));
        return { archived: true, path, error: null };
    } catch (error) {
        _terminalTranscriptArchiveError = toError(error).message;
        return { archived: false, path: _terminalTranscriptArchivePath, error: _terminalTranscriptArchiveError };
    }
}

/**
 * @returns {Promise<void>}
 */
export async function flushTerminalTranscriptArchive() {
    try {
        await terminalTranscriptArchiveWriter.flush();
        _terminalTranscriptArchiveError = null;
    } catch (error) {
        _terminalTranscriptArchiveError = toError(error).message;
        throw error;
    }
}

/**
 * @returns {{ path: string | null; error: string | null; queueDepth: number; droppedLines: number }}
 */
export function readTerminalTranscriptArchiveState() {
    const writerState = terminalTranscriptArchiveWriter.getState();
    return {
        path: _terminalTranscriptArchivePath,
        error: _terminalTranscriptArchiveError,
        queueDepth: writerState.queueDepth,
        droppedLines: writerState.droppedLines,
    };
}

/**
 * @returns {void}
 */
export function resetTerminalTranscriptArchiveForTests() {
    terminalTranscriptArchiveWriter.reset();
    _terminalTranscriptArchivePath = null;
    _terminalTranscriptArchiveError = null;
}
