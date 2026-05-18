// @ts-check
/**
 * Archive durável do transcript local do terminal.
 *
 * O feed em memória é uma janela operacional; o archive JSONL preserva o conteúdo completo em `data/`, que é runtime
 * state ignorado pelo git. Falha de archive nunca derruba a UX do terminal.
 *
 * @module copilot/terminal/state/transcript-archive
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { toError } from '../../core/error-handlers.js';

const TERMINAL_TRANSCRIPT_ARCHIVE_DIR = join(process.cwd(), 'data', 'copilot-terminal', 'transcripts');

/** @type {string | null} */
let _terminalTranscriptArchivePath = null;
/** @type {string | null} */
let _terminalTranscriptArchiveError = null;

/**
 * @returns {string}
 */
function resolveTranscriptArchivePath() {
    if (_terminalTranscriptArchivePath) return _terminalTranscriptArchivePath;
    const day = new Date().toISOString().slice(0, 10);
    _terminalTranscriptArchivePath = join(TERMINAL_TRANSCRIPT_ARCHIVE_DIR, `terminal-transcript-${day}.jsonl`);
    return _terminalTranscriptArchivePath;
}

/**
 * @param {import('./transcript-state.js').TerminalTranscriptTurn} entry
 * @returns {{ archived: boolean; path: string | null; error: string | null }}
 */
export function appendTerminalTranscriptArchive(entry) {
    try {
        mkdirSync(TERMINAL_TRANSCRIPT_ARCHIVE_DIR, { recursive: true });
        const path = resolveTranscriptArchivePath();
        appendFileSync(path, `${JSON.stringify({ ...entry, archived: true })}\n`, 'utf8');
        _terminalTranscriptArchiveError = null;
        return { archived: true, path, error: null };
    } catch (error) {
        _terminalTranscriptArchiveError = toError(error).message;
        return { archived: false, path: _terminalTranscriptArchivePath, error: _terminalTranscriptArchiveError };
    }
}

/**
 * @returns {{ path: string | null; error: string | null }}
 */
export function readTerminalTranscriptArchiveState() {
    return {
        path: _terminalTranscriptArchivePath,
        error: _terminalTranscriptArchiveError,
    };
}

/**
 * @returns {void}
 */
export function resetTerminalTranscriptArchiveForTests() {
    _terminalTranscriptArchivePath = null;
    _terminalTranscriptArchiveError = null;
}
