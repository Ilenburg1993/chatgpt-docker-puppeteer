// @ts-check
/**
 * src/copilot/terminal/commands/export.js
 *
 * Comando `/export [path]` — exporta o histórico de conversa como Markdown.
 *
 * @module copilot/terminal/commands/export
 */

import { llmBridgeClient } from '#copilot/services';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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
    const hist = llmBridgeClient.history;
    if (hist.length === 0) {
        println('  \x1b[33mHistórico vazio — nada para exportar.\x1b[0m');
        return;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `conversa-${ts}.md`;
    const filePath = arg?.trim() ? resolve(arg.trim()) : join(process.cwd(), defaultName);

    const lines = [`# Conversa LLM-B — ${new Date().toLocaleString('pt-BR')}`, ''];
    lines.push(`> ${hist.length} mensagens · exportado em ${new Date().toISOString()}`, '');

    for (const turn of hist) {
        const time = new Date(turn.timestamp).toLocaleTimeString('pt-BR');
        const role = turn.role === 'user' ? '👤 Usuário' : '🧠 LLM-B';
        lines.push(`## ${role} — ${time}`, '');
        lines.push(turn.content, '');
        lines.push('---', '');
    }

    try {
        await writeFile(filePath, lines.join('\n'), 'utf-8');
        println(`  \x1b[32m✅ Exportado: ${filePath}\x1b[0m`);
        println(`  \x1b[90m${hist.length} mensagens salvas como Markdown.\x1b[0m`);
    } catch (/** @type {any} */ e) {
        println(`  \x1b[31m❌ Erro ao exportar: ${e?.message ?? e}\x1b[0m`);
    }
}
