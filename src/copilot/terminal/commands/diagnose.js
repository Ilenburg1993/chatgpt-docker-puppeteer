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

import { readTerminalDiagnoseProjection } from '../frontend/index.js';

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
    const {
        snap,
        health,
        dialogLoopActive,
        binding,
        runtimeSessionId,
        mcp,
        memMB,
        uptimeSec,
        hub,
        todos,
        topToolStats,
    } = await readTerminalDiagnoseProjection({ hubSessionId: hubSessionId ?? null });

    const agentStatusColor =
        snap['status'] === 'waiting_for_input' ? C.green : snap['status'] === 'idle' ? C.yellow : C.red;
    const mcpLine =
        mcp.available && !mcp.circuitOpen && mcp.toolCount > 0
            ? `${C.green}✅ ${mcp.toolCount} tools (lat: ${mcp.latencyMs ?? '?'}ms)${C.reset}`
            : mcp.circuitOpen
              ? `${C.red}❌ circuit aberto${C.reset}`
              : `${C.yellow}⚠️  indisponível${C.reset}`;
    const hubLine =
        hub.summary === 'sem storage'
            ? `${C.grey}${hub.summary}${C.reset}`
            : hub.summary.includes('não inicializado')
              ? `${C.yellow}⚠️  ${hub.summary}${C.reset}`
              : hub.summary.includes('erro')
                ? `${C.red}❌ ${hub.summary}${C.reset}`
                : `${C.green}✅ ${hub.summary}${C.reset}`;
    const todoLines =
        todos.length === 0
            ? `${C.green}nenhum pendente${C.reset}`
            : todos.map((task) => `  ${C.grey}•${C.reset} [${task.id.slice(0, 6)}] ${task.title}`).join('\n');
    const statsLines =
        topToolStats.length === 0
            ? `${C.grey}nenhum dado registrado${C.reset}`
            : topToolStats
                  .map(([name, stat]) => {
                      const calls = Number(stat['calls'] ?? 0);
                      const errors = Number(stat['errors'] ?? 0);
                      const rate = calls > 0 ? Math.round(((calls - errors) / calls) * 100) : 0;
                      const col = rate >= 90 ? C.green : rate >= 70 ? C.yellow : C.red;
                      return `  ${C.grey}•${C.reset} ${name.padEnd(30)} ${col}${rate}%${C.reset} avg ${stat['avgLatencyMs'] ?? 0}ms (${calls} calls)`;
                  })
                  .join('\n');

    println(`
${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}
${C.bold}${C.cyan}║             Diagnóstico do Terminal LLM-B (F13.1)            ║${C.reset}
${C.bold}${C.cyan}╠══════════════════════════════════════════════════════════════╣${C.reset}
${C.cyan}  AGENTE${C.reset}
    status        ${agentStatusColor}${snap['status']}${C.reset}
    health        ${health ? `${health['status'] === 'healthy' ? C.green : health['status'] === 'degraded' ? C.yellow : C.red}${health['status']}${C.reset}` : `${C.grey}n/d${C.reset}`}
    dialog loop   ${dialogLoopActive ? `${C.green}● ativo${C.reset}` : `${C.red}○ inativo${C.reset}`}
    modelo        ${C.magenta}${snap['model']}${C.reset}
    reasoning     ${C.magenta}${snap['reasoningEffort'] ?? 'high'}${C.reset}
    runtime       ${runtimeSessionId ? `${C.grey}${runtimeSessionId}${C.reset}` : `${C.grey}(sem runtime)${C.reset}`}
    sdk session   ${binding.sdkSessionId ? `${C.grey}${binding.sdkSessionId}${C.reset}` : `${C.grey}(sem sdk)${C.reset}`}
    hub session   ${hub.activeHubSessionId ? `${C.grey}${hub.activeHubSessionId}${C.reset}` : `${C.grey}(sem hub)${C.reset}`}
    bg tasks      ${C.grey}${health?.['backgroundPendingCount'] ?? 0}${C.reset}
    keepalive     ${health?.['checks']?.['io']?.['keepaliveRunning'] ? `${C.green}running${C.reset}` : `${C.yellow}stopped${C.reset}`}
    quota monitor ${health?.['checks']?.['quota']?.['running'] ? `${C.green}running${C.reset}` : `${C.yellow}stopped${C.reset}`}
    issues        ${health ? (Array.isArray(health['issues']) && health['issues'].length === 0 ? `${C.green}nenhuma${C.reset}` : `${C.yellow}${Array.isArray(health['issues']) ? health['issues'].slice(0, 3).join(', ') : ''}${Array.isArray(health['issues']) && health['issues'].length > 3 ? '…' : ''}${C.reset}`) : `${C.grey}n/d${C.reset}`}

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
