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
import {
    formatTerminalTimeLabel,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeWrappedRow,
} from '../state/index.js';

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
                println(terminalThemeRow('Sessões', 'nenhuma sessão anterior encontrada', { role: 'muted' }));
                return;
            }
            println('');
            println(terminalThemeHeadline('assistant', 'Sessões anteriores'));
            for (const s of sessions) {
                const ts = formatTerminalTimeLabel(String(s['created_at'] ?? ''), { mode: 'dual' });
                const current = s['id'] === currentHubSessionId ? 'atual' : null;
                println(
                    terminalThemeWrappedRow(
                        String(s['id'] ?? '').slice(0, 8),
                        [String(s['title'] ?? 'sem título'), String(s['status'] ?? 'unknown'), ts, current]
                            .filter(Boolean)
                            .join(' · '),
                        { role: current ? 'success' : 'muted', width: 10, columns: 110 },
                    ),
                );
            }
            println('');
            println(terminalThemeRow('Uso', '/resume <id> para retomar', { role: 'command' }));
            println('');
        } catch (e) {
            println(terminalThemeRow('Sessões', `erro ao listar · ${toError(e).message}`, { role: 'error' }));
        }
        return;
    }

    // Com sessionId: carrega turnos e retoma
    try {
        const projection = readTerminalResumeProjection({ token: trimmed });
        if (!projection.found || !projection.target) {
            if (projection.reason === 'session-empty') {
                println(
                    terminalThemeRow(
                        'Sessão',
                        `${String(projection.target?.['id'] ?? trimmed).slice(0, 8)} · sem turnos registrados`,
                        {
                            role: 'muted',
                        },
                    ),
                );
                return;
            }
            println(terminalThemeRow('Sessão', `não encontrada · ${trimmed}`, { role: 'error' }));
            return;
        }

        println(
            terminalThemeRow(
                'Retomando',
                `${String(projection.target['id'] ?? '').slice(0, 8)} · ${projection.turns.length} ${
                    projection.turns.length === 1 ? 'turno' : 'turnos'
                }`,
                { role: 'assistant' },
            ),
        );

        // Import dinâmico para evitar ciclo
        const { sendTurn } = await import('../dialog/index.js');
        await sendTurn(projection.summaryPrompt ?? '', 'user');
    } catch (e) {
        println(terminalThemeRow('Retomar', `erro · ${toError(e).message}`, { role: 'error' }));
    }
}
