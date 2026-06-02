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

import { readTerminalConfigProjection, readTerminalDiagnoseProjection } from '../frontend/index.js';
import {
    formatTerminalIsoTimestamp,
    terminalPermissionModeSkipsSdkPrompts,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeText,
} from '../state/index.js';
import {
    compactTerminalDiagnosticId,
    compactTerminalToolText,
    getTerminalHumanToolName,
} from '../events/tool-activity-presenter.js';
import { callWithRuntimeTarget, extractRuntimeTarget, withRuntimeTarget } from './runtime-target.js';

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
 * @param {string[]} commands
 * @returns {string}
 */
function renderCommandList(commands) {
    return commands.map((command) => terminalThemeText('command', command)).join(terminalThemeText('muted', ' · '));
}

const DISABLED_BYOK_SUMMARY = Object.freeze({
    enabled: false,
    ready: false,
    preset: null,
    providerType: null,
    model: null,
    auth: {
        apiKeyConfigured: false,
        bearerTokenConfigured: false,
        headersConfigured: false,
    },
});

/**
 * Exibe diagnóstico completo do terminal LLM-B.
 *
 * @param {DiagnoseContext} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdDiagnose({ hubSessionId, println }, arg = '') {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const detail = /\b(?:detail|debug|--detail|--debug)\b/iu.test(cleanArg);
    const wantsFull = /\b(?:full|all|raw|diag|diagnose|detail|debug|--full|--detail|--debug)\b/iu.test(cleanArg);
    const configProjection = callWithRuntimeTarget(readTerminalConfigProjection, runtimeId);
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
        toolLoad,
        activity,
        display,
        lifecycle,
        sdkFsRouting,
    } = await readTerminalDiagnoseProjection(withRuntimeTarget({ hubSessionId: hubSessionId ?? null }, runtimeId));

    const agentStatusColor =
        snap['status'] === 'waiting_for_input' ? C.green : snap['status'] === 'idle' ? C.yellow : C.red;
    const mcpLine =
        mcp.available && !mcp.circuitOpen && mcp.toolCount > 0
            ? `${C.green}ok · ${mcp.toolCount} tools (lat: ${mcp.latencyMs ?? '?'}ms)${C.reset}`
            : mcp.circuitOpen
              ? `${C.red}falha · circuito aberto${C.reset}`
              : `${C.yellow}aviso · indisponível${C.reset}`;
    const hubLine =
        hub.summary === 'sem storage'
            ? `${C.grey}${hub.summary}${C.reset}`
            : hub.summary.includes('não inicializado')
              ? `${C.yellow}aviso · ${hub.summary}${C.reset}`
              : hub.summary.includes('erro')
                ? `${C.red}falha · ${hub.summary}${C.reset}`
                : `${C.green}ok · ${hub.summary}${C.reset}`;
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
                      const visualName = compactTerminalToolText(getTerminalHumanToolName(name), 28).padEnd(28);
                      return `  ${C.grey}•${C.reset} ${visualName} ${col}${rate}%${C.reset} avg ${stat['avgLatencyMs'] ?? 0}ms (${calls} calls)`;
                  })
                  .join('\n');
    const activityColor = activity.severity === 'error' ? C.red : activity.severity === 'warn' ? C.yellow : C.green;
    const activityDetail = activity.detail
        ? `${C.grey}${activity.detail}${C.reset}`
        : `${C.grey}(sem detalhe)${C.reset}`;
    const actionLine = renderCompactActionLine(health?.['recommendedAction']);
    const askUserLine = health?.['pendingQuestion']
        ? `${C.green}vivo${C.reset}${health?.['pendingQuestionKind'] ? ` [${health['pendingQuestionKind']}]` : ''}`
        : health?.['pendingQuestionShadow']
          ? `${health?.['pendingQuestionShadowExpired'] ? `${C.red}pergunta restaurada expirada${C.reset}` : health?.['pendingQuestionShadowState'] === 'expiring_soon' ? `${C.yellow}pergunta restaurada expirando${C.reset}` : health?.['pendingQuestionShadowState'] === 'fresh' ? `${C.cyan}pergunta recém-restaurada${C.reset}` : `${C.yellow}pergunta restaurada${C.reset}`}${health?.['pendingQuestionShadowKind'] ? ` [${health['pendingQuestionShadowKind']}]` : ''}`
          : `${C.grey}nenhum${C.reset}`;
    const askUserAgeLine =
        typeof health?.['pendingQuestionShadowAgeMs'] === 'number'
            ? `${Math.round(Number(health['pendingQuestionShadowAgeMs']) / 1000)}s`
            : `${C.grey}-${C.reset}`;
    const askUserRemainingLine =
        typeof health?.['pendingQuestionShadowRemainingMs'] === 'number'
            ? `${Math.round(Number(health['pendingQuestionShadowRemainingMs']) / 1000)}s`
            : `${C.grey}-${C.reset}`;
    const sdkModeLine = configProjection.sdkSessionMode
        ? `${C.magenta}${configProjection.sdkSessionMode}${C.reset}`
        : `${C.grey}desconhecido${C.reset}`;
    const permissionMode =
        configProjection.permissionMode === 'audit_only' || configProjection.permissionMode === 'selective'
            ? configProjection.permissionMode
            : 'approve_all';
    const permissionLine = `${C.magenta}${permissionMode}${C.reset} ${C.grey}· prompts SDK ${terminalPermissionModeSkipsSdkPrompts(permissionMode) ? 'ignorados' : 'seletivos'}${C.reset}`;
    const byok = configProjection.byok ?? DISABLED_BYOK_SUMMARY;
    const byokLine = byok.enabled
        ? `${byok.ready ? `${C.green}pronto${C.reset}` : `${C.red}incompleto${C.reset}`} ${C.grey}preset ${byok.preset ?? '-'} · provedor ${byok.providerType ?? '-'} · modelo ${byok.model ?? '-'} · autenticação ${renderCompactAuthLabel(byok.auth)}${C.reset}`
        : `${C.grey}off${C.reset}`;
    const gatewayProjection = configProjection.modelGatewayProjection ?? {
        providerCount: 0,
        modelCount: 0,
        enabledModelCount: 0,
        active: null,
    };
    const gatewayActive =
        gatewayProjection.active && typeof gatewayProjection.active === 'object' ? gatewayProjection.active : null;
    const gatewayLine =
        gatewayProjection.providerCount > 0 || gatewayProjection.modelCount > 0
            ? `${C.grey}${pluralPt(gatewayProjection.providerCount, 'provedor', 'provedores')} · ${pluralPt(gatewayProjection.modelCount, 'modelo', 'modelos')} · ${gatewayProjection.enabledModelCount} habilitados · ativo ${renderGatewayActiveLabel(gatewayActive)}${C.reset}`
            : `${C.grey}off${C.reset}`;
    const planOpLine = configProjection.sdkPlanOperation
        ? `${C.yellow}${configProjection.sdkPlanOperation}${C.reset}${configProjection.sdkPlanChangedAt ? ` ${C.grey}@ ${formatTerminalIsoTimestamp(configProjection.sdkPlanChangedAt)}${C.reset}` : ''}`
        : `${C.grey}(sem alteração)${C.reset}`;
    const runtimesLine =
        Array.isArray(configProjection.agentRuntimes) && configProjection.agentRuntimes.length > 0
            ? configProjection.agentRuntimes
                  .map((runtime) => {
                      const marker = runtime.isDefault ? '*' : '-';
                      return `${marker}${runtime.runtimeId}:${runtime.model}/${runtime.status}`;
                  })
                  .join('  •  ')
            : '(nenhum runtime registrado)';
    const bootReport = lifecycle.lastBootReport;
    const bootLine = bootReport
        ? `${bootReport.status === 'ok' ? C.green : C.red}${bootReport.status}${C.reset} ${C.grey}${bootReport.okCount}/${bootReport.phaseCount} fases · ${bootReport.durationMs}ms${bootReport.failedPhase ? ` · falha=${bootReport.failedPhase}` : ''}${C.reset}`
        : `${C.grey}n/d${C.reset}`;
    const shutdownReport = lifecycle.lastShutdownReport;
    const shutdownLine = lifecycle.shuttingDown
        ? `${C.yellow}em andamento${C.reset} ${C.grey}${lifecycle.shutdownHandlers.length} handlers${C.reset}`
        : shutdownReport
          ? `${shutdownReport.failedCount || shutdownReport.timeoutCount ? C.yellow : C.green}${shutdownReport.reason}${C.reset} ${C.grey}${shutdownReport.okCount}/${shutdownReport.handlerCount} handlers · ${shutdownReport.durationMs}ms${C.reset}`
          : `${C.grey}n/d${C.reset}`;
    const activeTimers = lifecycle.activeTimers ?? [];
    const timerLine =
        activeTimers.length === 0
            ? `${C.green}0 ativos${C.reset}`
            : `${C.yellow}${activeTimers.length} ativos${C.reset}${activeTimers[0] ? ` ${C.grey}· mais antigo ${activeTimers[0].id} há ${Math.round(activeTimers[0].ageMs / 1000)}s${C.reset}` : ''}`;
    const bootMetrics = lifecycle.bootMetrics ?? [];
    const slowestBootPhase = bootMetrics[0] ?? null;
    const shutdownMetrics = lifecycle.shutdownMetrics ?? [];
    const slowestShutdownHandler = shutdownMetrics[0] ?? null;
    const lifecycleMetricsLine =
        slowestBootPhase || slowestShutdownHandler
            ? `${slowestBootPhase ? `boot ${slowestBootPhase.id} · média ${slowestBootPhase.avgDurationMs}ms` : 'boot n/d'} ${C.grey}·${C.reset} ${slowestShutdownHandler ? `shutdown ${slowestShutdownHandler.name} · média ${slowestShutdownHandler.avgDurationMs}ms` : 'shutdown n/d'}`
            : `${C.grey}n/d${C.reset}`;
    const keepaliveRunning = Boolean(health?.['checks']?.['io']?.['keepaliveRunning']);
    const keepaliveOk = Boolean(health?.['checks']?.['io']?.['ok']);
    const keepaliveLine = keepaliveRunning
        ? `${C.green}rodando${C.reset}`
        : keepaliveOk
          ? `${C.green}standby da conversa${C.reset}`
          : `${C.yellow}parado${C.reset}`;
    const sdkFsRouteModeColor =
        sdkFsRouting.mode === 'local-fs-primary'
            ? C.green
            : sdkFsRouting.mode === 'sdk-workspace-only'
              ? C.yellow
              : C.red;
    const runtimeSessionLabel = renderDiagnoseSessionId(runtimeSessionId, detail, '(sem runtime)');
    const sdkSessionLabel = renderDiagnoseSessionId(binding.sdkSessionId, detail, '(sem sdk)');
    const hubSessionLabel = renderDiagnoseSessionId(hub.activeHubSessionId, detail, '(sem hub)');

    if (!wantsFull) {
        println(`
${terminalThemeHeadline('assistant', 'Saúde do Terminal LLM-B')}
${terminalThemeDivider(36)}
  Conversa     ${agentStatusColor}${renderHumanRuntimeStatus(String(snap['status'] ?? 'unknown'))}${C.reset} ${dialogLoopActive ? `${C.grey}· ativa${C.reset}` : `${C.yellow}· inativa${C.reset}`}
  Modelo       ${C.magenta}${snap['model']}${C.reset} ${C.grey}· raciocínio ${configProjection.currentReasoningEffort}${C.reset}
  Acesso       ${renderCompactByokLine(byok)}
  Gateway      ${renderCompactGatewayLine(gatewayProjection, gatewayActive)}
  Entrada      ${askUserLine}${typeof health?.['backgroundPendingCount'] === 'number' && health['backgroundPendingCount'] > 0 ? ` ${C.grey}· ${health['backgroundPendingCount']} tarefa(s) em segundo plano${C.reset}` : ''}
  Ferramentas  ${renderCompactMcpLine(mcp, toolLoad)}
  Atividade    ${activityColor}${activity.label}${C.reset}${typeof activity.progress === 'number' ? ` ${C.grey}(${activity.progress}%)${C.reset}` : ''} ${activity.detail ? `${C.grey}· ${activity.detail}${C.reset}` : ''}
  Infra        ${renderHumanHealthStatus(String(health?.['status'] ?? 'unknown'))} ${C.grey}· memória ${memMB}MB · uptime ${Math.floor(uptimeSec / 60)}m${C.reset}
  Próximo      ${renderCompactActionLine(health?.['recommendedAction'])}
  Detalhe      ${renderCommandList(['/health full', '/diagnose', '/tools diag', '/activity detail'])}
${terminalThemeDivider(36)}
`);
        if (configProjection.runtimeFallbackWarning) {
            println(
                `${C.yellow}  Nota: ${configProjection.runtimeFallbackWarning} Diagnóstico exibido para o runtime default (${configProjection.runtimeId}).${C.reset}`,
            );
        }
        return;
    }

    println(`
${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}
${C.bold}${C.cyan}║             Diagnóstico do Terminal LLM-B (F13.1)            ║${C.reset}
${C.bold}${C.cyan}╠══════════════════════════════════════════════════════════════╣${C.reset}
${C.cyan}  AGENTE${C.reset}
    status        ${agentStatusColor}${snap['status']}${C.reset}
    health        ${health ? `${health['status'] === 'healthy' ? C.green : health['status'] === 'degraded' ? C.yellow : C.red}${health['status']}${C.reset}` : `${C.grey}n/d${C.reset}`}
    conversa      ${dialogLoopActive ? `${C.green}● ativa${C.reset}` : `${C.red}○ inativa${C.reset}`}
    modelo        ${C.magenta}${snap['model']}${C.reset}
    byok          ${byokLine}
    gateway       ${gatewayLine}
    raciocínio    ${C.magenta}${configProjection.currentReasoningEffort}${C.reset}
    modo SDK      ${sdkModeLine}
    permissão     ${permissionLine}
    plan arquivo  ${planOpLine}
    runtime alvo  ${C.grey}${configProjection.runtimeId}${C.reset}
    mapa runtime  ${C.grey}${runtimesLine}${C.reset}
    sessão runtime ${C.grey}${runtimeSessionLabel}${C.reset}
    sessão SDK    ${C.grey}${sdkSessionLabel}${C.reset}
    sessão hub    ${C.grey}${hubSessionLabel}${C.reset}
    tarefas       ${C.grey}${health?.['backgroundPendingCount'] ?? 0}${C.reset}
    pulso         ${keepaliveLine}
    quota         ${health?.['checks']?.['quota']?.['running'] ? `${C.green}rodando${C.reset}` : `${C.yellow}parada${C.reset}`}
    issues        ${health ? (Array.isArray(health['issues']) && health['issues'].length === 0 ? `${C.green}nenhuma${C.reset}` : `${C.yellow}${Array.isArray(health['issues']) ? health['issues'].slice(0, 3).join(', ') : ''}${Array.isArray(health['issues']) && health['issues'].length > 3 ? '…' : ''}${C.reset}`) : `${C.grey}n/d${C.reset}`}
    ação          ${actionLine}
    pergunta      ${askUserLine}
    salva idade   ${askUserAgeLine}
    salva rest.   ${askUserRemainingLine}
    atividade     ${activityColor}${activity.label}${C.reset}${typeof activity.progress === 'number' ? ` ${C.grey}(${activity.progress}%)${C.reset}` : ''}
    detalhe       ${activityDetail}
    display       ${C.grey}raciocínio ${display.thinking ? 'on' : 'off'} · streaming ${display.streaming ? 'on' : 'off'} · uso ${display.usage ? 'on' : 'off'} · tools ${display.tools ? 'on' : 'off'} · intenção ${display.intent ? 'on' : 'off'}${C.reset}
    inline status ${display.inlineStatus.enabled ? C.green : C.yellow}${display.inlineStatus.mode}${C.reset} ${C.grey}origem ${display.inlineStatus.source}${display.inlineStatus.overlay ? ' · overlay' : ''}${C.reset}

${C.cyan}  INFRAESTRUTURA${C.reset}
    MCP bridge    ${mcpLine}
    Hub storage   ${hubLine}
    Boot report   ${bootLine}
    Shutdown      ${shutdownLine}
    Timers        ${timerLine}
    Lifecycle mx  ${lifecycleMetricsLine}
    Uptime        ${C.grey}${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s${C.reset}
    Memória RSS   ${memMB > 400 ? C.yellow : C.grey}${memMB}MB${C.reset}
    rota sdk↔fs   ${sdkFsRouteModeColor}${sdkFsRouting.mode}${C.reset} ${C.grey}(${sdkFsRouting.reason})${C.reset}

${C.cyan}  TODOs PENDENTES (top-5)${C.reset}
${todoLines}

${C.cyan}  TOOL STATS — MAIOR LATÊNCIA (top-5)${C.reset}
${statsLines}
${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}
`);

    if (configProjection.runtimeFallbackWarning) {
        println(
            `${C.yellow}  Nota: ${configProjection.runtimeFallbackWarning} Diagnóstico exibido para o runtime default (${configProjection.runtimeId}).${C.reset}`,
        );
    }
}

/**
 * @param {string | null | undefined} value
 * @param {boolean} detail
 * @param {string} emptyLabel
 * @returns {string}
 */
function renderDiagnoseSessionId(value, detail, emptyLabel) {
    if (!value) return emptyLabel;
    return detail ? value : (compactTerminalDiagnosticId(value, 14) ?? value);
}

/**
 * @param {string} value
 * @returns {string}
 */
function renderHumanRuntimeStatus(value) {
    if (value === 'processing') return 'trabalhando';
    if (value === 'waiting_for_input') return 'aguardando você';
    if (value === 'idle') return 'ocioso';
    if (value === 'starting') return 'iniciando';
    if (value === 'stopped') return 'parado';
    return value || 'desconhecido';
}

/**
 * @param {string} value
 * @returns {string}
 */
function renderHumanHealthStatus(value) {
    if (value === 'healthy') return `${C.green}ok${C.reset}`;
    if (value === 'degraded') return `${C.yellow}atenção${C.reset}`;
    if (value === 'unhealthy' || value === 'error') return `${C.red}problema${C.reset}`;
    return `${C.grey}${value || 'desconhecida'}${C.reset}`;
}

/**
 * @param {{
 *     enabled: boolean;
 *     ready: boolean;
 *     preset?: string | null;
 *     providerType?: string | null;
 *     model?: string | null;
 *     auth: { apiKeyConfigured?: boolean; bearerTokenConfigured?: boolean; headersConfigured?: boolean };
 * }} byok
 * @returns {string}
 */
function renderCompactByokLine(byok) {
    if (!byok.enabled) return `${C.grey}BYOK desligado${C.reset}`;
    const auth = renderCompactAuthLabel(byok.auth);
    const color = byok.ready ? C.green : C.red;
    return `${color}${byok.ready ? 'pronto' : 'incompleto'}${C.reset} ${C.grey}· ${byok.providerType ?? byok.preset ?? 'provedor'} · ${byok.model ?? 'modelo'} · ${auth}${C.reset}`;
}

/**
 * @param {{ apiKeyConfigured?: boolean; bearerTokenConfigured?: boolean; headersConfigured?: boolean }} auth
 * @returns {string}
 */
function renderCompactAuthLabel(auth) {
    if (auth.bearerTokenConfigured) return 'token bearer';
    if (auth.apiKeyConfigured) return 'chave API';
    if (auth.headersConfigured) return 'headers';
    return 'sem credencial';
}

/**
 * @param {{ providerCount: number; modelCount: number; enabledModelCount: number; active: unknown }} projection
 * @param {Record<string, unknown> | null} active
 * @returns {string}
 */
function renderCompactGatewayLine(projection, active) {
    if (projection.providerCount <= 0 && projection.modelCount <= 0) return `${C.grey}catálogo desligado${C.reset}`;
    const activeLabel = renderGatewayActiveLabel(active);
    return `${C.grey}${pluralPt(projection.providerCount, 'provedor', 'provedores')} · ${projection.enabledModelCount} de ${projection.modelCount} modelos habilitados · ${activeLabel}${C.reset}`;
}

/**
 * @param {Record<string, unknown> | null} active
 * @returns {string}
 */
function renderGatewayActiveLabel(active) {
    if (!active) return 'sem modelo ativo';
    const provider = typeof active?.['providerId'] === 'string' ? active['providerId'] : '';
    const rawModel = typeof active?.['modelId'] === 'string' ? active['modelId'] : 'sem modelo ativo';
    const model = provider && rawModel.startsWith(`${provider}:`) ? rawModel.slice(provider.length + 1) : rawModel;
    return provider ? `${provider} · ${model}` : model;
}

/**
 * @param {{ available: boolean; circuitOpen: boolean; toolCount: number; latencyMs: number | null }} mcp
 * @param {{ total?: number; hasCanonicalLocalFsTools?: boolean; hasCanonicalLocalExecTools?: boolean; hasSdkWorkspaceTooling?: boolean } | null | undefined} toolLoad
 * @returns {string}
 */
function renderCompactMcpLine(mcp, toolLoad) {
    if (mcp.available && !mcp.circuitOpen && mcp.toolCount > 0) {
        return `${C.green}${mcp.toolCount} ferramenta(s) disponíveis${C.reset}${typeof mcp.latencyMs === 'number' ? ` ${C.grey}· ${mcp.latencyMs}ms${C.reset}` : ''}`;
    }
    const localReady = Boolean(
        toolLoad?.hasCanonicalLocalFsTools || toolLoad?.hasCanonicalLocalExecTools || toolLoad?.hasSdkWorkspaceTooling,
    );
    if (localReady) {
        const signals = [
            toolLoad?.hasCanonicalLocalFsTools ? 'arquivos' : null,
            toolLoad?.hasCanonicalLocalExecTools ? 'terminal' : null,
            toolLoad?.hasSdkWorkspaceTooling ? 'workspace SDK' : null,
        ].filter(Boolean);
        return `${C.green}locais ativas${C.reset} ${C.grey}· ${signals.join(' · ') || 'registry local'} · MCP remoto ausente${C.reset}`;
    }
    if (mcp.circuitOpen) return `${C.red}ponte MCP pausada${C.reset}`;
    return `${C.yellow}ponte MCP indisponível${C.reset}`;
}

/**
 * @param {unknown} action
 * @returns {string}
 */
function renderCompactActionLine(action) {
    const value = typeof action === 'string' ? action.trim() : '';
    if (!value || value === 'none') return `${C.grey}nenhuma ação imediata${C.reset}`;
    if (value === 'inspect_boot_report') return `${C.yellow}verificar relatório de inicialização${C.reset}`;
    if (value === 'try_model_alternative') return `${C.yellow}testar modelo alternativo${C.reset}`;
    if (value === 'check_quota') return `${C.yellow}verificar quota/limites${C.reset}`;
    return `${C.yellow}${value}${C.reset}`;
}

/**
 * @param {number} value
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function pluralPt(value, singular, plural) {
    return `${value} ${value === 1 ? singular : plural}`;
}
