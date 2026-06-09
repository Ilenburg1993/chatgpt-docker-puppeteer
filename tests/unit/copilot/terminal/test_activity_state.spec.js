// @ts-check

import { describe, expect, it } from 'vitest';

import {
    clearTerminalActivityHistory,
    markTerminalActivityIdle,
    readTerminalActivityHistory,
    readTerminalActivitySnapshot,
    recordTerminalActivity,
} from '../../../../src/copilot/terminal/state/activity-state.js';

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

    it('redige secrets em detalhes e alvos antes de expor snapshot/histórico', () => {
        clearTerminalActivityHistory();
        const secret = 'sk-supersecret1234567890';
        recordTerminalActivity('tool', 'Executando tool', {
            detail: `api_key=${secret}`,
            toolName: 'exec_command',
            toolTarget: `curl -H "Authorization: Bearer ${secret}" https://example.test`,
            source: 'sdk',
        });

        const serializedSnapshot = JSON.stringify(readTerminalActivitySnapshot());
        const serializedHistory = JSON.stringify(readTerminalActivityHistory(5));

        expect(serializedSnapshot).not.toContain(secret);
        expect(serializedHistory).not.toContain(secret);
        expect(serializedSnapshot).toContain('api_key=[redacted]');
        expect(serializedSnapshot).toContain('Bearer [redacted]');
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

    it('mantém foco em tool ativa quando eventos periféricos de sistema chegam', () => {
        clearTerminalActivityHistory();
        recordTerminalActivity('tool', 'Executando tool', {
            detail: 'executando comando',
            toolName: 'bash',
            source: 'sdk',
        });
        recordTerminalActivity('system', 'Tarefas em segundo plano do SDK', {
            detail: '0 pendentes',
            source: 'sdk',
            recordHistory: false,
        });

        const snap = readTerminalActivitySnapshot();

        expect(snap.phase).toBe('tool');
        expect(snap.label).toBe('Executando tool');
        expect(snap.toolName).toBe('bash');
    });

    it('mantém foco em tool ativa quando watchdog de thinking chega em background', () => {
        clearTerminalActivityHistory();
        recordTerminalActivity('tool', 'Executando tool', {
            detail: 'executando comando',
            toolName: 'exec_command',
            toolTarget: 'npm test',
            source: 'sdk',
        });
        recordTerminalActivity('thinking', 'LLM-B trabalhando', {
            detail: '10s sem resposta visível',
            source: 'dialog',
            recordHistory: false,
            focusMode: 'background',
        });

        const snap = readTerminalActivitySnapshot();

        expect(snap.phase).toBe('tool');
        expect(snap.toolName).toBe('exec_command');
        expect(snap.toolTarget).toBe('npm test');
    });

    it('permite que watchdog de thinking em background refine preparação genérica de turno', () => {
        clearTerminalActivityHistory();
        recordTerminalActivity('turn', 'Preparando resposta', {
            detail: 'prompt do operador',
            source: 'dialog',
        });
        recordTerminalActivity('thinking', 'LLM-B trabalhando', {
            detail: '10s sem resposta visível',
            source: 'dialog',
            recordHistory: false,
            focusMode: 'background',
        });

        expect(readTerminalActivitySnapshot().phase).toBe('thinking');
    });

    it('não libera foco de tool por conclusão de tarefa não relacionada', () => {
        clearTerminalActivityHistory();
        recordTerminalActivity('tool', 'Executando tool', {
            detail: 'executando comando',
            toolName: 'exec_command',
            source: 'sdk',
        });
        recordTerminalActivity('task', 'Tarefa em segundo plano concluída', {
            detail: 'tarefa auxiliar',
            source: 'agent',
        });

        const snap = readTerminalActivitySnapshot();

        expect(snap.phase).toBe('tool');
        expect(snap.toolName).toBe('exec_command');
    });

    it('libera foco de tool ao receber conclusão da mesma tool', () => {
        clearTerminalActivityHistory();
        recordTerminalActivity('tool', 'Executando tool', {
            detail: 'executando comando',
            toolName: 'bash',
            source: 'sdk',
        });
        recordTerminalActivity('tool', 'Tool concluída', {
            detail: 'executando comando concluído',
            toolName: 'bash',
            source: 'sdk',
        });

        const snap = readTerminalActivitySnapshot();

        expect(snap.phase).toBe('tool');
        expect(snap.label).toBe('Tool concluída');
    });

    it('registra evento observado sem substituir a atividade atual', () => {
        clearTerminalActivityHistory();
        markTerminalActivityIdle('Aguardando próxima mensagem');
        recordTerminalActivity('task', 'Tarefa em segundo plano concluída', {
            detail: '0 fragmentos · 0 caracteres',
            source: 'agent',
            recordHistory: true,
            updateCurrent: false,
        });

        const snap = readTerminalActivitySnapshot();
        const history = readTerminalActivityHistory(5);

        expect(snap.phase).toBe('idle');
        expect(snap.label).toBe('Pronto');
        expect(history[0]?.label).toBe('Tarefa em segundo plano concluída');
    });
});
