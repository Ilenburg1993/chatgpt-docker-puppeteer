// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
    compactTerminalSdkSession: vi.fn(async () => ({ success: true })),
    confirmTerminalSdkSessionUi: vi.fn(async () => true),
    createTerminalSdkWorkspaceFile: vi.fn(async (path, content) => ({ path, content })),
    getTerminalSdkQuota: vi.fn(async () => ({
        quotaSnapshots: { chat: { remainingPercentage: 0.91, resetDate: '2026-05-01' } },
    })),
    inputTerminalSdkSessionUi: vi.fn(async (message) => `${message}:typed`),
    isTerminalSdkSessionUiElicitationAvailable: vi.fn(() => true),
    listTerminalSdkModels: vi.fn(async () => ({ models: [{ id: 'gpt-5-mini', supportedReasoningEfforts: ['high'] }] })),
    listTerminalSdkTools: vi.fn(async () => ({ tools: [{ name: 'read_file', description: 'Read files' }] })),
    listTerminalSdkWorkspaceFiles: vi.fn(async () => ({ files: [{ path: 'plan.md' }] })),
    readTerminalRuntimeState: vi.fn(() => ({
        runtimeId: 'default',
        sessionId: 'sdk-1',
        model: 'gpt-5-mini',
        reasoningEffort: 'high',
    })),
    readTerminalSdkWorkspaceFile: vi.fn(async (path) => ({ path, content: 'hello' })),
    requestTerminalSdkElicitation: vi.fn(async () => ({ action: 'accept', content: { answer: 'ok' } })),
    resolveTerminalSdkPendingElicitation: vi.fn(() => true),
    selectTerminalSdkSessionUi: vi.fn(async (_message, options) => options[0] ?? null),
}));

vi.mock('../../../../src/copilot/terminal/frontend/llm-b-runtime.js', () => runtimeMocks);

import { cmdElicitation, cmdPermission, cmdSdk, cmdWorkspace } from '../../../../src/copilot/terminal/commands/sdk.js';
import {
    clearTerminalElicitation,
    clearTerminalPermissions,
    recordTerminalElicitationPending,
    recordTerminalPermissionCompleted,
    recordTerminalPermissionRequested,
} from '../../../../src/copilot/terminal/sdk-interactions.js';

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    return {
        println: (/** @type {string} */ line) => lines.push(line),
        output: () => lines.join('\n'),
    };
}

describe('terminal/commands/sdk', () => {
    beforeEach(() => {
        clearTerminalElicitation('all');
        clearTerminalPermissions();
        vi.clearAllMocks();
    });

    it('/sdk status exibe runtime, sessão e quota', async () => {
        const ctx = mockCtx();
        await cmdSdk({ println: ctx.println }, 'status');
        expect(ctx.output()).toContain('SDK Runtime');
        expect(ctx.output()).toContain('sdk-1');
        expect(ctx.output()).toContain('chat');
    });

    it('/sdk models e /sdk tools consultam o Agent SDK facade', async () => {
        const models = mockCtx();
        await cmdSdk({ println: models.println }, 'models');
        expect(models.output()).toContain('gpt-5-mini');

        const tools = mockCtx();
        await cmdSdk({ println: tools.println }, 'tools gpt-5-mini');
        expect(runtimeMocks.listTerminalSdkTools).toHaveBeenCalledWith({ model: 'gpt-5-mini' });
        expect(tools.output()).toContain('read_file');
    });

    it('/workspace lista, lê e escreve no workspace virtual SDK', async () => {
        const list = mockCtx();
        await cmdWorkspace({ println: list.println }, 'list');
        expect(list.output()).toContain('plan.md');

        const read = mockCtx();
        await cmdWorkspace({ println: read.println }, 'read plan.md');
        expect(runtimeMocks.readTerminalSdkWorkspaceFile).toHaveBeenCalledWith('plan.md');
        expect(read.output()).toContain('hello');

        const write = mockCtx();
        await cmdWorkspace({ println: write.println }, 'write notes.md oi');
        expect(runtimeMocks.createTerminalSdkWorkspaceFile).toHaveBeenCalledWith('notes.md', 'oi');
        expect(write.output()).toContain('notes.md');
    });

    it('/elicitation lista pendências e dispara request estruturado', async () => {
        recordTerminalElicitationPending({
            requestId: 'el-1',
            message: 'Informe o branch',
            mode: 'form',
            requestedSchema: { type: 'object' },
        });

        const list = mockCtx();
        await cmdElicitation({ println: list.println }, 'list');
        expect(list.output()).toContain('el-1');
        expect(list.output()).toContain('ask_user = conversa');

        const request = mockCtx();
        await cmdElicitation({ println: request.println }, 'request Dados?');
        expect(runtimeMocks.requestTerminalSdkElicitation).toHaveBeenCalled();
        expect(request.output()).toContain('accept');

        const respond = mockCtx();
        await cmdElicitation({ println: respond.println }, 'respond el-1 accept {"env":"dev"}');
        expect(runtimeMocks.resolveTerminalSdkPendingElicitation).toHaveBeenCalledWith('el-1', {
            action: 'accept',
            content: { env: 'dev' },
        });
        expect(respond.output()).toContain('respondida');
    });

    it('/elicitation expõe confirm/select/input/capabilities via session.ui.*', async () => {
        const capabilities = mockCtx();
        await cmdElicitation({ println: capabilities.println }, 'capabilities');
        expect(capabilities.output()).toContain('available');

        const confirm = mockCtx();
        await cmdElicitation({ println: confirm.println }, 'confirm Confirma deploy?');
        expect(runtimeMocks.confirmTerminalSdkSessionUi).toHaveBeenCalledWith('Confirma deploy?');
        expect(confirm.output()).toContain('session.ui.confirm');

        const select = mockCtx();
        await cmdElicitation({ println: select.println }, 'select Escolha ambiente -- dev|prod');
        expect(runtimeMocks.selectTerminalSdkSessionUi).toHaveBeenCalledWith('Escolha ambiente', ['dev', 'prod']);
        expect(select.output()).toContain('session.ui.select');

        const input = mockCtx();
        await cmdElicitation({ println: input.println }, 'input Nome do projeto -- {"title":"Nome"}');
        expect(runtimeMocks.inputTerminalSdkSessionUi).toHaveBeenCalledWith('Nome do projeto', { title: 'Nome' });
        expect(input.output()).toContain('Nome do projeto:typed');
        expect(input.output()).not.toContain('[object Promise]');
    });

    it('/elicitation valida content contra schema SDK antes de responder', async () => {
        recordTerminalElicitationPending({
            requestId: 'el-schema',
            message: 'Informe ambiente',
            mode: 'form',
            requestedSchema: {
                type: 'object',
                properties: { env: { type: 'string', enum: ['dev', 'prod'] } },
                required: ['env'],
            },
        });

        const invalid = mockCtx();
        await cmdElicitation({ println: invalid.println }, 'respond el-schema accept {"env":"stage"}');
        expect(invalid.output()).toContain('dev | prod');
        expect(runtimeMocks.resolveTerminalSdkPendingElicitation).not.toHaveBeenCalled();

        const valid = mockCtx();
        await cmdElicitation({ println: valid.println }, 'respond el-schema accept {"env":"prod"}');
        expect(runtimeMocks.resolveTerminalSdkPendingElicitation).toHaveBeenCalledWith('el-schema', {
            action: 'accept',
            content: { env: 'prod' },
        });
    });

    it('/permission lista, detalha e limpa permissões SDK observadas', async () => {
        recordTerminalPermissionRequested({
            requestId: 'perm-1',
            permissionType: 'file_write',
            path: 'src/a.js',
        });
        recordTerminalPermissionCompleted({
            requestId: 'perm-1',
            granted: true,
            result: 'approved',
        });

        const list = mockCtx();
        await cmdPermission({ println: list.println }, 'all');
        expect(list.output()).toContain('perm-1');
        expect(list.output()).toContain('file_write');
        expect(list.output()).toContain('approved');

        const show = mockCtx();
        await cmdPermission({ println: show.println }, 'show perm-1');
        expect(show.output()).toContain('Permissão perm-1');
        expect(show.output()).toContain('file_write');

        const clear = mockCtx();
        await cmdPermission({ println: clear.println }, 'clear perm-1');
        expect(clear.output()).toContain('removida');
    });
});
