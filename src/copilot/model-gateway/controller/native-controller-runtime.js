// @ts-check
/**
 * Read-only runtime adapter for native Copilot controller selection.
 *
 * It opens a short-lived terminal-mode SDK client only to inspect account-visible models and account quota. No LLM turn
 * is sent. The resulting data is passed to the pure Controller Selection Plane.
 *
 * @module copilot/model-gateway/controller/native-controller-runtime
 */

import { buildModelGatewayControllerSelectionPlan } from './controller-selection.js';

/**
 * @param {{
 *   byokRoutes?: Record<string, any>[];
 *   currentController?: Record<string, any> | null;
 *   now?: string | number | Date;
 *   minContextWindowTokens?: number;
 *   maxAgentProofAgeMs?: number;
 *   allowOpaqueSdkAutoFallback?: boolean;
 *   deps?: {
 *     createManager?: () => { getClient: () => Promise<any>; stopClient: () => Promise<any[]> };
 *     readQuota?: (client: any) => Promise<any>;
 *   };
 * }} [options]
 */
export async function resolveModelGatewayNativeControllerSelection(options = {}) {
    let createManager = options.deps?.createManager;
    let readQuota = options.deps?.readQuota;
    if (!createManager || !readQuota) {
        // Keep the controller's pure selection plane cheap to import. Pulling the SDK client into the top-level
        // model-gateway barrel can retain SDK resources even for metadata-only CLI commands that never need a client.
        // The native substrate is therefore loaded only when this runtime adapter is actually invoked.
        const [clientModule, healthModule] = await Promise.all([
            import('#copilot/sdk/session/client'),
            import('#copilot/sdk/telemetry/health'),
        ]);
        createManager ??= () =>
            new clientModule.CopilotClientManager({ createClient: clientModule.createTerminalCopilotClient });
        readQuota ??= healthModule.getQuota;
    }
    const manager = createManager();
    let clientConnected = false;
    /** @type {any[]} */
    let models = [];
    let quota = null;
    let modelListError = null;
    let quotaError = null;
    let connectionError = null;
    /** @type {number} */
    let cleanupErrorCount;
    try {
        const client = await manager.getClient();
        clientConnected = true;
        try {
            models = await client.listModels();
        } catch (error) {
            modelListError = error instanceof Error ? error.message : String(error);
        }
        try {
            quota = await readQuota(client);
            if (quota?.error) quotaError = String(quota.error);
        } catch (error) {
            quotaError = error instanceof Error ? error.message : String(error);
        }
    } catch (error) {
        connectionError = error instanceof Error ? error.message : String(error);
    } finally {
        try {
            cleanupErrorCount = (await manager.stopClient()).length;
        } catch {
            cleanupErrorCount = 1;
        }
    }

    const allowOpaqueSdkAutoFallback =
        options.allowOpaqueSdkAutoFallback === true && clientConnected && connectionError === null;
    const plan = buildModelGatewayControllerSelectionPlan({
        sdkModels: models,
        sdkQuota: quota?.quotaSnapshots ?? {},
        byokRoutes: options.byokRoutes ?? [],
        currentController: options.currentController ?? null,
        ...(options.now !== undefined ? { now: options.now } : {}),
        ...(typeof options.minContextWindowTokens === 'number'
            ? { minContextWindowTokens: options.minContextWindowTokens }
            : {}),
        ...(typeof options.maxAgentProofAgeMs === 'number'
            ? { maxAgentProofAgeMs: options.maxAgentProofAgeMs }
            : {}),
        allowOpaqueSdkAutoFallback,
    });
    return {
        ...plan,
        inspection: {
            clientConnected,
            modelCount: models.length,
            quotaRead: quota !== null,
            connectionError,
            modelListError,
            quotaError,
            cleanupErrorCount,
        },
    };
}
