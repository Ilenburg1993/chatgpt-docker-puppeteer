// @ts-check
/**
 * src/copilot/terminal/commands/diagnose.js
 *
 * Comando `/diagnose` do REPL LLM-B: exibe diagnóstico completo do sistema em uma chamada. F13.1: health check
 * integrado sem sair do terminal.
 *
 * Inclui:
 *
 * - Estado do agente e dialog loop
 * - Status do MCP bridge (circuit breaker, tools count, disponibilidade)
 * - Estado do ConversationHub (sessão ativa, storage)
 * - TODOs pendentes (top-5)
 * - Tool stats top-5 por latência
 * - Uso de memória e uptime
 *
 * @module copilot/terminal/commands/diagnose
 * @see EventBus
 */

import { alwaysAliveAgent } from '#copilot/services';
import { getMcpStatus } from '#copilot/bridges';
import { conversationHub, conversationStore } from '#copilot/services';
import { getToolStats } from '#copilot/observability';

/**
 * @typedef {object} DiagnoseContext
 * @property {string | null} [hubSessionId]
 * @property {(text: string) => void} println
 */

/** ANSI helpers */
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    grey: '\x1b[90m',
    magenta: '\x1b[35m',
};

/**
 * Exibe diagnóstico completo do terminal LLM-B.
 *
 * @param {DiagnoseContext} ctx
 * @returns {Promise<void>}
 */
export async function cmdDiagnose({ hubSessionId, println }) {
    const snap = /** @type {Record<string, unknown>} */ (alwaysAliveAgent.getStatusSnapshot());
    const mcp = getMcpStatus();
    const memMB = Math.round(process.memoryUsage().rss / 1_048_576);
    const uptimeSec = Math.round(process.uptime());

    const agentStatusColor =
        snap['status'] === 'waiting_for_input' ? C.green : snap['status'] === 'idle' ? C.yellow : C.red;

    // ── MCP ──────────────────────────────────────────────────────────────────
    const mcpLine =
        mcp.available && !mcp.circuitOpen && mcp.toolCount > 0
            ? `${C.green}✅ ${mcp.toolCount} tools (lat: ${mcp.latencyMs ?? '?'}ms)${C.reset}`
            : mcp.circuitOpen
              ? `${C.red}❌ circuit aberto${C.reset}`
              : `${C.yellow}⚠️  indisponível${C.reset}`;

    // ── Hub ───────────────────────────────────────────────────────────────────
    let hubLine = `${C.grey}sem storage${C.reset}`;
    if (conversationHub.isReady && hubSessionId) {
        try {
            const session = conversationStore.getHubSession(hubSessionId);
            hubLine = session
                ? `${C.green}✅ sessão ${hubSessionId.slice(0, 8)}…${C.reset}`
                : `${C.yellow}⚠️  sessão não encontrada no store${C.reset}`;
        } catch {
            hubLine = `${C.red}❌ erro ao consultar store${C.reset}`;
        }
    } else if (!conversationHub.isReady) {
        hubLine = `${C.yellow}⚠️  hub não inicializado${C.reset}`;
    }

    // ── TODOs pendentes ───────────────────────────────────────────────────────
    /** @type {string} */
    let todoLines;
    try {
        const { readStore } = await import('../../tools/todo/store.js');
        const storeData = await readStore();
        const pending = Object.values(storeData.tasks)
            .filter(
                (/** @type {import('../../tools/todo/store.js').TodoItem} */ t) =>
                    t.status === 'todo' || t.status === 'in_progress',
            )
            .slice(0, 5);
        if (pending.length === 0) {
            todoLines = `${C.green}nenhum pendente${C.reset}`;
        } else {
            todoLines = pending
                .map(
                    (/** @type {import('../../tools/todo/store.js').TodoItem} */ t) =>
                        `  ${C.grey}•${C.reset} [${t.id.slice(0, 6)}] ${t.title}`,
                )
                .join('\n');
        }
    } catch {
        todoLines = `${C.grey}módulo não disponível${C.reset}`;
    }

    // ── Tool stats top-5 ─────────────────────────────────────────────────────
    /** @type {string} */
    let statsLines;
    try {
        const stats = getToolStats();
        const top5 = Object.entries(stats)
            .sort(([, a], [, b]) => (b.avgLatencyMs ?? 0) - (a.avgLatencyMs ?? 0))
            .slice(0, 5);
        if (top5.length === 0) {
            statsLines = `${C.grey}nenhum dado registrado${C.reset}`;
        } else {
            statsLines = top5
                .map(([name, s]) => {
                    const rate = s.calls > 0 ? Math.round(((s.calls - s.errors) / s.calls) * 100) : 0;
                    const col = rate >= 90 ? C.green : rate >= 70 ? C.yellow : C.red;
                    return `  ${C.grey}•${C.reset} ${name.padEnd(30)} ${col}${rate}%${C.reset} avg ${s.avgLatencyMs ?? 0}ms (${s.calls} calls)`;
                })
                .join('\n');
        }
    } catch {
        statsLines = `${C.grey}módulo não disponível${C.reset}`;
    }

    println(`
${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}
${C.bold}${C.cyan}║             Diagnóstico do Terminal LLM-B (F13.1)            ║${C.reset}
${C.bold}${C.cyan}╠══════════════════════════════════════════════════════════════╣${C.reset}
${C.cyan}  AGENTE${C.reset}
    status        ${agentStatusColor}${snap['status']}${C.reset}
    dialog loop   ${alwaysAliveAgent.dialogLoopActive ? `${C.green}● ativo${C.reset}` : `${C.red}○ inativo${C.reset}`}
    modelo        ${C.magenta}${snap['model']}${C.reset}
    reasoning     ${C.magenta}${snap['reasoningEffort'] ?? 'high'}${C.reset}

${C.cyan}  INFRAESTRUTURA${C.reset}
    MCP bridge    ${mcpLine}
    Hub storage   ${hubLine}
    Uptime        ${C.grey}${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s${C.reset}
    Memória RSS   ${memMB > 400 ? C.yellow : C.grey}${memMB}MB${C.reset}

${C.cyan}  TODOs PENDENTES (top-5)${C.reset}
${todoLines}

${C.cyan}  TOOL STATS — MAIOR LATÊNCIA (top-5)${C.reset}
${statsLines}
${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}
`);
}
