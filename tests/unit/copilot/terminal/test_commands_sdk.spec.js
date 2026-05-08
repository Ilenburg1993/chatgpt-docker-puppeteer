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
    listTerminalSdkPendingPermissions: vi.fn(async () => ({
        available: true,
        source: 'permissions.listPendingPermissionRequests',
        requests: [{ requestId: 'perm-rpc-1', permissionType: 'file_write' }],
    })),
    listTerminalSdkTools: vi.fn(async () => ({ tools: [{ name: 'read_file', description: 'Read files' }] })),
    listTerminalSdkWorkspaceFiles: vi.fn(async () => ({ files: [{ path: 'plan.md' }] })),
    readTerminalSdkSystemPromptProjection: vi.fn(async () => ({
        sessionId: 'sdk-1',
        sessionAvailable: true,
        instructionSources: { sources: [{ type: 'system', origin: 'sdk' }] },
        instructionSourcesError: null,
        systemPrompt: {
            effectiveMode: 'append',
            effectiveLiveMode: 'customize',
            liveReloadMechanism: 'sdk-transform',
            configPath: '/tmp/system-prompt.json',
            autoReload: true,
            sections: Array.from({ length: 10 }, (_, idx) => ({ sectionId: `s${idx + 1}` })),
            appendFiles: [{ path: '/tmp/user.md', exists: true }],
            limitations: ['mode=replace exige resume total apenas quando usado explicitamente.'],
            sdkCompatibility: { supportsCustomizeMode: true, supportsInstructionSourcesRpc: true },
            revision: { digest: 'abcd1234efgh5678' },
        },
    })),
    readTerminalSdkWorkspaceFile: vi.fn(async (path) => ({ path, content: 'hello' })),
    getTerminalSdkSessionCapabilities: vi.fn(() => ({
        ui: { elicitation: true, confirm: true, select: true, input: true },
        tools: { workspace: true, list: true, quota: true },
        plan: { read: true, write: true, delete: true },
    })),
    handleTerminalSdkPendingPermission: vi.fn(async (requestId, result) => ({ requestId, result, ok: true })),
    requestTerminalSdkElicitation: vi.fn(async () => ({ action: 'accept', content: { answer: 'ok' } })),
    resolveTerminalSdkPendingElicitation: vi.fn(() => true),
    selectTerminalSdkSessionUi: vi.fn(async (_message, options) => options[0] ?? null),
}));

const fileToolMocks = vi.hoisted(() => ({
    readFileHandler: vi.fn(async ({ path }) => ({
        success: true,
        path,
        content: `LOCAL:${String(path ?? '')}`,
        io: { operation: 'read', engine: 'io-engine.fs.readFile.text' },
    })),
    createFileHandler: vi.fn(async ({ path, content }) => ({
        success: true,
        path,
        bytesWritten: Buffer.byteLength(String(content ?? ''), 'utf8'),
        io: { operation: 'write', engine: 'io-engine.atomic-write' },
    })),
    writeFileHandler: vi.fn(async ({ path, content }) => ({
        success: true,
        path,
        bytesWritten: Buffer.byteLength(String(content ?? ''), 'utf8'),
        io: { operation: 'write', engine: 'io-engine.atomic-write' },
    })),
}));

const agentRuntimeMocks = vi.hoisted(() => ({
    readTerminalRuntimeState: vi.fn(() => ({
        runtimeId: 'default',
        sessionId: 'sdk-1',
        model: 'gpt-5-mini',
        reasoningEffort: 'high',
    })),
    readTerminalRuntimePermissionMode: vi.fn(() => 'approve_all'),
    setTerminalRuntimePermissionMode: vi.fn((mode) => mode),
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/sdk-session.js', () => runtimeMocks);
vi.mock('../../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => agentRuntimeMocks);
vi.mock('#copilot/tools', () => ({
    fileReadTools: [
        { name: 'list_directory', handler: vi.fn(async () => ({ entries: [] })) },
        { name: 'read_file_content', handler: fileToolMocks.readFileHandler },
        { name: 'search_in_files', handler: vi.fn(async () => ({ matches: [] })) },
    ],
    fileWriteTools: [
        { name: 'create_file', handler: fileToolMocks.createFileHandler },
        { name: 'write_file_content', handler: fileToolMocks.writeFileHandler },
        { name: 'patch_file', handler: vi.fn(async () => ({ success: true })) },
    ],
}));

import { cmdElicitation, cmdPermission, cmdSdk, cmdWorkspace } from '../../../../src/copilot/terminal/commands/sdk.js';
import {
    clearTerminalElicitation,
    clearTerminalPermissions,
    clearTerminalUserInputs,
    getTerminalPermission,
    recordTerminalElicitationPending,
    recordTerminalPermissionCompleted,
    recordTerminalPermissionModeChanged,
    recordTerminalPermissionRequested,
    recordTerminalUserInputRequested,
} from '../../../../src/copilot/terminal/state/sdk-interactions.js';

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
        clearTerminalUserInputs();
        vi.clearAllMocks();
    });

    it('/sdk status exibe runtime, sessão e quota', async () => {
        const ctx = mockCtx();
        await cmdSdk({ println: ctx.println }, 'status');
        expect(ctx.output()).toContain('SDK Runtime');
        expect(ctx.output()).toContain('sdk-1');
        expect(ctx.output()).toContain('chat');
        expect(ctx.output()).toContain('ask_user=0');
    });

    it('/sdk capabilities exibe capacidades consolidadas da sessão SDK', async () => {
        const ctx = mockCtx();
        await cmdSdk({ println: ctx.println }, 'capabilities');
        expect(runtimeMocks.getTerminalSdkSessionCapabilities).toHaveBeenCalled();
        expect(ctx.output()).toContain('SDK Capabilities');
        expect(ctx.output()).toContain('elicitation=true');
        expect(ctx.output()).toContain('workspace=true');
    });

    it('/sdk doctor valida roteamento entre workspace SDK e FS canônico', async () => {
        const ctx = mockCtx();
        await cmdSdk({ println: ctx.println }, 'doctor');
        expect(ctx.output()).toContain('SDK Doctor');
        expect(ctx.output()).toContain('local-fs-primary');
        expect(ctx.output()).toContain('/fs');
        expect(ctx.output()).toContain('contexto');
        expect(ctx.output()).toContain('/activity 5');
    });

    it('/sdk waits mostra painel unificado de interrupções SDK', async () => {
        recordTerminalElicitationPending({ requestId: 'el-wait', message: 'Informe branch', mode: 'form' });
        recordTerminalPermissionRequested({ requestId: 'perm-wait', permissionType: 'file_write' });
        recordTerminalUserInputRequested({ requestId: 'ui-wait', question: 'Qual ambiente?' });

        const ctx = mockCtx();
        await cmdSdk({ println: ctx.println }, 'waits');

        expect(ctx.output()).toContain('SDK Waits');
        expect(ctx.output()).toContain('3 pendência(s)');
        expect(ctx.output()).toContain('elicitation=1');
        expect(ctx.output()).toContain('permission=1');
        expect(ctx.output()).toContain('ask_user=1');
        expect(ctx.output()).toContain('/elicitation show latest');
        expect(ctx.output()).toContain('/permission show latest');
    });

    it('/sdk waits respeita runtimeId para elicitation/permission/user_input', async () => {
        recordTerminalElicitationPending({
            requestId: 'el-default',
            runtimeId: 'default',
            message: 'Default',
            mode: 'form',
        });
        recordTerminalPermissionRequested({ requestId: 'perm-default', runtimeId: 'default', permissionType: 'shell' });
        recordTerminalUserInputRequested({ requestId: 'ui-default', runtimeId: 'default', question: 'Default?' });

        recordTerminalElicitationPending({ requestId: 'el-audit', runtimeId: 'audit', message: 'Audit', mode: 'form' });
        recordTerminalPermissionRequested({
            requestId: 'perm-audit',
            runtimeId: 'audit',
            permissionType: 'file_write',
        });
        recordTerminalUserInputRequested({ requestId: 'ui-audit', runtimeId: 'audit', question: 'Audit?' });

        const ctx = mockCtx();
        await cmdSdk({ println: ctx.println }, 'waits --runtime audit');

        expect(ctx.output()).toContain('elicitation=1');
        expect(ctx.output()).toContain('permission=1');
        expect(ctx.output()).toContain('ask_user=1');
    });

    it('/sdk prompt exibe status canônico do system prompt e instruction sources', async () => {
        const ctx = mockCtx();
        await cmdSdk({ println: ctx.println }, 'prompt');
        expect(runtimeMocks.readTerminalSdkSystemPromptProjection).toHaveBeenCalled();
        expect(ctx.output()).toContain('System Prompt SDK');
        expect(ctx.output()).toContain('sdk-transform');
        expect(ctx.output()).toContain('abcd1234efgh5678');
        expect(ctx.output()).toContain('Instruction sources');
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

    it('/workspace lista, lê e escreve no workspace virtual SDK, deixando claro que não é FS local', async () => {
        const list = mockCtx();
        await cmdWorkspace({ println: list.println }, 'list');
        expect(list.output()).toContain('Workspace SDK virtual');
        expect(list.output()).toContain('plan.md');

        const read = mockCtx();
        await cmdWorkspace({ println: read.println }, 'read plan.md');
        expect(runtimeMocks.readTerminalSdkWorkspaceFile).toHaveBeenCalledWith('plan.md');
        expect(read.output()).toContain('não FS local');
        expect(read.output()).toContain('hello');

        const write = mockCtx();
        await cmdWorkspace({ println: write.println }, 'write notes.md oi');
        expect(runtimeMocks.createTerminalSdkWorkspaceFile).toHaveBeenCalledWith('notes.md', 'oi');
        expect(write.output()).toContain('workspace SDK virtual');
        expect(write.output()).toContain('notes.md');
    });

    it('/workspace sync materializa arquivo do workspace SDK no FS local canônico via file-tools', async () => {
        runtimeMocks.readTerminalSdkWorkspaceFile.mockResolvedValueOnce({ path: 'plan.md', content: 'PLANO' });

        const ctx = mockCtx();
        await cmdWorkspace({ println: ctx.println }, 'sync plan.md --to tmp/plan-local.md');

        expect(runtimeMocks.readTerminalSdkWorkspaceFile).toHaveBeenCalledWith('plan.md');
        expect(fileToolMocks.createFileHandler).toHaveBeenCalledWith(
            expect.objectContaining({
                path: 'tmp/plan-local.md',
                content: 'PLANO',
                overwrite: false,
                createParentDirs: true,
            }),
        );
        expect(ctx.output()).toContain('SDK');
        expect(ctx.output()).toContain('materializado');
    });

    it('/workspace sync exibe guidance acionável quando conteúdo não é textual', async () => {
        runtimeMocks.readTerminalSdkWorkspaceFile.mockResolvedValueOnce(
            /** @type {any} */ ({ path: 'plan.md', content: null }),
        );

        const ctx = mockCtx();
        await cmdWorkspace({ println: ctx.println }, 'sync plan.md --to tmp/plan-local.md');

        expect(ctx.output()).toContain('conteúdo não textual');
        expect(ctx.output()).toContain('Próximos passos:');
        expect(ctx.output()).toContain('/status');
    });

    it('/workspace mirror materializa múltiplos arquivos em root local e usa overwrite quando solicitado', async () => {
        runtimeMocks.listTerminalSdkWorkspaceFiles.mockResolvedValueOnce({
            files: [{ path: 'a.md' }, { path: 'dir/b.md' }],
        });
        runtimeMocks.readTerminalSdkWorkspaceFile
            .mockResolvedValueOnce({ path: 'a.md', content: 'A' })
            .mockResolvedValueOnce({ path: 'dir/b.md', content: 'B' });

        const ctx = mockCtx();
        await cmdWorkspace({ println: ctx.println }, 'mirror --to tmp/sdk-mirror --overwrite');

        expect(fileToolMocks.writeFileHandler).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ path: 'tmp/sdk-mirror/a.md', content: 'A', encoding: 'utf8' }),
        );
        expect(fileToolMocks.writeFileHandler).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ path: 'tmp/sdk-mirror/dir/b.md', content: 'B', encoding: 'utf8' }),
        );
        expect(ctx.output()).toContain('Mirror SDK');
        expect(ctx.output()).toContain('ok=2');
    });

    it('/workspace promote promove arquivo local para workspace SDK com conflito auditável', async () => {
        runtimeMocks.readTerminalSdkWorkspaceFile.mockRejectedValueOnce(new Error('ENOENT: no such file'));

        const ctx = mockCtx();
        await cmdWorkspace({ println: ctx.println }, 'promote tmp/local.md --to notes/from-local.md');

        expect(fileToolMocks.readFileHandler).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'tmp/local.md', encoding: 'utf8' }),
        );
        expect(runtimeMocks.createTerminalSdkWorkspaceFile).toHaveBeenCalledWith(
            'notes/from-local.md',
            'LOCAL:tmp/local.md',
        );
        expect(ctx.output()).toContain('FS');
        expect(ctx.output()).toContain('promovido');
        expect(ctx.output()).toContain('fail-if-exists');
        expect(ctx.output()).toContain('traceId=');

        runtimeMocks.readTerminalSdkWorkspaceFile.mockResolvedValueOnce({
            path: 'notes/from-local.md',
            content: 'exists',
        });
        const conflict = mockCtx();
        await cmdWorkspace({ println: conflict.println }, 'promote tmp/local.md --to notes/from-local.md');

        expect(conflict.output()).toContain('ação=conflict');
        expect(conflict.output()).toContain('--overwrite');
    });

    it('/workspace promote permite overwrite explícito no workspace SDK', async () => {
        const ctx = mockCtx();
        await cmdWorkspace({ println: ctx.println }, 'promote tmp/local.md --to notes/from-local.md --overwrite');

        expect(runtimeMocks.readTerminalSdkWorkspaceFile).not.toHaveBeenCalled();
        expect(runtimeMocks.createTerminalSdkWorkspaceFile).toHaveBeenCalledWith(
            'notes/from-local.md',
            'LOCAL:tmp/local.md',
        );
        expect(ctx.output()).toContain('overwrite');
        expect(ctx.output()).toContain('ação=overwritten');
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

    it('/elicitation aplica defaults e valida arrays anyOf na borda terminal', async () => {
        recordTerminalElicitationPending({
            requestId: 'el-defaults',
            message: 'Escolha ambiente e tags',
            mode: 'form',
            requestedSchema: {
                type: 'object',
                properties: {
                    env: { type: 'string', default: 'dev', enum: ['dev', 'prod'] },
                    tags: {
                        type: 'array',
                        items: {
                            anyOf: [
                                { const: 'fast', title: 'fast' },
                                { const: 'safe', title: 'safe' },
                            ],
                        },
                    },
                },
                required: ['env'],
            },
        });

        const invalid = mockCtx();
        await cmdElicitation({ println: invalid.println }, 'respond el-defaults accept {"tags":["fast","noisy"]}');
        expect(invalid.output()).toContain('fast | safe');

        const valid = mockCtx();
        await cmdElicitation({ println: valid.println }, 'respond el-defaults accept {"tags":["fast","safe"]}');
        expect(runtimeMocks.resolveTerminalSdkPendingElicitation).toHaveBeenCalledWith('el-defaults', {
            action: 'accept',
            content: { env: 'dev', tags: ['fast', 'safe'] },
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

    it('/permission respond envia decisão para pending permission via runtime gateway', async () => {
        recordTerminalPermissionRequested({
            requestId: 'perm-pending',
            permissionType: 'shell',
        });

        const respond = mockCtx();
        await cmdPermission({ println: respond.println }, 'respond perm-pending approve-once {"reason":"manual"}');

        expect(runtimeMocks.handleTerminalSdkPendingPermission).toHaveBeenCalledWith(
            'perm-pending',
            expect.objectContaining({ kind: 'approve-once', reason: 'manual' }),
            null,
        );
        expect(respond.output()).toContain('Resposta de permissão enviada');
    });

    it('/permission integra request → respond → completed com correlação por requestId', async () => {
        recordTerminalPermissionRequested({
            requestId: 'perm-e2e-1',
            permissionType: 'file_write',
            data: { path: 'src/copilot/terminal/commands/sdk.js' },
        });

        const respond = mockCtx();
        await cmdPermission(
            { println: respond.println },
            'respond perm-e2e-1 approve-once {"reason":"operator-approved"}',
        );

        expect(runtimeMocks.handleTerminalSdkPendingPermission).toHaveBeenCalledWith(
            'perm-e2e-1',
            expect.objectContaining({ kind: 'approve-once', reason: 'operator-approved' }),
            null,
        );

        recordTerminalPermissionCompleted({
            requestId: 'perm-e2e-1',
            permissionType: 'file_write',
            result: 'approve-once',
            granted: true,
            data: { finalizedBy: 'sdk-event' },
        });

        const entry = getTerminalPermission('perm-e2e-1');
        expect(entry).not.toBeNull();
        expect(entry?.status).toBe('completed');
        expect(entry?.granted).toBe(true);
        expect(entry?.result).toBe('approve-once');
        expect(entry?.data).toEqual(
            expect.objectContaining({
                completion: expect.objectContaining({ finalizedBy: 'sdk-event' }),
            }),
        );

        const show = mockCtx();
        await cmdPermission({ println: show.println }, 'show perm-e2e-1');
        expect(show.output()).toContain('Permissão perm-e2e-1');
        expect(show.output()).toContain('approve-once');
    });

    it('/permission respond valida decisões persistentes que exigem approval', async () => {
        recordTerminalPermissionRequested({
            requestId: 'perm-persistent',
            permissionType: 'write',
        });

        const invalid = mockCtx();
        await cmdPermission({ println: invalid.println }, 'respond perm-persistent approve-for-session {"reason":"x"}');

        expect(runtimeMocks.handleTerminalSdkPendingPermission).not.toHaveBeenCalled();
        expect(invalid.output()).toContain('approval');
    });

    it('/permission pending usa listagem ativa via SDK RPC quando disponível', async () => {
        const ctx = mockCtx();
        await cmdPermission({ println: ctx.println }, 'pending');

        expect(runtimeMocks.listTerminalSdkPendingPermissions).toHaveBeenCalledOnce();
        expect(ctx.output()).toContain('pendentes via RPC');
        expect(ctx.output()).toContain('perm-rpc-1');
        expect(ctx.output()).toContain('file_write');
    });

    it('/permission pending hidrata estado local para permitir respond por RPC-only request', async () => {
        const pending = mockCtx();
        await cmdPermission({ println: pending.println }, 'pending');

        const respond = mockCtx();
        await cmdPermission({ println: respond.println }, 'respond perm-rpc-1 approve-once');

        expect(runtimeMocks.handleTerminalSdkPendingPermission).toHaveBeenCalledWith(
            'perm-rpc-1',
            { kind: 'approve-once' },
            null,
        );
        expect(respond.output()).toContain('Resposta de permissão enviada');
    });

    it('/permission mode lê e altera o modo de governança do runtime', async () => {
        const show = mockCtx();
        await cmdPermission({ println: show.println }, 'mode');
        expect(agentRuntimeMocks.readTerminalRuntimePermissionMode).toHaveBeenCalled();
        expect(show.output()).toContain('approve_all');

        const set = mockCtx();
        await cmdPermission({ println: set.println }, 'mode audit_only');
        expect(agentRuntimeMocks.setTerminalRuntimePermissionMode).toHaveBeenCalledWith('audit_only', null);
        expect(set.output()).toContain('Permission mode atualizado');
    });

    it('/permission show/respond latest respeita runtimeId e evita bleed entre runtimes', async () => {
        recordTerminalPermissionRequested({
            requestId: 'perm-default-1',
            runtimeId: 'default',
            permissionType: 'shell',
        });
        recordTerminalPermissionRequested({
            requestId: 'perm-audit-1',
            runtimeId: 'audit',
            permissionType: 'file_write',
        });

        const showAudit = mockCtx();
        await cmdPermission({ println: showAudit.println }, 'show latest --runtime audit');
        expect(showAudit.output()).toContain('Permissão perm-audit-1');

        const respondAudit = mockCtx();
        await cmdPermission({ println: respondAudit.println }, 'respond latest approve-once --runtime audit');
        expect(runtimeMocks.handleTerminalSdkPendingPermission).toHaveBeenCalledWith(
            'perm-audit-1',
            { kind: 'approve-once' },
            'audit',
        );
    });

    it('/elicitation show/respond latest respeita runtimeId e evita bleed entre runtimes', async () => {
        recordTerminalElicitationPending({
            requestId: 'el-default-1',
            runtimeId: 'default',
            message: 'Default',
            mode: 'form',
            requestedSchema: { type: 'object', properties: { answer: { type: 'string' } } },
        });
        recordTerminalElicitationPending({
            requestId: 'el-audit-1',
            runtimeId: 'audit',
            message: 'Audit',
            mode: 'form',
            requestedSchema: { type: 'object', properties: { answer: { type: 'string' } } },
        });

        const showAudit = mockCtx();
        await cmdElicitation({ println: showAudit.println }, 'show latest --runtime audit');
        expect(showAudit.output()).toContain('Elicitation el-audit-1');

        const respondAudit = mockCtx();
        await cmdElicitation(
            { println: respondAudit.println },
            'respond latest accept {"answer":"ok"} --runtime audit',
        );
        expect(runtimeMocks.resolveTerminalSdkPendingElicitation).toHaveBeenCalledWith(
            'el-audit-1',
            {
                action: 'accept',
                content: { answer: 'ok' },
            },
            'audit',
        );
    });

    it('/permission cockpit exibe pendências por tipo e histórico de mode changes', async () => {
        recordTerminalPermissionRequested({ requestId: 'perm-a', permissionType: 'file_write' });
        recordTerminalPermissionRequested({ requestId: 'perm-b', permissionType: 'file_write' });
        recordTerminalPermissionRequested({ requestId: 'perm-c', permissionType: 'shell' });
        recordTerminalPermissionModeChanged({ mode: 'audit_only', ts: Date.now() - 2000 });
        recordTerminalPermissionModeChanged({ mode: 'selective', ts: Date.now() - 1000 });

        const ctx = mockCtx();
        await cmdPermission({ println: ctx.println }, 'cockpit');

        expect(ctx.output()).toContain('Permission cockpit');
        expect(ctx.output()).toContain('pendentes');
        expect(ctx.output()).toContain('file_write=2');
        expect(ctx.output()).toContain('shell=1');
        expect(ctx.output()).toContain('mode log');
        expect(ctx.output()).toContain('selective');
        expect(ctx.output()).toContain('/permission pending');
    });
});
