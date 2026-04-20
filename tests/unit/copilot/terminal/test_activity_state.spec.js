// @ts-check

import { describe, expect, it } from 'vitest';

import {
    clearTerminalActivityHistory,
    markTerminalActivityIdle,
    readTerminalActivityHistory,
    readTerminalActivitySnapshot,
    recordTerminalActivity,
} from '../../../../src/copilot/terminal/activity-state.js';

describe('terminal/activity-state', () => {
    it('registra atividade atual com progress e histórico', () => {
        clearTerminalActivityHistory();
        recordTerminalActivity('tool', 'Executando tool', {
            detail: 'web_fetch',
            toolName: 'web_fetch',
            progress: 40,
            source: 'sdk',
        });

        const snap = readTerminalActivitySnapshot();
        const history = readTerminalActivityHistory(5);

        expect(snap.phase).toBe('tool');
        expect(snap.toolName).toBe('web_fetch');
        expect(snap.progress).toBe(40);
        expect(history[0]?.label).toBe('Executando tool');
    });

    it('volta para idle com detalhe semântico', () => {
        markTerminalActivityIdle('Aguardando próxima mensagem');

        const snap = readTerminalActivitySnapshot();

        expect(snap.phase).toBe('idle');
        expect(snap.label).toBe('Pronto');
        expect(snap.detail).toContain('Aguardando');
    });

    it('não polui o histórico quando a atualização é semanticamente idêntica e sem histórico', () => {
        clearTerminalActivityHistory();
        recordTerminalActivity('streaming', 'Gerando resposta', {
            detail: 'gpt-5-mini · high',
            source: 'dialog',
            recordHistory: false,
        });
        recordTerminalActivity('streaming', 'Gerando resposta', {
            detail: 'gpt-5-mini · high',
            source: 'dialog',
            recordHistory: false,
        });

        const history = readTerminalActivityHistory(10);

        expect(history).toHaveLength(0);
        expect(readTerminalActivitySnapshot().label).toBe('Gerando resposta');
    });
});
