// @ts-check
/**
 * src/copilot/terminal/commands/export.js
 *
 * Comando `/export [path]` — exporta o histórico de conversa como Markdown.
 *
 * @module copilot/terminal/commands/export
 * @see EventBus
 */

import { WORKSPACE_ROOT } from '#copilot/boot';
import { writeFileAtomicTrusted } from '#copilot/infra/public/trusted-io';
import { join, resolve } from 'node:path';
import { toError } from '../../core/error-handlers.js';
import { redactSecretText } from '../../core/security/redaction.js';
import { sanitizeTerminalExternalToolText } from '../capabilities/index.js';
import { formatTerminalToolPathForOperator } from '../events/presenters/tools/index.js';
import { readTerminalTimelineProjection } from '../frontend/index.js';
import { formatTerminalIsoTimestamp, terminalThemeRow } from '../state/index.js';

/**
 * @typedef {object} ExportContext
 * @property {(text: string) => void} println
 */

/**
 * Exporta conversa como Markdown.
 *
 * @param {ExportContext} ctx
 * @param {string} [arg] - Caminho do arquivo (default: conversa-<timestamp>.md)
 * @returns {Promise<void>}
 */
export async function cmdExport({ println }, arg) {
    const projection = readTerminalTimelineProjection({ limitPairs: 500 });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `conversa-${ts}.md`;
    const filePath = arg?.trim() ? resolve(WORKSPACE_ROOT, arg.trim()) : join(WORKSPACE_ROOT, defaultName);
    const syncDetail =
        projection.sync.status === 'blocked' && projection.syncBlockedReason
            ? `${projection.sync.status}:${projection.syncBlockedReason}`
            : projection.sync.status;

    const exportedAt = formatTerminalIsoTimestamp(Date.now());
    const lines = [`# Conversa LLM-B — ${exportedAt}`, ''];
    lines.push(
        `> ${projection.turns.length} mensagens · timeline=${sanitizeExportInline(projection.timelineSource)}/${sanitizeExportInline(projection.reconciliationStatus)} · sync=${sanitizeExportInline(syncDetail)} · redaction=enabled · exportado em ${exportedAt}`,
        '',
    );
    if (projection.turns.length === 0) {
        lines.push('Nenhuma mensagem foi materializada neste transcript.', '');
        lines.push(
            'Este arquivo preserva o diagnóstico mínimo do terminal para cenários de timeout, provider sem resposta ou turno vazio antes de transcript público.',
            '',
        );
    }

    for (const turn of projection.turns) {
        const time = formatTerminalIsoTimestamp(turn.timestamp ?? Date.now());
        const role =
            turn.role === 'user'
                ? 'Usuário'
                : turn.rawRole === 'llm_a'
                  ? 'LLM-A'
                  : turn.role === 'system' || turn.rawRole === 'ask_user'
                    ? 'Sistema'
                    : 'LLM-B';
        const metadata = turn.metadata && typeof turn.metadata === 'object' ? turn.metadata : null;
        const streamingDiagnostics =
            metadata?.['terminalStreamingDiagnostics'] && typeof metadata['terminalStreamingDiagnostics'] === 'object'
                ? /** @type {Record<string, any>} */ (metadata['terminalStreamingDiagnostics'])
                : null;
        const envelope = readExportEnvelope(metadata);
        lines.push(`## ${role} — ${time}`, '');
        lines.push(`> origem=${turn.origin}${turn.persisted ? ' · persistido' : ' · vivo'}`, '');
        if (envelope) {
            lines.push(
                `> envelope=${sanitizeExportInline(envelope.source)} · trace=${sanitizeExportInline(envelope.traceId ?? '-')} · turn=${sanitizeExportInline(envelope.turnId ?? '-')} · evento=${sanitizeExportInline(envelope.eventId ?? '-')}`,
                '',
            );
        }
        if (streamingDiagnostics) {
            const materialization =
                streamingDiagnostics['materialization'] && typeof streamingDiagnostics['materialization'] === 'object'
                    ? /** @type {Record<string, any>} */ (streamingDiagnostics['materialization'])
                    : {};
            const finalReconciliation =
                streamingDiagnostics['finalReconciliation'] &&
                typeof streamingDiagnostics['finalReconciliation'] === 'object'
                    ? /** @type {Record<string, any>} */ (streamingDiagnostics['finalReconciliation'])
                    : {};
            const publicStream =
                streamingDiagnostics['publicStream'] && typeof streamingDiagnostics['publicStream'] === 'object'
                    ? /** @type {Record<string, any>} */ (streamingDiagnostics['publicStream'])
                    : {};
            lines.push(
                `> streaming=${sanitizeExportInline(finalReconciliation['mode'] ?? '-')}/${sanitizeExportInline(finalReconciliation['reason'] ?? '-')} · materializacao=${sanitizeExportInline(materialization['source'] ?? '-')} · deltas=${sanitizeExportInline(materialization['deltaSlices'] ?? 0)}/${sanitizeExportInline(materialization['deltaChars'] ?? 0)}ch · streamVisivel=${sanitizeExportInline(publicStream['visibleChars'] ?? 0)}ch`,
                '',
            );
        }
        lines.push(sanitizeExportBlock(turn.content), '');
        lines.push('---', '');
    }

    try {
        await writeFileAtomicTrusted(filePath, lines.join('\n'), { caller: 'terminal.commands.export' });
        println(terminalThemeRow('Exportado', formatTerminalToolPathForOperator(filePath), { role: 'success' }));
        println(
            terminalThemeRow(
                'Mensagens',
                projection.turns.length > 0
                    ? `${projection.turns.length} salvas como Markdown.`
                    : '0 salvas; arquivo diagnóstico mínimo criado.',
                { role: projection.turns.length > 0 ? 'muted' : 'warn' },
            ),
        );
    } catch (e) {
        println(terminalThemeRow('Erro', `erro ao exportar: ${toError(e).message ?? e}`, { role: 'error' }));
    }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeExportInline(value) {
    return escapeMarkdownHtml(
        redactSecretText(sanitizeTerminalExternalToolText(value))
            .replace(/[\r\n]+/gu, ' ')
            .trim(),
    );
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeExportBlock(value) {
    return escapeMarkdownHtml(redactSecretText(sanitizeTerminalExternalToolText(value)));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeMarkdownHtml(value) {
    return String(value ?? '')
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;');
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @returns {{ source: string; traceId: string | null; turnId: string | null; eventId: string | null } | null}
 */
function readExportEnvelope(metadata) {
    if (!metadata) return null;
    const direct = extractEnvelopeLike(metadata);
    if (direct) return direct;
    const assistantEnvelope =
        metadata['assistantMessageEnvelope'] && typeof metadata['assistantMessageEnvelope'] === 'object'
            ? extractEnvelopeLike(/** @type {Record<string, unknown>} */ (metadata['assistantMessageEnvelope']))
            : null;
    if (assistantEnvelope) return assistantEnvelope;
    const eventEnvelope =
        metadata['envelope'] && typeof metadata['envelope'] === 'object'
            ? extractEnvelopeLike(/** @type {Record<string, unknown>} */ (metadata['envelope']))
            : null;
    if (eventEnvelope) return eventEnvelope;
    const streamingEnvelope =
        metadata['terminalStreamingDiagnostics'] && typeof metadata['terminalStreamingDiagnostics'] === 'object'
            ? extractEnvelopeLike(/** @type {Record<string, unknown>} */ (metadata['terminalStreamingDiagnostics']))
            : null;
    if (streamingEnvelope) return streamingEnvelope;
    const original =
        metadata['originalMetadata'] && typeof metadata['originalMetadata'] === 'object'
            ? readExportEnvelope(/** @type {Record<string, unknown>} */ (metadata['originalMetadata']))
            : null;
    return original;
}

/**
 * @param {Record<string, unknown>} value
 * @returns {{ source: string; traceId: string | null; turnId: string | null; eventId: string | null } | null}
 */
function extractEnvelopeLike(value) {
    const source = typeof value['eventSource'] === 'string' ? value['eventSource'] : value['source'];
    const traceId =
        typeof value['traceId'] === 'string'
            ? value['traceId']
            : typeof value['turnKey'] === 'string'
              ? value['turnKey']
              : null;
    const turnId =
        typeof value['turnId'] === 'string'
            ? value['turnId']
            : typeof value['turnId'] === 'number'
              ? String(value['turnId'])
              : null;
    const hasEnvelope =
        typeof source === 'string' ||
        traceId !== null ||
        turnId !== null ||
        typeof value['eventId'] === 'string' ||
        typeof value['eventId'] === 'number';
    if (!hasEnvelope) return null;
    return {
        source: typeof source === 'string' ? source : '-',
        traceId,
        turnId,
        eventId:
            typeof value['eventId'] === 'string'
                ? value['eventId']
                : typeof value['eventId'] === 'number'
                  ? String(value['eventId'])
                  : null,
    };
}
