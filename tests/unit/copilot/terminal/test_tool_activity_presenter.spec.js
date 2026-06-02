// @ts-check

import { describe, expect, it } from 'vitest';

import { buildTerminalToolActivityPresentation } from '../../../../src/copilot/terminal/events/tool-activity-presenter.js';

describe('terminal/tool-activity-presenter', () => {
    it('explicita alias legado e mantém operação canônica inferida', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'view',
            args: { path: 'src/copilot/terminal/repl/live-status-line.js' },
        });

        expect(presentation.toolName).toBe('view');
        expect(presentation.canonicalToolName).toBe('read_file_content');
        expect(presentation.displayToolName).toBe('read_file_content (alias: view)');
        expect(presentation.operation).toBe('read');
        expect(presentation.detail).toContain('lendo arquivo');
        expect(presentation.progressLinePrefix).toContain('read_file_content (alias: view)');
    });

    it('não adiciona ruído de alias para tool já canônica', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'read_file_content',
            args: { path: 'src/copilot/terminal/state/activity-state.js' },
        });

        expect(presentation.canonicalToolName).toBe('read_file_content');
        expect(presentation.displayToolName).toBe('read_file_content');
        expect(presentation.detail).not.toContain('alias');
    });

    it('mostra request_user_input como espera humana com preview da pergunta', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'request_user_input',
            args: { question: 'Qual caminho seguir?' },
        });

        expect(presentation.detail).toContain('aguardando decisão humana');
        expect(presentation.startLine).toContain('Qual caminho seguir?');
        expect(presentation.completeLine(true, '1.0s')).toContain('aguardando decisão humana concluído');
    });

    it('enriquece leitura com range efetivamente retornado no resultado', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'read_file_content',
            args: { path: 'src/copilot/tools/file/read-tools.js', startLine: 10 },
            result: {
                success: true,
                path: 'src/copilot/tools/file/read-tools.js',
                returnedLines: { start: 10, end: 18 },
            },
        });

        expect(presentation.operation).toBe('read');
        expect(presentation.target).toContain('linhas 10-18');
        expect(presentation.lineRange).toEqual({ start: 10, end: 18 });
        expect(presentation.completeLine(true, '0.2s')).toContain('linhas 10-18');
    });

    it('classifica tools de introspecção sem badge UNKNOWN', () => {
        const workspace = buildTerminalToolActivityPresentation({
            toolName: 'get_workspace_info',
            args: {},
        });
        const telemetry = buildTerminalToolActivityPresentation({
            toolName: 'get_telemetry',
            args: {},
        });
        const intent = buildTerminalToolActivityPresentation({
            toolName: 'report_intent',
            args: { intent: 'validar UX do terminal' },
        });

        expect(workspace.canonicalToolName).toBe('get_workspace_info');
        expect(workspace.operation).toBe('inspect');
        expect(workspace.detail).toContain('inspecionando contexto');
        expect(telemetry.operation).toBe('inspect');
        expect(intent.canonicalToolName).toBe('report_intent_local');
        expect(intent.operation).toBe('inspect');
    });

    it('ignora nomes genéricos do SDK quando há fallback real', () => {
        const presentation = buildTerminalToolActivityPresentation(
            {
                toolName: 'unknown',
                args: { path: 'src/copilot/terminal/events/tool-activity-presenter.js' },
            },
            'read_file_content',
        );

        expect(presentation.toolName).toBe('read_file_content');
        expect(presentation.canonicalToolName).toBe('read_file_content');
        expect(presentation.operation).toBe('read');
        expect(presentation.detail).toContain('lendo arquivo');
    });

    it('recupera identidade real de tool em payloads SDK aninhados', () => {
        const fromData = buildTerminalToolActivityPresentation({
            toolName: 'external_tool',
            data: {
                toolName: 'patch_file',
                args: { path: 'src/copilot/terminal/dialog/engine.js' },
            },
        });
        const fromJsonArguments = buildTerminalToolActivityPresentation({
            name: 'unknown',
            arguments: JSON.stringify({
                mcpToolName: 'read_file_content',
                path: 'src/copilot/terminal/events/sdk-session-events.js',
            }),
        });

        expect(fromData.toolName).toBe('patch_file');
        expect(fromData.operation).toBe('edit');
        expect(fromJsonArguments.toolName).toBe('read_file_content');
        expect(fromJsonArguments.operation).toBe('read');
    });

    it('classifica copy_file e move_file como operações canônicas com source/destination reais', () => {
        const copy = buildTerminalToolActivityPresentation({
            toolName: 'copy_file',
            args: { source: 'src/a.txt', destination: 'src/b.txt' },
        });
        const move = buildTerminalToolActivityPresentation({
            toolName: 'move_file',
            operation: 'move',
            args: { source: 'src/b.txt', destination: 'src/c.txt' },
            toolCallId: 'call-move',
        });

        expect(copy.operation).toBe('copy');
        expect(copy.detail).toContain('copiando arquivo');
        expect(copy.fileTargets).toEqual(['src/a.txt', 'src/b.txt']);
        expect(move.operation).toBe('move');
        expect(move.detail).toContain('movendo arquivo');
        expect(move.target).toContain('src/b.txt');
        expect(move.target).not.toContain('call-move');
        expect(move.completeLine(true, '0.1s')).toContain('movendo arquivo concluído');
    });
});
