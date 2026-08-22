// @ts-check
/** Pure alert derivation from already-collected IO health snapshots. */

/**
 * @typedef {{ code:string; severity:'low'|'medium'|'high'; message:string }} IoHealthAlert
 */

/**
 * Runtime-owned alerts. No process-global lock/policy state is accepted here by design.
 *
 * @param {{
 *   scopes: import('#copilot/infra/internal/indexing/context').ScopeStats[];
 *   l2: Record<string, unknown>;
 *   circuitOpen: boolean;
 *   indexAutoRefresh: Record<string, unknown>;
 *   mutationState: { appliedButUnconfirmed: number };
 *   durability: { fileSync: { failed: number }; directorySync: { failed: number } };
 *   coherence: { crossProcess?: unknown } & Record<string, unknown>;
 *   advisoryBudget: ReturnType<ReturnType<typeof import('#copilot/infra/internal/telemetry').createIoTelemetryRuntime>['advisoryBudget']['stats']>;
 * }} input
 */
export function buildIoRuntimeAlerts(input) {
    const scopeStatusCounts = {
        ready: input.scopes.filter((scope) => scope.status === 'ready').length,
        warming: input.scopes.filter((scope) => scope.status === 'warming').length,
        stale: input.scopes.filter((scope) => scope.status === 'stale').length,
        degraded: input.scopes.filter((scope) => scope.status === 'degraded').length,
    };
    /** @type {IoHealthAlert[]} */
    const alerts = [];
    if (scopeStatusCounts.degraded > 0)
        alerts.push({
            code: 'IO_SCOPE_DEGRADED',
            severity: 'medium',
            message: 'Ao menos um escopo de IO deste runtime terminou warm-up/refresh em estado degradado.',
        });
    if ('configurationValid' in input.l2 && input.l2['configurationValid'] === false)
        alerts.push({
            code: 'IO_L2_PROFILE_INVALID',
            severity: 'high',
            message: 'IO_L2_CACHE_PROFILE possui valor inválido; L2 permanece desabilitado neste runtime.',
        });
    if (input.circuitOpen)
        alerts.push({
            code: 'IO_L2_CIRCUIT_OPEN',
            severity: 'high',
            message: 'L2 cache em circuit-open; runtime operando predominantemente em L1.',
        });
    const exhaustedRefreshes = Number(input.indexAutoRefresh['exhausted'] ?? 0);
    if (exhaustedRefreshes > 0)
        alerts.push({
            code: 'IO_INDEX_AUTO_REFRESH_EXHAUSTED',
            severity: 'medium',
            message: `${exhaustedRefreshes} atualização(ões) automática(s) do índice esgotaram o orçamento de retry neste runtime.`,
        });
    const stalePendingRefreshes = Number(input.indexAutoRefresh['stalePending'] ?? 0);
    if (stalePendingRefreshes > 0)
        alerts.push({
            code: 'IO_INDEX_AUTO_REFRESH_STALE_PENDING',
            severity: 'medium',
            message: `${stalePendingRefreshes} atualização(ões) automática(s) permanecem pendentes além do orçamento temporal derivado da policy de retry.`,
        });
    if (input.mutationState.appliedButUnconfirmed > 0)
        alerts.push({
            code: 'IO_MUTATION_APPLIED_UNCONFIRMED',
            severity: 'high',
            message:
                'Ao menos uma mutação deste runtime foi fisicamente aplicada antes de falhar sua confirmação/hook de durability.',
        });
    if (input.durability.fileSync.failed > 0 || input.durability.directorySync.failed > 0)
        alerts.push({
            code: 'IO_DURABILITY_SYNC_FAILED',
            severity: 'high',
            message: 'Ao menos uma falha real de file/directory sync foi observada neste runtime.',
        });
    const crossProcess =
        input.coherence.crossProcess && typeof input.coherence.crossProcess === 'object'
            ? /** @type {Record<string, unknown>} */ (input.coherence.crossProcess)
            : {};
    const crossProcessErrors =
        Number(crossProcess['initializationErrors'] ?? 0) +
        Number(crossProcess['writeErrors'] ?? 0) +
        Number(crossProcess['readErrors'] ?? 0);
    if (crossProcessErrors > 0)
        alerts.push({
            code: 'IO_CROSS_PROCESS_INVALIDATION_ERROR',
            severity: 'medium',
            message:
                'Cross-process cache invalidation journal observed an initialization/read/write error; filesystem fingerprints remain the fallback.',
        });
    if (Number(crossProcess['gapDetections'] ?? 0) > 0)
        alerts.push({
            code: 'IO_CROSS_PROCESS_INVALIDATION_GAP',
            severity: 'medium',
            message:
                'Cross-process invalidation consumer observed a journal sequence gap; a full index/cache reconciliation should be scheduled.',
        });
    if (input.advisoryBudget.pressure)
        alerts.push({
            code: 'IO_ADVISORY_BUDGET_PRESSURE',
            severity: 'medium',
            message: `Pressão advisory de I/O observada neste runtime: ${input.advisoryBudget.reasons.join(', ')}.`,
        });
    return { alerts: Object.freeze(alerts), scopeStatusCounts };
}
