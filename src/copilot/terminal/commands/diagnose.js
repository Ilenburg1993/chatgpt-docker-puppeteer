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
 * - Status do MCP remoto (circuit breaker, tools count, disponibilidade)
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
    formatTerminalTimeLabel,
    renderTerminalPendingQuestionKindLabel,
    terminalPermissionModeSkipsSdkPrompts,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeText,
} from '../state/index.js';
import {
    compactTerminalToolText,
    getTerminalHumanToolName,
    humanizeTerminalToolSurfaceText,
} from '../events/tool-activity-presenter.js';
import { callWithRuntimeTarget, extractRuntimeTarget, withRuntimeTarget } from './runtime-target.js';

/**
 * @typedef {object} DiagnoseContext
 * @property {string | null} [hubSessionId]
 * @property {(text: string) => void} println
 */

/**
 * @param {'assistant' | 'command' | 'error' | 'muted' | 'question' | 'success' | 'tool' | 'warn'} role
 * @param {string} text
 * @returns {string}
 */
function diagnoseText(role, text) {
    return terminalThemeText(role, text);
}

/**
 * @param {string[]} commands
 * @returns {string}
 */
function renderCommandList(commands) {
    return commands.map((command) => terminalThemeText('command', command)).join(terminalThemeText('muted', ' · '));
}

/**
 * @param {string} text
 * @returns {string}
 */
function humanizeDiagnoseToolIdentifiers(text) {
    return humanizeTerminalToolSurfaceText(text);
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

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderDiagnoseLifecycleMetricLabel(value) {
    const id = String(value ?? '').trim();
    if (!id) return 'sem amostra';
    if (id === 'sdk-preflight') return 'checagem do SDK';
    if (id === 'boot') return 'inicialização';
    if (id === 'shutdown') return 'encerramento';
    return id
        .replace(/^terminal[._-]+/u, '')
        .replace(/^bootstrap[._-]+/u, '')
        .replace(/[._-]+/gu, ' ');
}

/**
 * @param {{ id?: unknown; avgDurationMs?: unknown } | null} slowestBootPhase
 * @param {{ name?: unknown; avgDurationMs?: unknown } | null} slowestShutdownHandler
 * @returns {string}
 */
function renderDiagnoseLifecycleMetricsLine(slowestBootPhase, slowestShutdownHandler) {
    if (!slowestBootPhase && !slowestShutdownHandler) return diagnoseText('muted', 'sem amostra');
    const bootLine = slowestBootPhase
        ? `inicialização ${renderDiagnoseLifecycleMetricLabel(slowestBootPhase.id)} · média ${slowestBootPhase.avgDurationMs ?? '?'}ms`
        : 'inicialização sem amostra';
    const shutdownLine = slowestShutdownHandler
        ? `encerramento ${renderDiagnoseLifecycleMetricLabel(slowestShutdownHandler.name)} · média ${slowestShutdownHandler.avgDurationMs ?? '?'}ms`
        : 'encerramento sem amostra';
    return `${bootLine} ${diagnoseText('muted', '·')} ${shutdownLine}`;
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
            ? diagnoseText(
                  'success',
                  `ok · ${pluralPt(mcp.toolCount, 'ferramenta', 'ferramentas')} · latência ${mcp.latencyMs ?? '?'}ms`,
              )
            : mcp.circuitOpen
              ? diagnoseText('error', 'falha · circuito aberto')
              : diagnoseText('warn', 'aviso · remoto indisponível');
    const hubSummary = renderDiagnoseHubStorageSummary(hub.summary, detail);
    const hubLine =
        hubSummary === 'sem histórico local'
            ? diagnoseText('muted', hubSummary)
            : hubSummary.includes('não inicializado')
              ? diagnoseText('warn', `aviso · ${hubSummary}`)
              : hubSummary.includes('erro')
                ? diagnoseText('error', `falha · ${hubSummary}`)
                : diagnoseText('success', `ok · ${hubSummary}`);
    const todoLines =
        todos.length === 0
            ? diagnoseText('success', 'nenhum pendente')
            : todos.map((task) => `  ${diagnoseText('muted', '•')} [${task.id.slice(0, 6)}] ${task.title}`).join('\n');
    const statsLines =
        topToolStats.length === 0
            ? diagnoseText('muted', 'nenhum dado registrado')
            : topToolStats
                  .map(([name, stat]) => {
                      const calls = Number(stat['calls'] ?? 0);
                      const errors = Number(stat['errors'] ?? 0);
                      const rate = calls > 0 ? Math.round(((calls - errors) / calls) * 100) : 0;
                      const role = rate >= 90 ? 'success' : rate >= 70 ? 'warn' : 'error';
                      const visualName = compactTerminalToolText(getTerminalHumanToolName(name), 28).padEnd(28);
                      return `  ${diagnoseText('muted', '•')} ${visualName} ${diagnoseText(role, `${rate}%`)} média ${stat['avgLatencyMs'] ?? 0}ms (${pluralPt(calls, 'uso', 'usos')})`;
                  })
                  .join('\n');
    const activityDetail = activity.detail
        ? diagnoseText('muted', humanizeDiagnoseToolIdentifiers(activity.detail))
        : diagnoseText('muted', '(sem detalhe)');
    const actionLine = renderCompactActionLine(health?.['recommendedAction']);
    const askUserLine = health?.['pendingQuestion']
        ? `vivo${
              health?.['pendingQuestionKind']
                  ? ` [${renderTerminalPendingQuestionKindLabel(health['pendingQuestionKind'])}]`
                  : ''
          }`
        : health?.['pendingQuestionShadow']
          ? `${health?.['pendingQuestionShadowExpired'] ? 'pergunta restaurada expirada' : health?.['pendingQuestionShadowState'] === 'expiring_soon' ? 'pergunta restaurada expirando' : health?.['pendingQuestionShadowState'] === 'fresh' ? 'pergunta recém-restaurada' : 'pergunta restaurada'}${
                health?.['pendingQuestionShadowKind']
                    ? ` [${renderTerminalPendingQuestionKindLabel(health['pendingQuestionShadowKind'])}]`
                    : ''
            }`
          : 'nenhum';
    const askUserAgeLine =
        typeof health?.['pendingQuestionShadowAgeMs'] === 'number'
            ? `${Math.round(Number(health['pendingQuestionShadowAgeMs']) / 1000)}s`
            : diagnoseText('muted', '-');
    const askUserRemainingLine =
        typeof health?.['pendingQuestionShadowRemainingMs'] === 'number'
            ? `${Math.round(Number(health['pendingQuestionShadowRemainingMs']) / 1000)}s`
            : diagnoseText('muted', '-');
    const sdkModeLine = configProjection.sdkSessionMode
        ? diagnoseText('assistant', renderDiagnoseSdkMode(configProjection.sdkSessionMode))
        : diagnoseText('muted', 'desconhecido');
    const permissionMode = normalizeDiagnosePermissionMode(configProjection.permissionMode);
    const permissionLine = `${diagnoseText('assistant', renderDiagnosePermissionMode(permissionMode))} ${diagnoseText('muted', `· prompts SDK ${terminalPermissionModeSkipsSdkPrompts(permissionMode) ? 'ignorados' : 'seletivos'}`)}`;
    const byok = configProjection.byok ?? DISABLED_BYOK_SUMMARY;
    const byokLine = byok.enabled
        ? `${byok.ready ? diagnoseText('success', 'pronto') : diagnoseText('error', 'incompleto')} ${diagnoseText('muted', `preset ${byok.preset ?? '-'} · provedor ${byok.providerType ?? '-'} · modelo ${byok.model ?? '-'} · autenticação ${renderCompactAuthLabel(byok.auth)}`)}`
        : diagnoseText('muted', 'off');
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
            ? diagnoseText(
                  'muted',
                  `${pluralPt(gatewayProjection.providerCount, 'provedor', 'provedores')} · ${pluralPt(gatewayProjection.modelCount, 'modelo', 'modelos')} · ${gatewayProjection.enabledModelCount} habilitados · ativo ${renderGatewayActiveLabel(gatewayActive)}`,
              )
            : diagnoseText('muted', 'off');
    const planOpLine = configProjection.sdkPlanOperation
        ? `${diagnoseText('warn', configProjection.sdkPlanOperation)}${configProjection.sdkPlanChangedAt ? ` ${diagnoseText('muted', `@ ${formatTerminalTimeLabel(configProjection.sdkPlanChangedAt, { mode: 'dual' })}`)}` : ''}`
        : diagnoseText('muted', '(sem alteração)');
    const runtimesLine =
        Array.isArray(configProjection.agentRuntimes) && configProjection.agentRuntimes.length > 0
            ? renderDiagnoseRuntimeMap(configProjection.agentRuntimes, detail)
            : '(nenhum runtime registrado)';
    const bootReport = lifecycle.lastBootReport;
    const bootLine = bootReport
        ? `${diagnoseText(bootReport.status === 'ok' ? 'success' : 'error', bootReport.status === 'ok' ? 'ok' : 'problema')} ${diagnoseText('muted', `${bootReport.okCount}/${bootReport.phaseCount} fases · ${bootReport.durationMs}ms${bootReport.failedPhase ? ` · falha em ${renderDiagnoseLifecycleMetricLabel(bootReport.failedPhase)}` : ''}`)}`
        : diagnoseText('muted', 'sem amostra');
    const shutdownReport = lifecycle.lastShutdownReport;
    const shutdownLine = lifecycle.shuttingDown
        ? `${diagnoseText('warn', 'em andamento')} ${diagnoseText('muted', pluralPt(lifecycle.shutdownHandlers.length, 'rotina', 'rotinas'))}`
        : shutdownReport
          ? `${diagnoseText(shutdownReport.failedCount || shutdownReport.timeoutCount ? 'warn' : 'success', renderDiagnoseLifecycleReason(shutdownReport.reason))} ${diagnoseText('muted', `${shutdownReport.okCount}/${shutdownReport.handlerCount} rotinas · ${shutdownReport.durationMs}ms`)}`
          : diagnoseText('muted', 'sem amostra');
    const activeTimers = lifecycle.activeTimers ?? [];
    const timerLine =
        activeTimers.length === 0
            ? diagnoseText('success', '0 ativos')
            : `${diagnoseText('warn', `${activeTimers.length} ativos`)}${activeTimers[0] ? ` ${diagnoseText('muted', `· mais antigo ${renderDiagnoseTimerLabel(activeTimers[0].id, detail)} há ${Math.round(activeTimers[0].ageMs / 1000)}s`)}` : ''}`;
    const bootMetrics = lifecycle.bootMetrics ?? [];
    const slowestBootPhase = bootMetrics[0] ?? null;
    const shutdownMetrics = lifecycle.shutdownMetrics ?? [];
    const slowestShutdownHandler = shutdownMetrics[0] ?? null;
    const lifecycleMetricsLine = renderDiagnoseLifecycleMetricsLine(slowestBootPhase, slowestShutdownHandler);
    const keepaliveRunning = Boolean(health?.['checks']?.['io']?.['keepaliveRunning']);
    const keepaliveOk = Boolean(health?.['checks']?.['io']?.['ok']);
    const keepaliveLine = keepaliveRunning
        ? diagnoseText('success', 'rodando')
        : keepaliveOk
          ? diagnoseText('success', 'standby da conversa')
          : diagnoseText('warn', 'parado');
    const runtimeSessionLabel = renderDiagnoseSessionId(runtimeSessionId, detail, 'sem runtime', 'ativa');
    const sdkSessionLabel = renderDiagnoseSessionId(binding.sdkSessionId, detail, 'sem SDK', 'ativa');
    const hubSessionLabel = renderDiagnoseSessionId(hub.activeHubSessionId, detail, 'sem hub', 'ativo');

    if (!wantsFull) {
        const backgroundLine =
            typeof health?.['backgroundPendingCount'] === 'number' && health['backgroundPendingCount'] > 0
                ? ` · ${health['backgroundPendingCount']} tarefa(s) em segundo plano`
                : '';
        const activityProgress = typeof activity.progress === 'number' ? ` (${activity.progress}%)` : '';
        const activityDetailLine = activity.detail ? ` · ${humanizeDiagnoseToolIdentifiers(activity.detail)}` : '';
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
            terminalThemeRow('Atividade', `${humanizeDiagnoseToolIdentifiers(activity.label)}${activityProgress}${activityDetailLine}`, {
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
    println(terminalThemeRow('Ambiente alvo', renderDiagnoseRuntimeTarget(configProjection.runtimeId, detail)));
    println(terminalThemeRow('Mapa ambiente', runtimesLine));
    println(terminalThemeRow('Sessão ambiente', runtimeSessionLabel));
    println(terminalThemeRow('Sessão SDK', sdkSessionLabel));
    println(terminalThemeRow('Sessão hub', hubSessionLabel));
    println(terminalThemeRow('Pergunta', askUserLine, { role: askUserLine === 'nenhum' ? 'muted' : 'question' }));
    println(terminalThemeRow('Pergunta idade', askUserAgeLine));
    println(terminalThemeRow('Expira em', askUserRemainingLine));
    println(terminalThemeRow('Ação', actionLine, { role: 'command' }));

    println('');
    println(terminalThemeHeadline('thinking', 'Atividade', ['pulso', 'display']));
    println(terminalThemeRow('Atual', `${humanizeDiagnoseToolIdentifiers(activity.label)}${typeof activity.progress === 'number' ? ` (${activity.progress}%)` : ''}`, { role: renderActivityRole(activity.severity) }));
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
            `raciocínio ${renderDiagnoseBooleanFlag(display.thinking)} · streaming ${renderDiagnoseBooleanFlag(display.streaming)} · uso ${renderDiagnoseBooleanFlag(display.usage)} · ferramentas ${renderDiagnoseBooleanFlag(display.tools)} · intenção ${renderDiagnoseBooleanFlag(display.intent)}`,
        ),
    );
    println(
        terminalThemeRow(
            'Linha viva',
            `${renderDiagnoseInlineStatusMode(display.inlineStatus.mode)} · origem ${renderDiagnoseInlineStatusSource(display.inlineStatus.source)}${display.inlineStatus.overlay ? ' · sobreposição' : ''}`,
            { role: display.inlineStatus.enabled ? 'success' : 'warn' },
        ),
    );

    println('');
    println(terminalThemeHeadline('system', 'Infraestrutura', ['MCP', 'hub', 'timers']));
    println(terminalThemeRow('MCP remoto', mcpLine));
    println(terminalThemeRow('Histórico', hubLine));
    println(terminalThemeRow('Inicialização', bootLine));
    println(terminalThemeRow('Encerramento', shutdownLine));
    println(terminalThemeRow('Temporizadores', timerLine));
    println(terminalThemeRow('Ciclo de vida', lifecycleMetricsLine));
    println(terminalThemeRow('Uptime', `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`));
    println(terminalThemeRow('Memória RSS', `${memMB}MB`, { role: memMB > 400 ? 'warn' : 'muted' }));
    println(terminalThemeRow('Rota SDK/FS', `${renderDiagnoseSdkFsRouteMode(sdkFsRouting.mode)} · ${sdkFsRouting.reason}`, { role: sdkFsRouting.mode === 'local-fs-primary' ? 'success' : sdkFsRouting.mode === 'sdk-workspace-only' ? 'warn' : 'error' }));

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
            diagnoseText(
                'warn',
                `  Nota: ${configProjection.runtimeFallbackWarning} Diagnóstico exibido para o runtime default (${configProjection.runtimeId}).`,
            ),
        );
    }
}

/**
 * @param {string | null | undefined} value
 * @param {boolean} detail
 * @param {string} emptyLabel
 * @param {string} activeLabel
 * @returns {string}
 */
function renderDiagnoseSessionId(value, detail, emptyLabel, activeLabel) {
    if (!value) return emptyLabel;
    return detail ? value : activeLabel;
}

/**
 * @param {string | null | undefined} summary
 * @param {boolean} detail
 * @returns {string}
 */
function renderDiagnoseHubStorageSummary(summary, detail) {
    const value = String(summary ?? '').trim();
    if (!value) return 'sem histórico local';
    if (detail) return value;
    return value.replace(/^sessão\s+[a-z0-9_-]+…?$/iu, 'sessão ativa');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderDiagnoseLifecycleReason(value) {
    const reason = String(value ?? '').trim();
    if (!reason) return 'sem motivo registrado';
    if (reason === 'process-exit') return 'encerramento do processo';
    if (reason === 'operator') return 'solicitado pelo operador';
    if (reason === 'shutdown') return 'encerramento';
    return reason.replace(/[._-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderDiagnoseBooleanFlag(value) {
    return value ? 'ativo' : 'inativo';
}

/**
 * @param {unknown} value
 * @param {boolean} detail
 * @returns {string}
 */
function renderDiagnoseRuntimeTarget(value, detail) {
    const runtimeId = String(value ?? '').trim();
    if (!runtimeId) return 'principal';
    if (detail) return runtimeId;
    return runtimeId === 'default' ? 'principal' : runtimeId;
}

/**
 * @param {Array<{ runtimeId?: string; model?: string; status?: string; isDefault?: boolean }>} runtimes
 * @param {boolean} detail
 * @returns {string}
 */
function renderDiagnoseRuntimeMap(runtimes, detail) {
    return runtimes
        .map((runtime) => {
            const runtimeLabel = renderDiagnoseRuntimeTarget(runtime.runtimeId, detail);
            const scope = runtime.isDefault ? 'principal' : runtimeLabel;
            const model = runtime.model || 'sem modelo';
            const status = detail ? String(runtime.status ?? 'desconhecido') : renderHumanRuntimeStatus(String(runtime.status ?? 'unknown'));
            return detail
                ? `${runtime.isDefault ? '*' : '-'}${runtime.runtimeId}:${model}/${runtime.status}`
                : `${scope} · ${model} · ${status}`;
        })
        .join('  •  ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderDiagnoseInlineStatusMode(value) {
    const mode = String(value ?? '').trim();
    if (mode === 'reserved') return 'acima do prompt';
    if (mode === 'inline') return 'em linha';
    if (mode === 'overlay') return 'sobreposta';
    if (mode === 'off' || mode === 'disabled') return 'desligada';
    return mode.replace(/[._-]+/gu, ' ') || 'desconhecida';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderDiagnoseInlineStatusSource(value) {
    const source = String(value ?? '').trim();
    if (!source || source === 'default') return 'ambiente principal';
    if (source === 'operator') return 'operador';
    if (source === 'runtime') return 'runtime';
    if (source === 'sdk') return 'SDK';
    return source.replace(/[._-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @param {boolean} detail
 * @returns {string}
 */
function renderDiagnoseTimerLabel(value, detail) {
    const id = String(value ?? '').trim();
    if (!id) return 'timer';
    if (detail) return id;
    if (id.startsWith('conversation-hub.store.checkpoint')) return 'checkpoint do hub';
    if (id.startsWith('terminal.')) return id.slice('terminal.'.length).replace(/[._:-]+/gu, ' ');
    return id.replace(/:[0-9][^\s]*/gu, '').replace(/[._:-]+/gu, ' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderDiagnoseSdkFsRouteMode(value) {
    const mode = String(value ?? '').trim();
    if (mode === 'local-fs-primary') return 'arquivos locais primeiro';
    if (mode === 'sdk-workspace-only') return 'workspace SDK apenas';
    if (mode === 'unavailable') return 'indisponível';
    return mode.replace(/[._-]+/gu, ' ') || 'desconhecida';
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
