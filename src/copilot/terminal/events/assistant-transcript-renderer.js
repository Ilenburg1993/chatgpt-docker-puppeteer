// @ts-check
/**
 * Renderização persistente de mensagens da LLM-B que chegam fora do fluxo explícito de diálogo.
 *
 * A linha viva do terminal é transitória por definição; qualquer texto humanamente relevante precisa passar por este
 * renderer para entrar no histórico visual. O dedupe protege contra SDKs que emitem o mesmo conteúdo por
 * `assistant.message` e por deltas de streaming fechados em `assistant.turn_end`.
 *
 * @module copilot/terminal/events/assistant-transcript-renderer
 */

import { createHash } from 'node:crypto';
import { SEPARATOR, printlnBlock } from '../dialog/index.js';
import { appendTerminalTranscriptTurn, terminalThemeBadge, terminalThemeText } from '../state/events/index.js';

const RECENT_TRANSCRIPT_TTL_MS = 5 * 60_000;
const RECENT_TRANSCRIPT_MAX = 128;
const RECENT_TRANSCRIPT_COVERAGE_MIN_CHARS = 32;

/** @type {Map<string, { ts: number; normalized: string }>} */
const recentTranscriptHashes = new Map();

/**
 * @param {string} content
 * @returns {string}
 */
function normalizeTranscriptContent(content) {
    return content.replace(/\s+/g, ' ').trim();
}

/**
 * @param {number} [now]
 * @returns {void}
 */
function pruneRecentTranscriptHashes(now = Date.now()) {
    for (const [hash, entry] of recentTranscriptHashes.entries()) {
        if (now - entry.ts > RECENT_TRANSCRIPT_TTL_MS) recentTranscriptHashes.delete(hash);
    }
    if (recentTranscriptHashes.size <= RECENT_TRANSCRIPT_MAX) return;
    const overflow = recentTranscriptHashes.size - RECENT_TRANSCRIPT_MAX;
    let removed = 0;
    for (const hash of recentTranscriptHashes.keys()) {
        recentTranscriptHashes.delete(hash);
        removed += 1;
        if (removed >= overflow) break;
    }
}

/**
 * @param {string} content
 * @param {{ minChars?: number }} [options]
 * @returns {boolean}
 */
export function isTerminalAssistantTranscriptCovered(content, options = {}) {
    const normalized = normalizeTranscriptContent(content);
    const minChars = Math.max(1, options.minChars ?? RECENT_TRANSCRIPT_COVERAGE_MIN_CHARS);
    if (normalized.length < minChars) return false;
    pruneRecentTranscriptHashes();
    for (const entry of recentTranscriptHashes.values()) {
        if (entry.normalized === normalized) return true;
        if (entry.normalized.length >= minChars && entry.normalized.includes(normalized)) return true;
    }
    return false;
}

/**
 * @param {string} content
 * @param {{ suppressIfCoveredByRecent?: boolean }} [options]
 * @returns {boolean}
 */
export function claimTerminalAssistantTranscript(content, options = {}) {
    const normalized = normalizeTranscriptContent(content);
    if (!normalized) return false;
    pruneRecentTranscriptHashes();
    const hash = createHash('sha256').update(normalized).digest('hex');
    if (recentTranscriptHashes.has(hash)) return false;
    if (options.suppressIfCoveredByRecent && isTerminalAssistantTranscriptCovered(normalized)) return false;
    recentTranscriptHashes.set(hash, { ts: Date.now(), normalized });
    return true;
}

/**
 * @param {{
 *     content: string;
 *     title?: string;
 *     source?: string;
 *     status?: 'message' | 'completed' | 'error';
 *     detail?: string | null;
 *     truncated?: boolean;
 *     suppressIfCoveredByRecent?: boolean;
 *     metadata?: Record<string, unknown> | null;
 * }} input
 * @returns {boolean}
 */
export function renderTerminalAssistantTranscript(input) {
    const content = input.content.trim();
    const claimOptions = input.suppressIfCoveredByRecent ? { suppressIfCoveredByRecent: true } : {};
    if (!content || !claimTerminalAssistantTranscript(content, claimOptions)) {
        return false;
    }

    const title = input.title ?? 'Mensagem da LLM-B';
    const source = input.source ?? 'sdk';
    const status = input.status ?? 'message';
    const badgeRole = status === 'error' ? 'error' : status === 'completed' ? 'success' : 'info';
    const detail = input.detail ? ` ${terminalThemeText('muted', `· ${input.detail}`)}` : '';

    const lines = [
        SEPARATOR,
        `  ${terminalThemeBadge(badgeRole, 'LLM-B')} ${terminalThemeText('assistant', title)} ${terminalThemeText('muted', `· ${source}`)}${detail}`,
        '',
    ];
    for (const line of content.split('\n')) {
        lines.push(`  ${terminalThemeText('assistant', '│')}  ${line}`);
    }
    if (input.truncated) {
        lines.push('', `  ${terminalThemeText('warn', '… conteúdo preservado parcialmente em memória; veja o archive do transcript')}`);
    }
    lines.push('');
    printlnBlock(lines);
    appendTerminalTranscriptTurn({
        role: 'assistant',
        rawRole: 'llm_b',
        content,
        source,
        metadata: input.metadata ?? null,
    });
    return true;
}

export const __test__ = {
    clearRecentTranscriptHashes: () => recentTranscriptHashes.clear(),
    normalizeTranscriptContent,
};
