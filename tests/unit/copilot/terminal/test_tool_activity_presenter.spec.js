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
        expect(presentation.displayToolName).toBe('view -> read_file_content');
        expect(presentation.operation).toBe('read');
        expect(presentation.detail).toContain('alias view -> read_file_content');
        expect(presentation.progressLinePrefix).toContain('view -> read_file_content');
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
});
