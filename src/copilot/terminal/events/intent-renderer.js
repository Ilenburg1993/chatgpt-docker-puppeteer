// @ts-check
/**
 * Renderer persistente de intents da LLM-B.
 *
 * A linha viva pode mostrar progresso, mas intents são sinais conversacionais. Este módulo imprime, registra em
 * `/activity`, grava em `/intent` e promove o conteúdo para o transcript local.
 *
 * @module copilot/terminal/events/intent-renderer
 */

import { createHash } from 'node:crypto';
import { SEPARATOR, broadcastSse, printlnBlock } from '../dialog/index.js';
import {
    appendTerminalIntent,
    appendTerminalTranscriptTurn,
    normalizeTerminalIntentRisk,
    recordTerminalActivity,
    terminalThemeRow,
    terminalThemeText,
    withTerminalTurnCorrelation,
} from '../state/events/index.js';

const RECENT_INTENT_TTL_MS = 5 * 60_000;
const RECENT_INTENT_MAX = 256;

/** @type {Map<string, number>} */
const recentIntentHashes = new Map();

/**
 * @param {number} [now]
 * @returns {void}
 */
function pruneRecentIntentHashes(now = Date.now()) {
    for (const [hash, ts] of recentIntentHashes.entries()) {
        if (now - ts > RECENT_INTENT_TTL_MS) recentIntentHashes.delete(hash);
    }
    if (recentIntentHashes.size <= RECENT_INTENT_MAX) return;
    const overflow = recentIntentHashes.size - RECENT_INTENT_MAX;
    let removed = 0;
    for (const hash of recentIntentHashes.keys()) {
        recentIntentHashes.delete(hash);
        removed += 1;
        if (removed >= overflow) break;
    }
}

/**
 * @param {{ intent: string; tool?: string | null; risk?: unknown; source?: string; toolCallId?: string | null }} input
 * @returns {string}
 */
function hashIntentInput(input) {
    // Intents equivalentes podem chegar por três rotas quase simultâneas:
    // `assistant.intent`, `report_intent` e alias local `report_intent_local`.
    // A UI precisa de uma única intenção canônica; source/toolCallId são envelopes, não identidade semântica.
    return createHash('sha256')
        .update([input.intent.replace(/\s+/g, ' ').trim(), normalizeTerminalIntentRisk(input.risk)].join('\n'))
        .digest('hex');
}

/**
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
function compact(value, max) {
    const text = value.replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * @param {import('../state/intent-state.js').TerminalIntentRisk} risk
 * @returns {'info' | 'warn' | 'error' | 'muted'}
 */
function riskTheme(risk) {
    if (risk === 'high') return 'error';
    if (risk === 'medium') return 'warn';
    if (risk === 'unknown') return 'muted';
    return 'info';
}

/**
 * @param {import('../state/intent-state.js').TerminalIntentRisk} risk
 * @returns {string}
 */
function humanRiskLabel(risk) {
    if (risk === 'low') return 'risco baixo';
    if (risk === 'medium') return 'risco médio';
    if (risk === 'high') return 'risco alto';
    return 'risco não informado';
}

/**
 * @param {string} source
 * @returns {string}
 */
function humanIntentSource(source) {
    const text = source.trim().toLowerCase();
    if (text.includes('assistant.intent')) return 'SDK';
    if (text.includes('report_intent')) return 'ferramenta de intenção';
    if (text.includes('terminal')) return 'terminal';
    return 'captura';
}

/**
 * @param {{
 *     intent: string;
 *     tool?: string | null;
 *     risk?: unknown;
 *     source?: string;
 *     toolCallId?: string | null;
 *     print?: boolean;
 * }} input
 * @returns {import('../state/intent-state.js').TerminalIntentEntry | null}
 */
export function renderTerminalIntent(input) {
    const intent = input.intent.trim();
    if (!intent) return null;
    pruneRecentIntentHashes();
    const hash = hashIntentInput({ ...input, intent });
    if (recentIntentHashes.has(hash)) return null;
    recentIntentHashes.set(hash, Date.now());

    const entry = appendTerminalIntent({
        intent,
        tool: input.tool ?? null,
        risk: input.risk,
        source: input.source ?? 'terminal.intent',
        toolCallId: input.toolCallId ?? null,
    });
    if (!entry) return null;

    const risk = entry.risk;
    const theme = riskTheme(risk);
    const renderedRisk = humanRiskLabel(risk);
    const sourceLabel = ` · origem ${humanIntentSource(entry.source)}`;

    recordTerminalActivity('turn', 'Intenção da LLM-B', {
        detail: compact(intent, 240),
        source: entry.source,
        severity: risk === 'high' ? 'warn' : 'info',
        recordHistory: true,
        ...(entry.tool ? { toolName: entry.tool } : {}),
    });

    appendTerminalTranscriptTurn({
        role: 'system',
        rawRole: 'intent',
        content: `[intenção] ${renderedRisk}\n${intent}`,
        source: entry.source,
        timestamp: entry.timestamp,
    });

    if (input.print !== false) {
        const lines = [SEPARATOR, terminalThemeRow('Intenção', `${renderedRisk}${sourceLabel}`, { role: theme }), ''];
        for (const line of intent.split('\n')) {
            lines.push(`  ${terminalThemeText(theme, '│')}  ${line}`);
        }
        lines.push('');
        printlnBlock(lines);
    }

    broadcastSse(
        'assistant.intent',
        withTerminalTurnCorrelation({
            id: entry.id,
            intent: entry.intent,
            tool: entry.tool,
            risk: entry.risk,
            source: entry.source,
            eventSource: 'terminal-intent/assistant.intent',
            toolCallId: entry.toolCallId,
            timestamp: entry.timestamp,
        }),
    );

    return entry;
}

export const __test__ = {
    clearRecentIntentHashes: () => recentIntentHashes.clear(),
};
