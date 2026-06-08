// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy fixture inference is intentionally outside the MCP strict hardening pass

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/copilot/terminal/frontend/projections/now.js', () => ({
    readTerminalActivityProjection: vi.fn(() => ({
        current: {
            phase: 'tool',
            label: 'Executando tool',
            detail: 'web_fetch · display=full · 50%',
            source: 'sdk',
            severity: 'info',
            progress: 50,
            toolName: 'web_fetch',
            startedAt: 1,
            updatedAt: 2,
            ageMs: 1200,
        },
        history: [
            {
                phase: 'tool',
                label: 'Executando tool',
                detail: 'web_fetch · display=full · 50%',
                source: 'sdk',
                severity: 'info',
                progress: 50,
                toolName: 'web_fetch',
                startedAt: 1,
                updatedAt: 2,
                ageMs: 1200,
                ts: 2,
            },
        ],
        turnTrace: {
            current: {
                traceId: 'turn:turn-1',
                turnId: 'turn-1',
                source: 'assistant',
                status: 'active',
                startedAt: 1,
                updatedAt: 2,
                finishedAt: null,
                toolCount: 1,
                fileCount: 1,
                userInputCount: 1,
                tools: [
                    {
                        toolName: 'workspace.read_file',
                        operation: 'read',
                        path: 'src/copilot/terminal/repl/repl.js',
                        target: 'src/copilot/terminal/repl/repl.js',
                        source: 'sdk',
                        status: 'completed',
                        success: true,
                        count: 2,
                        updatedAt: 2,
                    },
                ],
                files: [
                    {
                        path: 'src/copilot/terminal/repl/repl.js',
                        operation: 'read',
                        source: 'sdk',
                        count: 2,
                        updatedAt: 2,
                    },
                    {
                        path: '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/repl/repl.js',
                        operation: 'read',
                        source: 'sdk',
                        count: 1,
                        updatedAt: 2,
                    },
                ],
                userInputs: [
                    {
                        requestId: 'ui-1',
                        kind: 'question',
                        question: 'Qual ambiente devo usar?',
                        choices: ['dev', 'prod'],
                        allowFreeform: false,
                        status: 'answered',
                        answerPreview: 'prod',
                        source: 'sdk',
                        count: 2,
                        updatedAt: 2,
                    },
                ],
            },
            recent: [
                {
                    traceId: 'turn:turn-0',
                    turnId: 'turn-0',
                    source: 'assistant',
                    status: 'completed',
                    startedAt: 1,
                    updatedAt: 2,
                    finishedAt: 3,
                    toolCount: 1,
                    fileCount: 1,
                    userInputCount: 0,
                    tools: [
                        {
                            toolName: 'view',
                            operation: 'read',
                            path: '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/commands/activity.js',
                            target: '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/commands/activity.js',
                            source: 'sdk',
                            status: 'completed',
                            success: true,
                            count: 1,
                            updatedAt: 2,
                        },
                    ],
                    files: [
                        {
                            path: '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/commands/activity.js',
                            operation: 'read',
                            source: 'sdk',
                            count: 1,
                            updatedAt: 2,
                        },
                    ],
                    userInputs: [],
                },
            ],
        },
    })),
}));

vi.mock('../../../../src/copilot/terminal/events/projections/index.js', () => ({
    readTerminalIoActivityProjection: vi.fn(() => [
        {
            timestamp: 2,
            success: true,
            operation: 'read',
            target: 'src/copilot/terminal/repl/repl.js',
            targets: ['src/copilot/terminal/repl/repl.js'],
            engine: 'io-engine.fs.readFile.text',
            targetKind: 'file',
            durationMs: 7,
            bytesRead: 42,
            bytesWritten: null,
            riskClass: 'low',
            error: null,
        },
    ]),
}));

const { cmdActivity } = await import('../../../../src/copilot/terminal/commands/activity.js');
const terminalFrontend = await import('../../../../src/copilot/terminal/frontend/projections/now.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('terminal/commands/activity', () => {
    it('exibe atividade atual e timeline recente', () => {
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '5');

        expect(ctx.output()).toContain('Atividade Atual da LLM-B');
        expect(ctx.output()).not.toContain('\x1b[36mAtividade Atual da LLM-B');
        expect(ctx.output()).toContain('Executando ferramenta');
        expect(ctx.output()).toContain('Buscar na web');
        expect(ctx.output()).not.toContain('Executando tool');
        expect(ctx.output()).not.toContain('web_fetch');
        expect(ctx.output()).toContain('tela full');
        expect(ctx.output()).not.toContain('display=full');
        expect(ctx.output()).toContain('Estado');
        expect(ctx.output()).toContain('Evento');
        expect(ctx.output()).toContain('Ferramentas');
        expect(ctx.output()).toContain('Timeline operacional');
        expect(ctx.output()).toContain('Operador');
        expect(ctx.output()).not.toContain('\x1b[36mTimeline recente');
        expect(ctx.output()).toContain('Resumo do turno atual');
        expect(ctx.output()).toContain('Último turno concluído');
        expect(ctx.output()).toContain('Arquivos tocados');
        expect(ctx.output()).toMatch(/Arquivos\s+1/u);
        expect((ctx.output().match(/Arquivo\s+leitura · src\/copilot\/terminal\/repl\/repl\.js ×2/gu) ?? [])).toHaveLength(1);
        expect(ctx.output()).toContain('Ler arquivo');
        expect(ctx.output()).not.toContain('workspace.read_file');
        expect(ctx.output()).toContain('Interações humanas');
        expect(ctx.output()).toContain('Qual ambiente devo usar?');
        expect(ctx.output()).toContain('resposta prod');
        expect(ctx.output()).not.toContain('resposta=');
        expect(ctx.output()).toContain('I/O real recente');
        expect(ctx.output()).toContain('há ');
        expect(ctx.output()).not.toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}\]/u);
        expect(ctx.output()).not.toMatch(/\[\d{2}:\d{2}:\d{2}\]/u);
        expect(ctx.output()).toContain('Mais detalhes');
        expect(ctx.output()).toContain('/activity detail');
        expect(ctx.output()).not.toContain('Detalhes técnicos ficam em /activity detail');
        expect(ctx.output()).not.toContain('Técnico');
        expect(ctx.output()).not.toContain('Detalhe      Detalhes técnicos');
        expect(ctx.output()).not.toContain('source');
        expect(ctx.output()).not.toContain('Streaming público');
        expect(ctx.output()).not.toContain('deltas');
        expect(ctx.output()).not.toContain('io-engine.fs.readFile.text');
        expect(ctx.output()).not.toContain('turn:turn-1');
    });

    it('preserva ids e engine no modo detail', () => {
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '5 detail');

        expect(ctx.output()).toContain('Timeline completa');
        expect(ctx.output()).toContain('1 arquivo único · 2 registros');
        expect(ctx.output()).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} \(há \d+[smhda]\)\]/u);
        expect(ctx.output()).toContain('io-engine.fs.readFile.text');
        expect(ctx.output()).toContain('turn:turn-1');
        expect(ctx.output()).toContain('req=ui-1');
        expect(ctx.output()).toContain('Origem');
        expect(ctx.output()).toContain('src/copilot/terminal/commands/activity.js');
        expect(ctx.output()).not.toContain(
            '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/commands/activity.js',
        );
    });

    it('humaniza fase de modelo sem vazar enum cru', () => {
        vi.mocked(terminalFrontend.readTerminalActivityProjection).mockReturnValueOnce({
            current: {
                phase: 'model',
                label: 'Troca de modelo solicitada',
                detail:
                    'solicitado: kilo-auto/free → terminal-ux-boundary-fixture · solicitação manual /byok model · origem terminal.byok_model · 2026-06-05T05:50:42.410Z',
                source: 'terminal.byok_model',
                severity: 'info',
                progress: null,
                toolName: null,
                startedAt: 1,
                updatedAt: 2,
                ageMs: 1200,
            },
            history: [
                {
                    phase: 'model',
                    label: 'Troca de modelo solicitada',
                    detail: 'solicitado: kilo-auto/free → terminal-ux-boundary-fixture',
                    source: 'terminal.byok_model',
                    severity: 'info',
                    progress: null,
                    toolName: null,
                    startedAt: 1,
                    updatedAt: 2,
                    ageMs: 1200,
                    ts: 2,
                },
            ],
            turnTrace: {
                current: null,
                recent: [],
            },
            streamDiagnostics: {
                active: false,
                pendingDeltas: 0,
                pendingReasoning: 0,
                pendingToolEvents: 0,
                lastFlushAt: null,
                lastDeltaAt: null,
            },
        });
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '5');

        expect(ctx.output()).toMatch(/Estado\s+modelo/u);
        expect(ctx.output()).toContain('Troca de modelo solicitada');
        expect(ctx.output()).not.toMatch(/Estado\s+model\b/u);
        expect(ctx.output()).not.toContain('terminal.byok_model');
    });

    it('não chama trace concluído recente de turno atual quando não há current ativo', () => {
        vi.mocked(terminalFrontend.readTerminalActivityProjection).mockReturnValueOnce({
            current: {
                phase: 'idle',
                label: 'Pronto',
                detail: 'Aguardando próxima mensagem',
                source: 'terminal',
                severity: 'info',
                progress: null,
                toolName: null,
                startedAt: 1,
                updatedAt: 2,
                ageMs: 1200,
            },
            history: [],
            turnTrace: {
                current: null,
                recent: [
                    {
                        traceId: 'turn:done',
                        turnId: 'done',
                        source: 'assistant',
                        status: 'completed',
                        startedAt: 1,
                        updatedAt: 2,
                        finishedAt: 3,
                        toolCount: 0,
                        fileCount: 0,
                        userInputCount: 1,
                        tools: [],
                        files: [],
                        userInputs: [
                            {
                                requestId: 'ui-2',
                                kind: 'question',
                                question: 'Confirmar deploy?',
                                choices: ['sim', 'não'],
                                allowFreeform: false,
                                status: 'requested',
                                answerPreview: null,
                                source: 'sdk',
                                count: 1,
                                updatedAt: 2,
                            },
                        ],
                    },
                ],
            },
        });
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '5');

        expect(ctx.output()).not.toContain('Resumo do turno atual');
        expect(ctx.output()).toContain('Último turno concluído');
        expect(ctx.output()).toContain('Confirmar deploy?');
    });

    it('chama trace implícito local de atividade operacional, não turno de conversa', () => {
        vi.mocked(terminalFrontend.readTerminalActivityProjection).mockReturnValueOnce({
            current: {
                phase: 'tool',
                label: 'Arquivo: busca concluída',
                detail: 'busca · data/copilot-terminal/live-scratch',
                source: 'io',
                severity: 'info',
                progress: 100,
                toolName: 'io.search',
                startedAt: 1,
                updatedAt: 2,
                ageMs: 0,
            },
            history: [],
            turnTrace: {
                current: {
                    traceId: 'implicit:123',
                    turnId: null,
                    source: 'implicit',
                    status: 'active',
                    startedAt: 1,
                    updatedAt: 2,
                    finishedAt: null,
                    toolCount: 0,
                    fileCount: 1,
                    userInputCount: 0,
                    tools: [],
                    files: [
                        {
                            path: 'data/copilot-terminal/live-scratch/example.txt',
                            operation: 'read',
                            source: 'io',
                            count: 1,
                            updatedAt: 2,
                        },
                    ],
                    userInputs: [],
                },
                recent: [],
            },
            streamDiagnostics: {
                active: false,
                pendingDeltas: 0,
                pendingReasoning: 0,
                pendingToolEvents: 0,
                lastFlushAt: null,
                lastDeltaAt: null,
            },
        });
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '5');

        expect(ctx.output()).toContain('Atividade operacional atual');
        expect(ctx.output()).not.toContain('Resumo do turno atual');
        expect(ctx.output()).toContain('data/copilot-terminal/live-scratch/example.txt');
    });

    it('preserva trace operacional recente quando o SDK separa tools e ask_user em turnos distintos', () => {
        vi.mocked(terminalFrontend.readTerminalActivityProjection).mockReturnValueOnce({
            current: {
                phase: 'idle',
                label: 'Pronto',
                detail: 'Turno concluído',
                source: 'terminal',
                severity: 'info',
                progress: null,
                toolName: null,
                startedAt: 1,
                updatedAt: 2,
                ageMs: 0,
            },
            history: [],
            turnTrace: {
                current: null,
                recent: [
                    {
                        traceId: 'turn:ask',
                        turnId: 'ask',
                        source: 'assistant',
                        status: 'completed',
                        startedAt: 20,
                        updatedAt: 30,
                        finishedAt: 30,
                        toolCount: 0,
                        fileCount: 0,
                        userInputCount: 1,
                        tools: [],
                        files: [],
                        userInputs: [
                            {
                                requestId: 'ask-1',
                                kind: 'question',
                                question: 'ASK-CANONICAL?',
                                choices: ['SIM'],
                                allowFreeform: false,
                                status: 'answered',
                                answerPreview: 'SIM',
                                source: 'sdk',
                                count: 2,
                                updatedAt: 30,
                            },
                        ],
                    },
                    {
                        traceId: 'turn:tools',
                        turnId: 'tools',
                        source: 'assistant',
                        status: 'completed',
                        startedAt: 10,
                        updatedAt: 19,
                        finishedAt: 19,
                        toolCount: 1,
                        fileCount: 1,
                        userInputCount: 0,
                        tools: [
                            {
                                toolName: 'read_file_content',
                                operation: 'read',
                                path: 'package.json',
                                target: 'package.json',
                                source: 'sdk',
                                status: 'completed',
                                success: true,
                                count: 1,
                                updatedAt: 19,
                            },
                        ],
                        files: [
                            {
                                path: 'package.json',
                                operation: 'read',
                                source: 'sdk',
                                count: 1,
                                updatedAt: 19,
                            },
                        ],
                        userInputs: [],
                    },
                ],
            },
        });
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '5');

        expect(ctx.output()).toContain('Último turno concluído');
        expect(ctx.output()).toContain('Ler arquivo');
        expect(ctx.output()).toContain('Interação humana recente');
        expect(ctx.output()).toContain('ASK-CANONICAL?');
        expect(ctx.output()).toContain('resposta SIM');
        expect(ctx.output()).not.toContain('resposta=');
    });

    it('prioriza falhas operacionais recentes em vez de reads triviais posteriores', () => {
        vi.mocked(terminalFrontend.readTerminalActivityProjection).mockReturnValueOnce({
            current: {
                phase: 'idle',
                label: 'Pronto',
                detail: 'Turno concluído',
                source: 'terminal',
                severity: 'info',
                progress: null,
                toolName: null,
                startedAt: 1,
                updatedAt: 2,
                ageMs: 0,
            },
            history: [],
            turnTrace: {
                current: null,
                recent: [
                    {
                        traceId: 'turn:empty-after-answer',
                        turnId: 'empty-after-answer',
                        source: 'assistant',
                        status: 'failed',
                        startedAt: 40,
                        updatedAt: 45,
                        finishedAt: 45,
                        toolCount: 0,
                        fileCount: 0,
                        userInputCount: 0,
                        tools: [],
                        files: [],
                        userInputs: [],
                    },
                    {
                        traceId: 'turn:read-after',
                        turnId: 'read-after',
                        source: 'assistant',
                        status: 'completed',
                        startedAt: 30,
                        updatedAt: 35,
                        finishedAt: 35,
                        toolCount: 1,
                        fileCount: 1,
                        userInputCount: 0,
                        tools: [
                            {
                                toolName: 'read_file_content',
                                operation: 'read',
                                path: 'package.json',
                                target: 'package.json',
                                source: 'sdk',
                                status: 'completed',
                                success: true,
                                count: 1,
                                updatedAt: 35,
                            },
                        ],
                        files: [{ path: 'package.json', operation: 'read', source: 'sdk', count: 1, updatedAt: 35 }],
                        userInputs: [],
                    },
                    {
                        traceId: 'turn:exec-failed',
                        turnId: 'exec-failed',
                        source: 'assistant',
                        status: 'completed',
                        startedAt: 20,
                        updatedAt: 25,
                        finishedAt: 25,
                        toolCount: 1,
                        fileCount: 0,
                        userInputCount: 0,
                        tools: [
                            {
                                toolName: 'exec_command',
                                operation: 'run',
                                path: null,
                                target: 'node -e "process.exit(7)"',
                                source: 'sdk',
                                status: 'failed',
                                success: false,
                                count: 1,
                                updatedAt: 25,
                            },
                        ],
                        files: [],
                        userInputs: [],
                    },
                ],
            },
        });
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '40');

        expect(ctx.output()).toContain('Último turno concluído');
        expect(ctx.output()).toContain('Executar comando');
        expect(ctx.output()).toContain('execução · node -e "process.exit(7)" · falhou');
    });

    it('humaniza fases internas na timeline padrão', () => {
        vi.mocked(terminalFrontend.readTerminalActivityProjection).mockReturnValueOnce({
            current: {
                phase: 'system',
                label: 'Uso BYOK sem Premium Request',
                detail: 'modelo kilo-auto/free',
                source: 'agent',
                severity: 'info',
                progress: null,
                toolName: null,
                startedAt: 1,
                updatedAt: 2,
                ageMs: 0,
            },
            history: [
                {
                    phase: 'system',
                    label: 'Uso BYOK sem Premium Request',
                    detail: 'modelo kilo-auto/free',
                    source: 'agent',
                    severity: 'info',
                    progress: null,
                    toolName: null,
                    startedAt: 1,
                    updatedAt: 2,
                    ageMs: 0,
                    ts: 2,
                },
                {
                    phase: 'task',
                    label: 'Tarefa em segundo plano concluída',
                    detail: 'Pergunta pendente persistida limpa',
                    source: 'agent',
                    severity: 'info',
                    progress: null,
                    toolName: null,
                    startedAt: 1,
                    updatedAt: 2,
                    ageMs: 0,
                    ts: 2,
                },
                {
                    phase: 'turn',
                    label: 'Processando mensagem',
                    detail: 'Faça um teste integrado canônico do terminal',
                    source: 'dialog',
                    severity: 'info',
                    progress: null,
                    toolName: null,
                    startedAt: 1,
                    updatedAt: 2,
                    ageMs: 0,
                    ts: 2,
                },
                {
                    phase: 'turn',
                    label: 'Intenção da LLM-B',
                    detail: 'terminal live canonical deltas tools ask_user usage',
                    source: 'sdk/assistant.intent',
                    severity: 'info',
                    progress: null,
                    toolName: null,
                    startedAt: 1,
                    updatedAt: 2,
                    ageMs: 0,
                    ts: 2,
                },
                {
                    phase: 'system',
                    label: 'Resposta concluída',
                    detail: '9.5s',
                    source: 'terminal',
                    severity: 'info',
                    progress: null,
                    toolName: null,
                    startedAt: 1,
                    updatedAt: 2,
                    ageMs: 0,
                    ts: 2,
                },
                {
                    phase: 'boot',
                    label: 'Inicializando terminal',
                    detail: 'Preparando aliases',
                    source: 'terminal',
                    severity: 'info',
                    progress: null,
                    toolName: null,
                    startedAt: 1,
                    updatedAt: 2,
                    ageMs: 0,
                    ts: 2,
                },
            ],
            turnTrace: {
                current: null,
                recent: [],
            },
        });
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '5');

        expect(ctx.output()).toMatch(/Estado\s+sistema/u);
        expect(ctx.output()).toContain('Timeline operacional');
        expect(ctx.output()).toContain('/activity detail');
        expect(ctx.output()).toContain('Mais detalhes');
        expect(ctx.output()).not.toContain('sistema · Uso BYOK sem Premium Request');
        expect(ctx.output()).toContain('Tarefa em segundo plano concluída');
        expect(ctx.output()).not.toContain('tarefa · Tarefa em segundo plano concluída');
        expect(ctx.output()).not.toContain('turno · Processando mensagem');
        expect(ctx.output()).toContain('Intenção da LLM-B');
        expect(ctx.output()).not.toContain('turno · Intenção da LLM-B');
        expect(ctx.output()).toContain('Resposta concluída');
        expect(ctx.output()).not.toContain('sistema · Resposta concluída');
        expect(ctx.output()).not.toContain('inicialização · Inicializando terminal');
        expect(ctx.output()).not.toContain('system · Uso BYOK');
        expect(ctx.output()).not.toContain('task · Tarefa');
        expect(ctx.output()).not.toContain('boot · Inicializando');
    });

    it('preserva nomes de protocolo em detalhes livres da intenção', () => {
        vi.mocked(terminalFrontend.readTerminalActivityProjection).mockReturnValueOnce({
            current: {
                phase: 'idle',
                label: 'Pronto',
                detail: 'Turno concluído',
                source: 'terminal',
                severity: 'info',
                progress: null,
                toolName: null,
                startedAt: 1,
                updatedAt: 2,
                ageMs: 0,
            },
            history: [
                {
                    phase: 'turn',
                    label: 'Intenção da LLM-B',
                    detail: 'terminal live canonical deltas tools ask_user usage',
                    source: 'tool/report_intent_local',
                    severity: 'info',
                    progress: null,
                    toolName: null,
                    startedAt: 1,
                    updatedAt: 2,
                    ageMs: 0,
                    ts: 2,
                },
            ],
            turnTrace: {
                current: null,
                recent: [],
            },
        });
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, 'detail 5');

        expect(ctx.output()).toMatch(/terminal live canonical deltas\s+tools\s+ask_user usage/u);
        expect(ctx.output()).not.toContain('terminal live canonical deltas tools Pergunta ao operador usage');
        expect(ctx.output()).toContain('ferramenta · Intenção capturada');
        expect(ctx.output()).not.toContain('tool/report_intent_local');
    });

    it('trata confirmação cruzada SDK/IO do mesmo arquivo como uma operação única', () => {
        vi.mocked(terminalFrontend.readTerminalActivityProjection).mockReturnValueOnce({
            current: {
                phase: 'idle',
                label: 'Pronto',
                detail: 'Turno concluído',
                source: 'terminal',
                severity: 'info',
                progress: null,
                toolName: null,
                startedAt: 1,
                updatedAt: 2,
                ageMs: 0,
            },
            history: [],
            turnTrace: {
                current: {
                    traceId: 'turn:file-roundtrip',
                    turnId: 'file-roundtrip',
                    source: 'assistant',
                    status: 'completed',
                    startedAt: 1,
                    updatedAt: 2,
                    finishedAt: 3,
                    toolCount: 2,
                    fileCount: 2,
                    userInputCount: 0,
                    tools: [],
                    files: [
                        {
                            path: '/workspaces/chatgpt-docker-puppeteer/.tmp/terminal-live/source.txt',
                            operation: 'move',
                            source: 'sdk',
                            count: 1,
                            updatedAt: 2,
                        },
                        {
                            path: '.tmp/terminal-live/source.txt',
                            operation: 'move',
                            source: 'io',
                            count: 1,
                            updatedAt: 3,
                        },
                    ],
                    userInputs: [],
                },
                recent: [],
            },
        });
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '5');

        expect(ctx.output()).toContain('Arquivos tocados');
        expect(ctx.output()).toContain('Arquivo');
        expect(ctx.output()).toContain('movimento · .tmp/terminal-live/source.txt');
        expect(ctx.output()).not.toContain('.tmp/terminal-live/source.txt ×2');
    });

    it('mantém eventos de boot no default quando ainda não existe evento operacional melhor', () => {
        vi.mocked(terminalFrontend.readTerminalActivityProjection).mockReturnValueOnce({
            current: {
                phase: 'boot',
                label: 'Inicializando terminal',
                detail: 'Preparando aliases',
                source: 'terminal',
                severity: 'info',
                progress: null,
                toolName: null,
                startedAt: 1,
                updatedAt: 2,
                ageMs: 0,
            },
            history: [
                {
                    phase: 'boot',
                    label: 'Inicializando terminal',
                    detail: 'Preparando aliases',
                    source: 'terminal',
                    severity: 'info',
                    progress: null,
                    toolName: null,
                    startedAt: 1,
                    updatedAt: 2,
                    ageMs: 0,
                    ts: 2,
                },
            ],
            turnTrace: {
                current: null,
                recent: [],
            },
        });
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '5');

        expect(ctx.output()).toContain('Timeline operacional');
        expect(ctx.output()).toContain('inicialização · Inicializando terminal');
    });
});
