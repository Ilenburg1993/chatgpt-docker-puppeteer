// @ts-check
/**
 * src/copilot/terminal/commands/resume.js
 *
 * Comando `/resume` — retomada de sessão anterior.
 *
 * Sem arg → lista últimas 5 hub_sessions. Com sessionId → carrega turnos e inicia nova sessão com contexto prefixed.
 *
 * @module copilot/terminal/commands/resume
 * @see EventBus
 */

import { toError } from '#copilot/core';
import { readTerminalResumeListProjection, readTerminalResumeProjection } from '../frontend/index.js';
import { formatTerminalIsoTimestamp } from '../state/index.js';

/**
 * Handler do comando `/resume`.
 *
 * @param {{ println: (text: string) => void; hubSessionId: string | null }} ctx
 * @param {string} arg - sessionId opcional
 * @returns {Promise<void>}
 */
export async function cmdResume({ println, hubSessionId }, arg) {
    const trimmed = (arg ?? '').trim();

    // Sem argumento: lista últimas 5 sessões
    if (!trimmed) {
        try {
            const { sessions, currentHubSessionId } = readTerminalResumeListProjection({
                currentHubSessionId: hubSessionId ?? null,
                limit: 5,
            });
            if (sessions.length === 0) {
                println('\x1b[90m  Nenhuma sessão anterior encontrada.\x1b[0m');
                return;
            }
            println('');
            println('\x1b[36m  ─── Sessões Anteriores ─────────────────────────────────────────\x1b[0m');
            for (const s of sessions) {
                const ts = formatTerminalIsoTimestamp(String(s['created_at'] ?? ''));
                const current = s['id'] === currentHubSessionId ? ' \x1b[32m← atual\x1b[0m' : '';
                println(
                    `  \x1b[33m${String(s['id'] ?? '').slice(0, 8)}\x1b[90m…\x1b[0m  ${s['title'] ?? 'sem título'}  \x1b[90m(${s['status'] ?? 'unknown'}, ${ts})${current}\x1b[0m`,
                );
            }
            println('');
            println('\x1b[90m  Use /resume <id> (primeiros 8 chars ou completo) para retomar.\x1b[0m');
            println('');
        } catch (e) {
            println(`\x1b[31m  ✗ Erro ao listar sessões: ${toError(e).message}\x1b[0m`);
        }
        return;
    }

    // Com sessionId: carrega turnos e retoma
    try {
        const projection = readTerminalResumeProjection({ token: trimmed });
        if (!projection.found || !projection.target) {
            if (projection.reason === 'session-empty') {
                println(
                    `\x1b[90m  Sessão ${String(projection.target?.['id'] ?? trimmed).slice(0, 8)}… não tem turnos registrados.\x1b[0m`,
                );
                return;
            }
            println(`\x1b[31m  ✗ Sessão não encontrada: ${trimmed}\x1b[0m`);
            return;
        }

        println(
            `\x1b[36m  ↩️  Retomando sessão ${String(projection.target['id'] ?? '').slice(0, 8)}… (${projection.turns.length} turnos)\x1b[0m`,
        );

        // Import dinâmico para evitar ciclo
        const { sendTurn } = await import('../dialog/index.js');
        await sendTurn(projection.summaryPrompt ?? '', 'user');
    } catch (e) {
        println(`\x1b[31m  ✗ Erro ao retomar sessão: ${toError(e).message}\x1b[0m`);
    }
}
