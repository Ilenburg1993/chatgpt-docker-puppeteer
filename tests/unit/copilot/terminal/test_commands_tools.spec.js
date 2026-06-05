// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readTerminalToolStatsProjection, readTerminalStatusProjection, readTerminalToolRegistrySnapshot } = vi.hoisted(
    () => ({
        readTerminalToolStatsProjection: vi.fn(),
        readTerminalStatusProjection: vi.fn(() => ({
            runtimeId: 'default',
            runtimeHealth: 'ok',
            toolLoad: {
                hasCanonicalLocalFsTools: true,
                hasCanonicalLocalExecTools: true,
                hasSdkWorkspaceTooling: false,
                hasLegacySdkShellToolsLoaded: false,
                disabled: [],
                toolContract: {
                    ok: true,
                    errorCount: 0,
                    warningCount: 0,
                    metadataCoverage: {
                        descriptionPct: 100,
                        parametersPct: 100,
                        categoryPct: 100,
                        tagsPct: 100,
                        instructionsPct: 100,
                    },
                },
            },
        })),
        readTerminalToolRegistrySnapshot: vi.fn(() => ({
            toolContract: {
                issues: [],
            },
        })),
    }),
);

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalToolStatsProjection,
    readTerminalStatusProjection,
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/index.js', () => ({
    readTerminalToolRegistrySnapshot,
}));

const { cmdTools } = await import('../../../../src/copilot/terminal/commands/tools.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('commands/tools', () => {
    beforeEach(() => {
        readTerminalToolStatsProjection.mockReset();
        readTerminalToolStatsProjection.mockReturnValue({
            stats: {
                'tool.fast': { calls: 3, errors: 0, avgLatencyMs: 12 },
                'tool.slow': { calls: 2, errors: 1, avgLatencyMs: 140 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['tool.fast', { calls: 3, errors: 0, avgLatencyMs: 12 }],
                ['tool.slow', { calls: 2, errors: 1, avgLatencyMs: 140 }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['tool.fast', { calls: 3, errors: 0, avgLatencyMs: 12 }],
                ['tool.slow', { calls: 2, errors: 1, avgLatencyMs: 140 }],
            ]),
            tools: [],
            byCategory: {},
            toolCount: 2,
            lifecycle: {
                active: [],
                recent: [],
                summary: { active: 0, recent: 0, waitingUser: 0, failedRecent: 0 },
            },
        });
    });

    it('renderiza estatísticas a partir da projection do terminal frontend', () => {
        const ctx = mockCtx();

        cmdTools({ println: ctx.println });

        expect(readTerminalToolStatsProjection).toHaveBeenCalledTimes(1);
        expect(ctx.output()).toContain('Ferramentas observadas');
        expect(ctx.output()).toContain('Categorias');
        expect(ctx.output()).toContain('tool.fast');
        expect(ctx.output()).toContain('uso');
        expect(ctx.output()).toContain('sem falhas');
        expect(ctx.output()).not.toContain('calls=');
        expect(ctx.output()).not.toContain('errors=');
        expect(ctx.output()).toContain('140ms');
    });

    it('renderiza estado vazio sem acessar observability diretamente', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {},
            canonicalEntries: [],
            entries: [],
            tools: [],
            byCategory: {},
            toolCount: 0,
            lifecycle: {
                active: [],
                recent: [],
                summary: { active: 0, recent: 0, waitingUser: 0, failedRecent: 0 },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println });

        expect(ctx.output()).toContain('Nenhuma ferramenta observada');
    });

    it('mostra diagnóstico e contrato mesmo sem tools observadas quando modo diag é explícito', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {},
            canonicalEntries: [],
            entries: [],
            tools: [],
            byCategory: {},
            toolCount: 0,
            lifecycle: {
                active: [],
                recent: [],
                summary: { active: 0, recent: 0, waitingUser: 0, failedRecent: 0 },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println }, 'diag');

        const output = ctx.output();
        expect(output).toContain('nenhuma tool usada ainda');
        expect(output).toContain('Superfícies operacionais');
        expect(output).toContain('Contrato das ferramentas');
        expect(output).toContain('/tools contract');
        expect(output).not.toContain('Ferramentas observadas');
        expect(output).not.toContain('0 grupos de ação');
    });

    it('renderiza decisões de autonomia no contrato sem tratá-las como aviso operacional', () => {
        readTerminalToolRegistrySnapshot.mockReturnValueOnce({
            toolContract: {
                ok: true,
                errorCount: 0,
                warningCount: 0,
                noticeCount: 0,
                decisionCount: 1,
                riskySkipPermissionCount: 0,
                autonomySkipPermissionCount: 1,
                permissionMode: 'approve_all',
                metadataCoverage: {
                    descriptionPct: 100,
                    parametersPct: 100,
                    categoryPct: 100,
                    tagsPct: 100,
                    instructionsPct: 100,
                },
                issues: [
                    {
                        severity: 'decision',
                        code: 'AUTONOMY_SKIP_PERMISSION',
                        toolName: 'patch_file',
                        message: 'autonomia efetiva em tool patch (high) por permissionMode=approve_all.',
                    },
                ],
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println }, 'contract');

        const output = ctx.output();
        expect(output).toContain('Contrato das ferramentas');
        expect(output).toContain('decisões 1');
        expect(output).toContain('autonomia 1');
        expect(output).toContain('Decisão');
        expect(output).toContain('AUTONOMY_SKIP_PERMISSION');
        expect(output).toContain('Editar arquivo');
        expect(output).not.toContain('Aviso   AUTONOMY_SKIP_PERMISSION');
    });

    it('renderiza superfície canônica de filesystem sem depender de tools já observadas', () => {
        readTerminalToolRegistrySnapshot.mockReturnValueOnce({
            hasCanonicalLocalFsTools: true,
            metadataByName: {
                patch_file: {
                    name: 'patch_file',
                    category: 'file',
                    operation: 'patch',
                    risk: 'high',
                    sideEffect: 'filesystem',
                    targetKinds: ['file'],
                    effectiveSkipPermission: true,
                    capabilities: {
                        dryRun: true,
                        rollback: true,
                        hashPrecondition: true,
                        pagination: false,
                        streaming: false,
                        diff: true,
                        preview: true,
                    },
                },
                read_file_content: {
                    name: 'read_file_content',
                    category: 'file',
                    operation: 'read',
                    risk: 'low',
                    sideEffect: 'none',
                    targetKinds: ['file'],
                    effectiveSkipPermission: true,
                    capabilities: {
                        dryRun: false,
                        rollback: false,
                        hashPrecondition: false,
                        pagination: true,
                        streaming: true,
                        diff: false,
                        preview: true,
                    },
                },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println }, 'fs');

        const output = ctx.output();
        expect(output).toContain('Tools de filesystem');
        expect(output).toContain('FS canônico ativo');
        expect(output).toContain('Ler arquivo');
        expect(output).toContain('Editar arquivo');
        expect(output).toContain('caps cursor/stream');
        expect(output).toContain('caps dry-run/hash/diff/rollback');
        expect(output.indexOf('Ler arquivo')).toBeLessThan(output.indexOf('Editar arquivo'));
        expect(output).toContain('/tools contract');
    });

    it('renderiza falhas de tools com lifecycle humano compacto', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {
                patch_file: { calls: 2, errors: 1, blocked: 0, avgLatencyMs: 44 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['patch_file', { calls: 2, errors: 1, blocked: 0, avgLatencyMs: 44, kind: 'file' }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['patch_file', { calls: 2, errors: 1, blocked: 0, avgLatencyMs: 44, kind: 'file' }],
            ]),
            tools: [],
            byCategory: {},
            toolCount: 1,
            lifecycle: {
                active: [],
                recent: [
                    {
                        key: 'call-failed',
                        type: 'complete',
                        status: 'failed',
                        source: 'sdk',
                        toolName: 'patch_file',
                        rawToolName: 'patch_file',
                        operation: 'patch',
                        toolCallId: 'chatcmpl-tool-failed',
                        requestId: 'req-failed',
                        traceId: 'turn:failed',
                        turnId: '9',
                        target: 'src/copilot/file.js',
                        path: 'src/copilot/file.js',
                        primaryTargetKind: 'patch',
                        resultSummary: 'Patch falhou: ERR_PATCH_NOT_FOUND',
                        progress: null,
                        progressMessage: null,
                        success: false,
                        durationMs: 12,
                        startedAt: 1,
                        updatedAt: 2,
                        completedAt: 2,
                    },
                ],
                summary: { active: 0, recent: 1, waitingUser: 0, failedRecent: 1 },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println }, 'failures');

        const output = ctx.output();
        expect(output).toContain('Falhas de tools');
        expect(output).toContain('Editar arquivo');
        expect(output).toContain('1 falha');
        expect(output).toContain('Patch falhou: ERR_PATCH_NOT_FOUND');
        expect(output).not.toContain('chatcmpl-tool-failed');
        expect(output).toContain('/errors');
    });

    it('usa nomes humanos no modo default, diag humano e nomes técnicos apenas no all/raw', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {
                read_file_content: { calls: 2, errors: 0, avgLatencyMs: 18 },
                report_intent_local: { calls: 1, errors: 0, avgLatencyMs: 7 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 2, errors: 0, avgLatencyMs: 18 }],
                ['report_intent_local', { calls: 1, errors: 0, avgLatencyMs: 7 }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 2, errors: 0, avgLatencyMs: 18 }],
                ['report_intent_local', { calls: 1, errors: 0, avgLatencyMs: 7 }],
            ]),
            tools: [],
            byCategory: {},
            toolCount: 2,
            lifecycle: {
                active: [],
                recent: [],
                summary: { active: 0, recent: 0, waitingUser: 0, failedRecent: 0 },
            },
        });
        const defaultCtx = mockCtx();

        cmdTools({ println: defaultCtx.println });

        expect(defaultCtx.output()).toContain('Ler arquivo');
        expect(defaultCtx.output()).toContain('Intenção capturada');
        expect(defaultCtx.output()).not.toContain('read_file_content');
        expect(defaultCtx.output()).not.toContain('report_intent_local');
        expect(defaultCtx.output()).toContain('Detalhes');
        expect(defaultCtx.output()).toContain('/tools diag');

        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {
                read_file_content: { calls: 2, errors: 0, avgLatencyMs: 18 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 2, errors: 0, avgLatencyMs: 18, kind: 'file' }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 2, errors: 0, avgLatencyMs: 18, kind: 'file' }],
            ]),
            tools: [],
            byCategory: {},
            toolCount: 1,
            lifecycle: {
                active: [],
                recent: [],
                summary: { active: 0, recent: 0, waitingUser: 0, failedRecent: 0 },
            },
        });
        const diagCtx = mockCtx();

        cmdTools({ println: diagCtx.println }, 'diag');

        expect(diagCtx.output()).toContain('Ler arquivo');
        expect(diagCtx.output()).toContain('diagnóstico humano');
        expect(diagCtx.output()).not.toContain('Nome interno');
        expect(diagCtx.output()).not.toContain('read_file_content');
        expect(diagCtx.output()).not.toContain('Nome técnico');
        expect(diagCtx.output()).not.toContain('tool técnico: read_file_content');
        expect(diagCtx.output()).toContain('arquivo');
        expect(diagCtx.output()).not.toContain('Tipo');
        expect(diagCtx.output()).not.toContain('tipo file');
        expect(diagCtx.output()).not.toContain('tipo: file');

        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {
                read_file_content: { calls: 2, errors: 0, avgLatencyMs: 18 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 2, errors: 0, avgLatencyMs: 18, kind: 'file' }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 2, errors: 0, avgLatencyMs: 18, kind: 'file' }],
            ]),
            tools: [],
            byCategory: {},
            toolCount: 1,
            lifecycle: {
                active: [],
                recent: [],
                summary: { active: 0, recent: 0, waitingUser: 0, failedRecent: 0 },
            },
        });
        const allCtx = mockCtx();

        cmdTools({ println: allCtx.println }, 'all');

        expect(allCtx.output()).toContain('diagnóstico completo');
        expect(allCtx.output()).toContain('Nome interno');
        expect(allCtx.output()).toContain('read_file_content');
    });

    it('humaniza agregados de I/O no modo default', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {
                'io.read.io-engine.fs.readFile.text': { calls: 1, errors: 0, avgLatencyMs: 3 },
                'io.mkdir.io-engine.ensure-dir': { calls: 1, errors: 0, avgLatencyMs: 2 },
                'io.search.io-engine.rg.search': { calls: 1, errors: 0, avgLatencyMs: 21 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['io.read.io-engine.fs.readFile.text', { calls: 1, errors: 0, avgLatencyMs: 3, kind: 'io' }],
                ['io.mkdir.io-engine.ensure-dir', { calls: 1, errors: 0, avgLatencyMs: 2, kind: 'io' }],
                ['io.search.io-engine.rg.search', { calls: 1, errors: 0, avgLatencyMs: 21, kind: 'io' }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['io.read.io-engine.fs.readFile.text', { calls: 1, errors: 0, avgLatencyMs: 3, kind: 'io' }],
                ['io.mkdir.io-engine.ensure-dir', { calls: 1, errors: 0, avgLatencyMs: 2, kind: 'io' }],
                ['io.search.io-engine.rg.search', { calls: 1, errors: 0, avgLatencyMs: 21, kind: 'io' }],
            ]),
            tools: [],
            byCategory: {},
            toolCount: 1,
            lifecycle: {
                active: [],
                recent: [],
                summary: { active: 0, recent: 0, waitingUser: 0, failedRecent: 0 },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println });

        expect(ctx.output()).toContain('Leitura local');
        expect(ctx.output()).toContain('Pasta local');
        expect(ctx.output()).toContain('Busca local');
        expect(ctx.output()).not.toContain('io-engine.fs.readFile.text');
        expect(ctx.output()).not.toContain('io-engine.ensure-dir');
        expect(ctx.output()).not.toContain('io-engine.rg.search');
    });

    it('omite tipo ferramenta redundante e preserva categoria agregada no diagnóstico humano', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {
                report_intent_local: { calls: 1, errors: 0, avgLatencyMs: 7 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['report_intent_local', { calls: 1, errors: 0, avgLatencyMs: 7, kind: 'tool' }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['report_intent_local', { calls: 1, errors: 0, avgLatencyMs: 7, kind: 'tool' }],
            ]),
            tools: [],
            byCategory: {
                tool: { totalCalls: 1, totalErrors: 0, totalBlocked: 0, avgLatencyMs: 7 },
            },
            toolCount: 1,
            lifecycle: {
                active: [],
                recent: [],
                summary: { active: 0, recent: 0, waitingUser: 0, failedRecent: 0 },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println }, 'diag');

        expect(ctx.output()).not.toContain('Classe');
        expect(ctx.output()).not.toContain('Tipo');
        expect(ctx.output()).toContain('ferramenta');
        expect(ctx.output()).toContain('Ferramenta');
        expect(ctx.output()).not.toContain('Tipo          ferramenta');
        expect(ctx.output()).not.toContain('Classe        tool');
        expect(ctx.output()).not.toContain('\ntool');
    });

    it('humaniza categoria bridge no diagnóstico humano', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {
                'bridge.git.diff': { calls: 1, errors: 0, avgLatencyMs: 33 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['bridge.git.diff', { calls: 1, errors: 0, avgLatencyMs: 33, kind: 'tool' }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['bridge.git.diff', { calls: 1, errors: 0, avgLatencyMs: 33, kind: 'tool' }],
            ]),
            tools: [],
            byCategory: {
                bridge: { totalCalls: 1, totalErrors: 0, totalBlocked: 0, avgLatencyMs: 33 },
            },
            toolCount: 1,
            lifecycle: {
                active: [],
                recent: [],
                summary: { active: 0, recent: 0, waitingUser: 0, failedRecent: 0 },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println }, 'diag');

        expect(ctx.output()).toContain('Ponte local');
        expect(ctx.output()).not.toMatch(/\n\s*bridge\s+uso/u);
    });

    it('renderiza lifecycle compacto em modo diag', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {
                read_file_content: { calls: 1, errors: 0, avgLatencyMs: 25 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 1, errors: 0, avgLatencyMs: 25, kind: 'file' }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 1, errors: 0, avgLatencyMs: 25, kind: 'file' }],
            ]),
            tools: [],
            byCategory: {
                file: { totalCalls: 1, totalErrors: 0, totalBlocked: 0, avgLatencyMs: 25 },
            },
            toolCount: 1,
            lifecycle: {
                active: [
                    {
                        key: 'call-123456789012345',
                        type: 'start',
                        status: 'active',
                        source: 'sdk',
                        toolName: 'read_file_content',
                        rawToolName: null,
                        operation: 'read',
                        toolCallId: 'call-123456789012345',
                        requestId: 'req-123456789012345',
                        traceId: 'turn:123456789012345',
                        turnId: '1',
                        target: 'src/copilot/file.js',
                        path: 'src/copilot/file.js',
                        progress: 50,
                        progressMessage: 'metade',
                        success: null,
                        durationMs: null,
                        startedAt: 1,
                        updatedAt: 2,
                        completedAt: null,
                    },
                ],
                recent: [
                    {
                        key: 'call-done',
                        type: 'complete',
                        status: 'completed',
                        source: 'sdk',
                        toolName: 'report_intent_local',
                        rawToolName: 'report_intent',
                        operation: 'inspect',
                        toolCallId: 'call-done',
                        requestId: null,
                        traceId: 'turn:1',
                        turnId: '1',
                        target: null,
                        path: null,
                        progress: null,
                        progressMessage: null,
                        success: true,
                        durationMs: 31,
                        startedAt: 1,
                        updatedAt: 3,
                        completedAt: 3,
                    },
                ],
                summary: { active: 1, recent: 1, waitingUser: 0, failedRecent: 0 },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println }, 'diag');

        const output = ctx.output();
        expect(output).toContain('Lifecycle recente');
        expect(output).toContain('ativas 1');
        expect(output).toContain('Ler arquivo');
        expect(output).toContain('Em voo');
        expect(output).toContain('1 ferramenta');
        expect(output).not.toContain('Nome interno');
        expect(output).not.toContain('read_file_content');
        expect(output).not.toContain('Rastreio');
        expect(output).not.toContain('call call-1234567…');
        expect(output).not.toContain('req req-12345678…');
        expect(output).toContain('Intenção capturada');
        expect(output).not.toContain('report_intent_local');
        expect(output).toMatch(/Alvo\s+src\/copilot\/file\.js/u);
        expect(output).toContain('concluída');
        expect(output).not.toContain('chamada call-1234567…');
        expect(output).not.toContain('requisição req-12345678…');
        expect(output).not.toContain('active=');
        expect(output).not.toContain('tool=report_intent_local');
        expect(output).not.toContain('call=call-1234567');
    });

    it('mostra comando, filtros e resultado no lifecycle humano sem IDs internos', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {
                exec_command: { calls: 1, errors: 0, avgLatencyMs: 80 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['exec_command', { calls: 1, errors: 0, avgLatencyMs: 80, kind: 'exec' }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['exec_command', { calls: 1, errors: 0, avgLatencyMs: 80, kind: 'exec' }],
            ]),
            tools: [],
            byCategory: {
                exec: { totalCalls: 1, totalErrors: 0, totalBlocked: 0, avgLatencyMs: 80 },
            },
            toolCount: 1,
            lifecycle: {
                active: [],
                recent: [
                    {
                        key: 'chatcmpl-tool-json-exec',
                        type: 'complete',
                        status: 'completed',
                        source: 'sdk',
                        toolName: 'exec_command',
                        rawToolName: 'external_tool',
                        operation: 'run',
                        toolCallId: 'chatcmpl-tool-json-exec',
                        requestId: 'req-json-exec',
                        traceId: 'turn:json-exec',
                        turnId: '7',
                        target: 'git status --short',
                        path: null,
                        directoryTargets: ['/workspaces/chatgpt-docker-puppeteer'],
                        commands: ['git status --short'],
                        filters: ['timeout: 10s'],
                        resultCount: null,
                        resultSummary: 'sucesso · saída 0',
                        primaryTargetKind: 'command',
                        progress: 100,
                        progressMessage: null,
                        success: true,
                        durationMs: 80,
                        startedAt: 1,
                        updatedAt: 2,
                        completedAt: 2,
                    },
                ],
                summary: { active: 0, recent: 1, waitingUser: 0, failedRecent: 0 },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println }, 'diag');

        const output = ctx.output();
        expect(output).toContain('Executar comando');
        expect(output).toMatch(/Comando\s+git status --short/u);
        expect(output).toMatch(/Filtros\s+timeout: 10s/u);
        expect(output).toMatch(/Resultado\s+sucesso · saída 0/u);
        expect(output).toContain('Diretório');
        expect(output).not.toContain('chatcmpl-tool-json-exec');
        expect(output).not.toContain('req-json-exec');
        expect(output).not.toContain('external_tool');
    });

    it('preserva rastreio técnico de lifecycle no modo all', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {
                read_file_content: { calls: 1, errors: 0, avgLatencyMs: 25 },
            },
            canonicalEntries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 1, errors: 0, avgLatencyMs: 25, kind: 'file' }],
            ]),
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['read_file_content', { calls: 1, errors: 0, avgLatencyMs: 25, kind: 'file' }],
            ]),
            tools: [],
            byCategory: {
                file: { totalCalls: 1, totalErrors: 0, totalBlocked: 0, avgLatencyMs: 25 },
            },
            toolCount: 1,
            lifecycle: {
                active: [
                    {
                        key: 'call-123456789012345',
                        type: 'start',
                        status: 'active',
                        source: 'sdk',
                        toolName: 'read_file_content',
                        rawToolName: null,
                        operation: 'read',
                        toolCallId: 'call-123456789012345',
                        requestId: 'req-123456789012345',
                        traceId: 'turn:123456789012345',
                        turnId: '1',
                        target: 'src/copilot/file.js',
                        path: 'src/copilot/file.js',
                        progress: 50,
                        progressMessage: 'metade',
                        success: null,
                        durationMs: null,
                        startedAt: 1,
                        updatedAt: 2,
                        completedAt: null,
                    },
                ],
                recent: [
                    {
                        key: 'call-done',
                        type: 'complete',
                        status: 'completed',
                        source: 'sdk',
                        toolName: 'report_intent_local',
                        rawToolName: 'report_intent',
                        operation: 'inspect',
                        toolCallId: 'call-done',
                        requestId: null,
                        traceId: 'turn:1',
                        turnId: '1',
                        target: null,
                        path: null,
                        progress: null,
                        progressMessage: null,
                        success: true,
                        durationMs: 31,
                        startedAt: 1,
                        updatedAt: 3,
                        completedAt: 3,
                    },
                ],
                summary: { active: 1, recent: 1, waitingUser: 0, failedRecent: 0 },
            },
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println }, 'all');

        const output = ctx.output();
        expect(output).toContain('diagnóstico completo');
        expect(output).toContain('Nome interno');
        expect(output).toContain('read_file_content');
        expect(output).toContain('SDK Intenção capturada');
        expect(output).not.toContain('report_intent');
        expect(output).toContain('Rastreio');
        expect(output).toContain('call call-1234567…');
        expect(output).toContain('req req-12345678…');
        expect(output).toContain('1970-01-01T00:00:00.002Z');
    });
});
