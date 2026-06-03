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
    terminalThemeRow,
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

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderDiagnoseAgentStatus(value) {
    const status = String(value ?? 'unknown');
    if (status === 'idle') return 'ocioso';
    if (status === 'processing') return 'trabalhando';
    if (status === 'starting') return 'iniciando';
    if (status === 'waiting_for_input') return 'aguardando você';
    if (status === 'stopped') return 'parado';
    return status.replace(/[._-]+/gu, ' ') || 'n/d';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderDiagnoseSdkMode(value) {
    const mode = String(value ?? '');
    if (mode === 'interactive') return 'interativo';
    if (mode === 'plan') return 'plano';
    if (mode === 'autopilot') return 'autopiloto';
    if (mode === 'shell') return 'shell';
    return mode.replace(/[._-]+/gu, ' ') || 'desconhecido';
}

/**
 * @param {unknown} value
 * @returns {'approve_all' | 'audit_only' | 'selective'}
 */
function normalizeDiagnosePermissionMode(value) {
    const mode = String(value ?? '');
    if (mode === 'audit_only' || mode === 'selective') return mode;
    return 'approve_all';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderDiagnosePermissionMode(value) {
    const mode = normalizeDiagnosePermissionMode(value);
    if (mode === 'approve_all') return 'automáticas';
    if (mode === 'audit_only') return 'auditoria sem janelas';
    return 'seletivas';
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
                      return `  ${C.grey}•${C.reset} ${visualName} ${col}${rate}%${C.reset} média ${stat['avgLatencyMs'] ?? 0}ms (${pluralPt(calls, 'uso', 'usos')})`;
                  })
                  .join('\n');
    const activityDetail = activity.detail
        ? `${C.grey}${activity.detail}${C.reset}`
        : `${C.grey}(sem detalhe)${C.reset}`;
    const actionLine = renderCompactActionLine(health?.['recommendedAction']);
    const askUserLine = health?.['pendingQuestion']
        ? `vivo${health?.['pendingQuestionKind'] ? ` [${health['pendingQuestionKind']}]` : ''}`
        : health?.['pendingQuestionShadow']
          ? `${health?.['pendingQuestionShadowExpired'] ? 'pergunta restaurada expirada' : health?.['pendingQuestionShadowState'] === 'expiring_soon' ? 'pergunta restaurada expirando' : health?.['pendingQuestionShadowState'] === 'fresh' ? 'pergunta recém-restaurada' : 'pergunta restaurada'}${health?.['pendingQuestionShadowKind'] ? ` [${health['pendingQuestionShadowKind']}]` : ''}`
          : 'nenhum';
    const askUserAgeLine =
        typeof health?.['pendingQuestionShadowAgeMs'] === 'number'
            ? `${Math.round(Number(health['pendingQuestionShadowAgeMs']) / 1000)}s`
            : `${C.grey}-${C.reset}`;
    const askUserRemainingLine =
        typeof health?.['pendingQuestionShadowRemainingMs'] === 'number'
            ? `${Math.round(Number(health['pendingQuestionShadowRemainingMs']) / 1000)}s`
            : `${C.grey}-${C.reset}`;
    const sdkModeLine = configProjection.sdkSessionMode
        ? `${C.magenta}${renderDiagnoseSdkMode(configProjection.sdkSessionMode)}${C.reset}`
        : `${C.grey}desconhecido${C.reset}`;
    const permissionMode = normalizeDiagnosePermissionMode(configProjection.permissionMode);
    const permissionLine = `${C.magenta}${renderDiagnosePermissionMode(permissionMode)}${C.reset} ${C.grey}· prompts SDK ${terminalPermissionModeSkipsSdkPrompts(permissionMode) ? 'ignorados' : 'seletivos'}${C.reset}`;
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
    const runtimeSessionLabel = renderDiagnoseSessionId(runtimeSessionId, detail, '(sem runtime)');
    const sdkSessionLabel = renderDiagnoseSessionId(binding.sdkSessionId, detail, '(sem sdk)');
    const hubSessionLabel = renderDiagnoseSessionId(hub.activeHubSessionId, detail, '(sem hub)');

    if (!wantsFull) {
        const backgroundLine =
            typeof health?.['backgroundPendingCount'] === 'number' && health['backgroundPendingCount'] > 0
                ? ` · ${health['backgroundPendingCount']} tarefa(s) em segundo plano`
                : '';
        const activityProgress = typeof activity.progress === 'number' ? ` (${activity.progress}%)` : '';
        const activityDetailLine = activity.detail ? ` · ${activity.detail}` : '';
        println('');
        println(terminalThemeHeadline('assistant', 'Saúde do Terminal LLM-B'));
        println(terminalThemeDivider(36));
        println(
            terminalThemeRow(
                'Conversa',
                `${renderHumanRuntimeStatus(String(snap['status'] ?? 'unknown'))} · ${dialogLoopActive ? 'ativa' : 'inativa'}`,
                { role: renderRuntimeStatusRole(String(snap['status'] ?? 'unknown'), dialogLoopActive) },
            ),
        );
        println(
            terminalThemeRow('Modelo', `${snap['model']} · raciocínio ${configProjection.currentReasoningEffort}`, {
                role: 'assistant',
            }),
        );
        println(terminalThemeRow('Acesso', renderCompactByokLine(byok), { role: byok.ready ? 'success' : 'warn' }));
        println(terminalThemeRow('Gateway', renderCompactGatewayLine(gatewayProjection, gatewayActive)));
        println(terminalThemeRow('Entrada', `${askUserLine}${backgroundLine}`, { role: askUserLine === 'nenhum' ? 'muted' : 'question' }));
        println(terminalThemeRow('Ferramentas', renderCompactMcpLine(mcp, toolLoad), { role: renderCompactMcpRole(mcp, toolLoad) }));
        println(
            terminalThemeRow('Atividade', `${activity.label}${activityProgress}${activityDetailLine}`, {
                role: renderActivityRole(activity.severity),
            }),
        );
        println(
            terminalThemeRow(
                'Infra',
                `${renderHumanHealthStatus(String(health?.['status'] ?? 'unknown'))} · memória ${memMB}MB · uptime ${Math.floor(uptimeSec / 60)}m`,
                { role: renderHealthRole(String(health?.['status'] ?? 'unknown')) },
            ),
        );
        println(terminalThemeRow('Próximo', renderCompactActionLine(health?.['recommendedAction']), { role: 'command' }));
        println(terminalThemeRow('Detalhe', renderCommandList(['/health full', '/diagnose', '/tools diag', '/activity detail'])));
        println(terminalThemeDivider(36));
        if (configProjection.runtimeFallbackWarning) {
            println(
                terminalThemeRow(
                    'Nota',
                    `${configProjection.runtimeFallbackWarning} Diagnóstico exibido para o runtime default (${configProjection.runtimeId}).`,
                    { role: 'warn' },
                ),
            );
        }
        return;
    }

    println('');
    println(terminalThemeHeadline('assistant', 'Diagnóstico do Terminal LLM-B', ['full']));
    println(terminalThemeDivider(62));

    println(terminalThemeHeadline('assistant', 'Agente', ['runtime', 'modelo', 'entrada']));
    println(terminalThemeRow('Status', renderDiagnoseAgentStatus(snap['status']), { role: renderRuntimeStatusRole(String(snap['status'] ?? 'unknown'), dialogLoopActive) }));
    println(terminalThemeRow('Saúde', health ? renderHumanHealthStatus(String(health['status'] ?? 'unknown')) : 'sem leitura', { role: renderHealthRole(String(health?.['status'] ?? 'unknown')) }));
    println(terminalThemeRow('Conversa', dialogLoopActive ? 'ativa' : 'inativa', { role: dialogLoopActive ? 'success' : 'warn' }));
    println(terminalThemeRow('Modelo', `${snap['model']} · raciocínio ${configProjection.currentReasoningEffort}`, { role: 'assistant' }));
    println(terminalThemeRow('BYOK', byokLine, { role: byok.ready ? 'success' : byok.enabled ? 'warn' : 'muted' }));
    println(terminalThemeRow('Gateway', gatewayLine));
    println(terminalThemeRow('Modo SDK', sdkModeLine));
    println(terminalThemeRow('Permissões', permissionLine));
    println(terminalThemeRow('Plan arquivo', planOpLine));
    println(terminalThemeRow('Runtime alvo', configProjection.runtimeId));
    println(terminalThemeRow('Mapa runtime', runtimesLine));
    println(terminalThemeRow('Sessão runtime', runtimeSessionLabel));
    println(terminalThemeRow('Sessão SDK', sdkSessionLabel));
    println(terminalThemeRow('Sessão hub', hubSessionLabel));
    println(terminalThemeRow('Pergunta', askUserLine, { role: askUserLine === 'nenhum' ? 'muted' : 'question' }));
    println(terminalThemeRow('Shadow idade', askUserAgeLine));
    println(terminalThemeRow('Shadow rest.', askUserRemainingLine));
    println(terminalThemeRow('Ação', actionLine, { role: 'command' }));

    println('');
    println(terminalThemeHeadline('thinking', 'Atividade', ['pulso', 'display']));
    println(terminalThemeRow('Atual', `${activity.label}${typeof activity.progress === 'number' ? ` (${activity.progress}%)` : ''}`, { role: renderActivityRole(activity.severity) }));
    println(terminalThemeRow('Detalhe', activityDetail));
    println(terminalThemeRow('Tarefas', String(health?.['backgroundPendingCount'] ?? 0)));
    println(terminalThemeRow('Pulso', keepaliveLine));
    println(terminalThemeRow('Quota', health?.['checks']?.['quota']?.['running'] ? 'rodando' : 'parada', { role: health?.['checks']?.['quota']?.['running'] ? 'success' : 'warn' }));
    println(
        terminalThemeRow(
            'Issues',
            health
                ? Array.isArray(health['issues']) && health['issues'].length === 0
                    ? 'nenhuma'
                    : `${Array.isArray(health['issues']) ? health['issues'].slice(0, 3).join(', ') : ''}${Array.isArray(health['issues']) && health['issues'].length > 3 ? '...' : ''}`
                : 'n/d',
            { role: Array.isArray(health?.['issues']) && health['issues'].length === 0 ? 'success' : 'warn' },
        ),
    );
    println(
        terminalThemeRow(
            'Display',
            `raciocínio ${display.thinking ? 'on' : 'off'} · streaming ${display.streaming ? 'on' : 'off'} · uso ${display.usage ? 'on' : 'off'} · tools ${display.tools ? 'on' : 'off'} · intenção ${display.intent ? 'on' : 'off'}`,
        ),
    );
    println(
        terminalThemeRow(
            'Linha viva',
            `${display.inlineStatus.mode} · origem ${display.inlineStatus.source}${display.inlineStatus.overlay ? ' · overlay' : ''}`,
            { role: display.inlineStatus.enabled ? 'success' : 'warn' },
        ),
    );

    println('');
    println(terminalThemeHeadline('system', 'Infraestrutura', ['MCP', 'hub', 'timers']));
    println(terminalThemeRow('MCP bridge', mcpLine));
    println(terminalThemeRow('Hub storage', hubLine));
    println(terminalThemeRow('Boot report', bootLine));
    println(terminalThemeRow('Shutdown', shutdownLine));
    println(terminalThemeRow('Timers', timerLine));
    println(terminalThemeRow('Lifecycle mx', lifecycleMetricsLine));
    println(terminalThemeRow('Uptime', `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`));
    println(terminalThemeRow('Memória RSS', `${memMB}MB`, { role: memMB > 400 ? 'warn' : 'muted' }));
    println(terminalThemeRow('Rota SDK/FS', `${sdkFsRouting.mode} · ${sdkFsRouting.reason}`, { role: sdkFsRouting.mode === 'local-fs-primary' ? 'success' : sdkFsRouting.mode === 'sdk-workspace-only' ? 'warn' : 'error' }));

    println('');
    println(terminalThemeHeadline('warn', 'Pendências', ['top-5']));
    for (const line of todoLines.split('\n')) println(line);

    println('');
    println(terminalThemeHeadline('tool', 'Ferramentas por latência', ['top-5']));
    for (const line of statsLines.split('\n')) println(line);
    println(terminalThemeDivider(62));
    println('');

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
 * @param {boolean} active
 * @returns {'success' | 'warn' | 'error' | 'assistant'}
 */
function renderRuntimeStatusRole(value, active) {
    if (!active) return 'warn';
    if (value === 'waiting_for_input' || value === 'idle') return 'success';
    if (value === 'processing' || value === 'starting') return 'assistant';
    if (value === 'stopped') return 'warn';
    return 'error';
}

/**
 * @param {string} value
 * @returns {string}
 */
function renderHumanHealthStatus(value) {
    if (value === 'healthy') return 'ok';
    if (value === 'degraded') return 'atenção';
    if (value === 'unhealthy' || value === 'error') return 'problema';
    return value || 'desconhecida';
}

/**
 * @param {string} value
 * @returns {'success' | 'warn' | 'error' | 'muted'}
 */
function renderHealthRole(value) {
    if (value === 'healthy') return 'success';
    if (value === 'degraded') return 'warn';
    if (value === 'unhealthy' || value === 'error') return 'error';
    return 'muted';
}

/**
 * @param {unknown} severity
 * @returns {'success' | 'warn' | 'error'}
 */
function renderActivityRole(severity) {
    if (severity === 'error') return 'error';
    if (severity === 'warn') return 'warn';
    return 'success';
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
    if (!byok.enabled) return 'BYOK desligado';
    const auth = renderCompactAuthLabel(byok.auth);
    return `${byok.ready ? 'pronto' : 'incompleto'} · ${byok.providerType ?? byok.preset ?? 'provedor'} · ${byok.model ?? 'modelo'} · ${auth}`;
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
    if (projection.providerCount <= 0 && projection.modelCount <= 0) return 'catálogo desligado';
    const activeLabel = renderGatewayActiveLabel(active);
    return `${pluralPt(projection.providerCount, 'provedor', 'provedores')} · ${projection.enabledModelCount} de ${projection.modelCount} modelos habilitados · ${activeLabel}`;
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
        return `${mcp.toolCount} ferramenta(s) disponíveis${typeof mcp.latencyMs === 'number' ? ` · ${mcp.latencyMs}ms` : ''}`;
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
        return `locais ativas · ${signals.join(' · ') || 'registry local'} · MCP remoto ausente`;
    }
    if (mcp.circuitOpen) return 'ponte MCP pausada';
    return 'ponte MCP indisponível';
}

/**
 * @param {{ available: boolean; circuitOpen: boolean; toolCount: number }} mcp
 * @param {{ hasCanonicalLocalFsTools?: boolean; hasCanonicalLocalExecTools?: boolean; hasSdkWorkspaceTooling?: boolean } | null | undefined} toolLoad
 * @returns {'success' | 'warn' | 'error'}
 */
function renderCompactMcpRole(mcp, toolLoad) {
    if (mcp.available && !mcp.circuitOpen && mcp.toolCount > 0) return 'success';
    if (toolLoad?.hasCanonicalLocalFsTools || toolLoad?.hasCanonicalLocalExecTools || toolLoad?.hasSdkWorkspaceTooling) {
        return 'success';
    }
    return mcp.circuitOpen ? 'error' : 'warn';
}

/**
 * @param {unknown} action
 * @returns {string}
 */
function renderCompactActionLine(action) {
    const value = typeof action === 'string' ? action.trim() : '';
    if (!value || value === 'none') return 'nenhuma ação imediata';
    if (value === 'inspect_boot_report') return 'verificar relatório de inicialização';
    if (value === 'try_model_alternative') return 'testar modelo alternativo';
    if (value === 'check_quota') return 'verificar quota/limites';
    return value.replace(/_/gu, ' ');
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
