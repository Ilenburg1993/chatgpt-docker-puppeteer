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
        lines.push(`## ${role} — ${time}`, '');
        lines.push(`> origem=${turn.origin}${turn.persisted ? ' · persistido' : ' · vivo'}`, '');
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
