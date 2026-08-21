// @ts-check
/** Pure alert derivation from already-collected IO runtime health snapshots. */
/**
 * @param {{
 *   scopes: import('#copilot/infra/internal/indexing/context').ScopeStats[];
 *   l2: Record<string, unknown>;
 *   circuitOpen: boolean;
 *   mutationState: { appliedButUnconfirmed: number };
 *   durability: { fileSync: { failed: number }; directorySync: { failed: number } };
 *   locks: ReturnType<typeof import('#copilot/infra/internal/concurrency/locks').getIoLockStats>;
 *   coherence: { crossProcess?: unknown } & Record<string, unknown>;
 *   advisoryBudget: ReturnType<typeof import('#copilot/infra/internal/telemetry').getIoAdvisoryBudgetStats>;
 * }} input
 */
export function buildIoRuntimeAlerts(input) {
    const scopeStatusCounts = {
        ready: input.scopes.filter((scope) => scope.status === 'ready').length,
        warming: input.scopes.filter((scope) => scope.status === 'warming').length,
        stale: input.scopes.filter((scope) => scope.status === 'stale').length,
        degraded: input.scopes.filter((scope) => scope.status === 'degraded').length,
    };
    /** @type {{ code:string; severity:string; message:string }[]} */
    const alerts = [];
    if (scopeStatusCounts.degraded > 0)
        alerts.push({
            code: 'IO_SCOPE_DEGRADED',
            severity: 'medium',
            message: 'Ao menos um escopo de IO terminou warm-up/refresh em estado degradado.',
        });
    if ('configurationValid' in input.l2 && input.l2['configurationValid'] === false)
        alerts.push({
            code: 'IO_L2_PROFILE_INVALID',
            severity: 'high',
            message: 'IO_L2_CACHE_PROFILE possui valor inválido; L2 permanece desabilitado.',
        });
    if (input.circuitOpen)
        alerts.push({
            code: 'IO_L2_CIRCUIT_OPEN',
            severity: 'high',
            message: 'L2 cache em circuit-open; runtime operando predominantemente em L1.',
        });
    if (input.mutationState.appliedButUnconfirmed > 0)
        alerts.push({
            code: 'IO_MUTATION_APPLIED_UNCONFIRMED',
            severity: 'high',
            message:
                'Ao menos uma mutação foi fisicamente aplicada antes de falhar sua confirmação/hook de durability.',
        });
    if (input.durability.fileSync.failed > 0 || input.durability.directorySync.failed > 0)
        alerts.push({
            code: 'IO_DURABILITY_SYNC_FAILED',
            severity: 'high',
            message: 'Ao menos uma falha real de file/directory sync foi observada no runtime.',
        });
    if (input.locks.timeouts > 0 || input.locks.fileLocks.timeouts > 0)
        alerts.push({
            code: 'IO_LOCK_TIMEOUT_OBSERVED',
            severity: 'medium',
            message: 'Ao menos um timeout de aquisição L0/L1 foi observado no runtime.',
        });
    if (input.locks.staleActiveLeases > 0)
        alerts.push({
            code: 'IO_LOCK_LEASE_STALE',
            severity: 'medium',
            message: 'Ao menos uma lease de I/O permanece ativa além do threshold operacional.',
        });
    if (!input.locks.fileLocks.configurationValid)
        alerts.push({
            code: 'IO_LOCK_PROFILE_INVALID',
            severity: 'high',
            message:
                'COPILOT_IO_FILE_LOCKS_ENABLED possui um perfil inválido; ativações automáticas estão desabilitadas.',
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
            message: `Pressão advisory de I/O observada: ${input.advisoryBudget.reasons.join(', ')}.`,
        });
    return { alerts, scopeStatusCounts };
}
