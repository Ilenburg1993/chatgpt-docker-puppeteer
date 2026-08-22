// @ts-check
/** Pure process-scoped alert derivation from already-collected health state. */

/**
 * @typedef {{ code:string; severity:'low'|'medium'|'high'; message:string }} IoProcessHealthAlert
 */

/**
 * @param {{
 *   locks: ReturnType<typeof import('#copilot/infra/internal/concurrency/locks').getIoLockStats> | null;
 *   ownership: { expected:boolean; complete:boolean; missingFacets:readonly string[] };
 * }} input
 */
export function buildIoProcessAlerts(input) {
    /** @type {IoProcessHealthAlert[]} */
    const alerts = [];
    if (input.ownership.expected && !input.ownership.complete) {
        alerts.push({
            code: 'IO_PROCESS_POLICY_OWNERSHIP_DRIFT',
            severity: 'high',
            message: `ProcessInfra ativo não possui todas as policies processuais esperadas: ${input.ownership.missingFacets.join(', ')}.`,
        });
    }
    const locks = input.locks;
    if (locks) {
        if (locks.timeouts > 0 || locks.fileLocks.timeouts > 0)
            alerts.push({
                code: 'IO_LOCK_TIMEOUT_OBSERVED',
                severity: 'medium',
                message: 'Ao menos um timeout de aquisição L0/L1 foi observado no processo.',
            });
        if (locks.staleActiveLeases > 0)
            alerts.push({
                code: 'IO_LOCK_LEASE_STALE',
                severity: 'medium',
                message: 'Ao menos uma lease processual de I/O permanece ativa além do threshold operacional.',
            });
        if (!locks.fileLocks.configurationValid)
            alerts.push({
                code: 'IO_LOCK_PROFILE_INVALID',
                severity: 'high',
                message:
                    'COPILOT_IO_FILE_LOCKS_ENABLED possui um perfil inválido; ativações automáticas estão desabilitadas.',
            });
    }
    return Object.freeze(alerts);
}
