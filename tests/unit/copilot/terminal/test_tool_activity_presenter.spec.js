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
});
