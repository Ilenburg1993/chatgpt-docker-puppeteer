// @ts-check
/**
 * Application-owned Audit composition.
 *
 * Audit owns writers and semantic records; Boot owns process lifecycle registration and binds the application HookBus.
 * This module is the only place that couples those two responsibilities.
 * @module copilot/boot/application-audit
 */
import { defaultAuditLog, flushPermissionAudit, setAuditBus } from '#copilot/audit';
import { PROCESS_SHUTDOWN_PHASE, registerApplicationShutdownHandler } from '#copilot/boot/process-runtime';

let bootstrapped = false;

/**
 * @param {{ emitHook: (name: string, sessionId: string, input: unknown, output?: unknown) => void }} bus
 */
export function bootstrapApplicationAudit(bus) {
    setAuditBus(bus);
    if (bootstrapped) return;
    bootstrapped = true;

    registerApplicationShutdownHandler(
        'audit.flush',
        async () => {
            await defaultAuditLog.flush();
        },
        PROCESS_SHUTDOWN_PHASE.FINAL,
    );
    registerApplicationShutdownHandler('audit.permission.flush', flushPermissionAudit, PROCESS_SHUTDOWN_PHASE.FINAL);
}
