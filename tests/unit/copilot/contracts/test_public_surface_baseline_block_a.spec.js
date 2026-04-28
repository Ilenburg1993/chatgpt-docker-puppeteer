// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('Block A — public surface baseline contracts', () => {
    it('sdk barrel preserva famílias públicas canônicas mínimas', async () => {
        const sdk = await import('#copilot/sdk');

        for (const key of [
            'createCopilotClient',
            'createSession',
            'resumeSession',
            'sendSessionAndWait',
            'sessionUiConfirm',
            'shellExec',
            'modelSwitchTo',
            'waitForEvent',
            'SdkOperationError',
        ]) {
            assert.ok(key in sdk, `sdk barrel deve expor '${key}'`);
        }
    });

    it('agent barrel preserva superfícies centrais do runtime vivo', async () => {
        const agent = await import('#copilot/agent');

        for (const key of [
            'AlwaysAliveAgent',
            'alwaysAliveAgent',
            'getAgent',
            'resetAgent',
            'readAgentRuntimeStatusSnapshot',
            'readAgentRuntimeHealthSnapshot',
            'startRuntime',
            'startAgentDialogLoop',
            'sendAgentDialogTurn',
            'ALWAYS_ALIVE_AGENT',
        ]) {
            assert.ok(key in agent, `agent barrel deve expor '${key}'`);
        }
    });

    it('presentation barrel preserva a shared edge layer canônica', async () => {
        const presentation = await import('../../../../src/copilot/presentation/index.js');

        for (const key of [
            'getAgentRuntime',
            'buildAgentRuntimeCapabilities',
            'startAgentRuntime',
            'sendRuntimeDialogTurn',
            'buildAgentModuleHealth',
            'readAgentStatusSnapshot',
            'readAgentStatusValue',
            'buildAgentConnectedSsePayload',
            'conversationHubPresentation',
            'systemConfigPresentation',
        ]) {
            assert.ok(key in presentation, `presentation barrel deve expor '${key}'`);
        }
    });

    it('hooks barrel preserva famílias públicas mínimas de policy/callbacks', async () => {
        const hooks = await import('#copilot/hooks');

        for (const key of [
            'createHooks',
            'createPermissionHandler',
            'createSessionHooks',
            'createPromptTransformer',
            'createQueuedInputHandler',
            'createQueuedElicitationHandler',
            'HookBus',
            'HookRegistry',
            'createAuditPreset',
        ]) {
            assert.ok(key in hooks, `hooks barrel deve expor '${key}'`);
        }
    });

    it('tools barrel preserva factory e catálogo central de capabilities', async () => {
        const tools = await import('#copilot/tools');

        for (const key of [
            'getAllTools',
            'allTools',
            'buildTool',
            'withSkipPermission',
            'taskTools',
            'sessionTools',
            'sessionRpcTools',
            'hookTools',
            'hubTools',
            'shellTools',
        ]) {
            assert.ok(key in tools, `tools barrel deve expor '${key}'`);
        }
    });

    it('server/routes/sdk mantém a taxonomia modular mínima esperada', async () => {
        const sdkRoutes = await import('../../../../src/copilot/server/routes/sdk/index.js');
        assert.equal(typeof sdkRoutes.createSdkRouter, 'function');

        const sessionMessaging = await import('../../../../src/copilot/server/routes/sdk/session-messaging.js');
        const sessions = await import('../../../../src/copilot/server/routes/sdk/sessions.js');
        const client = await import('../../../../src/copilot/server/routes/sdk/client.js');
        const hooks = await import('../../../../src/copilot/server/routes/sdk/hooks.js');
        const agent = await import('../../../../src/copilot/server/routes/sdk/agent.js');
        const observability = await import('../../../../src/copilot/server/routes/sdk/observability.js');

        assert.ok(sessionMessaging, 'session-messaging deve continuar existindo');
        assert.ok(sessions, 'sessions router deve continuar existindo');
        assert.ok(client, 'client router deve continuar existindo');
        assert.ok(hooks, 'hooks router deve continuar existindo');
        assert.ok(agent, 'agent router deve continuar existindo');
        assert.ok(observability, 'observability router deve continuar existindo');
    });
});
