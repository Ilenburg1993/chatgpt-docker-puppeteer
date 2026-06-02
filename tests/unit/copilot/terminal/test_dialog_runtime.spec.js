// @ts-check

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('terminal/dialog/dialog-runtime', () => {
    it('expõe estado de load sem fingir queue depth antes do import', async () => {
        const mod = await import('../../../../src/copilot/terminal/dialog/dialog-runtime.js');
        const state = mod.getDialogRuntimeLoadState();

        expect(state).toEqual(
            expect.objectContaining({
                loaded: expect.any(Boolean),
                importInFlight: expect.any(Boolean),
            }),
        );
        expect(state.turnQueueDepth === null || typeof state.turnQueueDepth === 'number').toBe(true);
    });

    it('reseta promise de lazy import quando o import falha', async () => {
        const src = await readFile(
            new URL('../../../../src/copilot/terminal/dialog/dialog-runtime.js', import.meta.url),
            'utf8',
        );

        expect(src).toContain('.catch((err) => {');
        expect(src).toContain('_engineModulePromise = null;');
        expect(src).toContain('_engineModule = null;');
    });

    it('mantém lifecycle do dialog loop com stdout humano por padrão', async () => {
        const src = await readFile(
            new URL('../../../../src/copilot/terminal/dialog/engine.js', import.meta.url),
            'utf8',
        );

        expect(src).toContain('Preparando agente');
        expect(src).toContain('Conectando conversa');
        expect(src).toContain('Boot da conversa bloqueado pela policy SDK');
        expect(src).toContain('Retomando sessão sem prompt inicial');
        expect(src).toContain('Inicializando ambiente da conversa');
        expect(src).toContain("'Conectando conversa'");
        expect(src).not.toContain("'Conectando ao dialog loop'");
        expect(src).not.toContain("'Boot do dialog loop bloqueado pela policy SDK'");
        expect(src).not.toContain('println(\'\\x1b[90m  Iniciando AlwaysAliveAgent');
        expect(src).not.toContain('println(\'\\x1b[90m  Conectando ao agente');
        expect(src).not.toContain('println(\'\\x1b[90m  Reanexando sessão SDK');
        expect(src).not.toContain("detail: 'AlwaysAliveAgent start()'");

        const repl = await readFile(new URL('../../../../src/copilot/terminal/repl/repl.js', import.meta.url), 'utf8');
        expect(repl).toContain("'Inicializando conversa'");
        expect(repl).not.toContain("'Inicializando dialog loop'");

        const sdkEvents = await readFile(
            new URL('../../../../src/copilot/terminal/events/sdk-session-events.js', import.meta.url),
            'utf8',
        );
        expect(sdkEvents).toContain("'Modelo confirmado'");
        expect(sdkEvents).toContain("'Pergunta ao operador'");
        expect(sdkEvents).toContain("'Resposta do operador'");
        expect(sdkEvents).not.toContain("'Modelo SDK alterado'");
        expect(sdkEvents).not.toContain("'ask_user SDK solicitado'");
        expect(sdkEvents).not.toContain("'ask_user SDK respondido'");

        const agentEvents = await readFile(
            new URL('../../../../src/copilot/terminal/events/agent-runtime-events.js', import.meta.url),
            'utf8',
        );
        expect(agentEvents).toContain("'Pergunta ao operador reconciliada'");
        expect(agentEvents).not.toContain("'question.pending reconciliado pelo ask_user SDK'");

        expect(src).toContain('sem pergunta humana ou formulário pendente');
        expect(src).not.toContain('sem ask_user/elicitation pendente');
    });
});
