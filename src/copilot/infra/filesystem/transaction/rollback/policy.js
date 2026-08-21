// @ts-check
/** Rollback opt-in, retention quotas, TTL and storage-directory policy. */

import { booleanValueOr, positiveIntegerOr } from '#copilot/infra/internal/platform';
import path from 'node:path';

const DEFAULT_ROLLBACK_ENABLED = false;
const DEFAULT_ROLLBACK_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ROLLBACK_MAX_ENTRIES = 32;
const DEFAULT_ROLLBACK_MAX_BYTES = 32 * 1024 * 1024;

export function isIoRollbackEnabled() {
    return booleanValueOr(process.env['COPILOT_IO_ROLLBACK_ENABLED'], DEFAULT_ROLLBACK_ENABLED);
}
/** @param {boolean} requested */
export function shouldCaptureIoRollback(requested = true) {
    return requested === true && isIoRollbackEnabled();
}
export function getRollbackSidecarMaxEntries() {
    return positiveIntegerOr(process.env['COPILOT_IO_ROLLBACK_MAX_ENTRIES'], DEFAULT_ROLLBACK_MAX_ENTRIES);
}
export function getRollbackSidecarMaxBytes() {
    return positiveIntegerOr(process.env['COPILOT_IO_ROLLBACK_MAX_BYTES'], DEFAULT_ROLLBACK_MAX_BYTES);
}
export function getRollbackSidecarDirectory() {
    const configured = String(process.env['COPILOT_IO_ROLLBACK_DIR'] ?? '').trim();
    return configured ? path.resolve(configured) : path.join(process.cwd(), 'src', 'copilot', '.ai', 'rollback');
}
export function getRollbackSidecarTtlMs() {
    return positiveIntegerOr(process.env['COPILOT_IO_ROLLBACK_TTL_MS'], DEFAULT_ROLLBACK_TTL_MS);
}
export function getIoRollbackPolicy() {
    return {
        enabled: isIoRollbackEnabled(),
        ttlMs: getRollbackSidecarTtlMs(),
        maxEntries: getRollbackSidecarMaxEntries(),
        maxBytes: getRollbackSidecarMaxBytes(),
    };
}
