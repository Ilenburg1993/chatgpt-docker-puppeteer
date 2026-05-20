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
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { toError } from '../../core/error-handlers.js';
import { readTerminalTimelineProjection } from '../frontend/index.js';

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
    if (projection.turns.length === 0) {
        println('  \x1b[33mHistórico vazio — nada para exportar.\x1b[0m');
        return;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `conversa-${ts}.md`;
    const filePath = arg?.trim() ? resolve(WORKSPACE_ROOT, arg.trim()) : join(WORKSPACE_ROOT, defaultName);

    const lines = [`# Conversa LLM-B — ${new Date().toLocaleString('pt-BR')}`, ''];
    lines.push(
        `> ${projection.turns.length} mensagens · timeline=${projection.timelineSource}/${projection.reconciliationStatus} · sync=${projection.sync.status} · exportado em ${new Date().toISOString()}`,
        '',
    );

    for (const turn of projection.turns) {
        const time = new Date(turn.timestamp ?? Date.now()).toLocaleTimeString('pt-BR');
        const role = turn.role === 'user' ? '👤 Usuário' : turn.rawRole === 'llm_a' ? '🤖 LLM-A' : '🧠 LLM-B';
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
                `> envelope=${envelope.source} · trace=${envelope.traceId ?? '-'} · turn=${envelope.turnId ?? '-'} · evento=${envelope.eventId ?? '-'}`,
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
                `> streaming=${String(finalReconciliation['mode'] ?? '-')}/${String(finalReconciliation['reason'] ?? '-')} · materializacao=${String(materialization['source'] ?? '-')} · deltas=${String(materialization['deltaSlices'] ?? 0)}/${String(materialization['deltaChars'] ?? 0)}ch · streamVisivel=${String(publicStream['visibleChars'] ?? 0)}ch`,
                '',
            );
        }
        lines.push(turn.content, '');
        lines.push('---', '');
    }

    try {
        await writeFile(filePath, lines.join('\n'), 'utf-8');
        println(`  \x1b[32m✅ Exportado: ${filePath}\x1b[0m`);
        println(`  \x1b[90m${projection.turns.length} mensagens salvas como Markdown.\x1b[0m`);
    } catch (e) {
        println(`  \x1b[31m❌ Erro ao exportar: ${toError(e).message ?? e}\x1b[0m`);
    }
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
    const hasEnvelope =
        typeof source === 'string' ||
        typeof value['traceId'] === 'string' ||
        typeof value['turnId'] === 'string' ||
        typeof value['eventId'] === 'string';
    if (!hasEnvelope) return null;
    return {
        source: typeof source === 'string' ? source : '-',
        traceId: typeof value['traceId'] === 'string' ? value['traceId'] : null,
        turnId: typeof value['turnId'] === 'string' ? value['turnId'] : null,
        eventId: typeof value['eventId'] === 'string' ? value['eventId'] : null,
    };
}
