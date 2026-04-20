// @ts-check

import { readTerminalActivityProjection } from '../frontend/index.js';

/**
 * @typedef {{ println: (text: string) => void }} ActivityContext
 */

/**
 * Exibe a atividade atual do terminal + timeline recente.
 *
 * @param {ActivityContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdActivity({ println }, arg) {
    const limit = Number(arg);
    const projection = readTerminalActivityProjection(Number.isFinite(limit) && limit > 0 ? limit : 10);
    const current = projection.current;
    const severityColor =
        current.severity === 'error' ? '\x1b[31m' : current.severity === 'warn' ? '\x1b[33m' : '\x1b[32m';
    const progressLabel = typeof current.progress === 'number' ? ` · ${current.progress}%` : '';
    println(`
  \x1b[36mAtividade Atual da LLM-B\x1b[0m
  ─────────────────────────────────────
  fase            ${severityColor}${current.phase}\x1b[0m
  label           ${current.label}${progressLabel}
  detalhe         ${current.detail ?? '\x1b[90m(nenhum)\x1b[0m'}
  source          \x1b[90m${current.source}\x1b[0m
  idade           \x1b[90m${Math.round(current.ageMs / 1000)}s\x1b[0m
  ─────────────────────────────────────`);

    if (projection.history.length === 0) {
        println('  \x1b[90mSem histórico de atividade ainda.\x1b[0m\n');
        return;
    }

    println('  \x1b[36mTimeline recente\x1b[0m');
    for (const entry of projection.history) {
        const ts = new Date(entry.ts).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        const sev = entry.severity === 'error' ? '\x1b[31m' : entry.severity === 'warn' ? '\x1b[33m' : '\x1b[90m';
        const extra = entry.detail ? ` — ${entry.detail}` : '';
        const progress = typeof entry.progress === 'number' ? ` (${entry.progress}%)` : '';
        println(`  ${sev}[${ts}]\x1b[0m ${entry.phase} · ${entry.label}${progress}${extra}`);
    }
    println('');
}
