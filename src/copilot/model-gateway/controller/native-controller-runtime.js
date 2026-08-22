// @ts-check
/**
 * Read-only runtime adapter for native Copilot controller selection.
 *
 * The controller depends only on a tiny inspection session: connect, list account-visible models, read quota and close.
 * The default adapter wraps the concrete Copilot SDK client/manager behind that structural port, while tests and future
 * substrates can implement the same capabilities without impersonating a CopilotClient.
 *
 * @module copilot/model-gateway/controller/native-controller-runtime
 */

import { buildModelGatewayControllerSelectionPlan } from './controller-selection.js';

/**
 * @typedef {object} ModelGatewayControllerQuotaInspection
 * @property {unknown} [quotaSnapshots]
 * @property {string} [error]
 */

/**
 * @typedef {object} ModelGatewayControllerInspectionSession
 * @property {() => Promise<void>} connect
 * @property {() => Promise<unknown[]>} listModels
 * @property {() => Promise<ModelGatewayControllerQuotaInspection>} readQuota
 * @property {() => Promise<number>} close
 */

/**
 * @returns {Promise<ModelGatewayControllerInspectionSession>}
 */
async function createDefaultInspectionSession() {
    // Keep metadata-only Model Gateway imports cheap. The SDK client is retained only when native inspection is invoked.
    const [clientModule, healthModule] = await Promise.all([
        import('#copilot/sdk/session'),
        import('#copilot/sdk/telemetry'),
    ]);
    const manager = new clientModule.CopilotClientManager({ createClient: clientModule.createTerminalCopilotClient });
    /** @type {import('@github/copilot-sdk').CopilotClient | null} */
    let client = null;
    return {
        async connect() {
            client = await manager.getClient();
        },
        async listModels() {
            if (!client) throw new Error('[model-gateway/controller] native inspection session is not connected');
            return client.listModels();
        },
        async readQuota() {
            if (!client) throw new Error('[model-gateway/controller] native inspection session is not connected');
            return healthModule.getQuota(client);
        },
        async close() {
            return (await manager.stopClient()).length;
        },
    };
}

/**
 * @param {{
 *     byokRoutes?: unknown[];
 *     currentController?: Record<string, unknown> | null;
 *     now?: string | number | Date;
 *     minContextWindowTokens?: number;
 *     maxAgentProofAgeMs?: number;
 *     allowOpaqueSdkAutoFallback?: boolean;
 *     deps?: {
 *         createInspectionSession?: () =>
 *             ModelGatewayControllerInspectionSession | Promise<ModelGatewayControllerInspectionSession>;
 *     };
 * }} [options]
 */
export async function resolveModelGatewayNativeControllerSelection(options = {}) {
    const createInspectionSession = options.deps?.createInspectionSession ?? createDefaultInspectionSession;
    const session = await createInspectionSession();
    let clientConnected = false;
    /** @type {unknown[]} */
    let models = [];
    /** @type {ModelGatewayControllerQuotaInspection | null} */
    let quota = null;
    /** @type {string | null} */
    let modelListError = null;
    /** @type {string | null} */
    let quotaError = null;
    /** @type {string | null} */
    let connectionError = null;
    /** @type {number} */
    let cleanupErrorCount;
    try {
        await session.connect();
        clientConnected = true;
        try {
            models = await session.listModels();
        } catch (error) {
            modelListError = error instanceof Error ? error.message : String(error);
        }
        try {
            quota = await session.readQuota();
            if (quota.error) quotaError = quota.error;
        } catch (error) {
            quotaError = error instanceof Error ? error.message : String(error);
        }
    } catch (error) {
        connectionError = error instanceof Error ? error.message : String(error);
    } finally {
        try {
            cleanupErrorCount = await session.close();
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
        ...(typeof options.maxAgentProofAgeMs === 'number' ? { maxAgentProofAgeMs: options.maxAgentProofAgeMs } : {}),
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
