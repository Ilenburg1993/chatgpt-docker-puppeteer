// @ts-check
/**
 * src/copilot/terminal/commands/session.js
 *
 * Comandos de sessão do REPL terminal LLM-B: /status, /history, /db-history, /db-sessions, /who, /count, /clear,
 * /answer, /clear-shadow, /restart, /quit, /exit
 *
 * @module copilot/terminal/commands/session
 * @see EventBus
 */

import { toError } from '#copilot/core';
import { buildTerminalOperationalGuidance } from '../auto-briefing.js';
import {
    clearPendingTerminalQuestionShadow,
    clearTerminalHistory,
    listTerminalSnapshotsProjection,
    loadTerminalSnapshotProjection,
    readTerminalActivityProjection,
    readTerminalConfigProjection,
    readTerminalCountProjection,
    readTerminalDbHistoryProjection,
    readTerminalDbSessionsProjection,
    readTerminalDisplayProjection,
    readTerminalLiveFlowProjection,
    readTerminalStatusProjection,
    readTerminalTimelineProjection,
    saveTerminalSnapshotProjection,
} from '../frontend/index.js';
import { tryAnswerTerminalPendingQuestionInput } from '../pending-question-answer.js';
import { callWithRuntimeTarget, extractRuntimeTarget, withRuntimeTarget } from './runtime-target.js';

/**
 * Referência ao _hubSessionId gerenciado pelo terminal server. É passado como parâmetro pois não pode ser importado
 * estaticamente (é mutável).
 *
 * @typedef {object} SessionContext
 * @property {string | null} [hubSessionId] - ID da hub session ativa
 * @property {number} [injectPort] - Porta do inject server
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * Exibe snapshot de status do agente.
 *
 * @param {SessionContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdStatus({ hubSessionId, injectPort, println }, arg = '') {
    const { runtimeId } = extractRuntimeTarget(arg);
    const configProjection = callWithRuntimeTarget(readTerminalConfigProjection, runtimeId);
    const activityProjection = readTerminalActivityProjection(3);
    const projection = readTerminalStatusProjection(
        withRuntimeTarget(
            {
                hubSessionId: hubSessionId ?? null,
                ...(typeof injectPort === 'number' ? { injectPort } : {}),
            },
            runtimeId,
        ),
    );
    const { snap, health } = projection;
    const active = projection.dialogLoopActive;
    const statusColor =
        snap['status'] === 'waiting_for_input' ? '\x1b[32m' : snap['status'] === 'idle' ? '\x1b[33m' : '\x1b[31m';
    const effort = configProjection.currentReasoningEffort;
    const sdkMode = projection.sdkSessionMode ?? 'interactive';
    const sdkModeColor = sdkMode === 'plan' ? '\x1b[35m' : sdkMode === 'autopilot' ? '\x1b[36m' : '\x1b[90m';
    const sdkPlanOpLabel = projection.sdkPlanOperation
        ? `${projection.sdkPlanOperation}${projection.sdkPlanChangedAt ? ` @ ${new Date(projection.sdkPlanChangedAt).toLocaleTimeString('pt-BR')}` : ''}`
        : '\x1b[90m(sem alterações)\x1b[0m';
    const healthColor =
        health?.['status'] === 'healthy' ? '\x1b[32m' : health?.['status'] === 'degraded' ? '\x1b[33m' : '\x1b[31m';
    const ws = projection.workspace;
    const branchStr = ws.currentBranch ? `\x1b[32m${ws.currentBranch}\x1b[0m` : '\x1b[90m(sem branch)\x1b[0m';
    const shadowState = projection.pendingQuestionShadowState;
    const askUserStatus = projection.pendingQuestion
        ? `\x1b[32mvivo\x1b[0m${projection.pendingQuestionKind ? ` [${projection.pendingQuestionKind}]` : ''}`
        : projection.pendingQuestionShadowExpired
          ? '\x1b[31mshadow expirada\x1b[0m'
          : projection.pendingQuestionShadow
            ? `${shadowState === 'expired' ? '\x1b[31mshadow expirada\x1b[0m' : shadowState === 'expiring_soon' ? '\x1b[33mshadow expirando\x1b[0m' : shadowState === 'fresh' ? '\x1b[36mshadow recém-restaurada\x1b[0m' : '\x1b[33mshadow restaurada\x1b[0m'}${projection.pendingQuestionShadowKind ? ` [${projection.pendingQuestionShadowKind}]` : ''}`
            : '\x1b[90m(nenhum)\x1b[0m';
    const pendingPreview = projection.pendingQuestionText
        ? projection.pendingQuestionText.slice(0, 80) + (projection.pendingQuestionText.length > 80 ? '…' : '')
        : projection.pendingQuestionShadowText
          ? projection.pendingQuestionShadowText.slice(0, 80) +
            (projection.pendingQuestionShadowText.length > 80 ? '…' : '')
          : null;
    const shadowExpiry =
        typeof projection.pendingQuestionShadowExpiresAt === 'number'
            ? new Date(projection.pendingQuestionShadowExpiresAt).toISOString()
            : null;
    const shadowAgeLabel =
        typeof projection.pendingQuestionShadowAgeMs === 'number'
            ? `${Math.round(projection.pendingQuestionShadowAgeMs / 1000)}s`
            : null;
    const shadowRemainingLabel =
        typeof projection.pendingQuestionShadowRemainingMs === 'number'
            ? `${Math.round(projection.pendingQuestionShadowRemainingMs / 1000)}s`
            : null;
    const activity = projection.activity;
    const lifecycle = projection.lifecycleSummary;
    const bootDetail =
        lifecycle.boot &&
        (lifecycle.boot.skippedCount > 0 || lifecycle.boot.failedCount > 0 || lifecycle.boot.timeoutCount > 0)
            ? ` · ok=${lifecycle.boot.okCount} skipped=${lifecycle.boot.skippedCount} failed=${lifecycle.boot.failedCount} timeout=${lifecycle.boot.timeoutCount}`
            : '';
    const bootLine = lifecycle.boot
        ? `${lifecycle.boot.status === 'ok' ? '\x1b[32m' : '\x1b[31m'}${lifecycle.boot.status}\x1b[0m \x1b[90m${lifecycle.boot.phases} fases · ${lifecycle.boot.durationMs}ms${bootDetail}${lifecycle.boot.failedPhase ? ` · falha=${lifecycle.boot.failedPhase}` : ''}\x1b[0m`
        : '\x1b[90m(n/d)\x1b[0m';
    const shutdownLine = lifecycle.shuttingDown
        ? `\x1b[33mem andamento\x1b[0m \x1b[90m${lifecycle.registeredShutdownHandlers} handlers\x1b[0m`
        : lifecycle.shutdown
          ? `${lifecycle.shutdown.status === 'ok' ? '\x1b[32m' : '\x1b[31m'}${lifecycle.shutdown.status}\x1b[0m \x1b[90m${lifecycle.shutdown.handlers} handlers · ${lifecycle.shutdown.durationMs}ms${lifecycle.shutdown.failedHandler ? ` · falha=${lifecycle.shutdown.failedHandler}` : ''}\x1b[0m`
          : `\x1b[90mparado · ${lifecycle.registeredShutdownHandlers} handlers registrados\x1b[0m`;
    const modelMeta = configProjection.modelMeta ?? configProjection.observedModelMeta;
    const autoPolicy = configProjection.autoModelPolicy;
    const autoPolicyLine =
        configProjection.currentModel === 'auto'
            ? `        auto policy      \x1b[90mpref=${autoPolicy.preferredModel}/${autoPolicy.preferredReasoningEffort} · autoridade=GitHub Copilot · último=${autoPolicy.observedModel ?? 'n/d'}\x1b[0m`
            : '';
    const modelBilling = projection.modelBilling;
    const display = readTerminalDisplayProjection();
    const activitySeverityColor =
        activity.severity === 'error' ? '\x1b[31m' : activity.severity === 'warn' ? '\x1b[33m' : '\x1b[32m';
    const activityProgress = typeof activity.progress === 'number' ? ` (${activity.progress}%)` : '';
    const sdkInterruptions = [
        projection.pendingElicitations > 0
            ? `elicitation=${projection.pendingElicitations}${projection.latestElicitationMode ? ` (${projection.latestElicitationMode})` : ''}`
            : null,
        projection.pendingPermissions > 0
            ? `permission=${projection.pendingPermissions}${projection.latestPermissionType ? ` (${projection.latestPermissionType})` : ''}`
            : null,
        projection.pendingUserInputs > 0
            ? `ask_user=${projection.pendingUserInputs}${projection.latestUserInputKind ? ` (${projection.latestUserInputKind})` : ''}`
            : null,
    ].filter(Boolean);
    const sdkCapabilitiesUi =
        projection.sdkCapabilities && typeof projection.sdkCapabilities['ui'] === 'object'
            ? /** @type {Record<string, unknown>} */ (projection.sdkCapabilities['ui'])
            : null;
    const uiElicitationFlag = sdkCapabilitiesUi ? sdkCapabilitiesUi['elicitation'] === true : null;
    const timelineSyncLabel =
        projection.timelineSyncStatus === 'scheduled' || projection.timelineSyncStatus === 'inflight'
            ? ` · sync=${projection.timelineSyncStatus}:${projection.timelineSyncPendingCount}`
            : projection.timelineSyncStatus === 'synced'
              ? ` · sync=synced:${projection.timelineSyncSyncedCount}`
              : projection.timelineSyncStatus === 'failed'
                ? ` · sync=failed:${projection.timelineSyncFailedCount}`
                : ` · sync=${projection.timelineSyncStatus}`;
    const promptBindingDigest =
        typeof projection.systemPromptBinding?.['digest'] === 'string'
            ? projection.systemPromptBinding['digest']
            : null;
    const promptFreshness = projection.systemPromptFreshness;
    const promptIsStale = typeof promptFreshness?.['isStale'] === 'boolean' ? promptFreshness['isStale'] : null;
    const promptFreshnessReason = typeof promptFreshness?.['reason'] === 'string' ? promptFreshness['reason'] : null;
    const promptRecommendedAction =
        promptFreshness?.['recommendedAction'] === 'none' ||
        promptFreshness?.['recommendedAction'] === 'observe-live-reload' ||
        promptFreshness?.['recommendedAction'] === 'resume-session'
            ? promptFreshness['recommendedAction']
            : 'none';
    const promptFreshnessLabel =
        promptIsStale === true
            ? '\x1b[31mstale\x1b[0m'
            : promptRecommendedAction === 'observe-live-reload'
              ? '\x1b[33mlive-reload\x1b[0m'
              : promptIsStale === false
                ? '\x1b[32mok\x1b[0m'
                : '\x1b[90m(n/d)\x1b[0m';
    const toolLoad = projection.toolLoad;
    const toolLoadColor = toolLoad.hasCanonicalLocalFsTools ? '\x1b[32m' : '\x1b[33m';
    const instructionLoad = projection.instructionLoad;
    const instructionLoadColor =
        instructionLoad.sectionsMissingFileCount === 0 && instructionLoad.appendFileMissingCount === 0
            ? '\x1b[32m'
            : '\x1b[33m';
    const sdkFsRouting = projection.sdkFsRouting;
    const operationalGuidance = buildTerminalOperationalGuidance({
        sdkFsRouting,
        toolLoad,
        instructionLoad,
    });
    const sdkFsRoutingColor =
        sdkFsRouting.mode === 'local-fs-primary'
            ? '\x1b[32m'
            : sdkFsRouting.mode === 'sdk-workspace-only'
              ? '\x1b[33m'
              : '\x1b[31m';
    const ioRuntime = projection.ioRuntime;
    const ioHitRatio = Number(ioRuntime.cache.aggregate.hitRatio || 0).toFixed(3);
    const ioL1 = ioRuntime.cache.l1;
    const ioL2 = ioRuntime.cache.l2;
    const ioIndex = /** @type {Record<string, unknown>} */ (ioRuntime.index ?? {});
    const ioCacheLine = `l1=${ioL1['enabled'] ? 'on' : 'off'} entries=${ioL1['size'] ?? 0} bytes=${ioL1['bytesStored'] ?? 0} · l2=${ioL2['enabled'] ? 'on' : 'off'} entries=${ioL2['size'] ?? 0} · hitRatio=${ioHitRatio}`;
    const ioScopeLine = `scopes=${ioRuntime.scopes.active} · parser=${ioRuntime.parser.size}/${ioRuntime.parser.maxSize} · index=${ioIndex['available'] ? 'on' : 'empty'}:${ioIndex['files'] ?? 0}`;
    println(`
  \x1b[36mStatus do Terminal LLM-B\x1b[0m
  ─────────────────────────────────────
  agente           ${statusColor}${snap['status']}\x1b[0m
        health           ${health ? `${healthColor}${health['status']}\x1b[0m` : '\x1b[90m(n/d)\x1b[0m'}
  dialog loop      ${active ? '\x1b[32m● ativo\x1b[0m' : '\x1b[31m○ inativo\x1b[0m'}
  ask_user         ${askUserStatus}
  sdk interrupts   ${sdkInterruptions.length > 0 ? `\x1b[33m${sdkInterruptions.join(' · ')}\x1b[0m` : '\x1b[90m(nenhum)\x1b[0m'}
    sdk ui           \x1b[90melicitation=${uiElicitationFlag == null ? 'n/a' : uiElicitationFlag ? 'available' : 'unavailable'}\x1b[0m
  modelo           \x1b[36m${snap['model']}\x1b[0m
  reasoning        \x1b[35m${effort}\x1b[0m
    modo SDK         ${sdkModeColor}${sdkMode}\x1b[0m
        permission mode  \x1b[33m${projection.permissionMode}\x1b[0m
    plan arquivo     ${sdkPlanOpLabel}
        bg tasks         ${health?.['backgroundPendingCount'] ?? 0}
        issues           ${Array.isArray(health?.['issues']) ? health['issues'].length : 0}
        ação sugerida    ${projection.recommendedAction ?? 'none'}
    runtime session  \x1b[90m${projection.runtimeSessionId ?? '(sem runtime)'}\x1b[0m
    runtime id       \x1b[90m${projection.runtimeId}\x1b[0m
    runtime profile  \x1b[90m${projection.agentProfileId ?? '(sem profile)'}\x1b[0m
    runtimes         \x1b[90m${projection.runtimeTopologyLabel}\x1b[0m
    timeline         \x1b[90m${projection.timelineSource} · ${projection.timelineAuthority} · ${projection.timelineReconciliationStatus} · ${projection.timelineTurnCount} turns${timelineSyncLabel}\x1b[0m
    prompt digest    \x1b[90m${promptBindingDigest ?? '(sem binding)'}\x1b[0m
    prompt frescor   ${promptFreshnessLabel} \x1b[90m(${promptRecommendedAction})\x1b[0m
    tools load       ${toolLoadColor}${toolLoad.total} registradas\x1b[0m \x1b[90m(fsCanônico=${toolLoad.hasCanonicalLocalFsTools} · sdkWorkspace=${toolLoad.hasSdkWorkspaceTooling} · disabled=${toolLoad.disabled.length})\x1b[0m
    instr. load      ${instructionLoadColor}${instructionLoad.liveReloadMechanism}\x1b[0m \x1b[90m(sections=${instructionLoad.sectionCount} · missingSectionFile=${instructionLoad.sectionsMissingFileCount} · missingAppendFile=${instructionLoad.appendFileMissingCount} · sourcesRpc=${instructionLoad.sdkSupportsInstructionSourcesRpc})\x1b[0m
    sdk↔fs route     ${sdkFsRoutingColor}${sdkFsRouting.mode}\x1b[0m \x1b[90m${sdkFsRouting.reason}\x1b[0m
    io cache         \x1b[90m${ioCacheLine}\x1b[0m
    io scope         \x1b[90m${ioScopeLine}\x1b[0m
    sdk session      \x1b[90m${projection.sdkSessionId ?? '(sem sdk)'}\x1b[0m
    hub session      \x1b[90m${projection.hubSessionId ?? '(sem hub)'}\x1b[0m
    turnos canon     ${projection.turnCount} \x1b[90m(persistidos=${projection.persistedTimelineTurnCount} · bridge=${projection.bridgeTurnCount} · live-tail=${projection.liveBridgeTailCount})\x1b[0m
    inject port      ${projection.injectPort}
        atividade atual  ${activitySeverityColor}${activity.label}\x1b[0m${activityProgress}
        fase/source      \x1b[90m${activity.phase} · ${activity.source}\x1b[0m
        boot             ${bootLine}
        shutdown         ${shutdownLine}
        display          \x1b[90mthinking=${display.thinking ? 'on' : 'off'} · streaming=${display.streaming ? 'on' : 'off'} · usage=${display.usage ? 'on' : 'off'} · tools=${display.tools ? 'on' : 'off'} · intent=${display.intent ? 'on' : 'off'}\x1b[0m
          último PR         \x1b[90m${modelBilling.at ?? '(sem consumo ainda)'}\x1b[0m
          billing/modelo    ${modelBilling.mismatch ? `\x1b[31mmismatch\x1b[0m \x1b[90m(cfg=${modelBilling.configuredModel ?? '-'} · cobrado=${modelBilling.billedModel ?? '-'})\x1b[0m` : `\x1b[32mok\x1b[0m \x1b[90m(${modelBilling.displayModel})\x1b[0m`}
          custo último PR   \x1b[90m${modelBilling.cost == null ? '(n/d)' : modelBilling.cost.toFixed(4)}\x1b[0m
        perfil modelo    \x1b[90m${modelMeta ? `cost=${modelMeta.costTier ?? 'n/a'} · speed=${modelMeta.speedTier ?? 'n/a'} · ctx=${typeof modelMeta.contextWindow === 'number' ? modelMeta.contextWindow.toLocaleString('pt-BR') : 'n/a'}` : '(sem metadata local)'}\x1b[0m
${autoPolicyLine ? `${autoPolicyLine}\n` : ''}  ─────────────────────────────────────
  workspace        \x1b[90m${ws.cwd}\x1b[0m
  git root         \x1b[90m${ws.gitRoot ?? '(não é git repo)'}\x1b[0m
  branch           ${branchStr}
  ─────────────────────────────────────
`);
    if (pendingPreview) {
        println(`  pergunta/shadow  \x1b[90m${pendingPreview}\x1b[0m`);
    }
    if (shadowExpiry) {
        println(`  shadow expira em \x1b[90m${shadowExpiry}\x1b[0m`);
    }
    if (shadowAgeLabel) {
        println(`  shadow idade    \x1b[90m${shadowAgeLabel}\x1b[0m`);
    }
    if (shadowRemainingLabel && !projection.pendingQuestionShadowExpired) {
        println(`  shadow restante \x1b[90m${shadowRemainingLabel}\x1b[0m`);
    }
    if (activity.detail) {
        println(`  atividade info  \x1b[90m${activity.detail}\x1b[0m`);
    }
    if (promptFreshnessReason) {
        println(`  prompt reason   \x1b[90m${promptFreshnessReason}\x1b[0m`);
    }
    println(`  guia operação  \x1b[90m${operationalGuidance.summary}\x1b[0m`);
    println(`  domínio ativo  \x1b[90m${operationalGuidance.domainHint}\x1b[0m`);
    println(`  coleta ctx     \x1b[90m${operationalGuidance.contextHint}\x1b[0m`);
    if (operationalGuidance.warnings.length > 0) {
        println(`  atenção boot   \x1b[33m${operationalGuidance.warnings.join(' | ')}\x1b[0m`);
    }
    if (activityProjection.history.length > 0) {
        println(
            '  atividade rec.  \x1b[90m' +
                activityProjection.history
                    .map((entry) => {
                        const progress = typeof entry.progress === 'number' ? ` ${entry.progress}%` : '';
                        return `${entry.phase}:${entry.label}${progress}`;
                    })
                    .join('  •  ') +
                '\x1b[0m',
        );
    }
    if (projection.pendingQuestionShadowExpired) {
        println(
            '  \x1b[33mDica: a shadow restaurada não é mais respondível; mantenha a limpeza no próximo fluxo operacional.\x1b[0m',
        );
    } else if (projection.pendingQuestionShadowState === 'expiring_soon') {
        println(
            '  \x1b[33mDica: a shadow restaurada está perto de expirar; revise ou limpe antes que o estado fique ambíguo.\x1b[0m',
        );
    }
    if (projection.sdkSessionMode === 'plan') {
        println(
            '  \x1b[90mNota: a sessão SDK está em plan mode vanilla; use /plan off para voltar a interactive.\x1b[0m',
        );
    }
    if (projection.pendingElicitations > 0) {
        println('  \x1b[33mAção: há elicitation pendente; use /elicitation list e /elicitation show latest.\x1b[0m');
    }
    if (projection.pendingPermissions > 0) {
        println(
            '  \x1b[33mAção: há permissão SDK pendente; acompanhe /activity e aguarde o hook/runtime decidir.\x1b[0m',
        );
    }
    if (projection.pendingUserInputs > 0) {
        println(
            '  \x1b[33mAção: há ask_user pendente do SDK; responda via conversa normal ou use /answer <texto>.\x1b[0m',
        );
    }
    if (modelBilling.mismatch) {
        println(
            '  \x1b[33mAção recomendada: valide fallback/model switch com /sdk quota, /status e um turno curto de confirmação.\x1b[0m',
        );
    }
    if (projection.usedDefaultRuntimeFallback) {
        println(
            `  \x1b[33mNota: runtime solicitado ${projection.requestedRuntimeId ?? '(desconhecido)'} não encontrado; usando runtime default (${projection.runtimeId}).\x1b[0m`,
        );
    }
    if (projection.timelineReconciliationStatus === 'diverged') {
        println(
            '  \x1b[33mNota: timeline do bridge divergiu da persistência; a UX está priorizando o hub como autoridade canônica.\x1b[0m',
        );
    }
    if (projection.timelineSyncStatus === 'scheduled' || projection.timelineSyncStatus === 'inflight') {
        println(
            `  \x1b[90mTimeline sync: ${projection.timelineSyncStatus} (${projection.timelineSyncPendingCount} turnos pendentes para materializar no Hub).\x1b[0m`,
        );
    }
    if (projection.timelineSyncStatus === 'failed') {
        const retryLabel =
            typeof projection.timelineSyncNextRetryAt === 'number'
                ? ` próxima tentativa=${new Date(projection.timelineSyncNextRetryAt).toLocaleTimeString('pt-BR')}`
                : '';
        println(
            `  \x1b[33mTimeline sync falhou: ${projection.timelineSyncLastError ?? 'erro desconhecido'}${retryLabel}.\x1b[0m`,
        );
    }
}

/**
 * Snapshot operacional rápido para uso frequente durante investigação/live-debug.
 *
 * @param {SessionContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdNow({ hubSessionId, injectPort, println }, arg = '') {
    const { runtimeId } = extractRuntimeTarget(arg);
    const projection = readTerminalStatusProjection(
        withRuntimeTarget(
            {
                hubSessionId: hubSessionId ?? null,
                ...(typeof injectPort === 'number' ? { injectPort } : {}),
            },
            runtimeId,
        ),
    );
    const mode = projection.sdkSessionMode ?? 'interactive';
    const state = String(projection.snap['status'] ?? 'unknown');
    const ask = projection.pendingQuestion
        ? `ASK:${projection.pendingQuestionKind ?? 'question'}`
        : projection.pendingQuestionShadowState
          ? `SHADOW:${projection.pendingQuestionShadowState}`
          : 'ASK:none';
    const sdkWait = [
        projection.pendingElicitations > 0 ? `ELICIT:${projection.pendingElicitations}` : null,
        projection.pendingPermissions > 0 ? `PERM:${projection.pendingPermissions}` : null,
        projection.pendingUserInputs > 0 ? `ASKSDK:${projection.pendingUserInputs}` : null,
        `PM:${projection.permissionMode}`,
    ]
        .filter(Boolean)
        .join(' ');
    const queue = Number(projection.snap['queueSize'] ?? 0);
    const modelBilling = projection.modelBilling;
    const live = readTerminalLiveFlowProjection(
        withRuntimeTarget(
            {
                hubSessionId: hubSessionId ?? null,
                ...(typeof injectPort === 'number' ? { injectPort } : {}),
                limit: 4,
            },
            runtimeId,
        ),
    );
    const mismatchLabel = modelBilling.mismatch
        ? `mismatch(cfg=${modelBilling.configuredModel ?? '-'}|bill=${modelBilling.billedModel ?? '-'})`
        : `model=${modelBilling.displayModel}`;

    println(
        `\x1b[36m[now]\x1b[0m runtime=${projection.runtimeId} live=${live.state} status=${state} loop=${projection.dialogLoopActive ? 'on' : 'off'} mode=${mode} queue=${queue} ${ask}${sdkWait ? ` ${sdkWait}` : ''} timeline=${projection.timelineSource}:${projection.timelineReconciliationStatus}:sync=${projection.timelineSyncStatus} sse=${live.sse.clients}/${live.sse.criticalClients} ${mismatchLabel}`,
    );
    if (projection.activity?.label) {
        const detail = projection.activity.detail ? ` · ${projection.activity.detail}` : '';
        println(`\x1b[90m[now]\x1b[0m atividade=${projection.activity.phase}:${projection.activity.label}${detail}`);
    }
    if (projection.recommendedAction) {
        println(`\x1b[90m[now]\x1b[0m recommended=${projection.recommendedAction}`);
    }
}

/**
 * Exibe a linha do tempo operacional live do terminal: loop, streaming, SSE, tools, arquivos e I/O real.
 *
 * @param {SessionContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdLive({ hubSessionId, injectPort, println }, arg = '') {
    const { runtimeId, arg: rest } = extractRuntimeTarget(arg);
    const requestedLimit = Number(rest) || 6;
    const projection = readTerminalLiveFlowProjection(
        withRuntimeTarget(
            {
                hubSessionId: hubSessionId ?? null,
                ...(typeof injectPort === 'number' ? { injectPort } : {}),
                limit: requestedLimit,
            },
            runtimeId,
        ),
    );
    const status = projection.status;
    const current = projection.activity.current;
    const activeTrace = projection.turnTrace.current ?? projection.turnTrace.recent[0] ?? null;
    const stateColor =
        projection.state === 'ready'
            ? '\x1b[32m'
            : projection.state === 'active-turn'
              ? '\x1b[36m'
              : projection.state === 'waiting-human' || projection.state === 'paused'
                ? '\x1b[33m'
                : '\x1b[31m';
    const streamFlags = [
        `streaming=${projection.stream.streaming ? 'on' : 'off'}`,
        `thinking=${projection.stream.thinking ? 'on' : 'off'}`,
        `tools=${projection.stream.toolActivity ? 'on' : 'off'}`,
        `intent=${projection.stream.intent ? 'on' : 'off'}`,
        `usage=${projection.stream.usage ? 'on' : 'off'}`,
    ].join(' · ');
    const ioRuntime = status.ioRuntime;
    const cacheHitRatio = Number(ioRuntime.cache.aggregate.hitRatio || 0).toFixed(3);
    const ioIndex = /** @type {Record<string, unknown>} */ (ioRuntime.index ?? {});

    println(`
  \x1b[36mTerminal Live Flow\x1b[0m
  ─────────────────────────────────────
  estado          ${stateColor}${projection.state}\x1b[0m \x1b[90m${projection.summary}\x1b[0m
  runtime         \x1b[90m${status.runtimeId} · ${String(status.snap['status'] ?? 'unknown')} · loop=${status.dialogLoopActive ? 'on' : 'off'} · paused=${status.snap['dialogPaused'] ? 'yes' : 'no'}\x1b[0m
  sdk/session     \x1b[90mmode=${status.sdkSessionMode ?? 'interactive'} · session=${status.sdkSessionId ?? '(sem sdk)'} · permission=${status.permissionMode}\x1b[0m
  streaming       \x1b[90m${streamFlags}\x1b[0m
  sse             \x1b[90mclients=${projection.sse.clients} · critical=${projection.sse.criticalClients} · replayLastId=${projection.sse.replayLastId}\x1b[0m
  timeline        \x1b[90m${projection.timeline.timelineSource} · ${projection.timeline.reconciliationStatus} · sync=${projection.timeline.sync.status} · turns=${projection.counters.timelineTurns}\x1b[0m
  cache/scope     \x1b[90ml1=${ioRuntime.cache.l1['enabled'] ? 'on' : 'off'}:${ioRuntime.cache.l1['size'] ?? 0} · l2=${ioRuntime.cache.l2['enabled'] ? 'on' : 'off'}:${ioRuntime.cache.l2['size'] ?? 0} · hitRatio=${cacheHitRatio} · index=${ioIndex['available'] ? 'on' : 'empty'}:${ioIndex['files'] ?? 0} · scopes=${ioRuntime.scopes.active} · parser=${ioRuntime.parser.size}/${ioRuntime.parser.maxSize}\x1b[0m
  atividade       \x1b[90m${current.phase}:${current.label}${current.detail ? ` · ${current.detail}` : ''}\x1b[0m
  trace           \x1b[90mtools=${projection.counters.toolCount} · arquivos=${projection.counters.fileCount} · ioRecent=${projection.counters.recentIoCount}\x1b[0m
  ─────────────────────────────────────`);

    if (activeTrace && (activeTrace.tools.length > 0 || activeTrace.files.length > 0)) {
        println('  turno observado');
        for (const tool of activeTrace.tools.slice(0, 5)) {
            const target = tool.path ?? tool.target;
            println(
                `    - tool ${tool.toolName} · ${tool.operation}${target ? ` · ${target}` : ''} · ${tool.status} · ${tool.source}`,
            );
        }
        for (const file of activeTrace.files.slice(0, 5)) {
            println(
                `    - file ${file.operation} · ${file.path} · ${file.source}${file.count > 1 ? ` x${file.count}` : ''}`,
            );
        }
    }

    if (projection.recentIo.length > 0) {
        println('  I/O real');
        for (const entry of projection.recentIo.slice(0, 6)) {
            const ts = new Date(entry.timestamp).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            const statusLabel = entry.success ? 'ok' : 'fail';
            const bytes =
                typeof entry.bytesRead === 'number'
                    ? ` · read=${entry.bytesRead}B`
                    : typeof entry.bytesWritten === 'number'
                      ? ` · write=${entry.bytesWritten}B`
                      : '';
            const duration = typeof entry.durationMs === 'number' ? ` · ${entry.durationMs}ms` : '';
            println(`    - [${ts}] ${statusLabel} · ${entry.operation} · ${entry.target}${bytes}${duration}`);
        }
    }

    if (projection.activity.history.length > 0) {
        println('  eventos recentes');
        for (const entry of projection.activity.history.slice(0, 6)) {
            const ts = new Date(entry.ts).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            const progress = typeof entry.progress === 'number' ? ` (${entry.progress}%)` : '';
            println(
                `    - [${ts}] ${entry.phase}:${entry.label}${progress}${entry.detail ? ` · ${entry.detail}` : ''}`,
            );
        }
    }

    println('');
}

/**
 * Exibe o histórico de conversa local.
 *
 * @param {SessionContext} ctx
 * @param {number | string} [n] - Número de pares a exibir ou argumento cru do REPL
 * @returns {void}
 */
export function cmdHistory({ println }, n = 10) {
    const rawArg = typeof n === 'number' ? String(n) : n;
    const { runtimeId, arg } = extractRuntimeTarget(rawArg ?? '');
    const requestedLimit = typeof n === 'number' ? n : Number(arg) || 10;
    const timeline = readTerminalTimelineProjection({ limitPairs: requestedLimit, runtimeId });
    const hist = timeline.turns;
    if (hist.length === 0) {
        println('[history] Histórico vazio.');
        return;
    }
    println(
        `\n── Histórico (${timeline.timelineSource} · ${timeline.timelineAuthority} · ${timeline.reconciliationStatus}) ──`,
    );
    for (const turn of hist) {
        const ts = new Date(turn.timestamp).toLocaleTimeString('pt-BR');
        const roleLabel = turn.role === 'user' ? '👤' : turn.rawRole === 'llm_a' ? '🤖' : '🧠';
        const sourceLabel = turn.persisted ? '' : ' \x1b[33m[live]\x1b[0m';
        const preview = turn.content.slice(0, 160) + (turn.content.length > 160 ? '…' : '');
        println(`  [${ts}] ${roleLabel}${sourceLabel} ${preview}`);
    }
    if (timeline.reconciliationStatus === 'diverged') {
        println(
            '  \x1b[33mNota: histórico do bridge divergiu; exibindo a timeline persistida como fonte oficial.\x1b[0m',
        );
    }
    if (timeline.sync.status === 'scheduled' || timeline.sync.status === 'inflight') {
        println(
            `  \x1b[90mSync Hub: ${timeline.sync.status} (${timeline.sync.pendingCount} turnos live aguardando persistência).\x1b[0m`,
        );
    } else if (timeline.sync.status === 'failed') {
        println(`  \x1b[33mSync Hub falhou: ${timeline.sync.lastError ?? 'erro desconhecido'}.\x1b[0m`);
    }
    println('─────────────────────────────────');
}

/**
 * Exibe o histórico SQLite persistido.
 *
 * @param {SessionContext} ctx
 * @param {number} [n] - Número de turnos a exibir (padrão: 20)
 * @param {number} [offset] - Offset de paginação (UPG-PROP-13)
 * @returns {void}
 */
export function cmdDbHistory({ hubSessionId, println }, n = 20, offset = 0) {
    const projection = readTerminalDbHistoryProjection({ hubSessionId: hubSessionId ?? null, limit: n, offset });
    if (!projection.available) {
        println('\x1b[90m  /db-history: Hub session não disponível (sem persistência).\x1b[0m');
        return;
    }
    try {
        const turns = projection.turns;
        if (turns.length === 0) {
            println('\x1b[90m  /db-history: Nenhum turno persistido ainda.\x1b[0m');
            return;
        }
        const offsetLabel = offset > 0 ? ` (offset recente ${offset})` : '';
        println(`\n  \x1b[36mÚltimos ${turns.length} turnos da sessão atual${offsetLabel}\x1b[0m`);
        println('  ─────────────────────────────────────────────────');
        for (const t of turns) {
            const ts = new Date(String(t['created_at'] ?? '')).toLocaleTimeString('pt-BR');
            const role = String(t['role'] ?? 'user');
            const content = String(t['content'] ?? '');
            const emoji = role === 'llm_b' ? '🧠' : role === 'llm_a' ? '🤖' : '👤';
            const preview = content.slice(0, 160) + (content.length > 160 ? '…' : '');
            println(`  \x1b[90m[${ts}]\x1b[0m ${emoji}  ${preview}`);
        }
        println(
            `  \x1b[90mwindow=${projection.effectiveOffset}..${projection.effectiveOffset + turns.length - 1} de ${projection.totalTurns} turnos persistidos\x1b[0m`,
        );
        println('  ─────────────────────────────────────────────────\n');
    } catch (e) {
        println(`\x1b[31m  /db-history erro: ${toError(e).message}\x1b[0m`);
    }
}

/**
 * Lista as hub_sessions persistidas no DB.
 *
 * @param {SessionContext} ctx
 * @param {number} [n]
 * @returns {void}
 */
export function cmdDbSessions({ hubSessionId, println }, n = 10) {
    try {
        const { sessions, currentHubSessionId } = readTerminalDbSessionsProjection({
            currentHubSessionId: hubSessionId ?? null,
            limit: n,
        });
        if (sessions.length === 0) {
            println('\x1b[90m  /db-sessions: Nenhuma sessão persistida ainda.\x1b[0m');
            return;
        }
        println(`\n  \x1b[36mÚltimas ${sessions.length} hub sessions\x1b[0m`);
        println('  ──────────────────────────────────────────────────────────────');
        for (const s of sessions) {
            const createdAt = new Date(String(s['created_at'] ?? '')).toLocaleString('pt-BR');
            const sessionId = String(s['id'] ?? '');
            const sessionStatus = String(s['status'] ?? 'unknown');
            const title = String(s['title'] ?? '(sem título)');
            const isCurrent = sessionId === currentHubSessionId;
            const statusColor = sessionStatus === 'active' ? '\x1b[32m' : '\x1b[90m';
            const marker = isCurrent ? ' \x1b[33m← atual\x1b[0m' : '';
            println(
                `  ${statusColor}${sessionStatus}\x1b[0m  \x1b[90m${createdAt}\x1b[0m  \x1b[2m${sessionId.slice(0, 8)}\x1b[0m  ${title}${marker}`,
            );
        }
        println('  ──────────────────────────────────────────────────────────────\n');
    } catch (e) {
        println(`\x1b[31m  /db-sessions erro: ${toError(e).message}\x1b[0m`);
    }
}

/**
 * Exibe atores ativos na sessão.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdWho({ injectPort, println }, arg = '') {
    const { runtimeId } = extractRuntimeTarget(arg);
    const { currentModel, currentReasoningEffort } = callWithRuntimeTarget(readTerminalConfigProjection, runtimeId);
    println(`
  \x1b[36mAtores ativos nesta sessão:\x1b[0m
  👤  \x1b[32mVocê\x1b[0m          — stdin (digitar diretamente aqui)
  🤖  \x1b[34mLLM-A\x1b[0m         — POST http://localhost:${injectPort}/inject
    🧠  \x1b[35mLLM-B\x1b[0m         — AlwaysAliveAgent (Copilot SDK · ${currentModel} · ${currentReasoningEffort})
  📡  \x1b[90mSSE stream\x1b[0m    — GET  http://localhost:${injectPort}/events
`);
}

/**
 * Exibe estatísticas da sessão atual.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdCount({ hubSessionId, println }) {
    const projection = readTerminalCountProjection({ hubSessionId: hubSessionId ?? null });
    if (!projection.available) {
        println('\x1b[33m  Nenhuma hub session ativa.\x1b[0m');
        return;
    }
    println(`
  \x1b[36mEstatísticas da sessão\x1b[0m
  ─────────────────────────────────────────────
    Turnos (usuário):   ${String(projection.userTurns).padStart(4)}
    Turnos (LLM-B):     ${String(projection.llmBTurns).padStart(4)}
    Turnos (total):     ${String(projection.turns).padStart(4)}
    Memórias salvas:    ${String(projection.memories).padStart(4)}
    Hub session:        ${projection.hubSessionId?.slice(0, 8) ?? '—'}…
    SDK session:        ${projection.sdkSessionId?.slice(0, 8) ?? '—'}…
  ─────────────────────────────────────────────\n`);
}

/**
 * Limpa histórico em memória.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdClear({ println }) {
    clearTerminalHistory();
    println('\x1b[90m  Histórico em memória limpo.\x1b[0m');
}

/**
 * Responde pergunta pendente do LLM-B.
 *
 * @param {SessionContext} ctx
 * @param {string} arg
 * @returns {void}
 */
export function cmdAnswer({ println }, arg) {
    const { runtimeId, arg: answer } = extractRuntimeTarget(arg);
    const result = tryAnswerTerminalPendingQuestionInput(answer, runtimeId);
    if (result.ok) {
        println(`[answer] Resposta enviada: "${result.answer}"`);
        return;
    }
    if (result.reason === 'empty') {
        println('[answer] Uso: /answer <texto>');
        return;
    }
    if (result.reason === 'protocol_controlled') {
        println('[answer] O runtime aguarda uma mensagem de diálogo. Digite o texto normalmente, sem /answer.');
        return;
    }
    const projection = readTerminalStatusProjection(withRuntimeTarget({}, runtimeId));
    if (result.shadowExpired || projection.pendingQuestionShadowExpired) {
        println('[answer] Nenhuma pergunta viva. Há uma shadow expirada de ask_user pendente de limpeza.');
        return;
    }
    println('[answer] Nenhuma pergunta pendente.');
}

/**
 * Limpa explicitamente a shadow persistida de `ask_user` restaurada do disco.
 *
 * @param {SessionContext} ctx
 * @returns {void}
 */
export function cmdClearShadow({ println }, arg = '') {
    const { runtimeId } = extractRuntimeTarget(arg);
    const ok = callWithRuntimeTarget(clearPendingTerminalQuestionShadow, runtimeId);
    println(
        ok
            ? '[clear-shadow] Shadow persistida de ask_user limpa.'
            : '[clear-shadow] Nenhuma shadow persistida do ask_user no momento.',
    );
}

/**
 * F41.5: Salva snapshot da sessão atual.
 *
 * @param {SessionContext} ctx
 * @param {string} [reason]
 * @returns {Promise<void>}
 */
export async function cmdSessionSave({ println }, reason) {
    const { runtimeId, arg: cleanReason } = extractRuntimeTarget(reason);
    const { data, path } = await callWithRuntimeTarget(
        saveTerminalSnapshotProjection,
        runtimeId,
        cleanReason || undefined,
    );
    println(`\x1b[32m  ✓ Snapshot salvo: ${String(data['snapshotId'] ?? '(sem id)')}\x1b[0m`);
    println(`\x1b[90m    Path: ${path}\x1b[0m`);
}

/**
 * F41.5: Lista snapshots disponíveis.
 *
 * @param {SessionContext} ctx
 * @returns {Promise<void>}
 */
export async function cmdSessionList({ println }) {
    const snaps = await listTerminalSnapshotsProjection();
    if (snaps.length === 0) {
        println('\x1b[90m  Nenhum snapshot encontrado.\x1b[0m');
        return;
    }
    println(`\x1b[36m  Snapshots disponíveis (${snaps.length}):\x1b[0m`);
    for (const s of snaps) {
        const createdAt = s['createdAt'];
        const date =
            typeof createdAt === 'number' || typeof createdAt === 'string'
                ? new Date(createdAt).toISOString().replace('T', ' ').slice(0, 19)
                : 'invalid-date';
        println(
            `    ${String(s['snapshotId'] ?? '')}  ${date}  model=${String(s['model'] ?? '')}  ${String(s['reason'] ?? '')}`,
        );
    }
}

/**
 * F41.5: Exibe detalhes de um snapshot.
 *
 * @param {SessionContext} ctx
 * @param {string} snapshotId
 * @returns {Promise<void>}
 */
export async function cmdSessionRestore({ println }, snapshotId) {
    if (!snapshotId) {
        println('\x1b[33m  Uso: /session restore <snapshotId>\x1b[0m');
        println('\x1b[90m  Use /session list para ver snapshots disponíveis.\x1b[0m');
        return;
    }

    const snap = await loadTerminalSnapshotProjection(snapshotId);
    if (!snap) {
        println(`\x1b[31m  Snapshot não encontrado: ${snapshotId}\x1b[0m`);
        return;
    }

    println(`\x1b[36m  Snapshot: ${String(snap['snapshotId'] ?? '(sem id)')}\x1b[0m`);
    const createdAt = snap['createdAt'];
    const createdAtIso =
        typeof createdAt === 'number' || typeof createdAt === 'string'
            ? new Date(createdAt).toISOString()
            : 'invalid-date';
    println(`    Criado: ${createdAtIso}`);
    println(`    Session: ${String(snap['sessionId'] ?? '(none)')}`);
    println(`    Model: ${String(snap['model'] ?? 'unknown')}  Status: ${String(snap['status'] ?? 'unknown')}`);
    println(`    Send count: ${Number(snap['sendCount'] ?? 0)}`);
    println(
        `    Dialog loop: ${snap['dialogLoopActive'] ? 'active' : 'inactive'}${snap['dialogPaused'] ? ' (paused)' : ''}`,
    );
    if (snap['pendingQuestion']) {
        const pendingMeta =
            snap['pendingQuestionMeta'] && typeof snap['pendingQuestionMeta'] === 'object'
                ? /** @type {{ kind?: string }} */ (snap['pendingQuestionMeta'])
                : null;
        const pendingKind = pendingMeta?.kind ? ` [${pendingMeta.kind}]` : '';
        println(`    Pending question${pendingKind}: ${String(snap['pendingQuestion'])}`);
    }
    if (snap['pendingQuestionShadow'] && typeof snap['pendingQuestionShadow'] === 'object') {
        const shadow =
            /** @type {{ question?: unknown; meta?: { kind?: unknown }; restoredAt?: unknown; expiresAt?: unknown }} */ (
                snap['pendingQuestionShadow']
            );
        const shadowKind = typeof shadow.meta?.kind === 'string' ? ` [${shadow.meta.kind}]` : '';
        println(`    Pending shadow${shadowKind}: ${String(shadow.question ?? '(sem texto)')}`);
        if (typeof shadow.restoredAt === 'number') {
            println(`    Shadow restoredAt: ${new Date(shadow.restoredAt).toISOString()}`);
        }
        if (typeof shadow.expiresAt === 'number') {
            println(`    Shadow expiresAt: ${new Date(shadow.expiresAt).toISOString()}`);
        }
    }
    if (snap['prMetrics']) {
        const prMetrics = /** @type {{ boots?: number; resumesWithPR?: number; resumesZeroPR?: number }} */ (
            snap['prMetrics']
        );
        println(
            `    PR metrics: boots=${Number(prMetrics.boots ?? 0)} resumePR=${Number(prMetrics.resumesWithPR ?? 0)} zeroPR=${Number(prMetrics.resumesZeroPR ?? 0)}`,
        );
    }
    println('\x1b[90m    (Restore automático ocorre no boot via PM2 — use /session save antes de reiniciar)\x1b[0m');
}
