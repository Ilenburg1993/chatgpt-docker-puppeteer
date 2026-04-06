// @ts-check
/**
 * src/copilot/terminal/commands/resume.js
 *
 * Comando `/resume` — retomada de sessão anterior.
 *
 * Sem arg → lista últimas 5 hub_sessions. Com sessionId → carrega turnos e inicia nova sessão com contexto prefixed.
 *
 * @module copilot/terminal/commands/resume
 */

import { conversationStore } from '#copilot/conversation-hub/store';

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
            const sessions = conversationStore.listHubSessions({ limit: 5, offset: 0 });
            if (sessions.length === 0) {
                println('\x1b[90m  Nenhuma sessão anterior encontrada.\x1b[0m');
                return;
            }
            println('');
            println('\x1b[36m  ─── Sessões Anteriores ─────────────────────────────────────────\x1b[0m');
            for (const s of sessions) {
                const ts = new Date(s.created_at).toLocaleString('pt-BR');
                const current = s.id === hubSessionId ? ' \x1b[32m← atual\x1b[0m' : '';
                println(
                    `  \x1b[33m${s.id.slice(0, 8)}\x1b[90m…\x1b[0m  ${s.title ?? 'sem título'}  \x1b[90m(${s.status}, ${ts})${current}\x1b[0m`,
                );
            }
            println('');
            println('\x1b[90m  Use /resume <id> (primeiros 8 chars ou completo) para retomar.\x1b[0m');
            println('');
        } catch (/** @type {any} */ e) {
            println(`\x1b[31m  ✗ Erro ao listar sessões: ${e.message}\x1b[0m`);
        }
        return;
    }

    // Com sessionId: carrega turnos e retoma
    try {
        // Suporta prefixo de 8+ chars
        const sessions = conversationStore.listHubSessions({ limit: 100, offset: 0 });
        const target = sessions.find((s) => s.id === trimmed || s.id.startsWith(trimmed));
        if (!target) {
            println(`\x1b[31m  ✗ Sessão não encontrada: ${trimmed}\x1b[0m`);
            return;
        }

        const turns = conversationStore.readTurns(target.id, { limit: 50, offset: 0 });
        if (turns.length === 0) {
            println(`\x1b[90m  Sessão ${target.id.slice(0, 8)}… não tem turnos registrados.\x1b[0m`);
            return;
        }

        // Monta resumo textual dos turnos
        const lines = [];
        for (const t of turns) {
            const roleLabel = t.role === 'llm_b' ? 'LLM-B' : t.role === 'llm_a' ? 'LLM-A' : 'Usuário';
            lines.push(`[${roleLabel}] ${t.content}`);
        }
        const summaryPrompt =
            '[CONTEXTO DE SESSÃO ANTERIOR] Estou retomando a seguinte conversa. ' +
            'Leia o contexto abaixo e continue a partir daí:\n\n' +
            lines.join('\n\n');

        println(`\x1b[36m  ↩️  Retomando sessão ${target.id.slice(0, 8)}… (${turns.length} turnos)\x1b[0m`);

        // Import dinâmico para evitar ciclo
        const { sendTurn } = await import('../dialog.js');
        await sendTurn(summaryPrompt, 'user');
    } catch (/** @type {any} */ e) {
        println(`\x1b[31m  ✗ Erro ao retomar sessão: ${e.message}\x1b[0m`);
    }
}
