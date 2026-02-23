// @ts-check

/** Estados canônicos de um audit job. */
export const AUDIT_JOB_STATUS = Object.freeze({
    PENDING: 'PENDING',
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    WAITING_APPROVAL: 'WAITING_APPROVAL',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
});

/** Tipos de trigger para criação/execução de audit jobs. */
export const AUDIT_JOB_TRIGGER_TYPE = Object.freeze({
    MANUAL: 'manual',
    SCHEDULE: 'schedule',
    FS_EVENT: 'fs_event',
    RUNTIME_EVENT: 'runtime_event',
    HEALTH_EVENT: 'health_event',
    API: 'api',
});

/** Kinds iniciais de jobs da V1. */
export const AUDIT_JOB_KIND = Object.freeze({
    QUICK_AUDIT: 'quick_audit',
    BUG_HUNT: 'bug_hunt',
    PATCH_SUGGEST: 'patch_suggest',
    REGRESSION_TRIAGE: 'regression_triage',
    RUNTIME_PROBE: 'runtime_probe',
    CUSTOM: 'custom',
    // Diagnostic Agent job kinds (migrated from standalone)
    DIAGNOSTIC_HEALTH: 'diagnostic_health',
    DIAGNOSTIC_SYSTEM: 'diagnostic_system',
    DIAGNOSTIC_MODELS: 'diagnostic_models',
    DIAGNOSTIC_VERIFY: 'diagnostic_verify',
    DIAGNOSTIC_REPORT: 'diagnostic_report',
});

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 */
function _isAllowed(value, allowed) {
    return typeof value === 'string' && allowed.includes(value);
}

/** @param {unknown} value */
export function isAuditJobStatus(value) {
    return _isAllowed(value, Object.values(AUDIT_JOB_STATUS));
}

/** @param {unknown} value */
export function isAuditJobTriggerType(value) {
    return _isAllowed(value, Object.values(AUDIT_JOB_TRIGGER_TYPE));
}

/** @param {unknown} value */
export function isAuditJobKind(value) {
    return _isAllowed(value, Object.values(AUDIT_JOB_KIND));
}
